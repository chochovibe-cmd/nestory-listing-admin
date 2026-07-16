/**
 * P1-5 / 回饋 49: card price display helpers (single or min~max range).
 */

export function formatPriceRangeLabel(prices: Array<number | null | undefined>): string | null {
  const nums = prices
    .map((p) => (p == null ? NaN : Number(p)))
    .filter((n) => Number.isFinite(n) && n > 0) as number[];
  if (nums.length === 0) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (min === max) return `NT$${min.toLocaleString()}`;
  return `NT$${min.toLocaleString()}~${max.toLocaleString()}`;
}

/** Prefer variant sell prices when multi-SKU; else draft.twd_price. */
export function collectSellPricesForCard(input: {
  draftPrice: number | null | undefined;
  variantPrices?: Array<number | null | undefined> | null;
}): number[] {
  const fromVariants = (input.variantPrices ?? [])
    .map((p) => (p == null ? NaN : Number(p)))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (fromVariants.length > 0) return fromVariants;
  const d = input.draftPrice == null ? NaN : Number(input.draftPrice);
  if (Number.isFinite(d) && d > 0) return [d];
  return [];
}
