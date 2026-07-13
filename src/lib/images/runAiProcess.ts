/**
 * D4 core: AI de_text / regenerate for ONE draft.
 * Used by POST /api/images/ai-process and D2 hybrid auto-chain.
 * Never call via HTTP self-fetch — invoke this function in-process.
 *
 * Pipeline per image (Q3-A / Q4-A):
 *   original → Image API → generated_file_url (temp, only on success)
 *   → sharp (afterAi) → processed_file_url = supabase_temp
 *   → finalize (default) → processed_file_url = shopify_cdn
 * Failures: never overwrite shopify CDN processed_file_url; no fake URLs.
 */

import {
  buildGeneratedStoragePath,
  isPipelineImageType,
  ownerSegmentFromOriginalPath,
  storagePathFromProductImagesPublicUrl
} from "@/lib/images/imagePipeline";
import { runFinalizeForDraft, type FinalizeServiceClient } from "@/lib/images/runFinalize";
import { runSharpBatchForDraft } from "@/lib/images/runSharpBatch";
import { SHARP_BATCH_MAX_IMAGES } from "@/lib/images/sharpProcess";
import {
  createOpenAiImageProvider,
  modelSupportsImageEdit
} from "@/lib/providers/openai-image-provider";
import type { ImageProvider } from "@/lib/providers/image";
import { safeTryNotifyImageBatchIfComplete } from "@/lib/notifications/tryNotifyImageBatchIfComplete";
import { isShopifyCdnUrl } from "@/lib/shopify/filesUpload";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { ImageProcessIntent, ImageType } from "@/types/domain";

const PRODUCT_IMAGES_BUCKET = "product-images";

export const AI_PROCESS_MAX_IMAGES = SHARP_BATCH_MAX_IMAGES;
/** Hybrid auto-chain: max AI images attempted per draft in one send-images request. */
export const AUTO_CHAIN_MAX_AI_IMAGES_PER_DRAFT = 1;
export const AI_PROCESS_DEADLINE_MS = 60_000;
export const AI_PROCESS_MIN_REMAINING_MS = 8_000;

export type AiProcessServiceClient = ReturnType<typeof createServiceSupabaseClient>;

export type AiProcessImageRow = {
  id: string;
  draft_id: string;
  image_type: ImageType | string;
  original_file_url: string | null;
  processed_file_url: string | null;
  generated_file_url: string | null;
  process_intent: ImageProcessIntent | null;
  processing_status: string;
  sort_order: number;
};

export type AiProcessPerImageResult = {
  imageId: string;
  intent: "de_text" | "regenerate";
  status: "done" | "skipped" | "failed" | "time_budget";
  reason?: string;
  generatedFileUrl?: string | null;
  processedFileUrl?: string | null;
  storage?: "supabase_temp" | "shopify_cdn" | "none";
  model?: string;
  cost?: number;
  warning?: string;
  error?: string;
};

export type RunAiProcessForDraftInput = {
  serviceSupabase: AiProcessServiceClient;
  draftId: string;
  imageIds?: string[] | null;
  /** Default true (Q3-A). */
  autoSharp?: boolean;
  /** Default true (Q3-A). Requires autoSharp path to have produced processed temp. */
  autoFinalize?: boolean;
  /** Cap AI calls this request (hybrid uses 1). */
  maxAiImages?: number;
  deadlineMs?: number;
  minRemainingMs?: number;
  startedAtMs?: number;
  now?: () => number;
  /** Inject for tests. */
  imageProvider?: ImageProvider;
  /** When true, also refresh image_batch_items / image_batches (Q6-A). Default true. */
  updateBatchStatus?: boolean;
};

export type RunAiProcessForDraftResult =
  | {
      ok: true;
      draftId: string;
      processed: number;
      skipped: number;
      failed: number;
      timeBudget: number;
      results: AiProcessPerImageResult[];
      message?: string;
      batchUpdated?: boolean;
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
      timeBudget?: number;
      results?: AiProcessPerImageResult[];
      message?: string;
      batchUpdated?: boolean;
    };

export function isD4ProcessIntent(
  intent: ImageProcessIntent | string | null | undefined
): intent is "de_text" | "regenerate" {
  return intent === "de_text" || intent === "regenerate";
}

