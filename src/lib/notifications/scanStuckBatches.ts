/**
 * D6-open: daily scan for stuck image batches + optional catch-up notify.
 *
 * Stuck: status ∈ {queued, processing} (or already stuck without notify),
 * updated_at older than 24h.
 * Q6-A: mark status = stuck.
 * Q3b: claim stuck_notified_at only when ≥1 channel "sent".
 */

import {
  buildReviewUrl,
  loadNotifyConfig,
  shouldClaimAfterDispatch,
  type NotifyAppConfig
} from "@/lib/notifications/config";
import { dispatchImageBatchStuck } from "@/lib/notifications/notifyCenter";
import { shortBatchId } from "@/lib/notifications/templates/imageBatch";
import {
  safeTryNotifyImageBatchIfComplete,
  type NotifyServiceClient
} from "@/lib/notifications/tryNotifyImageBatchIfComplete";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

const STUCK_AGE_MS = 24 * 60 * 60 * 1000;

export type ScanStuckBatchesResult = {
  ok: boolean;
  scanned: number;
  markedStuck: number;
  notifyAttempted: number;
  notifyClaimed: number;
  catchUpAttempted: number;
  errors: string[];
  note?: string;
};

export type ScanStuckDeps = {
  serviceSupabase?: NotifyServiceClient;
  config?: NotifyAppConfig;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  stuckAgeMs?: number;
  /** Also try terminal batches with null notify_sent_at (keys may have been added). */
  catchUpTerminal?: boolean;
};

export async function scanStuckBatches(
  deps: ScanStuckDeps = {}
): Promise<ScanStuckBatchesResult> {
  const errors: string[] = [];
  const now = deps.now?.() ?? new Date();
  const ageMs = deps.stuckAgeMs ?? STUCK_AGE_MS;
  const cutoffIso = new Date(now.getTime() - ageMs).toISOString();
  const config = deps.config ?? loadNotifyConfig();

  let serviceSupabase: NotifyServiceClient;
  try {
    serviceSupabase = deps.serviceSupabase ?? createServiceSupabaseClient();
  } catch (err) {
    return {
      ok: false,
      scanned: 0,
      markedStuck: 0,
      notifyAttempted: 0,
      notifyClaimed: 0,
      catchUpAttempted: 0,
      errors: [err instanceof Error ? err.message : String(err)],
      note: "service supabase unavailable"
    };
  }

  let markedStuck = 0;
  let notifyAttempted = 0;
  let notifyClaimed = 0;
  let catchUpAttempted = 0;

  // 1) Active non-terminal old batches
  const { data: activeRows, error: activeErr } = await serviceSupabase
    .from("image_batches")
    .select(
      "id, status, total_count, done_count, failed_count, updated_at, stuck_notified_at, notify_sent_at"
    )
    .in("status", ["queued", "processing"])
    .lt("updated_at", cutoffIso)
    .limit(50);

  if (activeErr) {
    errors.push(`active_scan:${activeErr.message}`);
  }

  // 2) Already stuck but never successfully notified (keys added later)
  const { data: stuckPending, error: stuckErr } = await serviceSupabase
    .from("image_batches")
    .select(
      "id, status, total_count, done_count, failed_count, updated_at, stuck_notified_at, notify_sent_at"
    )
    .eq("status", "stuck")
    .is("stuck_notified_at", null)
    .limit(50);

  if (stuckErr) {
    errors.push(`stuck_scan:${stuckErr.message}`);
  }

  type Row = {
    id: string;
    status: string;
    total_count: number;
    done_count: number;
    failed_count: number;
    updated_at: string | null;
    stuck_notified_at: string | null;
    notify_sent_at: string | null;
  };

  const byId = new Map<string, Row>();
  for (const r of [...(activeRows ?? []), ...(stuckPending ?? [])] as Row[]) {
    if (r?.id) byId.set(r.id, r);
  }

  const rows = [...byId.values()];
  const reviewUrl = buildReviewUrl(config.appBaseUrl);

  for (const row of rows) {
    try {
      // Q6-A: mark stuck (even if notify skipped)
      if (row.status === "queued" || row.status === "processing") {
        const { error: markErr } = await serviceSupabase
          .from("image_batches")
          .update({
            status: "stuck",
            updated_at: now.toISOString()
          })
          .eq("id", row.id)
          .in("status", ["queued", "processing"]);
        if (markErr) {
          errors.push(`mark_stuck:${row.id}:${markErr.message}`);
        } else {
          markedStuck += 1;
          row.status = "stuck";
        }
      }

      if (row.stuck_notified_at) continue;

      if (!config.anyChannelReady) {
        continue;
      }

      const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : now.getTime();
      const ageHours = Math.max(0, (now.getTime() - updatedAt) / (60 * 60 * 1000));

      notifyAttempted += 1;
      const dispatch = await dispatchImageBatchStuck(
        {
          batchId: row.id,
          batchIdShort: shortBatchId(row.id),
          status: row.status,
          totalCount: Number(row.total_count) || 0,
          doneCount: Number(row.done_count) || 0,
          failedCount: Number(row.failed_count) || 0,
          ageHours,
          reviewUrl,
          updatedAt: row.updated_at
        },
        { config, fetchImpl: deps.fetchImpl }
      );

      if (shouldClaimAfterDispatch(dispatch.attempts)) {
        const iso = now.toISOString();
        const { data: claimedRows, error: claimErr } = await serviceSupabase
          .from("image_batches")
          .update({
            stuck_notified_at: iso,
            updated_at: iso
          })
          .eq("id", row.id)
          .is("stuck_notified_at", null)
          .select("id");

        if (claimErr) {
          errors.push(`claim_stuck:${row.id}:${claimErr.message}`);
        } else if (Array.isArray(claimedRows) && claimedRows.length > 0) {
          notifyClaimed += 1;
        }
      }
    } catch (err) {
      errors.push(
        `row:${row.id}:${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Optional catch-up: terminal batches never claimed (keys were missing before)
  if (deps.catchUpTerminal !== false && config.anyChannelReady) {
    const { data: pendingDone, error: pendErr } = await serviceSupabase
      .from("image_batches")
      .select("id")
      .in("status", ["completed", "partial_failed", "failed"])
      .is("notify_sent_at", null)
      .limit(20);

    if (pendErr) {
      errors.push(`catchup_scan:${pendErr.message}`);
    } else {
      for (const p of pendingDone ?? []) {
        const id = (p as { id: string }).id;
        if (!id) continue;
        catchUpAttempted += 1;
        await safeTryNotifyImageBatchIfComplete(id, {
          serviceSupabase,
          config,
          fetchImpl: deps.fetchImpl,
          now: () => now
        });
      }
    }
  }

  return {
    ok: errors.length === 0,
    scanned: rows.length,
    markedStuck,
    notifyAttempted,
    notifyClaimed,
    catchUpAttempted,
    errors,
    note: config.anyChannelReady
      ? undefined
      : "no notify channels configured; stuck rows may still be marked"
  };
}
