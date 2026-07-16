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
 *  5. D2 + D4 hybrid auto chain (server-side, after batch insert) ✅
 *     - Prefer snapshot_json marks (anti drift)
 *     - All-keep → run sharp in-process → finalize (default on)
 *     - Mixed de_text/regenerate (Q1-C): process keep sharp+finalize; try limited
 *       AI images if time budget allows; else awaiting_d4 for POST /api/images/ai-process
 *     - Q4-A: serial drafts; maxDuration 60s; stop when remaining <8s
 *     - Never HTTP self-fetch /api/images/* (auth/deadlock)
 *     - Optional MAKE_WEBHOOK_URL → notifyMake("image_batch_submitted") once
 *       after receipt (+ chain + optional d4 summary); missing/fail never fails 送圖
 *     - Failures: draft.warnings short lines; no fake CDN
 *
 *  6. keep_as_is → runSharpBatchForDraft / POST /api/images/sharp-batch
 *     (one draft, ≤12 images) — also used standalone
 *     → WebP q82, long edge ≤2048, write processed WebP to Supabase temp
 *     → product_images.processed_file_url = supabase public URL (NOT shopify CDN)
 *     → storage label: supabase_temp
 *     ✅ D3
 *
 *  7. de_text / regenerate → D4 Image API ✅
 *     runAiProcessForDraft / POST /api/images/ai-process
 *     → OpenAI images/edits (de_text) or images/generations (regenerate)
 *     → generated_file_url (Supabase temp) on success only
 *     → post-AI sharp (afterAi) → processed temp → default finalize CDN
 *     → Auth: worker Bearer or session+canOperate
 *     → Make may call this API; Make does NOT need to call OpenAI directly (差異 24)
 *     → Default sharp-batch (afterAi=false) still SKIPS de_text/regen
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
 * 10. D6-open batch notify — ✅ tryNotifyImageBatchIfComplete
 *     After auto-chain / ai-process updates batch: if ALL image_batch_items are
 *     done|failed|skipped → Email (Resend) + LINE Messaging Flex (not LINE Notify).
 *     Idempotent notify_sent_at (claim only if ≥1 channel sent). Missing keys → skip.
 *     Daily Cron /api/cron/stuck-batches (>24h → status stuck + stuck_notified_at).
 *     Events #2–#4 not implemented (publish / scouting / budget).
 *
 * 11. Publish productCreateMedia attaching Files CDN URLs
 *     Current publish still falls back to processed || original (CDN preferred once finalized).
 *
 * 12. On published/archived → delete Supabase temp originals (+ rejected Files via fileDelete)
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
  /**
   * D4 post-AI: process de_text/regenerate from generated_file_url
   * (same WebP rules as keep). Default false → skip D4 intents.
   */
  afterAi?: boolean;
  generatedFileUrl?: string | null | undefined;
}): PipelineImageDecision {
  if (!isPipelineImageType(input.imageType)) {
    return {
      action: "skip",
      reason: `image_type=${input.imageType} is not a pipeline image (detail/Vision-only skipped)`
    };
  }

  const intent = input.processIntent ?? null;

  // D4 post-AI sharp: use generated bytes as source
  if (input.afterAi && (intent === "de_text" || intent === "regenerate" || intent === "to_trad")) {
    if (!input.generatedFileUrl?.trim()) {
      return {
        action: "skip",
        reason: `afterAi but missing generated_file_url for ${intent}`
      };
    }
    return {
      action: "process_sharp",
      reason: `post-AI sharp from generated_file_url (${intent})`
    };
  }

  if (!input.originalFileUrl?.trim() && !input.afterAi) {
    return { action: "skip", reason: "missing original_file_url" };
  }

  if (intent === "de_text") {
    return {
      action: "skip",
      reason: "process_intent=de_text; needs D4 Image API (not sharp-only)"
    };
  }

  if (intent === "to_trad") {
    return {
      action: "skip",
      reason: "process_intent=to_trad; needs D4 Image API (not sharp-only; R2 mark-only)"
    };
  }

  if (intent === "regenerate") {
    return {
      action: "skip",
      reason: "process_intent=regenerate; needs D4 Image API (not sharp-only)"
    };
  }

  if (intent === "keep") {
    if (!input.originalFileUrl?.trim()) {
      return { action: "skip", reason: "missing original_file_url" };
    }
    return { action: "process_sharp", reason: "process_intent=keep" };
  }

  // Unmarked (null)
  if (input.explicitImageIds) {
    if (!input.originalFileUrl?.trim()) {
      return { action: "skip", reason: "missing original_file_url" };
    }
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

/** Supabase Storage path for D4 AI raw output (before sharp). */
export function buildGeneratedStoragePath(params: {
  ownerSegment: string;
  draftId: string;
  imageId: string;
  ext?: string;
}): string {
  const ext = (params.ext || "png").replace(/^\./, "");
  return `${params.ownerSegment}/${params.draftId}/generated/${params.imageId}.${ext}`;
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
