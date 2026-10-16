import { readHiddenVariantPriceEvidence } from "@/lib/shopify/publishReadiness";

/**
 * PRICE-GUARD: detect captures where Taobao/Tmall hid the per-variant prices.
 *
 * 2026-10-14 incident: ICE data carried `skuItem.hideOtherPrice = true` and sku2info had no
 * `price` key, so every variant fell back to the product's cheapest ("起") price and eight
 * drafts went live at one price. The extension already warns (「sku: 個別未優惠價未完整取得…」),
 * but the server stored `price_requires_confirmation = false`.
 *
 * The evidence reader itself lives in publishReadiness.ts (that module must stay import-free
 * because the publish guard is shared with client code); this file adds the capture-side rule.
 */

/** Chinese warning added to the draft + raw_capture.server.warnings when prices are hidden. */
export const WARNING_HIDDEN_VARIANT_PRICES =
  "淘寶隱藏了各款價格，所有款式暫用最低價；發布前請逐款確認成本";

export {
  hasHiddenVariantPriceEvidence,
  readHiddenVariantPriceEvidence,
  textHasPriceRange,
  type HiddenVariantPriceEvidence
} from "@/lib/shopify/publishReadiness";

/**
 * Server capture rule (multi-variant only).
 *
 * `pricedVariantCount` = variants whose cost came from structured per-SKU evidence (a DOM
 * "currently selected SKU" price does not count: it covers one variant at most).
 * `unpricedVariantCount` = variants left without any own cost.
 *
 * - client warning + at least one unpriced variant → hidden
 * - hideOtherPrice / price range while NO variant has a structured price → hidden
 */
export function captureHidesVariantPrices(input: {
  clientMeta: unknown;
  variantCount: number;
  pricedVariantCount: number;
  unpricedVariantCount: number;
}): boolean {
  if (input.variantCount < 2) return false;
  const e = readHiddenVariantPriceEvidence(input.clientMeta);
  if (e.clientWarning && input.unpricedVariantCount > 0) return true;
  if ((e.hideOtherPrice || e.priceRange) && input.pricedVariantCount === 0) return true;
  return false;
}

/** CAPTURE-INTERACT: unverified click-through observations still require human review. */
export const WARNING_INTERACT_NEEDS_CONFIRMATION =
  "外掛逐款讀價沒有全部確認，發布前請逐款確認成本";

export function interactRequiresConfirmation(clientMeta: unknown): boolean {
  if (!clientMeta || typeof clientMeta !== "object" || Array.isArray(clientMeta)) return false;
  const interact = (clientMeta as Record<string, unknown>).interact;
  if (!interact || typeof interact !== "object" || Array.isArray(interact)) return false;
  const data = interact as Record<string, unknown>;
  return data.requires_confirmation === true ||
    data.status === "partial" || data.status === "aborted";
}
