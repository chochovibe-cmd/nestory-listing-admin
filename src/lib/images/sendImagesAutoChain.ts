/**
 * D2-open + D4 hybrid: server-side auto chain after B14 送圖 batch create.
 *
 * - All-keep → sharp → finalize (unchanged)
 * - Mixed de_text/regen (Q1-C): keep sharp+finalize; limited AI if time allows;
 *   else awaiting_d4 for POST /api/images/ai-process
 * - Q4-A: serial drafts; maxDuration budget 60s; stop when remaining < 8s
 * - Q5a: pure awaiting_d4 batch stays queued
 * - Never HTTP self-fetch
 */

import type { ImageBatchSnapshotDraft } from "@/lib/drafts/createImageBatch";
import {
  AUTO_CHAIN_MAX_AI_IMAGES_PER_DRAFT,
  runAiProcessForDraft
} from "@/lib/images/runAiProcess";
import { runFinalizeForDraft } from "@/lib/images/runFinalize";
import { runSharpBatchForDraft, type SharpBatchServiceClient } from "@/lib/images/runSharpBatch";
import { safeTryNotifyImageBatchIfComplete } from "@/lib/notifications/tryNotifyImageBatchIfComplete";
import type { ImageBatchItemStatus, ImageBatchStatus, ImageProcessIntent } from "@/types/domain";

/** Align with route maxDuration = 60. */
export const AUTO_CHAIN_DEADLINE_MS = 60_000;
/** Q4-A: stop starting new drafts when remaining budget below this. */
export const AUTO_CHAIN_MIN_REMAINING_MS = 8_000;

export type DraftAutoChainDecision =
  | { action: "run_all_keep"; reason: string }
  | { action: "run_mixed"; reason: string }
  | { action: "awaiting_d4"; reason: string }
  | { action: "no_pipeline_images"; reason: string };

export type DraftChainOutcome =
  | "done"
  | "failed"
  | "awaiting_d4"
  | "time_budget"
  | "skipped_empty";

export type DraftChainSummary = {
  draftId: string;
  title: string;
  decision: DraftAutoChainDecision["action"];
  outcome: DraftChainOutcome;
  sharp: "done" | "failed" | "skipped" | "not_run";
  finalize: "done" | "failed" | "skipped" | "not_run" | "not_configured";
  d4?: "done" | "failed" | "partial" | "skipped" | "not_run" | "time_budget";
  sharpProcessed?: number;
  sharpFailed?: number;
  finalizeUploaded?: number;
  finalizeFailed?: number;
  d4Processed?: number;
  d4Failed?: number;
  d4TimeBudget?: number;
  reason?: string;
  itemStatus: ImageBatchItemStatus;
};

export type AutoChainResult = {
  batchStatus: ImageBatchStatus;
  doneCount: number;
  failedCount: number;
  drafts: DraftChainSummary[];
  stoppedEarly: boolean;
  elapsedMs: number;
  policy: "all_keep_then_sharp_then_finalize_hybrid_d4";
};

/** Pure: Q1-C decision from B14 snapshot images (prefer snapshot over live marks). */
export function decideDraftAutoChainFromSnapshot(
  snapshotImages: Array<{ processIntent: ImageProcessIntent | string | null | undefined }>
): DraftAutoChainDecision {
  if (!snapshotImages.length) {
    return {
      action: "no_pipeline_images",
      reason: "snapshot has no pipeline images"
    };
  }

  const hasD4 = snapshotImages.some(
    (img) =>
      img.processIntent === "de_text" ||
      img.processIntent === "regenerate" ||
      img.processIntent === "to_trad"
  );
  if (hasD4) {
    return {
      action: "run_mixed",
      reason: "contains de_text/regenerate/to_trad; hybrid keep + limited D4 (Q1-C/R2)"
    };
  }

  const allKeep = snapshotImages.every((img) => img.processIntent === "keep");
  if (allKeep) {
    return {
      action: "run_all_keep",
      reason: "all pipeline images process_intent=keep"
    };
  }

  // Unmarked should not appear in ready batch snapshot; treat as no auto.
  return {
    action: "awaiting_d4",
    reason: "non-keep intents present; skip auto sharp"
  };
}

