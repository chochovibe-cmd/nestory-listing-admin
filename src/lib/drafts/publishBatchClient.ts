/**
 * PUBLISH-BATCH: browser-side driver for stepwise batch publish.
 *
 *   1. POST /api/drafts/batch/publish { stepwise:true }  → batch + queued items, nothing published
 *   2. POST /api/publish-batches/[batchId]/step           → ONE item per request, until done:true
 *
 * Every item therefore gets its own 60s server budget (the old single long request killed
 * the rest of the batch when one item was slow). The helper returns the SAME shape the old
 * one-shot batch response had (ok, batchId, batchStatus, succeeded, failed, skipped,
 * results[], message) so the three batch callers keep their existing result handling.
 *
 * Mock mode: the create call answers with the complete read-only dry-run result (mock:true),
 * which is returned as is — no step calls, nothing written.
 */
import {
  formatPublishBatchOperatorMessage,
  summarizePublishBatchStatus
} from "@/lib/drafts/publishBatch";
import type { PublishBlockCode, PublishBlocker } from "@/lib/shopify/publishReadiness";
import type { PublishBatchItemStatus, PublishBatchStatus, PublishMode } from "@/types/domain";

/** One row of `results` — same fields the old batch response carried (id = draft id). */
export type StepwisePublishResultRow = {
  id: string;
  ok: boolean;
  error?: string;
  mock?: boolean;
  productId?: string | null;
  adminUrl?: string | null;
  itemStatus: PublishBatchItemStatus;
  code?: PublishBlockCode;
  blockers?: PublishBlocker[];
  mockNotes?: string[];
  reconciled?: boolean;
  warnings?: string[];
};

export type StepwisePublishSummary = {
  /** HTTP-ok equivalent: the create call succeeded and the batch ran to its end. */
  ok: boolean;
  /** HTTP status of the failing call (200 when ok). */
  status: number;
  error?: string;
  hint?: string;
  mock: boolean;
  batchId: string | null;
  batchStatus: PublishBatchStatus | null;
  succeeded: number;
  failed: number;
  skipped: number;
  results: StepwisePublishResultRow[];
  message: string;
  stoppedEarly: boolean;
};

export type StepwiseProgress = {
  /** Items that reached a final state so far. */
  processed: number;
  total: number;
  /** e.g. 發布中 3/5… */
  text: string;
};

export type RunStepwisePublishBatchInput = {
  draftIds: string[];
  publishMode: PublishMode;
  confirmActive?: boolean;
  onProgress?: (progress: StepwiseProgress) => void;
  /** Inject for tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Extra attempts for a step request that failed at network/5xx level. Default 2. */
  stepRetries?: number;
  /** Pause between two step requests. Default 300 ms. */
  stepGapMs?: number;
  /** Pause when nothing was claimable because another tab is publishing. Default 1500 ms. */
  waitingGapMs?: number;
};

type CountsPayload = {
  total: number;
  done: number;
  failed: number;
  skipped: number;
  queued: number;
  processing?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function formatStepwiseProgressText(processed: number, total: number): string {
  return `發布中 ${Math.min(processed, total)}/${total}…`;
}

function failure(status: number, error: string, extra: Partial<StepwisePublishSummary> = {}): StepwisePublishSummary {
  return {
    ok: false,
    status,
    error,
    mock: false,
    batchId: null,
    batchStatus: null,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    results: [],
    message: error,
    stoppedEarly: false,
    ...extra
  };
}

/** A step request that did not come back as a usable JSON answer (network, 5xx, 504 timeout page). */
class StepTransportError extends Error {}

async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  body?: unknown
): Promise<{ status: number; ok: boolean; payload: any }> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, payload };
}

