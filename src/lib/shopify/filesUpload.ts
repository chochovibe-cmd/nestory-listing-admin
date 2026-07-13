/**
 * D1 thin skeleton: Shopify Files permanent image hosting.
 *
 * Full flow (NOT implemented in D-open — do not pretend CDN success):
 *
 *  1. stagedUploadsCreate (Admin GraphQL)
 *     → resource: FILE, filename, mimeType, httpMethod: POST, fileSize
 *     → returns stagedTargets[{ url, resourceUrl, parameters[] }]
 *
 *  2. Upload bytes to stagedTargets[0].url with form fields from parameters
 *     (file body goes to Shopify storage, NOT through Vercel as the long-term host)
 *
 *  3. fileCreate (Admin GraphQL) with originalSource = resourceUrl
 *     → returns file { id, ... } ; CDN URL via fileStatus / preview / image.url
 *
 *  4. Write permanent cdn.shopify.com URL into product_images.processed_file_url
 *     Label storage: shopify_cdn (see imagePipeline.ts)
 *
 *  5. Later: productCreateMedia attaches Files already on CDN
 *     Cleanup: fileDelete for rejected versions; delete Supabase temp originals
 *
 * Prerequisites: Shopify token scope write_files; callShopifyAdminGraphQL ready.
 *
 * This module only exports types + a not-implemented helper so callers can wire
 * POST /api/images/finalize without inventing success.
 */

import type { ProcessedImageStorage } from "@/lib/images/imagePipeline";

export type ShopifyFilesUploadInput = {
  /** Local or temp bytes already processed (e.g. WebP). */
  filename: string;
  mimeType: string;
  /** Byte length for stagedUploadsCreate. */
  fileSize: number;
  /**
   * Source the caller will upload. D-open does not perform the upload.
   * Future: Buffer | ReadableStream | public temp URL.
   */
  sourceHint?: string;
};

export type ShopifyFilesUploadResult =
  | {
      ok: true;
      storage: Extract<ProcessedImageStorage, "shopify_cdn">;
      cdnUrl: string;
      fileGid: string;
    }
  | {
      ok: false;
      code: "NOT_IMPLEMENTED" | "SHOPIFY_ERROR" | "CONFIG";
      error: string;
    };

/**
 * Upload a processed image to Shopify Files and return permanent CDN URL.
 * D-open: always NOT_IMPLEMENTED — real stagedUploadsCreate/fileCreate later.
 */
export async function uploadProcessedImageToShopifyFiles(
  _input: ShopifyFilesUploadInput
): Promise<ShopifyFilesUploadResult> {
  return {
    ok: false,
    code: "NOT_IMPLEMENTED",
    error:
      "Shopify Files upload not implemented in D-open. Next: stagedUploadsCreate → direct upload → fileCreate → write cdn.shopify.com to processed_file_url. Do not treat supabase_temp URLs as permanent CDN."
  };
}

/** GraphQL operation names reserved for the real implementation (documentation). */
export const SHOPIFY_FILES_OPERATIONS = {
  stagedUploadsCreate: "stagedUploadsCreate",
  fileCreate: "fileCreate",
  fileDelete: "fileDelete"
} as const;
