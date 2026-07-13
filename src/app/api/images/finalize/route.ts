/**
 * D1: Finalize processed images → Shopify Files CDN.
 *
 * Auth: WORKER_API_TOKEN Bearer OR session + canOperate (same as sharp-batch).
 * Body: { draftId, imageIds? } — single draft, ≤12 images, no multipart, no client URLs.
 *
 * Q1-A: does NOT run sharp.
 * Q5-A: only main + variant; spec/detail skipped.
 * Q2-A: CDN poll inside filesUpload.
 * Q3-A: one network retry per image.
 * Q4-A: best-effort delete old Supabase processed temp after CDN success.
 */

import { NextRequest } from "next/server";
import { requireWorkerToken, jsonError } from "@/lib/api/auth";
import { canOperate } from "@/lib/auth/roles";
import {
  storagePathFromProductImagesPublicUrl,
  type ProcessedImageStorage
} from "@/lib/images/imagePipeline";
import { SHARP_BATCH_MAX_IMAGES } from "@/lib/images/sharpProcess";
import {
  isFinalizeUploadImageType,
  isOwnProcessedTempPath,
  isShopifyCdnUrl,
  pickFinalizeSource,
  uploadProcessedImageToShopifyFilesWithRetry,
  SHOPIFY_FILES_OPERATIONS
} from "@/lib/shopify/filesUpload";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import type { ImageType, UserRole } from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 60;

const PRODUCT_IMAGES_BUCKET = "product-images";

type ImageRow = {
  id: string;
  draft_id: string;
  image_type: ImageType | string;
  original_file_url: string | null;
  processed_file_url: string | null;
  alt_text: string | null;
  processing_status: string;
  sort_order: number;
};

type PerImageResult = {
  imageId: string;
  status: "done" | "skipped" | "failed";
  reason?: string;
  processedFileUrl?: string | null;
  storage?: ProcessedImageStorage;
  fileGid?: string;
  tempDeleted?: boolean;
  error?: string;
  code?: string;
};

async function authorize(request: NextRequest): Promise<
  { ok: true; via: "worker" | "session" } | { ok: false; response: Response }
> {
  const worker = requireWorkerToken(request);
  if (worker.ok) return { ok: true, via: "worker" };

  // Worker token present but invalid → hard fail (do not fall through to session).
  const authHeader = request.headers.get("authorization");
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    const status = worker.error.includes("configured") ? 500 : 401;
    return { ok: false, response: jsonError(worker.error, status) };
  }

  try {
    const authSupabase = await createServerSupabaseClient();
    const {
      data: { user }
    } = await authSupabase.auth.getUser();
    if (!user) {
      return { ok: false, response: jsonError("Unauthorized", 401) };
    }
    const { data: profile } = await authSupabase.from("profiles").select("role").eq("id", user.id).single();
    if (!canOperate(profile?.role as UserRole | undefined)) {
      return { ok: false, response: jsonError("Operator role is required", 403) };
    }
    return { ok: true, via: "session" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auth failed";
    return { ok: false, response: jsonError(message, 500) };
  }
}

