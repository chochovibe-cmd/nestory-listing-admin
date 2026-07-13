/**
 * D1 image hosting pipeline skeleton (Nestory 圖床架構).
 *
 * Full chain (Supabase = temp workspace, Shopify Files = permanent CDN):
 *
 *  1. Browser → Supabase Storage product-images (original)
 *     Path: {userId}/{draftId}/{type}/{uuid}.ext
 *     Table: product_images.original_file_url
 *     Status: processing_status = uploaded
 *     ✅ DONE (ImageUploader)
 *
 *  2. Vision / copy generation reads original public URL
 *     ✅ DONE (analyze-images / generate)
 *
 *  3. Operator marks process_intent per pipeline image (keep | de_text | regenerate)
 *     ✅ DONE (B5 ResultCard / ImageUploader)
 *
 *  4. 送圖 creates image_batches + items (status starts queued)
 *     ✅ DONE (B14 /api/drafts/batch/send-images)
 *
 *  5. D2-open auto chain (server-side, after batch insert) ✅
 *     - Prefer snapshot_json marks (anti drift)
 *     - Q1-A: whole draft all pipeline images = keep → run sharp in-process
 *       (runSharpBatchForDraft); any de_text/regenerate → item stays queued
 *       (awaiting_d4), batch may stay queued; no auto sharp/finalize
 *     - Q2-A: if sharp ≥1 success → runFinalizeForDraft (default on)
 *     - Q4-A: serial drafts; maxDuration 60s; stop when remaining <8s
 *     - Never HTTP self-fetch /api/images/* (auth/deadlock)
 *     - Optional MAKE_WEBHOOK_URL → notifyMake("image_batch_submitted") once
 *       after receipt (+ chain summary); missing/fail never fails 送圖
 *     - Failures: draft.warnings short lines; no fake CDN
 *
 *  6. keep_as_is → runSharpBatchForDraft / POST /api/images/sharp-batch
 *     (one draft, ≤12 images) — also used standalone
 *     → WebP q82, long edge ≤2048, write processed WebP to Supabase temp
 *     → product_images.processed_file_url = supabase public URL (NOT shopify CDN)
 *     → storage label: supabase_temp
 *     ✅ D3
 *
 *  7. de_text / regenerate → Image API (Make waits 20–60s) — ❌ D4
 *     then re-enter sharp/finalize. sharp-batch SKIPS these with honest reason (Q4-A).
 *
 *  8. finalize → Shopify Files permanent CDN  ✅ D1
 *     runFinalizeForDraft / POST /api/images/finalize { draftId, imageIds? }
 *     → only main+variant (spec/detail skip); no sharp re-run
 *     → source: already CDN skip | processed_file_url | fallback original
 *     → stagedUploadsCreate → multipart direct to staged URL → fileCreate
 *     → short poll fileStatus (~5×800ms) for image.url / preview
 *     → overwrite processed_file_url with CDN; storage: shopify_cdn
 *     → best-effort delete old Supabase …/processed/{imageId}.webp (not original)
 *     Failures keep prior URL; no fake CDN. Auth: worker Bearer or session+canOperate.
 *
 *  9. Image review UI (D5) — ✅ /review + review-confirm/reject
 *     image_status stays "done" after sharp; human pass = image_flags.image_review=approved
 *     (not a new awaiting_review enum; see Mockup diff 21).
 *     Slider label may still say「處理後（暫存）」even after CDN (Q5-extra: no UI change).
 *
 * 10. Publish productCreateMedia attaching Files CDN URLs
 *     Current publish still falls back to processed || original (CDN preferred once finalized).
 *
 * 11. On published/archived → delete Supabase temp originals (+ rejected Files via fileDelete)
 *     ❌ full cleanup Cron — not this package (D1 only deletes processed temp after CDN success)
 *
 * Auth for pipeline APIs:
 *   - Operator cookie session (canOperate), or
 *   - WORKER_API_TOKEN Bearer (Make / scripts)
 *
 * API never accepts multipart file bodies (Vercel 4.5MB limit / 圖床鐵則).
 */

