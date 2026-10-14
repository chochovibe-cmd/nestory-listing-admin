// Tiered "尾數美化" price rounding. Replaces the old nearest-10/5/xx9 rounding
// with a lookup against price points that actually read well in the shop
// (see nestory_codex_phase2_supplement_1.md §4-10).

const LOW_TIER_PRICES = [99, 129, 149, 169, 199, 229, 249, 299];
const MID_TIER_PRICES = [329, 349, 399, 449, 499, 549, 599, 699, 799, 899];
const HIGH_TIER_PRICES = [
  980, 990, 999, 1080, 1099, 1180, 1199, 1280, 1299, 1580, 1680, 2280, 4480
];

function nearestAtOrAbove(tier: number[], rawPrice: number, extensionStep: number): number {
  const candidate = tier.find((price) => price >= rawPrice);

  if (candidate !== undefined) {
    return candidate;
  }

  // Beyond the top of this tier's lookup table: extend the ladder upward in
  // fixed steps instead of hardcoding every value.
  let extended = tier[tier.length - 1];

  while (extended < rawPrice) {
    extended += extensionStep;
  }

  return extended;
}

/**
 * "standard": the shop-wide ladder above (coarse above NT$1,680: 2280, 4480, then +1000).
 * "fine": same ladder up to NT$1,680, then every hundred offers an x80 and an x99 point
 * (1699, 1780, 1799, 1880, ... 2280 ... 4480 ... 5480 stay on it). Used for per-variant
 * pricing, where the coarse gaps made different costs collapse into one selling price.
 */
export type PriceLadder = "standard" | "fine";

const FINE_LADDER_START = 1680;
const FINE_HUNDRED_POINTS = [80, 99];

function fineHighPrice(basePrice: number): number {
  for (let hundred = Math.floor(basePrice / 100) * 100; ; hundred += 100) {
    for (const offset of FINE_HUNDRED_POINTS) {
      const candidate = hundred + offset;
      if (candidate >= basePrice) return candidate;
    }
  }
}

export function beautifyNestoryPrice(rawPrice: number, ladder: PriceLadder = "standard"): number {
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
    return 0;
  }

  const basePrice = Math.ceil(rawPrice);

  if (ladder === "fine" && basePrice > FINE_LADDER_START) {
    return fineHighPrice(basePrice);
  }

  if (basePrice < 300) {
    return nearestAtOrAbove(LOW_TIER_PRICES, basePrice, 50);
  }

  if (basePrice <= 900) {
    return nearestAtOrAbove(MID_TIER_PRICES, basePrice, 100);
  }

  return nearestAtOrAbove(HIGH_TIER_PRICES, basePrice, 1000);
}

/**
 * B6 補修：回傳「嚴格大於 price」的下一階美化價。
 * 用於特價模式定價不能等於／低於售價（利潤驅動把售價拉高追上定價時）。
 */
export function nextBeautifiedPriceAbove(price: number, ladder: PriceLadder = "standard"): number {
  if (!Number.isFinite(price) || price < 0) {
    return beautifyNestoryPrice(1, ladder);
  }
  // beautify 是「≥ raw 的最近階」；對 floor(price)+1 取美化即可跳過目前這階。
  const candidate = beautifyNestoryPrice(Math.floor(price) + 1, ladder);
  if (candidate > price) return candidate;
  // 理論上不該發生；再保險往上推一階。
  return beautifyNestoryPrice(candidate + 1, ladder);
}
