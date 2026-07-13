/**
 * D6-open: batch terminal detection from image_batch_items only.
 * Do NOT use batch.status alone (partial_failed can mean awaiting_d4).
 */

export const TERMINAL_ITEM_STATUSES = ["done", "failed", "skipped"] as const;
export type TerminalItemStatus = (typeof TERMINAL_ITEM_STATUSES)[number];

export const NON_TERMINAL_ITEM_STATUSES = ["queued", "processing"] as const;

export function isTerminalItemStatus(status: string | null | undefined): boolean {
  return (
    status === "done" || status === "failed" || status === "skipped"
  );
}

/**
 * True only when there is ≥1 item and every item is done|failed|skipped.
 * Empty list → false (nothing to notify).
 */
export function areAllBatchItemsTerminal(
  itemStatuses: Array<string | null | undefined>
): boolean {
  if (!itemStatuses.length) return false;
  return itemStatuses.every((s) => isTerminalItemStatus(s));
}

export type ItemStatusCounts = {
  total: number;
  done: number;
  failed: number;
  skipped: number;
  queued: number;
  processing: number;
  other: number;
};

export function countItemStatuses(
  itemStatuses: Array<string | null | undefined>
): ItemStatusCounts {
  const counts: ItemStatusCounts = {
    total: itemStatuses.length,
    done: 0,
    failed: 0,
    skipped: 0,
    queued: 0,
    processing: 0,
    other: 0
  };
  for (const s of itemStatuses) {
    if (s === "done") counts.done += 1;
    else if (s === "failed") counts.failed += 1;
    else if (s === "skipped") counts.skipped += 1;
    else if (s === "queued") counts.queued += 1;
    else if (s === "processing") counts.processing += 1;
    else counts.other += 1;
  }
  return counts;
}
