/**
 * B12 fix: optimistic hide after archive/unarchive so the list updates
 * immediately; router.refresh() only reconciles with the server.
 *
 * "archived"  — hide until server status is archived (or row gone)
 * "unarchived"— hide until server status is not archived
 */
export type OptimisticHideReason = "archived" | "unarchived";

export type OptimisticHideMap = Map<string, OptimisticHideReason>;

export function applyOptimisticHide(
  prev: OptimisticHideMap,
  ids: string[],
  reason: OptimisticHideReason
): OptimisticHideMap {
  if (!ids.length) return prev;
  const next = new Map(prev);
  for (const id of ids) next.set(id, reason);
  return next;
}

/** Drop entries the server props already reflect. */
export function reconcileOptimisticHide(
  prev: OptimisticHideMap,
  drafts: Array<{ id: string; status: string }>
): OptimisticHideMap {
  if (prev.size === 0) return prev;
  const byId = new Map(drafts.map((d) => [d.id, d.status]));
  let changed = false;
  const next = new Map(prev);
  for (const [id, reason] of prev) {
    const status = byId.get(id);
    const done =
      reason === "archived"
        ? status === undefined || status === "archived"
        : status !== undefined && status !== "archived";
    if (done) {
      next.delete(id);
      changed = true;
    }
  }
  return changed ? next : prev;
}

export function filterByOptimisticHide<T extends { id: string }>(
  items: T[],
  hide: OptimisticHideMap
): T[] {
  if (hide.size === 0) return items;
  return items.filter((item) => !hide.has(item.id));
}