export function remainingBudgetMs(
  startedAtMs: number,
  nowMs: number,
  deadlineMs: number = AUTO_CHAIN_DEADLINE_MS
): number {
  return deadlineMs - (nowMs - startedAtMs);
}

export function shouldStopForTimeBudget(
  startedAtMs: number,
  nowMs: number,
  opts?: { deadlineMs?: number; minRemainingMs?: number }
): boolean {
  const deadlineMs = opts?.deadlineMs ?? AUTO_CHAIN_DEADLINE_MS;
  const minRemainingMs = opts?.minRemainingMs ?? AUTO_CHAIN_MIN_REMAINING_MS;
  return remainingBudgetMs(startedAtMs, nowMs, deadlineMs) < minRemainingMs;
}

/** Merge short auto-chain warning into draft.warnings (Q5b-A). */
export function mergeAutoChainWarning(
  existing: string[] | null | undefined,
  line: string
): string[] {
  const list = Array.isArray(existing)
    ? existing.filter((w) => typeof w === "string")
    : [];
  const trimmed = line.trim().slice(0, 200);
  if (!trimmed) return list;
  if (!list.includes(trimmed)) list.push(trimmed);
  return list.slice(-30);
}

export function buildAutoChainWarning(
  kind: "sharp" | "finalize" | "d4",
  detail?: string
): string {
  const base =
    kind === "sharp"
      ? "送圖自動處理失敗：圖片轉檔"
      : kind === "finalize"
        ? "送圖自動處理失敗：上傳圖床"
        : "送圖自動處理失敗：AI 去字／重生";
  const extra = detail?.trim() ? `（${detail.trim().slice(0, 80)}）` : "";
  return `${base}${extra}`.slice(0, 200);
}

/** Aggregate batch header status after per-draft outcomes (Q5a-A / Q6-A). */
export function aggregateBatchStatusAfterChain(
  summaries: DraftChainSummary[]
): { batchStatus: ImageBatchStatus; doneCount: number; failedCount: number } {
  let doneCount = 0;
  let failedCount = 0;
  let awaitingOnly = 0;
  let timeBudget = 0;
  let emptySkip = 0;

  for (const s of summaries) {
    if (s.outcome === "done" || s.outcome === "skipped_empty") {
      doneCount += 1;
      if (s.outcome === "skipped_empty") emptySkip += 1;
    } else if (s.outcome === "failed") {
      failedCount += 1;
    } else if (s.outcome === "awaiting_d4") {
      awaitingOnly += 1;
    } else if (s.outcome === "time_budget") {
      timeBudget += 1;
    }
  }

  const n = summaries.length;
  if (n === 0) {
    return { batchStatus: "queued", doneCount: 0, failedCount: 0 };
  }

  if (awaitingOnly === n) {
    return { batchStatus: "queued", doneCount: 0, failedCount: 0 };
  }

  if (timeBudget === n) {
    return { batchStatus: "queued", doneCount: 0, failedCount: 0 };
  }

  if (failedCount === n) {
    return { batchStatus: "failed", doneCount: 0, failedCount };
  }

  if (doneCount === n) {
    return { batchStatus: "completed", doneCount, failedCount: 0 };
  }

  if (failedCount === 0 && timeBudget === 0 && doneCount + awaitingOnly + emptySkip === n) {
    return {
      batchStatus: doneCount > 0 ? (awaitingOnly > 0 ? "partial_failed" : "completed") : "queued",
      doneCount,
      failedCount: 0
    };
  }

  return {
    batchStatus: "partial_failed",
    doneCount,
    failedCount
  };
}

async function appendDraftWarning(
  serviceSupabase: SharpBatchServiceClient,
  draftId: string,
  line: string
): Promise<void> {
  try {
    const { data } = await serviceSupabase
      .from("product_drafts")
      .select("warnings")
      .eq("id", draftId)
      .maybeSingle();
    const next = mergeAutoChainWarning(
      Array.isArray(data?.warnings) ? (data!.warnings as string[]) : [],
      line
    );
    await serviceSupabase.from("product_drafts").update({ warnings: next }).eq("id", draftId);
  } catch {
    // best-effort only
  }
}

