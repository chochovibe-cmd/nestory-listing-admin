/**
 * D3 core: sharp-batch for ONE draft (≤12 images).
 * Used by POST /api/images/sharp-batch and D2 send-images auto-chain.
 * Never call via HTTP self-fetch — invoke this function in-process.
 */

import {
  aggregateImageStatusAfterSharp,
  buildProcessedStoragePath,
  decideSharpAction,
  ownerSegmentFromOriginalPath,
  storagePathFromProductImagesPublicUrl,
  type ProcessedImageStorage
} from "@/lib/images/imagePipeline";
import { processImageBuffer, SHARP_BATCH_MAX_IMAGES } from "@/lib/images/sharpProcess";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { ImageProcessIntent, ImageType } from "@/types/domain";

const PRODUCT_IMAGES_BUCKET = "product-images";
const STORAGE_LABEL: ProcessedImageStorage = "supabase_temp";

export type SharpBatchServiceClient = ReturnType<typeof createServiceSupabaseClient>;

export type SharpBatchImageRow = {
  id: string;
  draft_id: string;
  image_type: ImageType | string;
  original_file_url: string | null;
  processed_file_url: string | null;
  generated_file_url?: string | null;
  process_intent: ImageProcessIntent | null;
  processing_status: string;
  sort_order: number;
};

export type SharpBatchPerImageResult = {
  imageId: string;
  status: "done" | "skipped" | "failed";
  reason?: string;
  processedFileUrl?: string | null;
  storage?: ProcessedImageStorage;
  width?: number;
  height?: number;
  bytes?: number;
  error?: string;
};

export type RunSharpBatchForDraftInput = {
  serviceSupabase: SharpBatchServiceClient;
  draftId: string;
  /** When set, only these image ids; enables engineering mode for unmarked. */
  imageIds?: string[] | null;
  /**
   * D4: after AI wrote generated_file_url, sharp de_text/regenerate from that URL.
   * Default false — de_text/regen still skipped.
   */
  afterAi?: boolean;
};

export type RunSharpBatchForDraftResult =
  | {
      ok: true;
      draftId: string;
      processed: number;
      skipped: number;
      failed: number;
      results: SharpBatchPerImageResult[];
      imageStatus: string;
      storageDefault: ProcessedImageStorage;
      message?: string;
      error?: undefined;
      httpStatus?: undefined;
    }
  | {
      ok: false;
      draftId: string;
      error: string;
      httpStatus: number;
      processed?: number;
      skipped?: number;
      failed?: number;
      results?: SharpBatchPerImageResult[];
      imageStatus?: string;
      storageDefault?: ProcessedImageStorage;
      message?: string;
    };

async function fetchOriginalBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: { Accept: "image/*,*/*" }
  });
  if (!response.ok) {
    throw new Error(`fetch original failed: HTTP ${response.status}`);
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
    throw new Error(`original too large: ${ab.byteLength} bytes`);
  }
  return Buffer.from(ab);
}

/**
 * Process one draft's pipeline images with sharp → Supabase temp WebP.
 * Does not touch draft.status or image_batches.
 */
