/**
 * VARIANT-CLEAN: 依公式重算售價 — pure helpers shared by the 規格頁籤 dialog, the 價格／款式圖
 * 重同步 panel and the server-side sanity check.
 *
 * The pricing settings (匯率 / 倍率) live in this device's localStorage, so the NEW prices are
 * always computed in the browser from those settings; the server never recomputes, it only
 * checks that what it is asked to push is sane.
 */
import { isPricePlaceholderCny } from "@/lib/import/captureTypes";
import type { PriceMode, PricingSettings } from "@/lib/pricing";
import { calculatePrice } from "@/lib/pricing";
import { dbRowsToForm } from "./variantMapping";
import { recalculateUnlockedVariantPrices } from "./variantPricing";
import type { VariantDimension, VariantFormRow } from "./types";

/** One line telling the operator which settings produced the numbers. */
export function describePricingSettings(settings: PricingSettings): string {
  return (
    `使用匯率 ${settings.rate}、成本倍率 ${settings.costMultiplier}、售價倍率 ${settings.marginMultiplier}、` +
    `定價倍率 ${settings.compareAtMultiplier}、最低售價 ${settings.minPrice}（此裝置的定價設定）`
  );
}

export type PricedVariantDbRow = {
  id: string;
  option1_name?: string | null;
  option1_value?: string | null;
  option2_name?: string | null;
  option2_value?: string | null;
  option3_name?: string | null;
  option3_value?: string | null;
  cny_price?: number | null;
  twd_price?: number | null;
  compare_at_price?: number | null;
  cost_is_inherited?: boolean | null;
  sell_price_locked?: boolean | null;
  compare_at_locked?: boolean | null;
  price_locked?: boolean | null;
  sort_order?: number | null;
};

export type PriceRecalcLine = {
  /** product_variants.id */
  id: string;
  label: string;
  /** sell AND compare-at both locked: the line is shown but never changed */
  locked: boolean;
  oldSell: number | null;
  oldCompareAt: number | null;
  newSell: number | null;
  newCompareAt: number | null;
  changed: boolean;
};

function toNum(value: string): number | null {
  const n = Number(value);
  return value.trim() !== "" && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function rowLabel(row: PricedVariantDbRow): string {
  return [row.option1_value, row.option2_value, row.option3_value]
    .map((v) => (v ?? "").trim())
    .filter(Boolean)
    .join("／");
}

/** Productcost for variant fallback: the 0.01 import placeholder means "not known". */
export function usableProductCost(cny: number | null | undefined): number | null {
  if (cny == null || !Number.isFinite(Number(cny)) || Number(cny) <= 0) return null;
  return isPricePlaceholderCny(Number(cny)) ? null : Number(cny);
}

/** Recalculate every UNLOCKED variant with the existing per-variant rule; locked ones stay. */
export function computeVariantRecalcLines(input: {
  rows: PricedVariantDbRow[];
  dimensions?: VariantDimension[];
  productCost: number | null;
  priceMode: PriceMode;
  settings: PricingSettings;
}): PriceRecalcLine[] {
  const sorted = [...input.rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const { rows: formRows } = dbRowsToForm(input.dimensions ?? [], sorted, { productCost: input.productCost });
  const recalculated = recalculateUnlockedVariantPrices(formRows, {
    currency: "CNY",
    priceMode: input.priceMode,
    settings: input.settings,
    productCost: input.productCost
  });
  return sorted.map((row, index) => {
    const before: VariantFormRow = formRows[index];
    const after: VariantFormRow = recalculated[index];
    const oldSell = toNum(before.sellPrice);
    const oldCompareAt = toNum(before.compareAt);
    const newSell = toNum(after.sellPrice);
    const newCompareAt = toNum(after.compareAt);
    return {
      id: row.id,
      label: rowLabel(row) || "款式",
      locked: before.sellPriceLocked && before.compareAtLocked,
      oldSell,
      oldCompareAt,
      newSell,
      newCompareAt,
      changed: oldSell !== newSell || oldCompareAt !== newCompareAt
    };
  });
}

/** Single-variant product: price straight from the product cost; null when it cannot be priced. */
export function computeSingleRecalc(input: {
  productCost: number | null;
  priceMode: PriceMode;
  settings: PricingSettings;
  oldSell: number | null;
  oldCompareAt: number | null;
}): Pick<PriceRecalcLine, "oldSell" | "oldCompareAt" | "newSell" | "newCompareAt" | "changed"> {
  if (input.productCost == null) {
    return { oldSell: input.oldSell, oldCompareAt: input.oldCompareAt, newSell: null, newCompareAt: null, changed: false };
  }
  const result = calculatePrice(input.productCost, {
    currency: "CNY",
    priceMode: input.priceMode,
    settings: input.settings
  });
  const newCompareAt = input.priceMode === "single" ? null : result.compareAtPrice;
  return {
    oldSell: input.oldSell,
    oldCompareAt: input.oldCompareAt,
    newSell: result.sellPrice,
    newCompareAt,
    changed: input.oldSell !== result.sellPrice || (input.oldCompareAt ?? null) !== (newCompareAt ?? null)
  };
}

export const RESYNC_MAX_PRICE = 1_000_000;

export type ResyncPriceRequest = { price: number; compareAtPrice: number | null };

/** Server-side sanity check for one price pair. Returns an error message, or null when sane. */
export function checkResyncPrice(request: unknown): string | null {
  if (!request || typeof request !== "object") return "價格資料格式不符";
  const { price, compareAtPrice } = request as { price?: unknown; compareAtPrice?: unknown };
  if (typeof price !== "number" || !Number.isInteger(price) || price <= 0 || price > RESYNC_MAX_PRICE) {
    return "售價必須是 1 到 1,000,000 之間的整數";
  }
  if (compareAtPrice != null) {
    if (typeof compareAtPrice !== "number" || !Number.isInteger(compareAtPrice) || compareAtPrice <= 0 || compareAtPrice > RESYNC_MAX_PRICE) {
      return "定價必須是 1 到 1,000,000 之間的整數，或留空";
    }
    if (compareAtPrice < price) return "定價不可低於售價";
  }
  return null;
}
