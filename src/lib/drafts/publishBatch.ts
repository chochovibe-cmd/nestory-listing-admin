/**
 * D7-open: pure helpers for publish batches (no DB / no secrets).
 * Used by runPublishBatch + verify-d7-publish-batch.
 *
 * Q1-A: server-side rate limit (≥600ms gap)
 * Q2-A: time budget → item skipped (time_budget); batch always terminal
 * Q3 A-lite: retry failed = new batch (same helpers)
 */

import type {
  PublishBatchItemStatus,
  PublishBatchStatus,
  PublishMode
} from "@/types/domain";

/** Default gap between publishDraft calls (Shopify ~2 req/s). */
export const DEFAULT_PUBLISH_ITEM_GAP_MS = 600;

/** Align with route maxDuration = 60. */
export const PUBLISH_BATCH_DEADLINE_MS = 60_000;

/** Stop starting new drafts when remaining budget below this (same as D2). */
export const PUBLISH_BATCH_MIN_REMAINING_MS = 8_000;

export const TIME_BUDGET_SKIP_REASON = "時間不足略過（time_budget）";

export const MIGRATION_027_HINT =
  "請先在 Supabase SQL Editor 執行 migration 027（publish_batches 發布批次表）。";

/** R4 §9 / 回饋 44: processing badge frozen at publish time (Q3-A). */
export type PublishProcessTag = "含生圖" | "原圖直發";

export type PublishBatchSnapshotDraft = {
  draftId: string;
  title: string;
  /** Absent on pre-R4 batches → UI shows no badge (honest). */
  processTag?: PublishProcessTag;
};

export type PublishBatchItemResult = {
  draftId: string;
  title: string;
  itemStatus: PublishBatchItemStatus;
  ok: boolean;
  error?: string;
  mock?: boolean;
  productId?: string | null;
  adminUrl?: string | null;
  /** True when skipped because time budget (Q2-A). */
  timeBudget?: boolean;
};

/**
 * Resolve inter-item gap from env PUBLISH_ITEM_GAP_MS (ms).
 * Invalid / missing → DEFAULT_PUBLISH_ITEM_GAP_MS. Floor 0 (tests may set 0).
 */
export function resolvePublishItemGapMs(
  envValue: string | undefined = typeof process !== "undefined"
    ? process.env.PUBLISH_ITEM_GAP_MS
    : undefined
): number {
  if (envValue == null || envValue.trim() === "") return DEFAULT_PUBLISH_ITEM_GAP_MS;
  const n = Number(envValue);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_PUBLISH_ITEM_GAP_MS;
  return Math.floor(n);
}

export function remainingBudgetMs(
  startedAtMs: number,
  nowMs: number,
  deadlineMs: number = PUBLISH_BATCH_DEADLINE_MS
): number {
  return deadlineMs - (nowMs - startedAtMs);
}

export function shouldStopForTimeBudget(
  startedAtMs: number,
  nowMs: number,
  opts?: { deadlineMs?: number; minRemainingMs?: number }
): boolean {
  const deadlineMs = opts?.deadlineMs ?? PUBLISH_BATCH_DEADLINE_MS;
  const minRemainingMs = opts?.minRemainingMs ?? PUBLISH_BATCH_MIN_REMAINING_MS;
  return remainingBudgetMs(startedAtMs, nowMs, deadlineMs) < minRemainingMs;
}

/**
 * R4: AI image intents → 含生圖; otherwise 原圖直發.
 * Only pipeline image types count (main/spec/variant).
 */
export function processTagFromImageIntents(
  images: Array<{ image_type?: string | null; process_intent?: string | null }>
): PublishProcessTag {
  const pipeline = images.filter((img) => {
    const t = img.image_type;
    return t === "main" || t === "spec" || t === "variant";
  });
  const ai = pipeline.some(
    (img) =>
      img.process_intent === "de_text" ||
      img.process_intent === "regenerate" ||
      img.process_intent === "to_trad"
  );
  return ai ? "含生圖" : "原圖直發";
}