import type { ImageProcessIntent, ImageStatus, ImageType } from "@/types/domain";

/** Where a processed URL currently lives (honest labels for API responses). */
export type ProcessedImageStorage =
  | "supabase_temp"
  | "shopify_cdn"
  | "none";

export type PipelineImageDecision =
  | { action: "process_sharp"; reason: string }
  | { action: "skip"; reason: string };

/**
 * Decide what sharp-batch should do for one product_images row.
 *
 * @param explicitImageIds — when true, caller passed imageIds (engineering mode):
 *   unmarked pipeline images may still be processed. When false (whole-draft auto),
 *   unmarked → skip with warning (Q4 / 未標記規則).
 */
export function decideSharpAction(input: {
  imageType: ImageType | string;
  processIntent: ImageProcessIntent | null | undefined;
  originalFileUrl: string | null | undefined;
  explicitImageIds: boolean;
}): PipelineImageDecision {
  if (!isPipelineImageType(input.imageType)) {
    return {
      action: "skip",
      reason: `image_type=${input.imageType} is not a pipeline image (detail/Vision-only skipped)`
    };
  }

  if (!input.originalFileUrl?.trim()) {
    return { action: "skip", reason: "missing original_file_url" };
  }

  const intent = input.processIntent ?? null;

  if (intent === "de_text") {
    return {
      action: "skip",
      reason: "process_intent=de_text; needs D4 Image API (not sharp-only)"
    };
  }

  if (intent === "regenerate") {
    return {
      action: "skip",
      reason: "process_intent=regenerate; needs D4 Image API (not sharp-only)"
    };
  }

  if (intent === "keep") {
    return { action: "process_sharp", reason: "process_intent=keep" };
  }

  // Unmarked (null)
  if (input.explicitImageIds) {
    return {
      action: "process_sharp",
      reason: "unmarked but imageIds explicitly requested (engineering mode)"
    };
  }

  return {
    action: "skip",
    reason: "unmarked process_intent; whole-draft mode skips until operator marks keep/de_text/regenerate"
  };
}

export function isPipelineImageType(imageType: ImageType | string): boolean {
  return imageType === "main" || imageType === "spec" || imageType === "variant";
}

/**
 * Aggregate draft.image_status after a sharp-batch run (Q3-A).
 * - any processed this request → at least processing was used
 * - all attempted process rows done and none failed → done
 * - any failed among attempted → failed
 * - only skips, nothing processed → leave pending (caller may skip update)
 */
export function aggregateImageStatusAfterSharp(counts: {
  processed: number;
  failed: number;
  skipped: number;
}): ImageStatus | null {
  if (counts.processed === 0 && counts.failed === 0) {
    // Nothing ran — do not invent a status change.
    return null;
  }
  if (counts.failed > 0 && counts.processed === 0) {
    return "failed";
  }
  if (counts.failed > 0) {
    // Partial: honest failed (operator can re-run).
    return "failed";
  }
  return "done";
}

/** Supabase Storage path for processed WebP (temp until Shopify Files). */
export function buildProcessedStoragePath(params: {
  ownerSegment: string;
  draftId: string;
  imageId: string;
}): string {
  // ownerSegment = first path segment of original (usually userId), or "system".
  return `${params.ownerSegment}/${params.draftId}/processed/${params.imageId}.webp`;
}

/**
 * Extract Storage object path from a Supabase public URL for bucket product-images.
 * Returns null if URL is not under this bucket.
 */
export function storagePathFromProductImagesPublicUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = "/product-images/";
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  const path = url.slice(idx + marker.length).split("?")[0];
  return path ? decodeURIComponent(path) : null;
}

/** Owner folder from original storage path: {userId}/... */
export function ownerSegmentFromOriginalPath(storagePath: string | null, fallback = "system"): string {
  if (!storagePath) return fallback;
  const first = storagePath.split("/").filter(Boolean)[0];
  return first || fallback;
}
