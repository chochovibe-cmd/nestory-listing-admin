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
import { fetchServerImage } from "@/lib/images/fetchServerImage";
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
      error?: unde...[truncated]