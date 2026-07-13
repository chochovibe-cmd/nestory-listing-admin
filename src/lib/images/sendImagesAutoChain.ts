/**
 * D2-open: server-side auto chain after B14 送圖 batch create.
 *
 * Q1-A: whole draft all-keep → sharp; any de_text/regenerate → awaiting_d4 (no sharp/finalize).
 * Q2-A: after sharp with ≥1 success → finalize (in-process, no HTTP self-fetch).
 * Q4-A: serial drafts; maxDuration budget 60s; stop when remaining < 8s.
 * Q5a-A: pure awaiting_d4 batch stays queued.
 * Q5b-A: failures append short warnings on draft.
 */

import type { ImageBatchSnapshotDraft } from "@/lib/drafts/createImageBatch";
import { runFinalizeForDraft } from "@/lib/images/runFinalize";
import { runSharpBatchForDraft, type SharpBatchServiceClient } from "@/lib/images/runSharpBatch";
import type { ImageBatchItemStatus, ImageBatchStatus, ImageProcessIntent } from "@/types/domain";

/** Align with route maxDuration = 60. */
export const AUTO_CHAIN_DEADLINE_MS = 60_000;
/** Q4-A: stop starting new drafts when remaining budget below this. */
export const AUTO_CHAIN_MIN_REMAINING_MS = 8_000;

export type DraftAutoChainDecision =
  | { action: "run_all_keep"; reason: string }
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
  sharpProcessed?: number;
  sharpFailed?: number;
  finalizeUploaded?: number;
  finalizeFailed?: number;
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
  policy: "all_keep_then_sharp_then_finalize";
};

