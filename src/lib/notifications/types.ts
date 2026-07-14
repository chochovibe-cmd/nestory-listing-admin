/**
 * D6 notify center event types.
 *
 * Implemented: image_batch_done (#1), image_batch_stuck (cron),
 * publish_batch_done (#2, D6-#2 / notify2).
 * Stub only: weekly_scouting (#3), budget_80 (#4) — see 自動化流程【二】.
 */

export type NotifyEventType =
  | "image_batch_done"
  | "image_batch_stuck"
  | "publish_batch_done" // #2 after runPublishBatch terminal
  // --- stubs for later packages (do not dispatch yet) ---
  | "weekly_scouting" // #3 Phase F
  | "budget_80"; // #4 Phase E

export type ChannelId = "email" | "line";

export type ChannelAttemptStatus = "sent" | "skipped" | "error";

export type ChannelAttemptResult = {
  channel: ChannelId;
  status: ChannelAttemptStatus;
  /** Human-readable reason for skip/error (never secrets). */
  reason?: string;
  /** Provider message id when available. */
  messageId?: string;
};

export type NotifyDispatchResult = {
  event: NotifyEventType;
  attempts: ChannelAttemptResult[];
  /** True if at least one channel status === "sent". */
  anySent: boolean;
  /** True if every attempt was skipped (missing config). */
  allSkipped: boolean;
  /** True if no "sent" and at least one "error". */
  allFailedOrError: boolean;
};

export type ImageBatchNotifyPayload = {
  batchId: string;
  totalCount: number;
  doneCount: number;
  failedCount: number;
  skippedCount: number;
  regenerateItemCount: number;
  reviewUrl: string | null;
  /** Short id for logs / LINE alt text. */
  batchIdShort: string;
};

export type StuckBatchNotifyPayload = {
  batchId: string;
  batchIdShort: string;
  status: string;
  totalCount: number;
  doneCount: number;
  failedCount: number;
  ageHours: number;
  reviewUrl: string | null;
  updatedAt: string | null;
};

/** Event #2: publish batch finished (Email lists; LINE counts only). */
export type PublishBatchNotifyPayload = {
  batchId: string;
  batchIdShort: string;
  totalCount: number;
  doneCount: number;
  failedCount: number;
  skippedCount: number;
  /** Email only: success titles (already capped ≤20 by builder path). */
  successLines: string[];
  /** Email only: "title — reason" for failed items (all). */
  failedLines: string[];
  /** Email only: "title — reason" for skipped items (all). */
  skippedLines: string[];
  /** True when more than successLines.length successes exist. */
  successTruncated: boolean;
  recordsUrl: string | null;
  batchStatus?: string | null;
  publishMode?: string | null;
};

export type TryNotifyReason =
  | "not_terminal"
  | "already_notified"
  | "no_items"
  | "batch_not_found"
  | "no_channel_configured"
  | "dispatched_claimed"
  | "dispatched_not_claimed"
  | "error";

export type TryNotifyImageBatchResult = {
  ok: boolean;
  batchId: string;
  reason: TryNotifyReason;
  dispatch?: NotifyDispatchResult;
  claimed?: boolean;
  message?: string;
};

/** Same shape as image tryNotify result (shared reasons). */
export type TryNotifyPublishBatchResult = TryNotifyImageBatchResult;
