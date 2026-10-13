/**
 * REVIEW-FLOW B4: no blink after a "leaving" action.
 *
 * After approve / 標圖通過 / 退回 succeeds the card fades out, then `router.refresh()`
 * fetches new server props. Between "fade ended" and "refresh landed" the list still
 * holds the old draft (old stage + status), so the card used to flash back for a moment.
 *
 * We remember the PRE-action stage + status per id. While the draft prop still carries
 * exactly those values the card stays hidden. The entry is dropped as soon as the prop
 * changes (refresh landed) or the draft disappears, and after PENDING_LEAVE_TTL_MS
 * regardless — a refresh that never lands must not hide a card forever.
 *
 * Pure — no React, no timers. The panel owns state + a timeout that re-reconciles.
 */

export const PENDING_LEAVE_TTL_MS = 20_000;

export type PendingLeaveSnapshot = {
  pipeline_stage: string | null;
  status: string | null;
  /** epoch ms when the action succeeded */
  at: number;
};

export type PendingLeaveMap = Map<string, PendingLeaveSnapshot>;

type StageStatusDraft = {
  id: string;
  pipeline_stage?: string | null;
  status?: string | null;
};

/** Pre-action values to record (captured at success time, before the refresh lands). */
export type PendingLeaveSource = {
  id: string;
  pipeline_stage: string | null;
  status: string | null;
};

export function snapshotForPendingLeave(
  ids: string[],
  drafts: StageStatusDraft[]
): PendingLeaveSource[] {
  const byId = new Map(drafts.map((d) => [d.id, d]));
  const out: PendingLeaveSource[] = [];
  for (const id of ids) {
    const draft = byId.get(id);
    if (!draft) continue;
    out.push({
      id,
      pipeline_stage: draft.pipeline_stage ?? null,
      status: draft.status ?? null
    });
  }
  return out;
}

export function recordPendingLeave(
  prev: PendingLeaveMap,
  sources: PendingLeaveSource[],
  now: number
): PendingLeaveMap {
  if (sources.length === 0) return prev;
  const next = new Map(prev);
  for (const source of sources) {
    next.set(source.id, {
      pipeline_stage: source.pipeline_stage,
      status: source.status,
      at: now
    });
  }
  return next;
}

function isExpired(entry: PendingLeaveSnapshot, now: number): boolean {
  return now - entry.at >= PENDING_LEAVE_TTL_MS;
}

function sameStageStatus(entry: PendingLeaveSnapshot, draft: StageStatusDraft): boolean {
  return (
    (draft.pipeline_stage ?? null) === entry.pipeline_stage &&
    (draft.status ?? null) === entry.status
  );
}

/** True while this draft should stay hidden (unchanged prop + inside the TTL). */
export function isPendingLeaveActive(
  entry: PendingLeaveSnapshot | undefined,
  draft: StageStatusDraft,
  now: number
): boolean {
  if (!entry) return false;
  if (isExpired(entry, now)) return false;
  return sameStageStatus(entry, draft);
}

export function filterPendingLeave<T extends StageStatusDraft>(
  items: T[],
  pending: PendingLeaveMap,
  now: number
): T[] {
  if (pending.size === 0) return items;
  return items.filter((item) => !isPendingLeaveActive(pending.get(item.id), item, now));
}

/**
 * Drop entries that are done: draft gone, stage/status changed, or past the TTL.
 * Returns the same Map instance when nothing was dropped (no needless re-render).
 */
export function reconcilePendingLeave(
  prev: PendingLeaveMap,
  drafts: StageStatusDraft[],
  now: number
): PendingLeaveMap {
  if (prev.size === 0) return prev;
  const byId = new Map(drafts.map((d) => [d.id, d]));
  let changed = false;
  const next = new Map(prev);
  for (const [id, entry] of prev) {
    const draft = byId.get(id);
    if (!draft || isExpired(entry, now) || !sameStageStatus(entry, draft)) {
      next.delete(id);
      changed = true;
    }
  }
  return changed ? next : prev;
}

/** ms until the earliest entry expires (>= 0), or null when the map is empty. */
export function nextPendingLeaveExpiryMs(
  pending: PendingLeaveMap,
  now: number
): number | null {
  if (pending.size === 0) return null;
  let soonest = Infinity;
  for (const entry of pending.values()) {
    soonest = Math.min(soonest, entry.at + PENDING_LEAVE_TTL_MS - now);
  }
  return Math.max(0, soonest);
}
