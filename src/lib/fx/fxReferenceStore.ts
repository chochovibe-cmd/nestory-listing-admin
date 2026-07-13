/**
 * C6: device-local "today's reference" FX rate (NOT the applied pricing rate).
 *
 * - Applied rate lives in nestory_pricing_settings.rate (pricingSettingsStore).
 * - This store only holds the reference quote for display / optional apply.
 * - Team-wide shared reference is deferred until Supabase team_settings is wired.
 */

"use client";

export const FX_REFERENCE_STORAGE_KEY = "nestory_fx_reference";
export const FX_REFERENCE_CHANGED_EVENT = "nestory:fx-reference-changed";

export type FxReference = {
  rate: number;
  /** When this device last successfully stored the quote (ISO). */
  fetchedAt: string;
  source: string;
  /** Provider quote time when known (ISO). */
  asOf?: string;
};

/**
 * YYYY-MM-DD in Asia/Taipei — used for "same calendar day" cache.
 * Exported pure helper so verify scripts can mirror the rule.
 */
export function taiwanCalendarDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function isSameTaiwanCalendarDay(
  iso: string,
  now: Date = new Date()
): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return taiwanCalendarDateKey(d) === taiwanCalendarDateKey(now);
}

/** True when stored reference is usable as "today" without re-fetch. */
export function isFreshFxReference(
  ref: FxReference | null | undefined,
  now: Date = new Date()
): boolean {
  if (!ref) return false;
  if (typeof ref.rate !== "number" || !Number.isFinite(ref.rate) || ref.rate <= 0) {
    return false;
  }
  if (typeof ref.fetchedAt !== "string" || !ref.fetchedAt) return false;
  return isSameTaiwanCalendarDay(ref.fetchedAt, now);
}

export function getStoredFxReference(): FxReference | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FX_REFERENCE_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<FxReference>;
    if (typeof data.rate !== "number" || !Number.isFinite(data.rate) || data.rate <= 0) {
      return null;
    }
    if (typeof data.fetchedAt !== "string" || !data.fetchedAt) return null;
    return {
      rate: data.rate,
      fetchedAt: data.fetchedAt,
      source: typeof data.source === "string" ? data.source : "unknown",
      asOf: typeof data.asOf === "string" ? data.asOf : undefined
    };
  } catch {
    return null;
  }
}

/**
 * Persist today's reference only. Never touches pricing / applied rate.
 */
export function setStoredFxReference(ref: Omit<FxReference, "fetchedAt"> & { fetchedAt?: string }) {
  if (typeof window === "undefined") return;
  const next: FxReference = {
    rate: ref.rate,
    fetchedAt: ref.fetchedAt ?? new Date().toISOString(),
    source: ref.source,
    asOf: ref.asOf
  };
  window.localStorage.setItem(FX_REFERENCE_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(
    new CustomEvent(FX_REFERENCE_CHANGED_EVENT, { detail: next })
  );
}