async function fetchImageBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: { Accept: "image/*,*/*" }
  });
  if (!response.ok) {
    throw new Error(`fetch source failed: HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !contentType.startsWith("image/") && !contentType.includes("octet-stream")) {
    throw new Error(`unexpected content-type: ${contentType}`);
  }
  const ab = await response.arrayBuffer();
  if (!ab.byteLength) {
    throw new Error("empty image body");
  }
  if (ab.byteLength > 25 * 1024 * 1024) {
    throw new Error(`image too large: ${ab.byteLength} bytes`);
  }
  return Buffer.from(ab);
}

function guessMimeAndFilename(sourceUrl: string, imageId: string): {
  mimeType: string;
  filename: string;
} {
  const lower = sourceUrl.toLowerCase().split("?")[0];
  if (lower.endsWith(".webp") || lower.includes("/processed/")) {
    return { mimeType: "image/webp", filename: `${imageId}.webp` };
  }
  if (lower.endsWith(".png")) {
    return { mimeType: "image/png", filename: `${imageId}.png` };
  }
  if (lower.endsWith(".gif")) {
    return { mimeType: "image/gif", filename: `${imageId}.gif` };
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return { mimeType: "image/jpeg", filename: `${imageId}.jpg` };
  }
  // Default: treat as webp when coming from our pipeline; jpeg otherwise.
  return { mimeType: "image/webp", filename: `${imageId}.webp` };
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return jsonError("Invalid JSON body", 400);
  }

  const draftId =
    typeof (body as { draftId?: unknown }).draftId === "string"
      ? (body as { draftId: string }).draftId.trim()
      : "";
  if (!draftId) {
    return jsonError("draftId is required", 400);
  }

  const rawImageIds = (body as { imageIds?: unknown }).imageIds;
  let imageIdsFilter: string[] | null = null;
  if (rawImageIds !== undefined && rawImageIds !== null) {
    if (!Array.isArray(rawImageIds) || !rawImageIds.every((id) => typeof id === "string")) {
      return jsonError("imageIds must be a string array when provided", 400);
    }
    imageIdsFilter = [...new Set(rawImageIds.map((id) => id.trim()).filter(Boolean))];
    if (imageIdsFilter.length === 0) {
      return jsonError("imageIds is empty", 400);
    }
    if (imageIdsFilter.length > SHARP_BATCH_MAX_IMAGES) {
      return jsonError(`imageIds exceeds max ${SHARP_BATCH_MAX_IMAGES} per request`, 400);
    }
  }

  let serviceSupabase: ReturnType<typeof createServiceSupabaseClient>;
  try {
    serviceSupabase = createServiceSupabaseClient();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Supabase service client unavailable";
    return jsonError(message, 500);
  }

  const { data: draft, error: draftError } = await serviceSupabase
    .from("product_drafts")
    .select("id")
    .eq("id", draftId)
    .maybeSingle();

  if (draftError) {
    return jsonError(draftError.message, 500);
  }
  if (!draft) {
    return jsonError("Draft not found", 404);
  }

  let query = serviceSupabase
    .from("product_images")
    .select(
      "id, draft_id, image_type, original_file_url, processed_file_url, alt_text, processing_status, sort_order"
    )
    .eq("draft_id", draftId)
    .order("sort_order", { ascending: true });

  if (imageIdsFilter) {
    query = query.in("id", imageIdsFilter);
  }

  const { data: imageRows, error: imageError } = await query;
  if (imageError) {
    return jsonError(imageError.message, 500);
  }

  const images = (imageRows ?? []) as ImageRow[];

  if (imageIdsFilter) {
    const found = new Set(images.map((r) => r.id));
    const missing = imageIdsFilter.filter((id) => !found.has(id));
    if (missing.length) {
      return jsonError(`imageIds not found on this draft: ${missing.join(", ")}`, 404);
    }
  }

  if (images.length === 0) {
    return Response.json({
      ok: true,
      draftId,
      auth: auth.via,
      uploaded: 0,
      skipped: 0,
      failed: 0,
      results: [],
      storage: "none" as ProcessedImageStorage,
      operations: SHOPIFY_FILES_OPERATIONS,
      message: "No product_images rows to consider."
    });
  }

  if (images.length > SHARP_BATCH_MAX_IMAGES) {
    return jsonError(
      `Draft has ${images.length} candidate rows; max ${SHARP_BATCH_MAX_IMAGES} per request. Pass imageIds to chunk.`,
      400
    );
  }

  const results: PerImageResult[] = [];
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  // Serial uploads only (Shopify rate limits).
  for (const img of images) {
    if (!isFinalizeUploadImageType(img.image_type)) {
      skipped += 1;
      results.push({
        imageId: img.id,
        status: "skipped",
        reason: `image_type=${img.image_type} not uploaded to Shopify Files (Q5-A: main+variant only)`,
        processedFileUrl: img.processed_file_url,
        storage: isShopifyCdnUrl(img.processed_file_url)
          ? "shopify_cdn"
          : img.processed_file_url
            ? "supabase_temp"
            : "none"
      });
      continue;
    }

    const source = pickFinalizeSource({
      processedFileUrl: img.processed_file_url,
      originalFileUrl: img.original_file_url
    });

    if (source.kind === "already_cdn") {
      skipped += 1;
      results.push({
        imageId: img.id,
        status: "skipped",
        reason: "already shopify_cdn (idempotent)",
        processedFileUrl: source.url,
        storage: "shopify_cdn"
      });
      continue;
    }

    if (source.kind === "none") {
      failed += 1;
      const errMsg = source.reason;
      await serviceSupabase
        .from("product_images")
        .update({
          processing_error: errMsg.slice(0, 500)
        })
        .eq("id", img.id);
      results.push({
        imageId: img.id,
        status: "failed",
        error: errMsg,
        code: "NO_SOURCE",
        processedFileUrl: img.processed_file_url,
        storage: "none"
      });
      continue;
    }

    const previousProcessedUrl = img.processed_file_url;
    const sourceUrl = source.url;

    try {
      const bytes = await fetchImageBuffer(sourceUrl);
      const { mimeType, filename } = guessMimeAndFilename(sourceUrl, img.id);

      const upload = await uploadProcessedImageToShopifyFilesWithRetry({
        filename,
        mimeType,
        fileSize: bytes.byteLength,
        bytes,
        alt: img.alt_text,
        sourceHint: sourceUrl
      });

      if (!upload.ok) {
        failed += 1;
        await serviceSupabase
          .from("product_images")
          .update({
            processing_error: upload.error.slice(0, 500)
            // Do NOT overwrite processed_file_url
          })
          .eq("id", img.id);

        results.push({
          imageId: img.id,
          status: "failed",
          error: upload.error,
          code: upload.code,
          fileGid: upload.fileGid,
          processedFileUrl: img.processed_file_url,
          storage: isShopifyCdnUrl(img.processed_file_url)
            ? "shopify_cdn"
            : img.processed_file_url
              ? "supabase_temp"
              : "none"
        });
        continue;
      }

      // Success: write CDN URL
      const { error: updateError } = await serviceSupabase
        .from("product_images")
        .update({
          processed_file_url: upload.cdnUrl,
          processing_status: "done",
          processing_error: null
        })
        .eq("id", img.id);

      if (updateError) {
        failed += 1;
        results.push({
          imageId: img.id,
          status: "failed",
          error: `db update failed after CDN upload: ${updateError.message}`,
          code: "DB_ERROR",
          fileGid: upload.fileGid,
          processedFileUrl: img.processed_file_url,
          storage: "supabase_temp"
        });
        continue;
      }

      // Storage label is in API response only — do not touch draft.image_flags
      // (D5 image_review lives there). Merge-only rule: never write image_flags = {}.

      // Q4-A: best-effort delete old Supabase processed temp
      let tempDeleted = false;
      if (previousProcessedUrl && !isShopifyCdnUrl(previousProcessedUrl)) {
        const storagePath = storagePathFromProductImagesPublicUrl(previousProcessedUrl);
        if (storagePath && isOwnProcessedTempPath(storagePath, draftId, img.id)) {
          try {
            const { error: removeError } = await serviceSupabase.storage
              .from(PRODUCT_IMAGES_BUCKET)
              .remove([storagePath]);
            if (!removeError) {
              tempDeleted = true;
            }
          } catch {
            // never fail the image for temp cleanup
          }
        }
      }

      uploaded += 1;
      results.push({
        imageId: img.id,
        status: "done",
        reason: source.kind === "processed" ? "uploaded from processed temp" : "uploaded from original fallback",
        processedFileUrl: upload.cdnUrl,
        storage: "shopify_cdn",
        fileGid: upload.fileGid,
        tempDeleted
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed += 1;
      await serviceSupabase
        .from("product_images")
        .update({
          processing_error: message.slice(0, 500)
        })
        .eq("id", img.id);

      results.push({
        imageId: img.id,
        status: "failed",
        error: message,
        code: "FETCH_OR_UPLOAD",
        processedFileUrl: img.processed_file_url,
        storage: isShopifyCdnUrl(img.processed_file_url)
          ? "shopify_cdn"
          : img.processed_file_url
            ? "supabase_temp"
            : "none"
      });
    }
  }

  const anyCdn =
    uploaded > 0 ||
    results.some((r) => r.storage === "shopify_cdn" && r.status !== "failed");

  const ok = failed === 0;
  return Response.json({
    ok,
    draftId,
    auth: auth.via,
    uploaded,
    skipped,
    failed,
    results,
    storage: anyCdn ? ("shopify_cdn" as const) : ("supabase_temp" as const),
    operations: SHOPIFY_FILES_OPERATIONS,
    note:
      "Success overwrites processed_file_url with Shopify CDN. Failures keep prior URL. Originals not deleted. D5 UI label unchanged."
  });
}
