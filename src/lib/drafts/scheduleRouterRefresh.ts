/**
 * B12 fix: commit client notice/selection state before RSC refresh.
 * Calling router.refresh() in the same tick as setState can race so the
 * success notice and list update only appear after the next user action.
 */
export function scheduleRouterRefresh(refresh: () => void): void {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(() => {
      refresh();
    });
    return;
  }
  setTimeout(refresh, 0);
}
