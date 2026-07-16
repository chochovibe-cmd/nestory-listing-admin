/**
 * R3: run sharp → finalize before Shopify create (moved from station② all-keep).
 * Best-effort: failures surface as warnings / hard fail when no usable images.
 */

import { runFinalizeForDraft } from "@/lib/images/runFinalize";
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

/**
 * Prepare listing images for Shopify: WebP (sharp) then CDN (finalize).
 * Safe to call when images already on CDN (finalize skips).
 */
export async function prepareImagesForPublish(input: {
  serviceSupabase: SharpBatchServiceClient;
  draftId: string;
}): Promise<PrepareImagesForPublishResult> {
  const warnings: string[] = [];
  let sharp: PrepareImagesForPublishResult["sharp"] = "not_run";
  let finalize: PrepareImagesForPublishResult["finalize"] = "not_run";
  let sharpProcessed = 0;
  let sharpFailed = 0;
  let finalizeUploaded = 0;
  let finalizeFailed = 0;

  try {
    const sharpResult = await runSharpBatchForDraft({
      serviceSupabase: input.serviceSupabase,
      draftId: input.draftId
    });
    if (sharpResult.ok) {
      sharp = sharpResult.failed > 0 && sharpResult.processed === 0 ? "failed" : "done";
      sharpProcessed = sharpResult.processed;
      sharpFailed = sharpResult.failed;
      if (sharpResult.failed > 0) {
        warnings.push(`轉檔失敗 ${sharpResult.failed} 張`);
      }
    } else {
      sharp = "failed";
      warnings.push(sharpResult.error || "轉檔失敗");
    }
  } catch (e) {
    sharp = "failed";
    warnings.push(e instanceof Error ? e.message : String(e));
  }

  try {
    const fin = await runFinalizeForDraft({
      serviceSupabase: input.serviceSupabase,
      draftId: input.draftId
    });
    if (fin.ok) {
      finalize =
        fin.failed > 0 && fin.uploaded === 0
          ? "failed"
          : fin.uploaded > 0
            ? "done"
            : "skipped";
      finalizeUploaded = fin.uploaded;
      finalizeFailed = fin.failed;
      if (fin.failed > 0) {
        warnings.push(`圖床上傳失敗 ${fin.failed} 張`);
      }
      if (fin.message?.includes("not configured") || fin.message?.includes("憑證")) {
        finalize = "not_configured";
      }
    } else {
      finalize = "failed";
      warnings.push(fin.error || "圖床上傳失敗");
    }
  } catch (e) {
    finalize = "failed";
    warnings.push(e instanceof Error ? e.message : String(e));
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