export async function runStepwisePublishBatch(
  input: RunStepwisePublishBatchInput
): Promise<StepwisePublishSummary> {
  const {
    draftIds,
    publishMode,
    confirmActive = publishMode === "active",
    onProgress,
    fetchImpl = (...args: Parameters<typeof fetch>) => fetch(...args),
    sleep = defaultSleep,
    stepRetries = 2,
    stepGapMs = 300,
    waitingGapMs = 1500
  } = input;

  // ---- 1) create -----------------------------------------------------------
  let created: Awaited<ReturnType<typeof postJson>>;
  try {
    created = await postJson(fetchImpl, "/api/drafts/batch/publish", {
      draftIds,
      publishMode,
      confirmActive,
      stepwise: true
    });
  } catch {
    return failure(0, "發布連線失敗");
  }
  const createdPayload = created.payload ?? {};
  if (!created.ok) {
    return failure(created.status, createdPayload.error ?? "批次發布失敗", {
      hint: createdPayload.hint,
      batchId: createdPayload.batchId ?? null,
      mock: createdPayload.mock === true
    });
  }
  if (createdPayload.mock === true) {
    // Dry run: already the complete old-shape answer.
    return {
      ok: true,
      status: created.status,
      mock: true,
      batchId: createdPayload.batchId ?? null,
      batchStatus: createdPayload.batchStatus ?? null,
      succeeded: createdPayload.succeeded ?? 0,
      failed: createdPayload.failed ?? 0,
      skipped: createdPayload.skipped ?? 0,
      results: Array.isArray(createdPayload.results) ? createdPayload.results : [],
      message: createdPayload.message ?? "",
      stoppedEarly: createdPayload.stoppedEarly === true
    };
  }

  const batchId: string = createdPayload.batchId;
  const total: number = createdPayload.total ?? draftIds.length;
  const createdItems: Array<{ draftId: string }> = Array.isArray(createdPayload.items)
    ? createdPayload.items
    : draftIds.map((draftId) => ({ draftId }));

  const results = new Map<string, StepwisePublishResultRow>();
  let lastCounts: CountsPayload | null = null;
  let lastStatus: PublishBatchStatus | null = null;
  let finalMessage: string | undefined;
  let finished = false;
  let aborted = false;
  let consecutiveFailedSteps = 0;
  const maxIterations = total * 4 + 200;

  onProgress?.({ processed: 0, total, text: formatStepwiseProgressText(0, total) });

  // ---- 2) step until done ----------------------------------------------------
  for (let iteration = 0; iteration < maxIterations && !finished; iteration += 1) {
    let step: Awaited<ReturnType<typeof postJson>> | null = null;
    for (let attempt = 0; attempt <= stepRetries; attempt += 1) {
      try {
        const answer = await postJson(fetchImpl, `/api/publish-batches/${batchId}/step`);
        if (answer.status >= 500 || answer.payload == null) {
          throw new StepTransportError(`HTTP ${answer.status}`);
        }
        step = answer;
        break;
      } catch {
        if (attempt < stepRetries) await sleep(500 * (attempt + 1));
      }
    }

    if (!step) {
      // Out of retries for this call. The server-side stale recovery settles whatever this
      // request left half-done, so move on instead of failing the whole batch — but give up
      // when the server is clearly not answering at all.
      consecutiveFailedSteps += 1;
      if (consecutiveFailedSteps >= 3) {
        aborted = true;
        break;
      }
      await sleep(stepGapMs);
      continue;
    }
    consecutiveFailedSteps = 0;

    if (!step.ok) {
      // 4xx: the batch cannot continue (auth, guard, missing batch).
      return summarize({
        ok: false,
        error: step.payload?.error ?? "批次發布中斷"
      });
    }

    const body = step.payload;
    lastStatus = body.batchStatus ?? lastStatus;
    if (body.counts) lastCounts = body.counts;
    const item = body.processed;
    if (item?.draftId) {
      results.set(item.draftId, {
        id: item.draftId,
        ok: item.ok === true,
        error: item.error,
        productId: item.productId ?? null,
        adminUrl: item.adminUrl ?? null,
        itemStatus: item.itemStatus,
        code: item.code,
        blockers: item.blockers,
        reconciled: item.reconciled,
        warnings: item.warnings
      });
    }
    if (body.done === true) {
      finished = true;
      finalMessage = body.message;
    }

    const processedCount = lastCounts
      ? lastCounts.done + lastCounts.failed + lastCounts.skipped
      : results.size;
    onProgress?.({
      processed: processedCount,
      total,
      text: formatStepwiseProgressText(processedCount, total)
    });

    if (!finished) await sleep(item ? stepGapMs : waitingGapMs);
  }

  return summarize({ ok: finished });

  function summarize(state: { ok: boolean; error?: string }): StepwisePublishSummary {
    // Draft ids the server never reported on (a step request died): placeholders, so the
    // caller never silently drops them. Counts below still come from the server.
    const rows: StepwisePublishResultRow[] = [];
    for (const { draftId } of createdItems) {
      rows.push(
        results.get(draftId) ?? {
          id: draftId,
          ok: false,
          itemStatus: "processing",
          error: "結果未確認，請到發布紀錄查看"
        }
      );
    }
    const counted = lastCounts
      ? { done: lastCounts.done, failed: lastCounts.failed, skipped: lastCounts.skipped }
      : {
          done: rows.filter((r) => r.itemStatus === "done").length,
          failed: rows.filter((r) => r.itemStatus === "failed").length,
          skipped: rows.filter((r) => r.itemStatus === "skipped").length
        };
    const batchStatus: PublishBatchStatus =
      lastStatus && lastStatus !== "processing"
        ? lastStatus
        : summarizePublishBatchStatus({
            total,
            done: counted.done,
            failed: counted.failed,
            skipped: counted.skipped
          });

    if (!state.ok) {
      const error =
        state.error ??
        (aborted
          ? "連線中斷，批次可能還在處理。請稍後到發布紀錄確認結果"
          : "批次尚未完成，請稍後到發布紀錄確認結果");
      return {
        ok: false,
        status: 0,
        error,
        mock: false,
        batchId,
        batchStatus: lastStatus,
        succeeded: counted.done,
        failed: counted.failed,
        skipped: counted.skipped,
        results: rows,
        message: error,
        stoppedEarly: true
      };
    }

    return {
      ok: true,
      status: 200,
      mock: false,
      batchId,
      batchStatus,
      succeeded: counted.done,
      failed: counted.failed,
      skipped: counted.skipped,
      results: rows,
      message:
        finalMessage ??
        formatPublishBatchOperatorMessage({
          succeeded: counted.done,
          failed: counted.failed,
          skipped: counted.skipped,
          batchStatus,
          publishMode
        }),
      stoppedEarly: counted.skipped > 0
    };
  }
}