function snapshotKeepIds(
  snap: ImageBatchSnapshotDraft | undefined
): string[] {
  if (!snap?.images?.length) return [];
  return snap.images
    .filter((img) => img.processIntent === "keep" && img.imageId)
    .map((img) => img.imageId as string);
}

function snapshotD4Ids(snap: ImageBatchSnapshotDraft | undefined): string[] {
  if (!snap?.images?.length) return [];
  return snap.images
    .filter(
      (img) =>
        (img.processIntent === "de_text" ||
          img.processIntent === "regenerate" ||
          img.processIntent === "to_trad") &&
        img.imageId
    )
    .map((img) => img.imageId as string);
}

/** R2: all-keep chain done → station③ ready (still dual-write status=approved). */
async function advanceDraftToReadyStation(
  serviceSupabase: SharpBatchServiceClient,
  draftId: string
): Promise<void> {
  try {
    await serviceSupabase
      .from("product_drafts")
      .update({ pipeline_stage: "ready" })
      .eq("id", draftId)
      .in("pipeline_stage", ["image_review", "ready"]);
  } catch {
    // best-effort; station UI may lag until refresh
  }
}

async function runKeepSharpFinalize(input: {
  serviceSupabase: SharpBatchServiceClient;
  draftId: string;
  keepIds: string[] | null;
  autoFinalize: boolean;
  startedAt: number;
  now: () => number;
  deadlineMs: number;
  minRemainingMs: number;
}): Promise<{
  sharpProcessed: number;
  sharpFailed: number;
  sharpStatus: DraftChainSummary["sharp"];
  finalizeStatus: DraftChainSummary["finalize"];
  finalizeUploaded: number;
  finalizeFailed: number;
  hardFailed: boolean;
  reason?: string;
  stoppedForFinalizeBudget: boolean;
}> {
  const {
    serviceSupabase,
    draftId,
    keepIds,
    autoFinalize,
    startedAt,
    now,
    deadlineMs,
    minRemainingMs
  } = input;

  // No keep images → skip sharp for keep path
  if (keepIds && keepIds.length === 0) {
    return {
      sharpProcessed: 0,
      sharpFailed: 0,
      sharpStatus: "skipped",
      finalizeStatus: "skipped",
      finalizeUploaded: 0,
      finalizeFailed: 0,
      hardFailed: false,
      stoppedForFinalizeBudget: false
    };
  }

  const sharpResult = await runSharpBatchForDraft({
    serviceSupabase,
    draftId,
    imageIds: keepIds && keepIds.length > 0 ? keepIds : undefined
  });

  if (!sharpResult.ok && sharpResult.httpStatus && sharpResult.httpStatus >= 400 && sharpResult.processed === undefined) {
    await appendDraftWarning(serviceSupabase, draftId, buildAutoChainWarning("sharp", sharpResult.error));
    return {
      sharpProcessed: 0,
      sharpFailed: 1,
      sharpStatus: "failed",
      finalizeStatus: "not_run",
      finalizeUploaded: 0,
      finalizeFailed: 0,
      hardFailed: true,
      reason: sharpResult.error,
      stoppedForFinalizeBudget: false
    };
  }

  const sharpProcessed = sharpResult.processed ?? 0;
  const sharpFailed = sharpResult.failed ?? 0;

  if (sharpFailed > 0 && sharpProcessed === 0 && (keepIds === null || keepIds.length > 0)) {
    await appendDraftWarning(
      serviceSupabase,
      draftId,
      buildAutoChainWarning("sharp", `${sharpFailed} 張失敗`)
    );
    return {
      sharpProcessed,
      sharpFailed,
      sharpStatus: "failed",
      finalizeStatus: "not_run",
      finalizeUploaded: 0,
      finalizeFailed: 0,
      hardFailed: true,
      reason: "sharp produced zero successes",
      stoppedForFinalizeBudget: false
    };
  }

  if (sharpFailed > 0) {
    await appendDraftWarning(
      serviceSupabase,
      draftId,
      buildAutoChainWarning("sharp", `部分失敗 ${sharpFailed} 張`)
    );
  }

  let finalizeStatus: DraftChainSummary["finalize"] = "not_run";
  let finalizeUploaded = 0;
  let finalizeFailed = 0;
  let stoppedForFinalizeBudget = false;

  if (autoFinalize && sharpProcessed >= 1) {
    if (shouldStopForTimeBudget(startedAt, now(), { deadlineMs, minRemainingMs })) {
      stoppedForFinalizeBudget = true;
      finalizeStatus = "skipped";
    } else {
      const fin = await runFinalizeForDraft({
        serviceSupabase,
        draftId,
        imageIds: keepIds && keepIds.length > 0 ? keepIds : undefined
      });

      if (!fin.ok && fin.uploaded === undefined) {
        finalizeStatus = "failed";
        finalizeFailed = 1;
        await appendDraftWarning(
          serviceSupabase,
          draftId,
          buildAutoChainWarning("finalize", fin.error)
        );
      } else {
        finalizeUploaded = fin.uploaded ?? 0;
        finalizeFailed = fin.failed ?? 0;
        if (finalizeFailed > 0 && finalizeUploaded === 0) {
          finalizeStatus = "failed";
          await appendDraftWarning(
            serviceSupabase,
            draftId,
            buildAutoChainWarning("finalize", `${finalizeFailed} 張失敗`)
          );
        } else if (finalizeFailed > 0) {
          finalizeStatus = "failed";
          await appendDraftWarning(
            serviceSupabase,
            draftId,
            buildAutoChainWarning("finalize", `部分失敗 ${finalizeFailed} 張`)
          );
        } else {
          finalizeStatus = "done";
        }
      }
    }
  } else if (!autoFinalize) {
    finalizeStatus = "skipped";
  } else {
    finalizeStatus = "skipped";
  }

  return {
    sharpProcessed,
    sharpFailed,
    sharpStatus: sharpFailed > 0 ? "failed" : sharpProcessed > 0 ? "done" : "skipped",
    finalizeStatus,
    finalizeUploaded,
    finalizeFailed,
    hardFailed: false,
    stoppedForFinalizeBudget
  };
}

