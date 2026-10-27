/**
 * 4e DETAIL-LISTING: put the description's detail images on Shopify Files before
 * publish / sync builds the payload, so the description only embeds Shopify CDN URLs.
 *
 * - Only rows from listDescriptionImagesToUpload (detail / generated_detail without a CDN URL).
 * - Success writes processed_file_url = CDN URL. original_file_url and the Supabase file are
 *   NEVER touched here (old storefront descriptions may still embed them; cleanup is 4e Part B).
 * - Never throws. A failed or late image is left out of the description and reported as a
 *   warning; the next publish / sync retries it (rows already on the CDN are skipped).
 */

import { fetchServerImage } from "@/lib/images/fetchServerImage";
import { guessMimeAndFilename } from "@/lib/images/runFinalize";
import {
  listDescriptionImagesToUpload,
  type DescriptionImageRow
} from "@/lib/contentGenerator/descriptionDetailImages";
import { uploadProcessedImageToShopifyFilesWithRetry } from "@/lib/shopify/filesUpload";

/** Parallel Shopify Files uploads per draft. */
export const DESCRIPTION_UPLOAD_CONCURRENCY = 4;
/** No new upload starts after this much time (publish / sync routes have 300s). */
export const DESCRIPTION_UPLOAD_BUDGET_MS = 120_000;

export type UploadDescriptionImagesDeps = {
  upload?: typeof uploadProcessedImageToShopifyFilesWithRetry;
  fetchBytes?: (url: string) => Promise<Buffer>;
  now?: () => number;
};

export type UploadDescriptionImagesResult = {
  attempted: number;
  uploaded: number;
  failed: number;
  skippedForTime: number;
  /** image id → new CDN URL, for callers that patch rows in memory instead of re-reading. */
  cdnById: Record<string, string>;
  warnings: string[];
};

type UpdateClient = {
  from: (table: string) => any;
};

async function defaultFetchBytes(url: string): Promise<Buffer> {
  const fetched = await fetchServerImage(url, { maxBytes: 25 * 1024 * 1024 });
  if (!fetched.ok) throw new Error(fetched.message);
  return fetched.bytes;
}

function sourceUrl...[truncated]