/**
 * Batch-level badge from item tags.
 * If no item has processTag (old snapshot) → null (do not guess).
 */
export function batchProcessTagFromItems(
  tags: Array<PublishProcessTag | null | undefined>
): PublishProcessTag | null {
  let sawAny = false;
  let sawAi = false;
  for (const t of tags) {
    if (t !== "含生圖" && t !== "原圖直發") continue;
    sawAny = true;
    if (t === "含生圖") sawAi = true;
  }
  if (!sawAny) return null;
  return sawAi ? "含生圖" : "原圖直發";
}

export function buildPublishSnapshot(
  items: Array<{
    draftId: string;
    title: string;
    processTag?: PublishProcessTag | null;
  }>
): PublishBatchSnapshotDraft[] {
  return items.map((item) => {
    const row: PublishBatchSnapshotDraft = {
      draftId: item.draftId,
      title: (item.title || "未命名草稿").trim() || "未命名草稿"
    };
    if (item.processTag === "含生圖" || item.processTag === "原圖直發") {
      row.processTag = item.processTag;
    }
    return row;
  });
}

/**
 * Q2-A: batch always reaches a terminal status after run ends.
 * skipped = total - done - failed (not a separate column).
 */
export function summarizePublishBatchStatus(counts: {
  total: number;
  done: number;
  failed: number;
  skipped?: number;
}): PublishBatchStatus {
  const total = Math.max(0, counts.total);
  const done = Math.max(0, counts.done);
  const failed = Math.max(0, counts.failed);
  const skipped =
    counts.skipped != null
      ? Math.max(0, counts.skipped)
      : Math.max(0, total - done - failed);

  if (total === 0) return "failed";
  if (done === total) return "completed";
  if (failed === total) return "failed";
  if (done === 0 && failed === 0 && skipped >= total) return "failed";
  if (done === 0) return "failed";
  return "partial_failed";
}

export function formatPublishBatchOperatorMessage(input: {
  succeeded: number;
  failed: number;
  skipped: number;
  batchStatus: PublishBatchStatus;
  publishMode: PublishMode;
}): string {
  const modeLabel = input.publishMode === "active" ? "上架" : "建草稿";
  const parts = [
    `批次${modeLabel}完成：成功 ${input.succeeded} 筆／失敗 ${input.failed} 筆`
  ];
  if (input.skipped > 0) {
    parts.push(`略過 ${input.skipped} 筆（時間不足）`);
  }
  if (input.batchStatus === "partial_failed") {
    parts.push("詳見發布紀錄");
  } else if (input.batchStatus === "failed" && input.succeeded === 0) {
    parts.push("請至發布紀錄查看原因");
  } else {
    parts.push("可至發布紀錄查詢");
  }
  return parts.join("；");
}

/** Short batch id for UI (last 6 of uuid without dashes). */
export function shortBatchId(batchId: string): string {
  const compact = batchId.replace(/-/g, "");
  return compact.slice(-6).toUpperCase() || batchId.slice(0, 8);
}

export function publishBatchTitle(publishMode: PublishMode): string {
  return publishMode === "active"
    ? "匯入 Shopify（API 上架）"
    : "匯入 Shopify（API 建草稿）";
}

/**
 * P1-4: only true missing-table signals → 027 hint.
 * RLS recursion (42P17), permission errors, etc. must show raw message.
 */
export function isMissingPublishBatchesError(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  // Explicit PostgREST / Postgres missing-relation codes
  if (m.includes("42p01") || m.includes("pgrst205")) {
    return (
      m.includes("publish_batch") ||
      m.includes("publish_batches") ||
      m.includes("publish_batch_items") ||
      m.includes("current_publish_batch")
    );
  }
  const mentionsPublishTable =
    m.includes("publish_batches") ||
    m.includes("publish_batch_items") ||
    m.includes("current_publish_batch_id");
  if (!mentionsPublishTable) return false;
  // Phrase + table name (not bare table name — 42P17 includes table names)
  return (
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    m.includes("could not find the table")
  );
}

export function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