export type RunSendImagesAutoChainInput = {
  serviceSupabase: SharpBatchServiceClient;
  batchId: string;
  readyDrafts: Array<{ draftId: string; title: string }>;
  snapshot: ImageBatchSnapshotDraft[];
  /** Default true (Q2-A). */
  autoFinalize?: boolean;
  deadlineMs?: number;
  minRemainingMs?: number;
  /** Inject clock for tests. */
  now?: () => number;
};

/**
 * After image_batches + items exist: optional sharp→finalize and limited D4 hybrid.
 * Updates batch/item rows. Does not throw on per-draft failure.
 */
export async function runSendImagesAutoChain(
  input: RunSendImagesAutoChainInput
): Promise<AutoChainResult> {
  const {
    serviceSupabase,
    batchId,
    readyDrafts,
    snapshot,
    autoFinalize = true,
    deadlineMs = AUTO_CHAIN_DEADLINE_MS,
    minRemainingMs = AUTO_CHAIN_MIN_REMAINING_MS
  } = input;
  const now = input.now ?? Date.now;
  const startedAt = now();

  const snapshotByDraft = new Map(snapshot.map((s) => [s.draftId, s]));
  const summaries: DraftChainSummary[] = [];

  const plans = readyDrafts.map((d) => {
    const snap = snapshotByDraft.get(d.draftId);
    const decision = decideDraftAutoChainFromSnapshot(snap?.images ?? []);
    return { ...d, decision, snap };
  });

  const anyRunnable = plans.some(
    (p) => p.decision.action === "run_all_keep" || p.decision.action === "run_mixed"
  );

  if (anyRunnable) {
    await serviceSupabase
      .from("image_batches")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", batchId);
  }

  let stoppedEarly = false;

  for (const plan of plans) {
    const baseTitle = plan.title || plan.snap?.title || "未命名";

    if (plan.decision.action === "awaiting_d4") {
      summaries.push({
        draftId: plan.draftId,
        title: baseTitle,
        decision: "awaiting_d4",
        outcome: "awaiting_d4",
        sharp: "not_run",
        finalize: "not_run",
        d4: "not_run",
        reason: plan.decision.reason,
        itemStatus: "queued"
      });
      continue;
    }

    if (plan.decision.action === "no_pipeline_images") {
      await serviceSupabase
        .from("image_batch_items")
        .update({ item_status: "done" })
        .eq("batch_id", batchId)
        .eq("draft_id", plan.draftId);
      summaries.push({
        draftId: plan.draftId,
        title: baseTitle,
        decision: "no_pipeline_images",
        outcome: "skipped_empty",
        sharp: "skipped",
        finalize: "skipped",
        d4: "skipped",
        reason: plan.decision.reason,
        itemStatus: "done"
      });
      continue;
    }

    if (shouldStopForTimeBudget(startedAt, now(), { deadlineMs, minRemainingMs })) {
      stoppedEarly = true;
      summaries.push({
        draftId: plan.draftId,
        title: baseTitle,
        decision: plan.decision.action,
        outcome: plan.decision.action === "run_mixed" ? "awaiting_d4" : "time_budget",
        sharp: "not_run",
        finalize: "not_run",
        d4: plan.decision.action === "run_mixed" ? "not_run" : "not_run",
        reason: "time budget remaining < 8s; item left queued (Q4-A)",
        itemStatus: "queued"
      });
      continue;
    }

    await serviceSupabase
      .from("image_batch_items")
      .update({ item_status: "processing" })
      .eq("batch_id", batchId)
      .eq("draft_id", plan.draftId);

    // --- all keep path ---
    if (plan.decision.action === "run_all_keep") {
      const keepRun = await runKeepSharpFinalize({
        serviceSupabase,
        draftId: plan.draftId,
        keepIds: null,
        autoFinalize,
        startedAt,
        now,
        deadlineMs,
        minRemainingMs
      });

      if (keepRun.hardFailed) {
        await serviceSupabase
          .from("image_batch_items")
          .update({ item_status: "failed" })
          .eq("batch_id", batchId)
          .eq("draft_id", plan.draftId);
        summaries.push({
          draftId: plan.draftId,
          title: baseTitle,
          decision: "run_all_keep",
          outcome: "failed",
          sharp: keepRun.sharpStatus,
          finalize: keepRun.finalizeStatus,
          d4: "skipped",
          sharpProcessed: keepRun.sharpProcessed,
          sharpFailed: keepRun.sharpFailed,
          reason: keepRun.reason,
          itemStatus: "failed"
        });
        continue;
      }

      const itemStatus: ImageBatchItemStatus =
        keepRun.sharpFailed > 0 ||
        (keepRun.sharpProcessed === 0 && keepRun.sharpStatus === "failed")
          ? "failed"
          : "done";

      await serviceSupabase
        .from("image_batch_items")
        .update({ item_status: itemStatus })
        .eq("batch_id", batchId)
        .eq("draft_id", plan.draftId);

      // R2 Q3-B path complete → station③ (all-keep does not need 生圖工廠 review)
      if (itemStatus === "done") {
        await advanceDraftToReadyStation(serviceSupabase, plan.draftId);
      }

      summaries.push({
        draftId: plan.draftId,
        title: baseTitle,
        decision: "run_all_keep",
        outcome: itemStatus === "failed" ? "failed" : "done",
        sharp: keepRun.sharpStatus,
        finalize: keepRun.finalizeStatus,
        d4: "skipped",
        sharpProcessed: keepRun.sharpProcessed,
        sharpFailed: keepRun.sharpFailed,
        finalizeUploaded: keepRun.finalizeUploaded,
        finalizeFailed: keepRun.finalizeFailed,
        reason: plan.decision.reason,
        itemStatus
      });
      continue;
    }

    // --- run_mixed hybrid Q1-C ---
    const keepIds = snapshotKeepIds(plan.snap);
    const d4Ids = snapshotD4Ids(plan.snap);

    const keepRun = await runKeepSharpFinalize({
      serviceSupabase,
      draftId: plan.draftId,
      keepIds,
      autoFinalize,
      startedAt,
      now,
      deadlineMs,
      minRemainingMs
    });

    // D4 limited attempt
    let d4Status: DraftChainSummary["d4"] = "not_run";
    let d4Processed = 0;
    let d4Failed = 0;
    let d4TimeBudget = 0;

    if (d4Ids.length === 0) {
      d4Status = "skipped";
    } else if (shouldStopForTimeBudget(startedAt, now(), { deadlineMs, minRemainingMs })) {
      stoppedEarly = true;
      d4Status = "time_budget";
      d4TimeBudget = d4Ids.length;
    } else {
      const ai = await runAiProcessForDraft({
        serviceSupabase,
        draftId: plan.draftId,
        imageIds: d4Ids,
        autoSharp: true,
        autoFinalize,
        maxAiImages: AUTO_CHAIN_MAX_AI_IMAGES_PER_DRAFT,
        deadlineMs,
        minRemainingMs,
        startedAtMs: startedAt,
        now,
        // batch updated once at end of this draft
        updateBatchStatus: false
      });

      d4Processed = ai.processed ?? 0;
      d4Failed = ai.failed ?? 0;
      d4TimeBudget = ai.timeBudget ?? 0;

      if (d4Processed > 0 && d4Failed === 0 && d4TimeBudget === 0) {
        d4Status = "done";
      } else if (d4Processed > 0 && (d4Failed > 0 || d4TimeBudget > 0)) {
        d4Status = "partial";
      } else if (d4Failed > 0 && d4Processed === 0) {
        d4Status = "failed";
        await appendDraftWarning(
          serviceSupabase,
          plan.draftId,
          buildAutoChainWarning("d4", ai.error || `${d4Failed} 張失敗`)
        );
      } else if (d4TimeBudget > 0) {
        d4Status = "time_budget";
      } else {
        d4Status = "skipped";
      }
    }

    // If any D4 left unfinished (time budget / max 1 image / partial), stay queued
    const unfinishedD4 =
      d4Ids.length > 0 &&
      (d4Status === "time_budget" ||
        d4Status === "partial" ||
        d4TimeBudget > 0 ||
        (d4Processed + d4Failed < d4Ids.length &&
          d4Status !== "failed" &&
          d4Status !== "done" &&
          d4Status !== "skipped"));

    let outcome: DraftChainOutcome;
    let itemStatus: ImageBatchItemStatus;

    if (keepRun.hardFailed && d4Processed === 0 && !unfinishedD4) {
      outcome = "failed";
      itemStatus = "failed";
    } else if (unfinishedD4) {
      outcome = "awaiting_d4";
      itemStatus = "queued";
    } else if (
      (keepRun.sharpFailed > 0 && keepIds.length > 0 && keepRun.sharpProcessed === 0) ||
      (d4Status === "failed" && d4Processed === 0 && keepIds.length === 0)
    ) {
      outcome = "failed";
      itemStatus = "failed";
    } else if (d4Status === "failed" && d4Processed === 0 && keepRun.sharpProcessed > 0) {
      // keep ok, all attempted AI failed
      outcome = "failed";
      itemStatus = "failed";
    } else {
      outcome = "done";
      itemStatus = keepRun.sharpFailed > 0 || d4Failed > 0 ? "failed" : "done";
      if (d4Processed > 0 && d4Failed > 0) {
        itemStatus = "done";
        outcome = "done";
      }
    }

    await serviceSupabase
      .from("image_batch_items")
      .update({ item_status: itemStatus })
      .eq("batch_id", batchId)
      .eq("draft_id", plan.draftId);

    summaries.push({
      draftId: plan.draftId,
      title: baseTitle,
      decision: "run_mixed",
      outcome,
      sharp: keepRun.sharpStatus,
      finalize: keepRun.finalizeStatus,
      d4: d4Status,
      sharpProcessed: keepRun.sharpProcessed,
      sharpFailed: keepRun.sharpFailed,
      finalizeUploaded: keepRun.finalizeUploaded,
      finalizeFailed: keepRun.finalizeFailed,
      d4Processed,
      d4Failed,
      d4TimeBudget,
      reason:
        outcome === "awaiting_d4"
          ? "hybrid partial; remaining de_text/regenerate need POST /api/images/ai-process"
          : plan.decision.reason,
      itemStatus
    });
  }

  const agg = aggregateBatchStatusAfterChain(summaries);
  const elapsedMs = now() - startedAt;

  await serviceSupabase
    .from("image_batches")
    .update({
      status: agg.batchStatus,
      done_count: agg.doneCount,
      failed_count: agg.failedCount,
      updated_at: new Date().toISOString()
    })
    .eq("id", batchId);

  // D6-open: notify only if all items terminal; never throw into send-images
  await safeTryNotifyImageBatchIfComplete(batchId, { serviceSupabase });

  return {
    batchStatus: agg.batchStatus,
    doneCount: agg.doneCount,
    failedCount: agg.failedCount,
    drafts: summaries,
    stoppedEarly,
    elapsedMs,
    policy: "all_keep_then_sharp_then_finalize_hybrid_d4"
  };
}

