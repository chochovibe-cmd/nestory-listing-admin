/**
 * D6-open: shared idempotent entry — notify once when all batch items are terminal.
 *
 * Q3b (B′):
 * - no channel configured / all skipped → do NOT claim notify_sent_at
 * - at least one channel "sent" → claim with conditional update (防雙寄)
 * - all error → do NOT claim (retry later)
 * - one sent + one error → claim
 *
 * Failures never throw to caller paths that matter — callers should still wrap try/catch.
 */

import {
  buildReviewUrl,
  loadNotifyConfig,
  shouldClaimAfterDispatch,
  type NotifyAppConfig
} from "@/lib/notifications/config";
import {
  areAllBatchItemsTerminal,
  countItemStatuses
} from "@/lib/notifications/itemTerminal";
import { dispatchImageBatchDone } from "@/lib/notifications/notifyCenter";
import { shortBatchId } from "@/lib/notifications/templates/imageBatch";
import type {
  TryNotifyImageBatchResult
} from "@/lib/notifications/types";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export type NotifyServiceClient = ReturnType<typeof createServiceSupabaseClient>;

export type TryNotifyDeps = {
  serviceSupabase?: NotifyServiceClient;
  config?: NotifyAppConfig;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

export async function tryNotifyImageBatchIfComplete(
  batchId: string,
  deps: TryNotifyDeps = {}
): Promise<TryNotifyImageBatchResult> {
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
      .from("image_batches")
      .select(
        "id, status, total_count, done_count, failed_count, regenerate_item_count, notify_sent_at"
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
      .from("image_batch_items")
      .select("item_status")
      .eq("batch_id", batchId);

    if (itemsErr) {
      return {
        ok: false,
        batchId,
        reason: "error",
        message: itemsErr.message
      };
    }

    const statuses = (items ?? []).map(
      (r) => (r as { item_status?: string }).item_status
    );

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

    const counts = countItemStatuses(statuses);
    const reviewUrl = buildReviewUrl(config.appBaseUrl);
    const payload = {
      batchId,
      batchIdShort: shortBatchId(batchId),
      totalCount: counts.total || Number(batch.total_count) || 0,
      doneCount: counts.done,
      failedCount: counts.failed,
      skippedCount: counts.skipped,
      regenerateItemCount: Number(batch.regenerate_item_count) || 0,
      reviewUrl
    };

    const dispatch = await dispatchImageBatchDone(payload, {
      config,
      fetchImpl: deps.fetchImpl
    });

    const claim = shouldClaimAfterDispatch(dispatch.attempts);
    let claimed = false;

    if (claim) {
      const nowIso = (deps.now?.() ?? new Date()).toISOString();
      // Conditional update: only first successful claimer wins
      const { data: claimedRows, error: claimErr } = await serviceSupabase
        .from("image_batches")
        .update({
          notify_sent_at: nowIso,
          completed_at: nowIso,
          updated_at: nowIso
        })
        .eq("id", batchId)
        .is("notify_sent_at", null)
        .select("id");

      if (claimErr) {
        console.warn(
          "[d6-notify] claim notify_sent_at failed",
          batchId,
          claimErr.message
        );
      } else {
        claimed = Array.isArray(claimedRows) && claimedRows.length > 0;
      }
    }

    if (dispatch.anySent) {
      console.info(
        "[d6-notify] image_batch_done",
        batchId,
        dispatch.attempts.map((a) => `${a.channel}:${a.status}`).join(","),
        claimed ? "claimed" : "claim_race_or_fail"
      );
    } else {
      console.info(
        "[d6-notify] image_batch_done not claimed",
        batchId,
        dispatch.attempts.map((a) => `${a.channel}:${a.status}:${a.reason ?? ""}`).join(";")
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
    console.warn("[d6-notify] tryNotifyImageBatchIfComplete error", batchId, message);
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
 * Use after batch status writes in auto-chain / ai-process.
 */
export async function safeTryNotifyImageBatchIfComplete(
  batchId: string | null | undefined,
  deps: TryNotifyDeps = {}
): Promise<TryNotifyImageBatchResult | null> {
  if (!batchId) return null;
  try {
    return await tryNotifyImageBatchIfComplete(batchId, deps);
  } catch (err) {
    console.warn(
      "[d6-notify] safeTryNotify swallowed",
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
