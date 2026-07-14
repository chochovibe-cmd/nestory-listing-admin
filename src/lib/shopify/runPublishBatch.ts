/**
 * D7-open: rate-limited batch publish (Q1-A server-side).
 *
 * - Creates publish_batches + items, runs publishDraft serially with ≥600ms gap
 * - Time budget 60s / stop <8s remaining → remaining items skipped (Q2-A)
 * - Never HTTP self-fetch; never rewrites publishDraft GraphQL
 * - Optional MAKE_WEBHOOK_URL publish_batch_submitted; fail never 500
 * - D6-#2: after terminal batch update → safeTryNotifyPublishBatchIfComplete
 *   (Q3b claim; notify failure never changes run ok)
 */

import {
  MIGRATION_027_HINT,
  TIME_BUDGET_SKIP_REASON,
  buildPublishSnapshot,
  formatPublishBatchOperatorMessage,
  isMissingPublishBatchesError,
  resolvePublishItemGapMs,
  shouldStopForTimeBudget,
  sleepMs,
  summarizePublishBatchStatus,
  type PublishBatchItemResult,
  type PublishBatchSnapshotDraft,
  PUBLISH_BATCH_DEADLINE_MS,
  PUBLISH_BATCH_MIN_REMAINING_MS
} from "@/lib/drafts/publishBatch";
import { notifyMake } from "@/lib/notifications/make";
import { safeTryNotifyPublishBatchIfComplete } from "@/lib/notifications/tryNotifyPublishBatchIfComplete";
import { publishDraft, type PublishDraftResult } from "@/lib/shopify/publishDraft";
import type { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { PublishBatchStatus, PublishMode } from "@/types/domain";

export type PublishBatchServiceClient = ReturnType<typeof createServiceSupabaseClient>;

export type RunPublishBatchInput = {
  serviceSupabase: PublishBatchServiceClient;
  draftIds: string[];
  publishMode: PublishMode;
  createdBy: string | null;
  /** Inject for tests. */
  now?: () => number;
  gapMs?: number;
  deadlineMs?: number;
  minRemainingMs?: number;
  /** Inject publishDraft for unit tests. */
  publishOne?: (
    client: PublishBatchServiceClient,
    id: string,
    mode: PublishMode
  ) => Promise<PublishDraftResult>;
  /** Skip Make webhook (tests). */
  skipMakeWebhook?: boolean;
};

export type RunPublishBatchResult =
  | {
      ok: true;
      batchId: string;
      batchStatus: PublishBatchStatus;
      succeeded: number;
      failed: number;
      skipped: number;
      results: PublishBatchItemResult[];
      message: string;
      stoppedEarly: boolean;
      elapsedMs: number;
      makeWebhook: "sent" | "skipped" | "error";
    }
  | {
      ok: false;
      error: string;
      status: number;
      hint?: string;
      batchId?: string | null;
    };

function draftTitle(row: {
  title_zh?: string | null;
  taobao_title?: string | null;
  original_title?: string | null;
} | null): string {
  return (
    row?.title_zh?.trim() ||
    row?.taobao_title?.trim() ||
    row?.original_title?.trim() ||
    "未命名草稿"
  );
}

export async function runPublishBatch(
  input: RunPublishBatchInput
): Promise<RunPublishBatchResult> {
  const {
    serviceSupabase,
    publishMode,
    createdBy,
    now = () => Date.now(),
    deadlineMs = PUBLISH_BATCH_DEADLINE_MS,
    minRemainingMs = PUBLISH_BATCH_MIN_REMAINING_MS,
    publishOne = publishDraft,
    skipMakeWebhook = false
  } = input;

  const gapMs = input.gapMs ?? resolvePublishItemGapMs();
  const uniqueIds = [...new Set(input.draftIds.filter((id) => typeof id === "string" && id.length > 0))];

  if (uniqueIds.length === 0) {
    return { ok: false, error: "draftIds must be a non-empty string array", status: 400 };
  }

  const startedAt = now();

  const { data: drafts, error: draftError } = await serviceSupabase
    .from("product_drafts")
    .select("id, title_zh, taobao_title, original_title")
    .in("id", uniqueIds);

  if (draftError) {
    return { ok: false, error: draftError.message, status: 500 };
  }

  const draftById = new Map((drafts ?? []).map((d) => [d.id as string, d]));
  const ordered: Array<{ draftId: string; title: string }> = [];
  for (const id of uniqueIds) {
    const row = draftById.get(id) ?? null;
    ordered.push({
      draftId: id,
      title: row ? draftTitle(row) : "找不到草稿"
    });
  }

  const snapshot: PublishBatchSnapshotDraft[] = buildPublishSnapshot(ordered);
  const createNow = new Date(now()).toISOString();

  const { data: batchRow, error: batchError } = await serviceSupabase
    .from("publish_batches")
    .insert({
      kind: "shopify_api",
      status: "processing",
      publish_mode: publishMode,
      total_count: ordered.length,
      done_count: 0,
      failed_count: 0,
      created_by: createdBy,
      created_at: createNow,
      updated_at: createNow,
      started_at: createNow,
      snapshot_json: snapshot
    })
    .select("id")
    .single();

  if (batchError || !batchRow) {
    const msg = batchError?.message ?? "建立發布批次失敗";
    return {
      ok: false,
      error: msg,
      status: 500,
      hint: isMissingPublishBatchesError(msg) ? MIGRATION_027_HINT : undefined,
      batchId: null
    };
  }

  const batchId = batchRow.id as string;

  const itemRows = ordered.map((item) => ({
    batch_id: batchId,
    draft_id: item.draftId,
    item_status: "queued" as const,
    created_at: createNow
  }));

  const { error: itemsError } = await serviceSupabase.from("publish_batch_items").insert(itemRows);
  if (itemsError) {
    const msg = itemsError.message;
    await serviceSupabase
      .from("publish_batches")
      .update({
        status: "failed",
        error_summary: msg.slice(0, 500),
        completed_at: new Date(now()).toISOString(),
        updated_at: new Date(now()).toISOString()
      })
      .eq("id", batchId);
    return {
      ok: false,
      error: msg,
      status: 500,
      hint: isMissingPublishBatchesError(msg) ? MIGRATION_027_HINT : undefined,
      batchId
    };
  }

  // Point drafts at this batch (best-effort; column may be missing if 027 partial)
  for (const item of ordered) {
    try {
      await serviceSupabase
        .from("product_drafts")
        .update({ current_publish_batch_id: batchId })
        .eq("id", item.draftId);
    } catch {
      // ignore missing column / RLS
    }
  }

  const results: PublishBatchItemResult[] = [];
  let doneCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let stoppedEarly = false;
  let firstItem = true;

  for (const item of ordered) {
    if (shouldStopForTimeBudget(startedAt, now(), { deadlineMs, minRemainingMs })) {
      stoppedEarly = true;
      const completedAt = new Date(now()).toISOString();
      await serviceSupabase
        .from("publish_batch_items")
        .update({
          item_status: "skipped",
          error_message: TIME_BUDGET_SKIP_REASON,
          completed_at: completedAt
        })
        .eq("batch_id", batchId)
        .eq("draft_id", item.draftId);

      results.push({
        draftId: item.draftId,
        title: item.title,
        itemStatus: "skipped",
        ok: false,
        error: TIME_BUDGET_SKIP_REASON,
        timeBudget: true
      });
      skippedCount += 1;
      continue;
    }

    if (!firstItem && gapMs > 0) {
      await sleepMs(gapMs);
      // Re-check budget after sleep
      if (shouldStopForTimeBudget(startedAt, now(), { deadlineMs, minRemainingMs })) {
        stoppedEarly = true;
        const completedAt = new Date(now()).toISOString();
        await serviceSupabase
          .from("publish_batch_items")
          .update({
            item_status: "skipped",
            error_message: TIME_BUDGET_SKIP_REASON,
            completed_at: completedAt
          })
          .eq("batch_id", batchId)
          .eq("draft_id", item.draftId);

        results.push({
          draftId: item.draftId,
          title: item.title,
          itemStatus: "skipped",
          ok: false,
          error: TIME_BUDGET_SKIP_REASON,
          timeBudget: true
        });
        skippedCount += 1;
        // Mark rest without sleeping again
        const rest = ordered.slice(ordered.indexOf(item) + 1);
        for (const r of rest) {
          await serviceSupabase
            .from("publish_batch_items")
            .update({
              item_status: "skipped",
              error_message: TIME_BUDGET_SKIP_REASON,
              completed_at: new Date(now()).toISOString()
            })
            .eq("batch_id", batchId)
            .eq("draft_id", r.draftId);
          results.push({
            draftId: r.draftId,
            title: r.title,
            itemStatus: "skipped",
            ok: false,
            error: TIME_BUDGET_SKIP_REASON,
            timeBudget: true
          });
          skippedCount += 1;
        }
        break;
      }
    }
    firstItem = false;

    if (!draftById.has(item.draftId)) {
      const err = "草稿不存在或無權限";
      await serviceSupabase
        .from("publish_batch_items")
        .update({
          item_status: "failed",
          error_message: err,
          completed_at: new Date(now()).toISOString()
        })
        .eq("batch_id", batchId)
        .eq("draft_id", item.draftId);
      results.push({
        draftId: item.draftId,
        title: item.title,
        itemStatus: "failed",
        ok: false,
        error: err
      });
      failedCount += 1;
      continue;
    }

    await serviceSupabase
      .from("publish_batch_items")
      .update({ item_status: "processing" })
      .eq("batch_id", batchId)
      .eq("draft_id", item.draftId);

    let pubResult: PublishDraftResult;
    try {
      pubResult = await publishOne(serviceSupabase, item.draftId, publishMode);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      await serviceSupabase
        .from("publish_batch_items")
        .update({
          item_status: "failed",
          error_message: err.slice(0, 500),
          completed_at: new Date(now()).toISOString()
        })
        .eq("batch_id", batchId)
        .eq("draft_id", item.draftId);
      results.push({
        draftId: item.draftId,
        title: item.title,
        itemStatus: "failed",
        ok: false,
        error: err
      });
      failedCount += 1;
      continue;
    }

    if (pubResult.ok) {
      const productId = "productId" in pubResult ? pubResult.productId : null;
      const adminUrl = "adminUrl" in pubResult ? pubResult.adminUrl : null;
      const mock = "mock" in pubResult && pubResult.mock === true;
      await serviceSupabase
        .from("publish_batch_items")
        .update({
          item_status: "done",
          error_message: null,
          shopify_product_id: productId ?? (mock ? "mock-product-id" : null),
          shopify_admin_url: adminUrl ?? null,
          completed_at: new Date(now()).toISOString()
        })
        .eq("batch_id", batchId)
        .eq("draft_id", item.draftId);
      results.push({
        draftId: item.draftId,
        title: item.title,
        itemStatus: "done",
        ok: true,
        mock: mock || undefined,
        productId: productId ?? (mock ? "mock-product-id" : null),
        adminUrl: adminUrl ?? null
      });
      doneCount += 1;
    } else {
      const err = pubResult.error || "發布失敗";
      await serviceSupabase
        .from("publish_batch_items")
        .update({
          item_status: "failed",
          error_message: err.slice(0, 500),
          completed_at: new Date(now()).toISOString()
        })
        .eq("batch_id", batchId)
        .eq("draft_id", item.draftId);
      results.push({
        draftId: item.draftId,
        title: item.title,
        itemStatus: "failed",
        ok: false,
        error: err
      });
      failedCount += 1;
    }
  }

  // If we stopped early via continue loop, remaining ordered items may still be queued
  const handledIds = new Set(results.map((r) => r.draftId));
  for (const item of ordered) {
    if (handledIds.has(item.draftId)) continue;
    stoppedEarly = true;
    await serviceSupabase
      .from("publish_batch_items")
      .update({
        item_status: "skipped",
        error_message: TIME_BUDGET_SKIP_REASON,
        completed_at: new Date(now()).toISOString()
      })
      .eq("batch_id", batchId)
      .eq("draft_id", item.draftId);
    results.push({
      draftId: item.draftId,
      title: item.title,
      itemStatus: "skipped",
      ok: false,
      error: TIME_BUDGET_SKIP_REASON,
      timeBudget: true
    });
    skippedCount += 1;
  }

  const batchStatus = summarizePublishBatchStatus({
    total: ordered.length,
    done: doneCount,
    failed: failedCount,
    skipped: skippedCount
  });

  const errorSummaryParts: string[] = [];
  if (failedCount > 0) errorSummaryParts.push(`失敗 ${failedCount}`);
  if (skippedCount > 0) errorSummaryParts.push(`略過 ${skippedCount}（時間不足）`);
  const completedAt = new Date(now()).toISOString();

  await serviceSupabase
    .from("publish_batches")
    .update({
      status: batchStatus,
      done_count: doneCount,
      failed_count: failedCount,
      error_summary: errorSummaryParts.length ? errorSummaryParts.join("；") : null,
      completed_at: completedAt,
      updated_at: completedAt
      // notify_sent_at claimed only by tryNotify when ≥1 channel sent (Q3b)
    })
    .eq("id", batchId);

  // Event #2: after terminal write; never throws into publish result
  await safeTryNotifyPublishBatchIfComplete(batchId, { serviceSupabase });

  let makeWebhook: "sent" | "skipped" | "error" = "skipped";
  if (!skipMakeWebhook && process.env.MAKE_WEBHOOK_URL) {
    try {
      await notifyMake("publish_batch_submitted", {
        batchId,
        publishMode,
        batchStatus,
        totalCount: ordered.length,
        doneCount,
        failedCount,
        skippedCount,
        stoppedEarly,
        snapshot,
        results: results.map((r) => ({
          draftId: r.draftId,
          itemStatus: r.itemStatus,
          ok: r.ok,
          error: r.error ?? null,
          productId: r.productId ?? null
        }))
      });
      makeWebhook = "sent";
    } catch {
      makeWebhook = "error";
    }
  }

  const message = formatPublishBatchOperatorMessage({
    succeeded: doneCount,
    failed: failedCount,
    skipped: skippedCount,
    batchStatus,
    publishMode
  });

  return {
    ok: true,
    batchId,
    batchStatus,
    succeeded: doneCount,
    failed: failedCount,
    skipped: skippedCount,
    results,
    message,
    stoppedEarly,
    elapsedMs: now() - startedAt,
    makeWebhook
  };
}
