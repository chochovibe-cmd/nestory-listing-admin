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

export function beautifyNestoryPrice(rawPrice: number): number {
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
    return 0;
  }

  const basePrice = Math.ceil(rawPrice);

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
export function nextBeautifiedPriceAbove(price: number): number {
  if (!Number.isFinite(price) || price < 0) {
    return beautifyNestoryPrice(1);
  }
  // beautify 是「≥ raw 的最近階」；對 floor(price)+1 取美化即可跳過目前這階。
  const candidate = beautifyNestoryPrice(Math.floor(price) + 1);
  if (candidate > price) return candidate;
  // 理論上不該發生；再保險往上推一階。
  return beautifyNestoryPrice(candidate + 1);
}
