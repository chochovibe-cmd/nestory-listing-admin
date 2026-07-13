/**
 * D1 core: finalize one draft's images → Shopify Files CDN.
 * Used by POST /api/images/finalize and D2 send-images auto-chain.
 * Never call via HTTP self-fetch — invoke this function in-process.
 *
 * Does NOT run sharp. Only main+variant. Failures keep prior URL (no fake CDN).
 */

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
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { ImageType } from "@/types/domain";

const PRODUCT_IMAGES_BUCKET = "product-images";

export type FinalizeServiceClient = ReturnType<typeof createServiceSupabaseClient>;

export type FinalizeImageRow = {
  id: string;
  draft_id: string;
  image_type: ImageType | string;
  original_file_url: string | null;
  processed_file_url: string | null;
  alt_text: string | null;
  processing_status: string;
  sort_order: number;
};

export type FinalizePerImageResult = {
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

export type RunFinalizeForDraftInput = {
  serviceSupabase: FinalizeServiceClient;
  draftId: string;
  imageIds?: string[] | null;
};

export type RunFinalizeForDraftResult =
  | {
      ok: true;
      draftId: string;
      uploaded: number;
      skipped: number;
      failed: number;
      results: FinalizePerImageResult[];
      storage: ProcessedImageStorage;
      operations: typeof SHOPIFY_FILES_OPERATIONS;
      message?: string;
      error?: undefined;
      httpStatus?: undefined;
    }
  | {
      ok: false;
      draftId: string;
      error: string;
      httpStatus: number;
      uploaded?: number;
      skipped?: number;
      failed?: number;
      results?: FinalizePerImageResult[];
      storage?: ProcessedImageStorage;
      operations?: typeof SHOPIFY_FILES_OPERATIONS;
      message?: string;
    };

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

function guessMimeAndFilename(
  sourceUrl: string,
  imageId: string
): { mimeType: string; filename: string } {
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
  return { mimeType: "image/webp", filename: `${imageId}.webp` };
}

/**
 * Upload one draft's main+variant images to Shopify Files; write CDN URLs.
 */
export async function runFinalizeForDraft(
  input: RunFinalizeForDraftInput
): Promise<RunFinalizeForDraftResult> {
  const { serviceSupabase } = input;
  const draftId = input.draftId.trim();
  if (!draftId) {
    return { ok: false, draftId: "", error: "draftId is required", httpStatus: 400 };
  }

  let imageIdsFilter: string[] | null = null;
  if (input.imageIds !== undefined && input.imageIds !== null) {
    if (!Array.isArray(input.imageIds) || !input.imageIds.every((id) => typeof id === "string")) {
      return { ok: false, draftId, error: "imageIds must be a string array when provided", httpStatus: 400 };
    }
    imageIdsFilter = [...new Set(input.imageIds.map((id) => id.trim()).filter(Boolean))];
    if (imageIdsFilter.length === 0) {
      return { ok: false, draftId, error: "imageIds is empty", httpStatus: 400 };
    }
    if (imageIdsFilter.length > SHARP_BATCH_MAX_IMAGES) {
      return {
        ok: false,
        draftId,
        error: `imageIds exceeds max ${SHARP_BATCH_MAX_IMAGES} per request`,
        httpStatus: 400
      };
    }
  }

  const { data: draft, error: draftError } = await serviceSupabase
    .from("product_drafts")
    .select("id")
    .eq("id", draftId)
    .maybeSingle();

  if (draftError) {
    return { ok: false, draftId, error: draftError.message, httpStatus: 500 };
  }
  if (!draft) {
    return { ok: false, draftId, error: "Draft not found", httpStatus: 404 };
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
    return { ok: false, draftId, error: imageError.message, httpStatus: 500 };
  }

  const images = (imageRows ?? []) as FinalizeImageRow[];

  if (imageIdsFilter) {
    const found = new Set(images.map((r) => r.id));
    const missing = imageIdsFilter.filter((id) => !found.has(id));
    if (missing.length) {
      return {
        ok: false,
        draftId,
        error: `imageIds not found on this draft: ${missing.join(", ")}`,
        httpStatus: 404
      };
    }
  }

  if (images.length === 0) {
    return {
      ok: true,
      draftId,
      uploaded: 0,
      skipped: 0,
      failed: 0,
      results: [],
      storage: "none",
      operations: SHOPIFY_FILES_OPERATIONS,
      message: "No product_images rows to consider."
    };
  }

  if (images.length > SHARP_BATCH_MAX_IMAGES) {
    return {
      ok: false,
      draftId,
      error: `Draft has ${images.length} candidate rows; max ${SHARP_BATCH_MAX_IMAGES} per request. Pass imageIds to chunk.`,
      httpStatus: 400
    };
  }

  const results: FinalizePerImageResult[] = [];
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

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
        .update({ processing_error: errMsg.slice(0, 500) })
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
          .update({ processing_error: upload.error.slice(0, 500) })
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
        reason:
          source.kind === "processed" ? "uploaded from processed temp" : "uploaded from original fallback",
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
        .update({ processing_error: message.slice(0, 500) })
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
    uploaded > 0 || results.some((r) => r.storage === "shopify_cdn" && r.status !== "failed");

  const storage: ProcessedImageStorage = anyCdn ? "shopify_cdn" : "supabase_temp";

  if (failed === 0) {
    return {
      ok: true,
      draftId,
      uploaded,
      skipped,
      failed,
      results,
      storage,
      operations: SHOPIFY_FILES_OPERATIONS
    };
  }

  return {
    ok: false,
    draftId,
    error: `${failed} image(s) failed finalize`,
    httpStatus: 200,
    uploaded,
    skipped,
    failed,
    results,
    storage,
    operations: SHOPIFY_FILES_OPERATIONS
  };
}