/** Operator-facing message after batch + optional chain (Q6-A). */
export function formatAutoChainOperatorMessage(input: {
  readyCount: number;
  blockedLines: string[];
  chain: AutoChainResult | null;
}): string {
  const { readyCount, blockedLines, chain } = input;
  const parts: string[] = [];

  if (!chain) {
    parts.push(`已建立送圖批次（${readyCount} 件）。`);
  } else {
    const done = chain.drafts.filter((d) => d.outcome === "done" || d.outcome === "skipped_empty").length;
    const failed = chain.drafts.filter((d) => d.outcome === "failed").length;
    const awaiting = chain.drafts.filter((d) => d.outcome === "awaiting_d4").length;
    const timed = chain.drafts.filter((d) => d.outcome === "time_budget").length;
    const d4Done = chain.drafts.filter((d) => d.d4 === "done" || d.d4 === "partial").length;

    parts.push(`已建立送圖批次（${readyCount} 件）。`);
    parts.push(
      `自動處理：成功 ${done}／待 AI 去字重生 ${awaiting}／失敗 ${failed}` +
        (timed > 0 ? `／逾時未跑 ${timed}` : "") +
        (d4Done > 0 ? `／已試 AI ${d4Done}` : "") +
        `。`
    );

    if (awaiting > 0) {
      parts.push(
        `尚有 de_text／regenerate 未完成：可呼叫 POST /api/images/ai-process，或由 Make 重試。`
      );
    }
    if (chain.stoppedEarly) {
      parts.push(`時間預算不足，部分商品未處理完，可稍後重送或手動執行轉檔／AI。`);
    }
    if (chain.batchStatus === "completed" && done > 0) {
      parts.push(`可至「生圖工廠」查看處理結果。`);
    }
  }

  if (blockedLines.length > 0) {
    parts.push(`${blockedLines.length} 件被擋：`);
    parts.push(...blockedLines);
  }

  return parts.join("\n");
}

/** Optional Make payload d4 summary (failures must not 500). */
export function buildMakeD4Summary(
  chain: AutoChainResult | null
): Record<string, unknown> | null {
  if (!chain) return null;
  const drafts = chain.drafts
    .filter((d) => d.decision === "run_mixed" || d.d4)
    .map((d) => ({
      draftId: d.draftId,
      d4: d.d4 ?? "not_run",
      d4Processed: d.d4Processed ?? 0,
      d4Failed: d.d4Failed ?? 0,
      d4TimeBudget: d.d4TimeBudget ?? 0,
      outcome: d.outcome
    }));
  if (drafts.length === 0) return null;
  return {
    attempted: drafts.filter((d) => d.d4 !== "not_run" && d.d4 !== "skipped").length,
    awaiting: drafts.filter((d) => d.outcome === "awaiting_d4").length,
    drafts
  };
}
