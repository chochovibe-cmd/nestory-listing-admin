/**
 * REVIEW-FLOW B7: outcome tracking for the sequential (逐件) review overlay.
 *
 * Each queue item ends a round as one of:
 *   done     — acted on successfully (approve / 標圖通過 / return)
 *   skipped  — moved forward past (跳過 › / → / j) without acting
 *   pending  — not reached yet, or only looked at and left (back / 結束)
 *
 * Going back never changes an outcome; acting on a previously skipped item makes it done.
 * When the round ends (moved past the last item, or 結束逐件 / Esc) and something was
 * skipped, the overlay shows a summary instead of closing: jump to a skipped item,
 * restart with only the skipped ones, or end.
 *
 * Pure reducer — the overlay keeps it in useReducer; tests drive it directly.
 */

export type SequentialOutcome = "pending" | "done" | "skipped";
export type SequentialPhase = "reviewing" | "summary" | "closed";
/** finished = walked past the last item; ended = 結束逐件 / Esc / summary 結束. */
export type SequentialCloseReason = "finished" | "ended";

export type SequentialReviewState = {
  /** Active round, in display order. */
  ids: string[];
  index: number;
  outcomes: Record<string, SequentialOutcome>;
  phase: SequentialPhase;
  /** Visiting one item from the summary list: acting returns to the summary. */
  fromSummary: boolean;
  closedBy: SequentialCloseReason | null;
};

export type SequentialReviewAction =
  | { type: "reset"; ids: string[] }
  /**
   * An item was acted on successfully. `id` = the item that was acted on (the overlay always
   * passes it, so a slow request that resolves after the user navigated still marks the
   * right item); omitted = the current item.
   */
  | { type: "done"; id?: string }
  /** Moved forward without acting. */
  | { type: "skip" }
  | { type: "back" }
  /** 結束逐件 / Esc. */
  | { type: "end" }
  /** Open the item at `index` (of the current round) from the summary list. */
  | { type: "jump"; index: number }
  /** Summary → new round with only the skipped items. */
  | { type: "restart_skipped" };

export function createSequentialReviewState(ids: string[]): SequentialReviewState {
  const outcomes: Record<string, SequentialOutcome> = {};
  for (const id of ids) outcomes[id] = "pending";
  return {
    ids: [...ids],
    index: 0,
    outcomes,
    phase: ids.length === 0 ? "closed" : "reviewing",
    fromSummary: false,
    closedBy: ids.length === 0 ? "ended" : null
  };
}

export function sequentialCounts(state: SequentialReviewState): {
  total: number;
  position: number;
  done: number;
  skipped: number;
  pending: number;
} {
  let done = 0;
  let skipped = 0;
  let pending = 0;
  for (const id of state.ids) {
    const outcome = state.outcomes[id] ?? "pending";
    if (outcome === "done") done += 1;
    else if (outcome === "skipped") skipped += 1;
    else pending += 1;
  }
  const total = state.ids.length;
  return {
    total,
    position: total === 0 ? 0 : Math.min(state.index, total - 1) + 1,
    done,
    skipped,
    pending
  };
}

export function sequentialSkippedIds(state: SequentialReviewState): string[] {
  return state.ids.filter((id) => state.outcomes[id] === "skipped");
}

export function sequentialCurrentId(state: SequentialReviewState): string | null {
  if (state.ids.length === 0) return null;
  return state.ids[Math.min(state.index, state.ids.length - 1)] ?? null;
}

/** Round is over: summary when something was skipped, otherwise close. */
function finishRound(
  state: SequentialReviewState,
  reason: SequentialCloseReason
): SequentialReviewState {
  if (sequentialSkippedIds(state).length > 0) {
    return { ...state, phase: "summary", fromSummary: false };
  }
  return { ...state, phase: "closed", fromSummary: false, closedBy: reason };
}

/** After an outcome was recorded for the current item: move on. */
function advance(state: SequentialReviewState): SequentialReviewState {
  if (state.fromSummary) {
    // One-off visit from the summary: back to it (or close if nothing is left skipped).
    return finishRound({ ...state, fromSummary: false }, "finished");
  }
  if (state.index >= state.ids.length - 1) return finishRound(state, "finished");
  return { ...state, index: state.index + 1 };
}

export function reduceSequentialReview(
  state: SequentialReviewState,
  action: SequentialReviewAction
): SequentialReviewState {
  if (action.type === "reset") return createSequentialReviewState(action.ids);
  if (state.phase === "closed") return state;

  if (action.type === "done" && action.id != null) {
    const targetId = action.id;
    if (!(targetId in state.outcomes)) return state;
    const marked = { ...state, outcomes: { ...state.outcomes, [targetId]: "done" as const } };
    if (state.phase === "summary") {
      // Resolved while the summary is up: just record it; nothing skipped left → close.
      return sequentialSkippedIds(marked).length === 0
        ? { ...marked, phase: "closed", fromSummary: false, closedBy: "finished" }
        : marked;
    }
    // Acted on an item the user already navigated away from: record, don't move.
    if (targetId !== sequentialCurrentId(state)) return marked;
    return advance(marked);
  }

  if (action.type === "end") {
    if (state.phase === "summary") {
      return { ...state, phase: "closed", fromSummary: false, closedBy: "ended" };
    }
    return finishRound({ ...state, fromSummary: false }, "ended");
  }

  if (state.phase === "summary") {
    if (action.type === "jump") {
      if (action.index < 0 || action.index >= state.ids.length) return state;
      return { ...state, phase: "reviewing", index: action.index, fromSummary: true };
    }
    if (action.type === "restart_skipped") {
      const skipped = sequentialSkippedIds(state);
      return skipped.length === 0
        ? { ...state, phase: "closed", closedBy: "ended" }
        : createSequentialReviewState(skipped);
    }
    return state;
  }

  // phase === "reviewing"
  const currentId = sequentialCurrentId(state);
  if (currentId == null) return state;

  switch (action.type) {
    case "done":
      return advance({
        ...state,
        outcomes: { ...state.outcomes, [currentId]: "done" }
      });
    case "skip": {
      const prior = state.outcomes[currentId] ?? "pending";
      return advance({
        ...state,
        outcomes: {
          ...state.outcomes,
          [currentId]: prior === "done" ? "done" : "skipped"
        }
      });
    }
    case "back": {
      if (state.fromSummary) return { ...state, phase: "summary", fromSummary: false };
      return { ...state, index: Math.max(0, state.index - 1) };
    }
    default:
      return state;
  }
}
