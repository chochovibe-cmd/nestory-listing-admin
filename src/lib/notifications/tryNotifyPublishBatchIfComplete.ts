/**
 * D6-#2 / notify2: idempotent notify when all publish_batch_items are terminal.
 *
 * Q1-A: item statuses only (done|failed|skipped)
 * Q2-B: Email lists fail/skip + success ≤20; LINE via template counts only
 * Q3b: ≥1 channel sent → claim notify_sent_at; all skip/error → no claim
 *
 * Failures never throw to runPublishBatch — use safeTry wrapper.
 */

import {
  buildPublishRecordsBatchUrl,
  buildReviewUrl,
  loadNotifyConfig,
  shouldClaimAfterDispatch,
  type NotifyAppConfig
} from "@/lib/notifications/config";
import {
  areAllBatchItemsTerminal,
  countItemStatuses
} from "@/lib/notifications/itemTerminal";
import { dispatchPublishBatchDone } from "@/lib/notifications/notifyCenter";
import {
  buildPublishNotifyLineLists,
  shortBatchId
} from "@/lib/notifications/templates/publishBatch";
import type { TryNotifyPublishBatchResult } from "@/lib/notifications/types";
import { snapshotTitleMap } from "@/lib/drafts/publishRecords";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export type NotifyServiceClient = ReturnType<typeof createServiceSupabaseClient>;

export type TryNotifyPublishDeps = {
  serviceSupabase?: NotifyServiceClient;
  config?: NotifyAppConfig;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

export async function tryNotifyPublishBatchIfComplete(
  batchId: string,
  deps: TryNotifyPublishDeps = {}
): Promise<TryNotifyPublishBatchResult> {
  if (!batchId?.trim()) {
    return {
      ok: false,
      batchId: batchId || "",
      reason: "batch_not_found",
      message: "empty batchId"
    };
  }

  try {
    const serviceSupabase =
      deps.serviceSupabase ?? createServiceSupabaseClient();
    const config = deps.config ?? loadNotifyConfig();

    const { data: batch, error: batchErr } = await serviceSupabase
      .from("publish_batches")
      .select(
        "id, status, publish_mode, total_count, done_count, failed_count, notify_sent_at, snapshot_json"
      )
      .eq("id", batchId)
      .maybeSingle();

    if (batchErr || !batch) {
      return {
        ok: false,
        batchId,
        reason: "batch_not_found",
        message: batchErr?.message
      };
    }

    if (batch.notify_sent_at) {
      return {
        ok: true,
        batchId,
        reason: "already_notified",
        claimed: true
      };
    }

    const { data: items, error: itemsErr } = await serviceSupabase
      .from("publish_batch_items")
      .select("draft_id, item_status, error_message")
      .eq("batch_id", batchId);

    if (itemsErr) {
      return {
        ok: false,
        batchId,
        reason: "error",
        message: itemsErr.message
      };
    }

    const rows = (items ?? []) as Array<{
      draft_id?: string;
      item_status?: string;
      error_message?: string | null;
    }>;

    const statuses = rows.map((r) => r.item_status);

    if (statuses.length === 0) {
      return { ok: true, batchId, reason: "no_items" };
    }

    if (!areAllBatchItemsTerminal(statuses)) {
      return { ok: true, batchId, reason: "not_terminal" };
    }

    if (!config.anyChannelReady) {
      return {
        ok: true,
        batchId,
        reason: "no_channel_configured",
        claimed: false,
        message: "RESEND_*/LINE_* not configured; skipped without claim"
      };
    }

    const titleMap = snapshotTitleMap(batch.snapshot_json);
    const lineSource = rows.map((r) => ({
      draftId: r.draft_id || "",
      itemStatus: r.item_status || "",
      errorMessage: r.error_message ?? null,
      title: titleMap.get(r.draft_id || "") || "未命名草稿"
    }));

    const lists = buildPublishNotifyLineLists(lineSource);
    const counts = countItemStatuses(statuses);
    // R4 §12: deep link to the batch card
    const recordsUrl =
      buildPublishRecordsBatchUrl(config.appBaseUrl, batchId) ??
      buildReviewUrl(config.appBaseUrl, "/records");

    const payload = {
      batchId,
      batchIdShort: shortBatchId(batchId),
      totalCount: counts.total || Number(batch.total_count) || 0,
      doneCount: lists.doneCount,
      failedCount: lists.failedCount,
      skippedCount: lists.skippedCount,
      successLines: lists.successLines,
      failedLines: lists.failedLines,
      skippedLines: lists.skippedLines,
      successTruncated: lists.successTruncated,
      recordsUrl,
      batchStatus: typeof batch.status === "string" ? batch.status : null,
      publishMode:
        typeof batch.publish_mode === "string" ? batch.publish_mode : null
    };

    const dispatch = await dispatchPublishBatchDone(payload, {
      config,
      fetchImpl: deps.fetchImpl
    });

    const claim = shouldClaimAfterDispatch(dispatch.attempts);
    let claimed = false;

    if (claim) {
      const nowIso = (deps.now?.() ?? new Date()).toISOString();
      const { data: claimedRows, error: claimErr } = await serviceSupabase
        .from("publish_batches")
        .update({
          notify_sent_at: nowIso,
          updated_at: nowIso
        })
        .eq("id", batchId)
        .is("notify_sent_at", null)
        .select("id");

      if (claimErr) {
        console.warn(
          "[d6-notify2] claim notify_sent_at failed",
          batchId,
          claimErr.message
        );
      } else {
        claimed = Array.isArray(claimedRows) && claimedRows.length > 0;
      }
    }

    if (dispatch.anySent) {
      console.info(
        "[d6-notify2] publish_batch_done",
        batchId,
        dispatch.attempts.map((a) => `${a.channel}:${a.status}`).join(","),
        claimed ? "claimed" : "claim_race_or_fail"
      );
    } else {
      console.info(
        "[d6-notify2] publish_batch_done not claimed",
        batchId,
        dispatch.attempts
          .map((a) => `${a.channel}:${a.status}:${a.reason ?? ""}`)
          .join(";")
      );
    }

    return {
      ok: true,
      batchId,
      reason: claim && claimed ? "dispatched_claimed" : "dispatched_not_claimed",
      dispatch,
      claimed
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      "[d6-notify2] tryNotifyPublishBatchIfComplete error",
      batchId,
      message
    );
    return {
      ok: false,
      batchId,
      reason: "error",
      message
    };
  }
}

/**
 * Fire-and-forget safe wrapper: never throws.
 * Use after publish_batches terminal update in runPublishBatch.
 */
export async function safeTryNotifyPublishBatchIfComplete(
  batchId: string | null | undefined,
  deps: TryNotifyPublishDeps = {}
): Promise<TryNotifyPublishBatchResult | null> {
  if (!batchId) return null;
  try {
    return await tryNotifyPublishBatchIfComplete(batchId, deps);
  } catch (err) {
    console.warn(
      "[d6-notify2] safeTryNotifyPublish swallowed",
      batchId,
      err instanceof Error ? err.message : err
    );
    return {
      ok: false,
      batchId,
      reason: "error",
      message: err instanceof Error ? err.message : String(err)
    };
  }
}
