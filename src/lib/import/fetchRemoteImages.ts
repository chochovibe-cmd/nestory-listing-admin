/**
 * CAP-1: server-side image fetch ??Supabase Storage product-images.
 * Failures become warnings; never block draft creation.
 */
import { fetchServerImage } from "@/lib/images/fetchServerImage";
import {
  IMAGE_FETCH_TIMEOUT_MS,
  MAX_DETAIL_IMAGES,
  MAX_IMAGE_BYTES,
  MAX_MAIN_IMAGES,
  MAX_VARIANT_IMAGES
} from "@/lib/import/captureTypes";

export type CaptureImageType = "main" | "detail" | "variant";

export type ImageFetchItemResult = {
  url: string;
  image_type: CaptureImageType;
  ok: boolean;
  image_id?: string;
  error?: string;
};

export type FetchRemoteImagesResult = {
  results: ImageFetchItemResult[];
  okCount: number;
  failedCount: number;
  warnings: string[];
  /** Updated raw_capture.server.image_fetch entries */
  imageFetchLog: ImageFetchItemResult[];
  /** CAP-2.6: source URL ??product_images.id for successful fetches (incl. variant). */
  urlToImageId: Record<string, string>;
};

function refererFromSourceUrl(sourceUrl: string): string | undefined {
  try {
    const u = new URL(sourceUrl);
    return `${u.origin}/`;
  } catch {
    return undefined;
  }
}

function extFromContentTypeAndUrl(contentType: string | null, url: string): string {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("avif")) return "avif";
  if (ct.includes("heic") || ct.includes("heif")) return "heic";
  if (ct.includes("tiff")) return "tiff";
  if (ct.includes("bmp")) return "bmp";
  if (ct.includes("icon")) return "ico";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  const path = url.split("?")[0] ?? "";
  const m = path.match(/\.([a-zA-Z0-9]{2,5})$/);
  if (m) return m[1].toLowerCase().replace("jpeg", "jpg");
  return "jpg";
}