/** Pure: Q1-A decision from B14 snapshot images (prefer snapshot over live marks). */
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
    (img) => img.processIntent === "de_text" || img.processIntent === "regenerate"
  );
  if (hasD4) {
    return {
      action: "awaiting_d4",
      reason: "contains de_text/regenerate; wait for D4/Make (Q1-A)"
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
    reason: "non-keep intents present; skip auto sharp (Q1-A)"
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
  // Cap growth
  return list.slice(-30);
}

export function buildAutoChainWarning(kind: "sharp" | "finalize", detail?: string): string {
  const base =
    kind === "sharp" ? "送圖自動處理失敗：圖片轉檔" : "送圖自動處理失敗：上傳圖床";
  const extra = detail?.trim() ? `（${detail.trim().slice(0, 80)}）` : "";
  return `${base}${extra}`.slice(0, 200);
}

/** Aggregate batch header status after per-draft outcomes (Q5a-A). */
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

  // All awaiting D4 → stay queued (Q5a-A)
  if (awaitingOnly === n) {
    return { batchStatus: "queued", doneCount: 0, failedCount: 0 };
  }

  // All time-budget before any work
  if (timeBudget === n) {
    return { batchStatus: "queued", doneCount: 0, failedCount: 0 };
  }

  if (failedCount === n) {
    return { batchStatus: "failed", doneCount: 0, failedCount };
  }

  if (doneCount === n) {
    return { batchStatus: "completed", doneCount, failedCount: 0 };
  }

  // Mix: some done, some awaiting_d4 (no hard fail) → completed for what auto could do
  if (failedCount === 0 && timeBudget === 0 && doneCount + awaitingOnly + emptySkip === n) {
    return {
      batchStatus: doneCount > 0 ? "completed" : "queued",
      doneCount,
      failedCount: 0
    };
  }

  // Any failure or time-budget leftover → partial_failed
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
 * After image_batches + items exist: optional sharp→finalize per all-keep draft.
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

  // Pre-decide all drafts
  const plans = readyDrafts.map((d) => {
    const snap = snapshotByDraft.get(d.draftId);
    const decision = decideDraftAutoChainFromSnapshot(snap?.images ?? []);
    return { ...d, decision, snap };
  });

  const anyRunnable = plans.some((p) => p.decision.action === "run_all_keep");

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
        reason: plan.decision.reason,
        itemStatus: "queued"
      });
      // item stays queued — do not update
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
        reason: plan.decision.reason,
        itemStatus: "done"
      });
      continue;
    }

    // run_all_keep
    if (shouldStopForTimeBudget(startedAt, now(), { deadlineMs, minRemainingMs })) {
      stoppedEarly = true;
      summaries.push({
        draftId: plan.draftId,
        title: baseTitle,
        decision: "run_all_keep",
        outcome: "time_budget",
        sharp: "not_run",
        finalize: "not_run",
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

    const sharpResult = await runSharpBatchForDraft({
      serviceSupabase,
      draftId: plan.draftId
      // whole-draft mode: explicitImageIds false → only keep (all are keep)
    });

    if (!sharpResult.ok && sharpResult.httpStatus && sharpResult.httpStatus >= 400 && sharpResult.processed === undefined) {
      // Hard failure before processing (e.g. draft not found)
      await appendDraftWarning(
        serviceSupabase,
        plan.draftId,
        buildAutoChainWarning("sharp", sharpResult.error)
      );
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
        sharp: "failed",
        finalize: "not_run",
        reason: sharpResult.error,
        itemStatus: "failed"
      });
      continue;
    }

    const sharpProcessed = sharpResult.processed ?? 0;
    const sharpFailed = sharpResult.failed ?? 0;
    const sharpOk = sharpFailed === 0 && (sharpResult.ok || sharpProcessed > 0);

    if (sharpFailed > 0 && sharpProcessed === 0) {
      await appendDraftWarning(
        serviceSupabase,
        plan.draftId,
        buildAutoChainWarning("sharp", `${sharpFailed} 張失敗`)
      );
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
        sharp: "failed",
        finalize: "not_run",
        sharpProcessed,
        sharpFailed,
        reason: "sharp produced zero successes",
        itemStatus: "failed"
      });
      continue;
    }

    if (sharpFailed > 0) {
      await appendDraftWarning(
        serviceSupabase,
        plan.draftId,
        buildAutoChainWarning("sharp", `部分失敗 ${sharpFailed} 張`)
      );
    }

    let finalizeStatus: DraftChainSummary["finalize"] = "not_run";
    let finalizeUploaded = 0;
    let finalizeFailed = 0;

    // Q2-A: finalize only if at least 1 sharp success
    if (autoFinalize && sharpProcessed >= 1) {
      if (shouldStopForTimeBudget(startedAt, now(), { deadlineMs, minRemainingMs })) {
        stoppedEarly = true;
        // sharp done but no time for finalize — item still partial success
        await serviceSupabase
          .from("image_batch_items")
          .update({ item_status: "done" })
          .eq("batch_id", batchId)
          .eq("draft_id", plan.draftId);
        summaries.push({
          draftId: plan.draftId,
          title: baseTitle,
          decision: "run_all_keep",
          outcome: sharpFailed > 0 ? "failed" : "done",
          sharp: sharpFailed > 0 ? "failed" : "done",
          finalize: "skipped",
          sharpProcessed,
          sharpFailed,
          reason: "sharp done; finalize skipped (time budget)",
          itemStatus: sharpFailed > 0 ? "failed" : "done"
        });
        continue;
      }

      const fin = await runFinalizeForDraft({
        serviceSupabase,
        draftId: plan.draftId
      });

      if (!fin.ok && fin.uploaded === undefined) {
        finalizeStatus = "failed";
        finalizeFailed = 1;
        await appendDraftWarning(
          serviceSupabase,
          plan.draftId,
          buildAutoChainWarning("finalize", fin.error)
        );
      } else {
        finalizeUploaded = fin.uploaded ?? 0;
        finalizeFailed = fin.failed ?? 0;
        if (finalizeFailed > 0 && finalizeUploaded === 0) {
          finalizeStatus = "failed";
          await appendDraftWarning(
            serviceSupabase,
            plan.draftId,
            buildAutoChainWarning("finalize", `${finalizeFailed} 張失敗`)
          );
        } else if (finalizeFailed > 0) {
          finalizeStatus = "failed";
          await appendDraftWarning(
            serviceSupabase,
            plan.draftId,
            buildAutoChainWarning("finalize", `部分失敗 ${finalizeFailed} 張`)
          );
        } else {
          finalizeStatus = "done";
        }
      }
    } else if (!autoFinalize) {
      finalizeStatus = "skipped";
    } else {
      finalizeStatus = "skipped";
    }

    const itemFailed = sharpFailed > 0 || (finalizeStatus === "failed" && finalizeUploaded === 0 && sharpProcessed === 0);
    // Honest: sharp partial fail marks item failed; finalize-only fail still done (temp exists) but warning written
    const itemStatus: ImageBatchItemStatus =
      sharpProcessed === 0 && sharpFailed > 0
        ? "failed"
        : sharpFailed > 0
          ? "failed"
          : "done";

    await serviceSupabase
      .from("image_batch_items")
      .update({ item_status: itemStatus })
      .eq("batch_id", batchId)
      .eq("draft_id", plan.draftId);

    summaries.push({
      draftId: plan.draftId,
      title: baseTitle,
      decision: "run_all_keep",
      outcome: itemStatus === "failed" ? "failed" : "done",
      sharp: sharpFailed > 0 ? (sharpProcessed > 0 ? "failed" : "failed") : "done",
      finalize: finalizeStatus,
      sharpProcessed,
      sharpFailed,
      finalizeUploaded,
      finalizeFailed,
      reason: itemFailed ? "partial or full failure" : plan.decision.reason,
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

  return {
    batchStatus: agg.batchStatus,
    doneCount: agg.doneCount,
    failedCount: agg.failedCount,
    drafts: summaries,
    stoppedEarly,
    elapsedMs,
    policy: "all_keep_then_sharp_then_finalize"
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

    parts.push(`已建立送圖批次（${readyCount} 件）。`);
    parts.push(
      `自動處理：成功 ${done}／略過（去字重生等 D4）${awaiting}／失敗 ${failed}` +
        (timed > 0 ? `／逾時未跑 ${timed}` : "") +
        `。`
    );

    if (awaiting > 0) {
      parts.push(`含 de_text／regenerate 的商品維持佇列（awaiting_d4），需等 AI 去字／重生（D4）。`);
    }
    if (chain.stoppedEarly) {
      parts.push(`時間預算不足，部分商品未處理完，可稍後重送或手動執行轉檔。`);
    }
    if (chain.batchStatus === "completed" && done > 0) {
      parts.push(`可至「圖片審核」查看處理結果。`);
    }
  }

  if (blockedLines.length > 0) {
    parts.push(`${blockedLines.length} 件被擋：`);
    parts.push(...blockedLines);
  }

  return parts.join("\n");
}
