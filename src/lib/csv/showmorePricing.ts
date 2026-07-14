import { beautifyNestoryPrice, nextBeautifiedPriceAbove } from "@/lib/nestoryPrice";

/** Default Showmore markup % (C2 / 【自動·一】). */
export const DEFAULT_SHOWMORE_MARKUP_PERCENT = 5;

/**
 * Normalize client-sent markup % for export.
 * Invalid / missing → 5; clamp 0–100.
 */
export function normalizeShowmoreMarkupPercent(value: unknown): number {
  if (value == null || value === "") return DEFAULT_SHOWMORE_MARKUP_PERCENT;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SHOWMORE_MARKUP_PERCENT;
  return Math.min(100, Math.max(0, n));
}

/**
 * Sell / list price after Showmore markup + nestory 尾數美化.
 * Cost must NOT use this helper (cost is never marked up).
 * Empty / non-positive input → empty string for CSV cells.
 */
export function applyShowmoreMarkup(
  price: number | null | undefined,
  markupPercent: number
): number | "" {
  if (price == null || !Number.isFinite(Number(price))) return "";
  const base = Number(price);
  if (base <= 0) return "";
  const pct = normalizeShowmoreMarkupPercent(markupPercent);
  const raw = base * (1 + pct / 100);
  return beautifyNestoryPrice(raw);
}

/**
 * Compare-at (原價) after markup + beautify.
 * Must stay strictly above the Showmore sell price when both exist.
 */
export function applyShowmoreCompareAt(
  compareAt: number | null | undefined,
  sellPriceShowmore: number | "",
  markupPercent: number
): number | "" {
  if (compareAt == null || !Number.isFinite(Number(compareAt))) return "";
  const base = Number(compareAt);
  if (base <= 0) return "";

  let marked = applyShowmoreMarkup(base, markupPercent);
  if (marked === "") return "";

  if (typeof sellPriceShowmore === "number" && sellPriceShowmore > 0 && marked <= sellPriceShowmore) {
    marked = nextBeautifiedPriceAbove(sellPriceShowmore);
  }
  return marked;
}