export function decideAiProcessAction(input: {
  imageType: ImageType | string;
  processIntent: ImageProcessIntent | null | undefined;
  originalFileUrl: string | null | undefined;
}): { action: "process_ai" | "skip"; reason: string; intent?: "de_text" | "regenerate" } {
  if (!isPipelineImageType(input.imageType)) {
    return {
      action: "skip",
      reason: `image_type=${input.imageType} is not a pipeline image`
    };
  }
  if (!isD4ProcessIntent(input.processIntent)) {
    return {
      action: "skip",
      reason: `process_intent=${input.processIntent ?? "null"} is not de_text/regenerate`
    };
  }
  if (input.processIntent === "de_text" && !input.originalFileUrl?.trim()) {
    return { action: "skip", reason: "de_text missing original_file_url" };
  }
  // regenerate can run without original (generate from text)
  return {
    action: "process_ai",
    reason: `process_intent=${input.processIntent}`,
    intent: input.processIntent
  };
}

export function remainingAiBudgetMs(
  startedAtMs: number,
  nowMs: number,
  deadlineMs: number = AI_PROCESS_DEADLINE_MS
): number {
  return deadlineMs - (nowMs - startedAtMs);
}

export function shouldStopAiForTimeBudget(
  startedAtMs: number,
  nowMs: number,
  opts?: { deadlineMs?: number; minRemainingMs?: number }
): boolean {
  const deadlineMs = opts?.deadlineMs ?? AI_PROCESS_DEADLINE_MS;
  const minRemainingMs = opts?.minRemainingMs ?? AI_PROCESS_MIN_REMAINING_MS;
  return remainingAiBudgetMs(startedAtMs, nowMs, deadlineMs) < minRemainingMs;
}

function mimeToExt(mime: string): string {
  if (mime.includes("webp")) return "webp";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("gif")) return "gif";
  return "png";
}

async function appendDraftWarning(
  serviceSupabase: AiProcessServiceClient,
  draftId: string,
  line: string
): Promise<void> {
  try {
    const { data } = await serviceSupabase
      .from("product_drafts")
      .select("warnings")
      .eq("id", draftId)
      .maybeSingle();
    const list = Array.isArray(data?.warnings)
      ? (data!.warnings as string[]).filter((w) => typeof w === "string")
      : [];
    const trimmed = line.trim().slice(0, 200);
    if (!trimmed) return;
    if (!list.includes(trimmed)) list.push(trimmed);
    await serviceSupabase
      .from("product_drafts")
      .update({ warnings: list.slice(-30) })
      .eq("id", draftId);
  } catch {
    // best-effort
  }
}

function isImageTerminal(r: {
  process_intent: string | null;
  processing_status: string;
  processed_file_url: string | null;
  generated_file_url: string | null;
}): boolean {
  if (isShopifyCdnUrl(r.processed_file_url)) return true;
  if (r.processing_status === "failed") return true;
  if (r.processing_status === "done" && (r.processed_file_url || r.generated_file_url)) return true;
  // keep with processed temp
  if (r.process_intent === "keep" && r.processed_file_url) return true;
  return false;
}

/**
 * After AI (and optional sharp/finalize), refresh batch item + header if draft has a current batch.
 */
