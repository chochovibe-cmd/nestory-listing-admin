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

function sourceUrlOf(row: DescriptionImageRow): string | null {
  for (const raw of [row.processed_file_url, row.original_file_url, row.generated_file_url]) {
    const url = typeof raw === "string" ? raw.trim() : "";
    if (url) return url;
  }
  return null;
}

export async function uploadDescriptionImagesToShopifyFiles(input: {
  serviceSupabase: UpdateClient;
  draftId: string;
  images: DescriptionImageRow[] | null | undefined;
  deps?: UploadDescriptionImagesDeps;
}): Promise<UploadDescriptionImagesResult> {
  const upload = input.deps?.upload ?? uploadProcessedImageToShopifyFilesWithRetry;
  const fetchBytes = input.deps?.fetchBytes ?? defaultFetchBytes;
  const now = input.deps?.now ?? (() => Date.now());
  const startedAt = now();

  const todo = listDescriptionImagesToUpload(input.images);
  const result: UploadDescriptionImagesResult = {
    attempted: 0,
    uploaded: 0,
    failed: 0,
    skippedForTime: 0,
    cdnById: {},
    warnings: []
  };
  if (!todo.length) return result;

  const recordError = async (id: string, message: string) => {
    try {
      await input.serviceSupabase
        .from("product_images")
        .update({ processing_error: message.slice(0, 500) })
        .eq("id", id);
    } catch {
      // the warning below is enough
    }
  };

  const uploadOne = async (row: DescriptionImageRow) => {
    const source = sourceUrlOf(row);
    if (!source) {
      result.failed += 1;
      await recordError(row.id, "missing image URL");
      return;
    }
    try {
      const bytes = await fetchBytes(source);
      const { mimeType, filename } = guessMimeAndFilename(source, row.id);
      const up = await upload({
        filename,
        mimeType,
        fileSize: bytes.byteLength,
        bytes,
        alt: row.alt_text ?? null,
        sourceHint: source
      });
      if (!up.ok) {
        result.failed += 1;
        await recordError(row.id, up.error);
        return;
      }
      const { error } = await input.serviceSupabase
        .from("product_images")
        .update({ processed_file_url: up.cdnUrl, processing_status: "done", processing_error: null })
        .eq("id", row.id);
      if (error) {
        result.failed += 1;
        return;
      }
      result.uploaded += 1;
      result.cdnById[row.id] = up.cdnUrl;
    } catch (err) {
      result.failed += 1;
      await recordError(row.id, err instanceof Error ? err.message : String(err));
    }
  };

  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      if (now() - startedAt >= DESCRIPTION_UPLOAD_BUDGET_MS) return;
      const row = todo[next++];
      result.attempted += 1;
      await uploadOne(row);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(DESCRIPTION_UPLOAD_CONCURRENCY, todo.length) }, worker)
  );
  result.skippedForTime = todo.length - result.attempted;

  if (result.failed > 0) {
    result.warnings.push(
      `詳情圖上傳 Shopify 失敗 ${result.failed} 張，這次沒放進描述；再同步一次會補上`
    );
  }
  if (result.skippedForTime > 0) {
    result.warnings.push(
      `詳情圖還有 ${result.skippedForTime} 張來不及上傳，這次沒放進描述；再同步一次會補上`
    );
  }
  return result;
}

/** Apply cdnById onto in-memory rows (processed_file_url only). */
export function applyDescriptionImageCdnUrls<T extends DescriptionImageRow>(
  images: T[] | null | undefined,
  cdnById: Record<string, string>
): T[] {
  return (images ?? []).map((row) =>
    cdnById[row.id] ? { ...row, processed_file_url: cdnById[row.id] } : row
  );
}
