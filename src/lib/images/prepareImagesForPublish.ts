/**
 * R3: run sharp → finalize before Shopify create (moved from station② all-keep).
 * Best-effort: failures surface as warnings / hard fail when no usable images.
 */

import { decideSharpAction } from "@/lib/images/imagePipeline";
import { runFinalizeForDraft } from "@/lib/images/runFinalize";
import { SHARP_BATCH_MAX_IMAGES } from "@/lib/images/sharpProcess";
import { isFinalizeUploadImageType, isShopifyCdnUrl } from "@/lib/shopify/filesUpload";
import {
  runSharpBatchForDraft,
  type SharpBatchServiceClient
} from "@/lib/images/runSharpBatch";

export type PrepareImagesForPublishResult = {
  ok: boolean;
  sharp: "done" | "failed" | "skipped" | "not_run";
  finalize: "done" | "failed" | "skipped" | "not_run" | "not_configured";
  sharpProcessed: number;
  sharpFailed: number;
  finalizeUploaded: number;
  finalizeFailed: number;
  warnings: string[];
  error?: string;
};

type PrepImageRow = {
  id?: string | null;
  image_type?: string | null;
  original_file_url?: string | null;
  processed_file_url?: string | null;
  generated_file_url?: string | null;
  process_intent?: string | null;
  processing_status?: string | null;
};

const PREP_IMAGE_COLUMNS =
  "id, image_type, original_file_url, processed_file_url, generated_file_url, process_intent, processing_status, sort_order";

/** Same eligibility the whole-draft (non-explicit) sharp path uses; minus rows already reusable. */
function isSharpEligible(img: PrepImageRow): boolean {
  const decision = decideSharpAction({
    imageType: img.image_type ?? "",
    processIntent: img.process_intent as any,
    originalFileUrl: img.original_file_url,
    explicitImageIds: false,
    generatedFileUrl: img.generated_file_url
  });
  if (decision.action !== "process_sharp") return false;

  const hasReusableProcessedImage =
    img.processing_status === "done" &&
    typeof img.processed_file_url === "string" &&
    img.processed_file_url.trim().length > 0;

  return !hasReusableProcessedImage;
}

/** Same eligibility runFinalizeForDraft uses to upload: main/variant, not already on the CDN, has a source. */
function isFinalizeEligible(img: PrepImageRow): boolean {
  if (!isFinalizeUploadImageType(img.image_type)) return false;
  if (isShopifyCdnUrl(img.processed_file_url)) return false;

  const processed = typeof img.processed_file_url === "string" ? img.processed_file_url.trim() : "";
  const original = typeof img.original_file_url === "string" ? img.original_file_url.trim() : "";
  if (!processed && original && isShopifyCdnUrl(original)) return false;
  return Boolean(processed || original);
}