export async function updateBatchStatusAfterAiProcess(
  serviceSupabase: AiProcessServiceClient,
  draftId: string
): Promise<boolean> {
  try {
    const { data: draft } = await serviceSupabase
      .from("product_drafts")
      .select("id, current_image_batch_id")
      .eq("id", draftId)
      .maybeSingle();

    const batchId = draft?.current_image_batch_id as string | null | undefined;
    if (!batchId) return false;

    const { data: images } = await serviceSupabase
      .from("product_images")
      .select("id, image_type, process_intent, processing_status, processed_file_url, generated_file_url")
      .eq("draft_id", draftId);

    const rows = (images ?? []) as Array<{
      id: string;
      image_type: string;
      process_intent: string | null;
      processing_status: string;
      processed_file_url: string | null;
      generated_file_url: string | null;
    }>;

    const pipeline = rows.filter((r) => isPipelineImageType(r.image_type));

    if (pipeline.length === 0) {
      await serviceSupabase
        .from("image_batch_items")
        .update({ item_status: "done" })
        .eq("batch_id", batchId)
        .eq("draft_id", draftId);
    } else {
      const allTerminal = pipeline.every(isImageTerminal);
      const d4 = pipeline.filter((r) => isD4ProcessIntent(r.process_intent));
      const allD4Failed =
        d4.length > 0 && d4.every((r) => r.processing_status === "failed");
      const anyFailed = pipeline.some((r) => r.processing_status === "failed");

      if (!allTerminal) {
        await serviceSupabase
          .from("image_batch_items")
          .update({ item_status: "queued" })
          .eq("batch_id", batchId)
          .eq("draft_id", draftId);
      } else {
        const itemStatus =
          allD4Failed && pipeline.every((r) => r.processing_status === "failed")
            ? "failed"
            : anyFailed && d4.length === pipeline.length && allD4Failed
              ? "failed"
              : "done";
        await serviceSupabase
          .from("image_batch_items")
          .update({ item_status: itemStatus })
          .eq("batch_id", batchId)
          .eq("draft_id", draftId);
      }
    }

    const { data: items } = await serviceSupabase
      .from("image_batch_items")
      .select("item_status")
      .eq("batch_id", batchId);

    const statuses = (items ?? []).map((i) => i.item_status as string);
    if (statuses.length === 0) return true;

    let doneCount = 0;
    let failedCount = 0;
    let queuedCount = 0;
    let processingCount = 0;
    for (const s of statuses) {
      if (s === "done") doneCount += 1;
      else if (s === "failed") failedCount += 1;
      else if (s === "processing") processingCount += 1;
      else queuedCount += 1;
    }

    let batchStatus: string;
    if (queuedCount > 0 || processingCount > 0) {
      batchStatus =
        doneCount === 0 && failedCount === 0
          ? processingCount > 0
            ? "processing"
            : "queued"
          : "partial_failed";
    } else if (failedCount === statuses.length) {
      batchStatus = "failed";
    } else if (failedCount > 0) {
      batchStatus = "partial_failed";
    } else {
      batchStatus = "completed";
    }

    await serviceSupabase
      .from("image_batches")
      .update({
        status: batchStatus,
        done_count: doneCount,
        failed_count: failedCount,
        updated_at: new Date().toISOString()
      })
      .eq("id", batchId);

    // D6-open: item-level terminal gate inside tryNotify; never throw
    await safeTryNotifyImageBatchIfComplete(batchId, { serviceSupabase });

    return true;
  } catch {
    return false;
  }
}

/**
 * Process de_text / regenerate images for one draft.
 */