async function fetchOneImageBuffer(
  url: string,
  sourceUrl: string
): Promise<{ ok: true; buffer: Buffer; contentType: string | null } | { ok: false; error: string }> {
  const referer = refererFromSourceUrl(sourceUrl);
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
  };
  if (referer) headers.Referer = referer;

  const fetched = await fetchServerImage(url, {
    headers,
    timeoutMs: IMAGE_FETCH_TIMEOUT_MS,
    maxBytes: MAX_IMAGE_BYTES
  });
  if (!fetched.ok) {
    return { ok: false, error: fetched.message };
  }

  return { ok: true, buffer: fetched.bytes, contentType: fetched.contentType };
}
type ServiceStorageClient = {
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        body: Buffer,
        opts: { contentType?: string; upsert?: boolean }
      ) => PromiseLike<{ error: { message: string } | null }>;
      getPublicUrl: (path: string) => { data: { publicUrl: string } };
    };
  };
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => {
      select: (cols: string) => {
        single: () => PromiseLike<{
          data: { id: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

/**
 * Fetch main + detail + variant image URLs into Storage and product_images rows.
 * CAP-2.6: variant thumbs use image_type='variant'; url?d map for product_variants.image_id.
 * Failures never throw ??caller still persists variants with null image_id.
 */
export async function fetchAndStoreCaptureImages(input: {
  serviceSupabase: ServiceStorageClient;
  userId: string;
  draftId: string;
  sourceUrl: string;
  mainImageUrls: string[];
  detailImageUrls: string[];
  /** CAP-2.6 / 88: unique SKU option thumb URLs */
  variantImageUrls?: string[];
}): Promise<FetchRemoteImagesResult> {
  const warnings: string[] = [];
  const results: ImageFetchItemResult[] = [];
  const urlToImageId: Record<string, string> = {};

  const main = input.mainImageUrls.slice(0, MAX_MAIN_IMAGES);
  const detail = input.detailImageUrls.slice(0, MAX_DETAIL_IMAGES);
  const variantSrc = Array.isArray(input.variantImageUrls) ? input.variantImageUrls : [];
  const variant = variantSrc.slice(0, MAX_VARIANT_IMAGES);

  if (input.mainImageUrls.length > MAX_MAIN_IMAGES) {
    warnings.push(
      `銝餃?頞?銝? ${MAX_MAIN_IMAGES} 撘蛛?撌脫?瘀?靘? ${input.mainImageUrls.length} 撘蛛?`
    );
  }
  if (input.detailImageUrls.length > MAX_DETAIL_IMAGES) {
    warnings.push(
      `閰單???????${MAX_DETAIL_IMAGES} 撘蛛?撌脫?瘀?靘? ${input.detailImageUrls.length} 撘蛛?`
    );
  }
  if (variantSrc.length > MAX_VARIANT_IMAGES) {
    warnings.push(
      `甈曉?蝮桀?頞?銝? ${MAX_VARIANT_IMAGES} 撘蛛?撌脫?瘀?靘? ${variantSrc.length} 撘蛛?`
    );
  }

  // Deduplicate jobs by URL (G1: one fetch ??shared image_id across variants)
  const jobs: Array<{ url: string; image_type: CaptureImageType; sort_order: number }> = [];
  const scheduled = new Set<string>();
  function schedule(url: string, image_type: CaptureImageType, sort_order: number) {
    const u = url.trim();
    if (!u || scheduled.has(u)) return;
    scheduled.add(u);
    jobs.push({ url: u, image_type, sort_order });
  }
  main.forEach((url, i) => schedule(url, "main", i));
  detail.forEach((url, i) => schedule(url, "detail", i));
  variant.forEach((url, i) => schedule(url, "variant", i));

  for (const job of jobs) {
    const fetched = await fetchOneImageBuffer(job.url, input.sourceUrl);
    if (!fetched.ok) {
      const item: ImageFetchItemResult = {
        url: job.url,
        image_type: job.image_type,
        ok: false,
        error: fetched.error
      };
      results.push(item);
      warnings.push(
        `??隞??憭望?嚗?{job.image_type}嚗?${fetched.error} 繚 ${truncateUrl(job.url)}`
      );
      continue;
    }

    const ext = extFromContentTypeAndUrl(fetched.contentType, job.url);
    const path = `${input.userId}/${input.draftId}/${job.image_type}/${crypto.randomUUID()}.${ext}`;
    const contentType =
      fetched.contentType && fetched.contentType.startsWith("image/")
        ? fetched.contentType.split(";")[0].trim()
        : `image/${ext === "jpg" ? "jpeg" : ext}`;

    const { error: uploadError } = await input.serviceSupabase.storage
      .from("product-images")
      .upload(path, fetched.buffer, { contentType, upsert: false });

    if (uploadError) {
      const item: ImageFetchItemResult = {
        url: job.url,
        image_type: job.image_type,
        ok: false,
        error: uploadError.message
      };
      results.push(item);
      warnings.push(
        `??銝 Storage 憭望?嚗?{job.image_type}嚗?${uploadError.message} 繚 ${truncateUrl(job.url)}`
      );
      continue;
    }

    const { data: pub } = input.serviceSupabase.storage.from("product-images").getPublicUrl(path);
    const publicUrl = pub.publicUrl;

    const { data: row, error: insertError } = await input.serviceSupabase
      .from("product_images")
      .insert({
        draft_id: input.draftId,
        image_type: job.image_type,
        original_file_url: publicUrl,
        processed_file_url: publicUrl,
        sort_order: job.sort_order,
        processing_status: "uploaded"
      })
      .select("id")
      .single();

    if (insertError || !row?.id) {
      const errMsg = insertError?.message ?? "insert failed";
      const item: ImageFetchItemResult = {
        url: job.url,
        image_type: job.image_type,
        ok: false,
        error: errMsg
      };
      results.push(item);
      warnings.push(
        `??撖怠 product_images 憭望?嚗?{job.image_type}嚗?${errMsg} 繚 ${truncateUrl(job.url)}`
      );
      continue;
    }

    urlToImageId[job.url] = row.id;
    results.push({
      url: job.url,
      image_type: job.image_type,
      ok: true,
      image_id: row.id
    });
  }

  const okCount = results.filter((r) => r.ok).length;
  const failedCount = results.filter((r) => !r.ok).length;

  return {
    results,
    okCount,
    failedCount,
    warnings,
    imageFetchLog: results,
    urlToImageId
  };
}

/**
 * Pure helper: apply url?mage_id map onto variant rows; strip temporary image_url.
 * Used by createCaptureDraft + verify-cap1 (fetch-all-fail ??all image_id null).
 */
export function applyVariantImageIds(
  variantRows: Array<Record<string, unknown>>,
  urlToImageId: Record<string, string>
): Array<Record<string, unknown>> {
  return variantRows.map((row) => {
    const next = { ...row };
    const rawUrl = next.image_url;
    delete next.image_url;
    const url = rawUrl != null ? String(rawUrl).trim() : "";
    if (url && urlToImageId[url]) {
      next.image_id = urlToImageId[url];
    } else {
      // explicit null when no map (honest; do not invent)
      if (next.image_id == null) {
        // leave undefined so DB default null; avoid sending unknown keys issues
        delete next.image_id;
      }
    }
    return next;
  });
}

function truncateUrl(url: string): string {
  return url.length > 64 ? `${url.slice(0, 61)}…` : url;
}