function idsOf(rows: PrepImageRow[], pick: (img: PrepImageRow) => boolean): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (id && pick(row) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function chunkImageIds(ids: string[], size = SHARP_BATCH_MAX_IMAGES): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

export type PrepareImagesDeps = {
  runSharp?: typeof runSharpBatchForDraft;
  runFinalize?: typeof runFinalizeForDraft;
};

async function loadImageRows(
  serviceSupabase: SharpBatchServiceClient,
  draftId: string
): Promise<PrepImageRow[] | null> {
  try {
    const { data, error } = await (serviceSupabase as any)
      .from("product_images")
      .select(PREP_IMAGE_COLUMNS)
      .eq("draft_id", draftId)
      .order("sort_order", { ascending: true });
    if (error || !Array.isArray(data)) return null;
    return data as PrepImageRow[];
  } catch {
    return null;
  }
}

function finalizeStatus(
  uploaded: number,
  failed: number
): PrepareImagesForPublishResult["finalize"] {
  if (failed > 0 && uploaded === 0) return "failed";
  return uploaded > 0 ? "done" : "skipped";
}

/**
 * Prepare listing images for Shopify: WebP (sharp) then CDN (finalize).
 * Safe to call when images already on CDN (finalize skips).
 *
 * Drafts routinely hold 25+ rows (mostly `detail`, never processed or sent to Shopify), which
 * trips the 12-rows-per-request cap of the whole-draft path. So we select the eligible ids
 * ourselves (same rules as the whole-draft path) and call the runners in chunks of
 * SHARP_BATCH_MAX_IMAGES. Explicit ids switch the sharp runner to "engineering mode", which is
 * safe here only because every id already passed decideSharpAction(explicit=false).
 */
export async function prepareImagesForPublish(input: {
  serviceSupabase: SharpBatchServiceClient;
  draftId: string;
  deps?: PrepareImagesDeps;
}): Promise<PrepareImagesForPublishResult> {
  const runSharp = input.deps?.runSharp ?? runSharpBatchForDraft;
  const runFinalize = input.deps?.runFinalize ?? runFinalizeForDraft;
  const warnings: string[] = [];
  let sharp: PrepareImagesForPublishResult["sharp"] = "not_run";
  let finalize: PrepareImagesForPublishResult["finalize"] = "not_run";
  let sharpProcessed = 0;
  let sharpFailed = 0;
  let finalizeUploaded = 0;
  let finalizeFailed = 0;

  let preflightKnown = false;
  let shouldRunSharp = true;
  let shouldRunFinalize = true;
  let sharpIds: string[] = [];
  let finalizeIds: string[] = [];

  const rows = await loadImageRows(input.serviceSupabase, input.draftId);
  if (rows) {
    preflightKnown = true;
    sharpIds = idsOf(rows, isSharpEligible);
    finalizeIds = idsOf(rows, isFinalizeEligible);
    shouldRunSharp = sharpIds.length > 0;
    shouldRunFinalize = finalizeIds.length > 0;
  }

  if (!preflightKnown) {
    // Preflight unavailable: legacy whole-draft call (may hit the 12-row cap and warn once).
    try {
      const sharpResult = await runSharp({
        serviceSupabase: input.serviceSupabase,
        draftId: input.draftId
      });
      if (sharpResult.ok) {
        sharp = sharpResult.failed > 0 && sharpResult.processed === 0 ? "failed" : "done";
        sharpProcessed = sharpResult.processed;
        sharpFailed = sharpResult.failed;
        if (sharpResult.failed > 0) warnings.push(`轉檔失敗 ${sharpResult.failed} 張`);
      } else {
        sharp = "failed";
        warnings.push(sharpResult.error || "轉檔失敗");
      }
    } catch (e) {
      sharp = "failed";
      warnings.push(e instanceof Error ? e.message : String(e));
    }
  } else if (shouldRunSharp) {
    let chunkError: string | null = null;
    let okChunks = 0;
    for (const ids of chunkImageIds(sharpIds)) {
      try {
        const r = await runSharp({
          serviceSupabase: input.serviceSupabase,
          draftId: input.draftId,
          imageIds: ids
        });
        if (r.ok) {
          okChunks += 1;
          sharpProcessed += r.processed;
          sharpFailed += r.failed;
        } else {
          chunkError ??= r.error || "轉檔失敗";
          sharpFailed += r.failed ?? 0;
        }
      } catch (e) {
        chunkError ??= e instanceof Error ? e.message : String(e);
      }
    }
    if (okChunks === 0) sharp = "failed";
    else sharp = sharpFailed > 0 && sharpProcessed === 0 ? "failed" : "done";
    if (sharpFailed > 0) warnings.push(`轉檔失敗 ${sharpFailed} 張`);
    if (chunkError) warnings.push(chunkError);
  } else {
    sharp = "skipped";
  }

  // Finalize after sharp: re-read rows so freshly written processed_file_url is respected.
  if (preflightKnown && shouldRunSharp) {
    const fresh = await loadImageRows(input.serviceSupabase, input.draftId);
    if (fresh) {
      finalizeIds = idsOf(fresh, isFinalizeEligible);
      shouldRunFinalize = finalizeIds.length > 0;
    }
  }

  // If sharp actually ran (or preflight was unavailable), preserve the old
  // behavior and finalize afterward. Otherwise only finalize rows that still
  // need to move to Shopify Files.
  const needsFinalizeNow = !preflightKnown || shouldRunSharp || shouldRunFinalize;

  let notConfigured = false;
  const applyFinalize = (fin: Awaited<ReturnType<typeof runFinalizeForDraft>>): string | null => {
    if (!fin.ok) return fin.error || "圖床上傳失敗";
    finalizeUploaded += fin.uploaded;
    finalizeFailed += fin.failed;
    if (fin.message?.includes("not configured") || fin.message?.includes("憑證")) {
      notConfigured = true;
    }
    return null;
  };

  if (!preflightKnown) {
    try {
      const err = applyFinalize(
        await runFinalize({ serviceSupabase: input.serviceSupabase, draftId: input.draftId })
      );
      if (err) {
        finalize = "failed";
        warnings.push(err);
      } else {
        finalize = notConfigured ? "not_configured" : finalizeStatus(finalizeUploaded, finalizeFailed);
        if (finalizeFailed > 0) warnings.push(`圖床上傳失敗 ${finalizeFailed} 張`);
      }
    } catch (e) {
      finalize = "failed";
      warnings.push(e instanceof Error ? e.message : String(e));
    }
  } else if (needsFinalizeNow && finalizeIds.length > 0) {
    let chunkError: string | null = null;
    let okChunks = 0;
    for (const ids of chunkImageIds(finalizeIds)) {
      try {
        const err = applyFinalize(
          await runFinalize({
            serviceSupabase: input.serviceSupabase,
            draftId: input.draftId,
            imageIds: ids
          })
        );
        if (err) chunkError ??= err;
        else okChunks += 1;
      } catch (e) {
        chunkError ??= e instanceof Error ? e.message : String(e);
      }
    }
    if (okChunks === 0) finalize = "failed";
    else finalize = finalizeStatus(finalizeUploaded, finalizeFailed);
    if (notConfigured) finalize = "not_configured";
    if (finalizeFailed > 0) warnings.push(`圖床上傳失敗 ${finalizeFailed} 張`);
    if (chunkError) warnings.push(chunkError);
  } else {
    finalize = "skipped";
  }

  // Soft fail: still allow publish with original URLs when mock / partial CDN.
  // Hard block only when both sharp and finalize fully failed with zero progress
  // and we have no usable prior state — leave that to payload/media layer.
  return {
    ok: true,
    sharp,
    finalize,
    sharpProcessed,
    sharpFailed,
    finalizeUploaded,
    finalizeFailed,
    warnings
  };
}