export async function runAiProcessForDraft(
  input: RunAiProcessForDraftInput
): Promise<RunAiProcessForDraftResult> {
  const { serviceSupabase } = input;
  const draftId = input.draftId.trim();
  if (!draftId) {
    return { ok: false, draftId: "", error: "draftId is required", httpStatus: 400 };
  }

  const autoSharp = input.autoSharp !== false;
  const autoFinalize = input.autoFinalize !== false;
  const maxAiImages = input.maxAiImages ?? AI_PROCESS_MAX_IMAGES;
  const deadlineMs = input.deadlineMs ?? AI_PROCESS_DEADLINE_MS;
  const minRemainingMs = input.minRemainingMs ?? AI_PROCESS_MIN_REMAINING_MS;
  const now = input.now ?? Date.now;
  const startedAt = input.startedAtMs ?? now();
  const updateBatch = input.updateBatchStatus !== false;
  const provider = input.imageProvider ?? createOpenAiImageProvider();

  let imageIdsFilter: string[] | null = null;
  if (input.imageIds !== undefined && input.imageIds !== null) {
    if (!Array.isArray(input.imageIds) || !input.imageIds.every((id) => typeof id === "string")) {
      return { ok: false, draftId, error: "imageIds must be a string array when provided", httpStatus: 400 };
    }
    imageIdsFilter = [...new Set(input.imageIds.map((id) => id.trim()).filter(Boolean))];
    if (imageIdsFilter.length === 0) {
      return { ok: false, draftId, error: "imageIds is empty", httpStatus: 400 };
    }
    if (imageIdsFilter.length > AI_PROCESS_MAX_IMAGES) {
      return {
        ok: false,
        draftId,
        error: `imageIds exceeds max ${AI_PROCESS_MAX_IMAGES} per request`,
        httpStatus: 400
      };
    }
  }

  const { data: draft, error: draftError } = await serviceSupabase
    .from("product_drafts")
    .select("id, title_zh, taobao_title, original_title, image_description, image_status, warnings")
    .eq("id", draftId)
    .maybeSingle();

  if (draftError) {
    return { ok: false, draftId, error: draftError.message, httpStatus: 500 };
  }
  if (!draft) {
    return { ok: false, draftId, error: "Draft not found", httpStatus: 404 };
  }

  const title =
    (draft.title_zh as string | null)?.trim() ||
    (draft.taobao_title as string | null)?.trim() ||
    (draft.original_title as string | null)?.trim() ||
    "";
  const imageDescription = (draft.image_description as string | null) ?? null;

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

  const images = (imageRows ?? []) as AiProcessImageRow[];

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
      timeBudget: 0,
      results: [],
      message: "No product_images rows to consider."
    };
  }

  if (images.length > AI_PROCESS_MAX_IMAGES) {
    return {
      ok: false,
      draftId,
      error: `Draft has ${images.length} candidate rows; max ${AI_PROCESS_MAX_IMAGES} per request. Pass imageIds to chunk.`,
      httpStatus: 400
    };
  }

  const candidates = images
    .map((img) => {
      const d = decideAiProcessAction({
        imageType: img.image_type,
        processIntent: img.process_intent,
        originalFileUrl: img.original_file_url
      });
      return { img, decision: d };
    })
    .filter((c) => c.decision.action === "process_ai");

  const results: AiProcessPerImageResult[] = [];
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let timeBudget = 0;
  let aiStarted = 0;

  // Mark non-candidates as skipped in results for transparency
  for (const img of images) {
    const d = decideAiProcessAction({
      imageType: img.image_type,
      processIntent: img.process_intent,
      originalFileUrl: img.original_file_url
    });
    if (d.action === "skip") {
      skipped += 1;
      results.push({
        imageId: img.id,
        intent: isD4ProcessIntent(img.process_intent) ? img.process_intent : "de_text",
        status: "skipped",
        reason: d.reason,
        processedFileUrl: img.processed_file_url,
        generatedFileUrl: img.generated_file_url
      });
    }
  }

  if (candidates.length > 0) {
    await serviceSupabase.from("product_drafts").update({ image_status: "processing" }).eq("id", draftId);
  }

  for (const { img, decision } of candidates) {
    const intent = decision.intent!;

    if (aiStarted >= maxAiImages) {
      timeBudget += 1;
      results.push({
        imageId: img.id,
        intent,
        status: "time_budget",
        reason: `maxAiImages=${maxAiImages} reached; left for later ai-process call`,
        processedFileUrl: img.processed_file_url,
        generatedFileUrl: img.generated_file_url
      });
      continue;
    }

    if (shouldStopAiForTimeBudget(startedAt, now(), { deadlineMs, minRemainingMs })) {
      timeBudget += 1;
      results.push({
        imageId: img.id,
        intent,
        status: "time_budget",
        reason: "time budget remaining < 8s; item left for retry (Q7-A)",
        processedFileUrl: img.processed_file_url,
        generatedFileUrl: img.generated_file_url
      });
      continue;
    }

    // Preserve CDN on failure
    const priorProcessed = img.processed_file_url;
    const priorIsCdn = isShopifyCdnUrl(priorProcessed);

    try {
      aiStarted += 1;
      await serviceSupabase
        .from("product_images")
        .update({ processing_status: "processing", processing_error: null })
        .eq("id", img.id);

      const out = await provider.process({
        sourceImages: img.original_file_url ? [img.original_file_url] : [],
        imageType: img.image_type,
        task: intent,
        imageDescription,
        title
      });

      if (out.warning) {
        await appendDraftWarning(serviceSupabase, draftId, `AI 圖片：${out.warning}`.slice(0, 200));
      }

      const originalPath = storagePathFromProductImagesPublicUrl(img.original_file_url);
      const owner = ownerSegmentFromOriginalPath(originalPath, "system");
      const ext = mimeToExt(out.mimeType);
      const storagePath = buildGeneratedStoragePath({
        ownerSegment: owner,
        draftId,
        imageId: img.id,
        ext
      });

      const { error: uploadError } = await serviceSupabase.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .upload(storagePath, out.resultBytes, {
          contentType: out.mimeType || "image/png",
          upsert: true
        });

      if (uploadError) {
        throw new Error(`storage upload generated failed: ${uploadError.message}`);
      }

      const { data: publicData } = serviceSupabase.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .getPublicUrl(storagePath);
      const generatedUrl = publicData.publicUrl;

      // Q4-A: only write generated_file_url on AI success
      const { error: genUpdateError } = await serviceSupabase
        .from("product_images")
        .update({
          generated_file_url: generatedUrl,
          processing_error: null
        })
        .eq("id", img.id);

      if (genUpdateError) {
        throw new Error(`db update generated_file_url failed: ${genUpdateError.message}`);
      }

      let processedUrl: string | null = null;
      let storage: AiProcessPerImageResult["storage"] = "none";

      if (autoSharp) {
        const sharpResult = await runSharpBatchForDraft({
          serviceSupabase,
          draftId,
          imageIds: [img.id],
          afterAi: true
        });

        const sharpRow = sharpResult.results?.find((r) => r.imageId === img.id);
        if (sharpRow?.status === "done" && sharpRow.processedFileUrl) {
          processedUrl = sharpRow.processedFileUrl;
          storage = "supabase_temp";
        } else if (sharpRow?.status === "failed") {
          throw new Error(sharpRow.error || "post-AI sharp failed");
        } else {
          throw new Error(sharpRow?.reason || sharpResult.error || "post-AI sharp skipped unexpectedly");
        }

        if (autoFinalize && processedUrl) {
          const fin = await runFinalizeForDraft({
            serviceSupabase: serviceSupabase as FinalizeServiceClient,
            draftId,
            imageIds: [img.id]
          });
          const finRow = fin.results?.find((r) => r.imageId === img.id);
          if (finRow?.status === "done" && finRow.processedFileUrl) {
            processedUrl = finRow.processedFileUrl;
            storage = "shopify_cdn";
          } else if (finRow?.status === "skipped" && finRow.storage === "shopify_cdn") {
            processedUrl = finRow.processedFileUrl ?? processedUrl;
            storage = "shopify_cdn";
          } else if (finRow?.status === "failed") {
            // Temp exists; warn but count as processed with temp
            await appendDraftWarning(
              serviceSupabase,
              draftId,
              `AI 圖床上傳失敗（${intent}）：${(finRow.error || "finalize failed").slice(0, 80)}`
            );
          }
          // If finalize not configured / all skip — keep temp
        }
      } else {
        // No sharp: mark image done with generated only
        await serviceSupabase
          .from("product_images")
          .update({
            processing_status: "done",
            processing_error: null
          })
          .eq("id", img.id);
        processedUrl = null;
        storage = "none";
      }

      processed += 1;
      results.push({
        imageId: img.id,
        intent,
        status: "done",
        reason: decision.reason,
        generatedFileUrl: generatedUrl,
        processedFileUrl: processedUrl ?? priorProcessed,
        storage,
        model: out.model,
        cost: out.cost,
        warning: out.warning
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed += 1;

      // Do not overwrite CDN processed_file_url
      const updatePayload: Record<string, unknown> = {
        processing_status: "failed",
        processing_error: message.slice(0, 500)
      };
      // Never clear processed if CDN
      if (priorIsCdn) {
        // leave processed_file_url untouched (omit from update)
      }

      await serviceSupabase.from("product_images").update(updatePayload).eq("id", img.id);

      await appendDraftWarning(
        serviceSupabase,
        draftId,
        `AI 圖片處理失敗（${intent}）：${message.slice(0, 80)}`
      );

      results.push({
        imageId: img.id,
        intent,
        status: "failed",
        error: message,
        processedFileUrl: priorProcessed,
        generatedFileUrl: img.generated_file_url,
        storage: priorIsCdn ? "shopify_cdn" : priorProcessed ? "supabase_temp" : "none"
      });
    }
  }

  // Aggregate draft image_status
  let imageStatus: string = (draft.image_status as string) ?? "pending";
  if (processed > 0 && failed === 0 && timeBudget === 0) {
    imageStatus = "done";
  } else if (processed > 0 && (failed > 0 || timeBudget > 0)) {
    imageStatus = "done"; // partial success still reviewable
  } else if (failed > 0 && processed === 0) {
    imageStatus = "failed";
  } else if (timeBudget > 0 && processed === 0 && failed === 0) {
    // nothing finished — leave processing or pending
    imageStatus = "pending";
  }
  if (processed > 0 || failed > 0) {
    await serviceSupabase.from("product_drafts").update({ image_status: imageStatus }).eq("id", draftId);
  }

  let batchUpdated = false;
  if (updateBatch && (processed > 0 || failed > 0 || timeBudget > 0)) {
    batchUpdated = await updateBatchStatusAfterAiProcess(serviceSupabase, draftId);
  }

  if (failed > 0 && processed === 0 && timeBudget === 0) {
    return {
      ok: false,
      draftId,
      error: `${failed} image(s) failed AI process`,
      httpStatus: 200,
      processed,
      skipped,
      failed,
      timeBudget,
      results,
      batchUpdated,
      message: modelSupportsImageEdit()
        ? undefined
        : "Hint: de_text needs edit-capable OPENAI_IMAGE_MODEL (see .env.example)."
    };
  }

  return {
    ok: true,
    draftId,
    processed,
    skipped,
    failed,
    timeBudget,
    results,
    batchUpdated,
    message:
      timeBudget > 0
        ? `${timeBudget} image(s) left for later (time budget or maxAiImages). Call ai-process again or via Make.`
        : undefined
  };
}