export async function runSharpBatchForDraft(
  input: RunSharpBatchForDraftInput
): Promise<RunSharpBatchForDraftResult> {
  const { serviceSupabase } = input;
  const draftId = input.draftId.trim();
  if (!draftId) {
    return { ok: false, draftId: "", error: "draftId is required", httpStatus: 400 };
  }

  let explicitImageIds = false;
  let imageIdsFilter: string[] | null = null;
  const afterAi = input.afterAi === true;
  if (input.imageIds !== undefined && input.imageIds !== null) {
    if (!Array.isArray(input.imageIds) || !input.imageIds.every((id) => typeof id === "string")) {
      return { ok: false, draftId, error: "imageIds must be a string array when provided", httpStatus: 400 };
    }
    explicitImageIds = true;
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
    .select("id, image_status")
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
      "id, draft_id, image_type, original_file_url, processed_file_url, generated_file_url, process_intent, processing_status, sort_order"
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

  const images = (imageRows ?? []) as SharpBatchImageRow[];

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
      processed: 0,
      skipped: 0,
      failed: 0,
      results: [],
      imageStatus: (draft.image_status as string) ?? "pending",
      storageDefault: STORAGE_LABEL,
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

  const willProcess = images.some((img) => {
    const d = decideSharpAction({
      imageType: img.image_type,
      processIntent: img.process_intent,
      originalFileUrl: img.original_file_url,
      explicitImageIds,
      afterAi,
      generatedFileUrl: img.generated_file_url
    });
    return d.action === "process_sharp";
  });

  if (willProcess) {
    await serviceSupabase.from("product_drafts").update({ image_status: "processing" }).eq("id", draftId);
  }

  const results: SharpBatchPerImageResult[] = [];
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const img of images) {
    const decision = decideSharpAction({
      imageType: img.image_type,
      processIntent: img.process_intent,
      originalFileUrl: img.original_file_url,
      explicitImageIds,
      afterAi,
      generatedFileUrl: img.generated_file_url
    });

    if (decision.action === "skip") {
      skipped += 1;
      results.push({
        imageId: img.id,
        status: "skipped",
        reason: decision.reason,
        processedFileUrl: img.processed_file_url,
        storage: STORAGE_LABEL
      });
      continue;
    }

    try {
      await serviceSupabase
        .from("product_images")
        .update({ processing_status: "processing", processing_error: null })
        .eq("id", img.id);

      // afterAi: source = generated_file_url; else original
      const sourceUrl = afterAi
        ? (img.generated_file_url || "").trim()
        : (img.original_file_url || "").trim();
      if (!sourceUrl) {
        throw new Error(afterAi ? "missing generated_file_url" : "missing original_file_url");
      }
      const buffer = await fetchOriginalBuffer(sourceUrl);
      const out = await processImageBuffer(buffer, { square: false });

      const pathHint = storagePathFromProductImagesPublicUrl(
        img.original_file_url || sourceUrl
      );
      const owner = ownerSegmentFromOriginalPath(pathHint, "system");
      const storagePath = buildProcessedStoragePath({
        ownerSegment: owner,
        draftId,
        imageId: img.id
      });

      const { error: uploadError } = await serviceSupabase.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .upload(storagePath, out.buffer, {
          contentType: "image/webp",
          upsert: true
        });

      if (uploadError) {
        throw new Error(`storage upload failed: ${uploadError.message}`);
      }

      const { data: publicData } = serviceSupabase.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .getPublicUrl(storagePath);
      const processedUrl = publicData.publicUrl;

      const { error: updateError } = await serviceSupabase
        .from("product_images")
        .update({
          processed_file_url: processedUrl,
          processing_status: "done",
          processing_error: null
        })
        .eq("id", img.id);

      if (updateError) {
        throw new Error(`db update failed: ${updateError.message}`);
      }

      processed += 1;
      results.push({
        imageId: img.id,
        status: "done",
        reason: decision.reason,
        processedFileUrl: processedUrl,
        storage: STORAGE_LABEL,
        width: out.width,
        height: out.height,
        bytes: out.bytes
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed += 1;
      await serviceSupabase
        .from("product_images")
        .update({
          processing_status: "failed",
          processing_error: message.slice(0, 500)
        })
        .eq("id", img.id);

      results.push({
        imageId: img.id,
        status: "failed",
        error: message,
        processedFileUrl: img.processed_file_url,
        storage: STORAGE_LABEL
      });
    }
  }

  const nextImageStatus = aggregateImageStatusAfterSharp({ processed, failed, skipped });
  let imageStatus = (draft.image_status as string) ?? "pending";
  if (nextImageStatus) {
    await serviceSupabase.from("product_drafts").update({ image_status: nextImageStatus }).eq("id", draftId);
    imageStatus = nextImageStatus;
  }

  if (failed === 0) {
    return {
      ok: true,
      draftId,
      processed,
      skipped,
      failed,
      results,
      imageStatus,
      storageDefault: STORAGE_LABEL
    };
  }

  return {
    ok: false,
    draftId,
    error: `${failed} image(s) failed sharp`,
    httpStatus: 200,
    processed,
    skipped,
    failed,
    results,
    imageStatus,
    storageDefault: STORAGE_LABEL
  };
}
