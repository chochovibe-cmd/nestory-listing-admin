/**
 * UX-B2-P14: relative time for result-card headers.
 * Not the same as formatAutosaveAgeLabel (restore bar uses 「約 N …」).
 */
export function formatRelativeTime(
  iso: string | null | undefined,
  nowMs: number = Date.now()
): string {
  if (iso == null || iso === "") return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";

  const diffMs = Math.max(0, nowMs - t);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "剛剛";
  if (minutes < 60) return `${minutes}分鐘前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小時前`;

  const d = new Date(t);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}`;
}

/** Hover title: full local datetime; empty when invalid. */
export function formatAbsoluteLocalTime(
  iso: string | null | undefined
): string {
  if (iso == null || iso === "") return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
