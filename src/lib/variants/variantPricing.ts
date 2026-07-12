import {
  calculatePrice,
  type CostCurrency,
  type PriceMode,
  type PricingSettings,
  defaultPricingSettings
} from "@/lib/pricing";
import type { VariantFormRow } from "./types";

/**
 * Recompute sell/compare for unlocked rows from each row's cost.
 * Locked rows (✎) are left unchanged.
 */
export function recalculateUnlockedVariantPrices(
  rows: VariantFormRow[],
  options: {
    currency: CostCurrency;
    priceMode: PriceMode;
    settings?: PricingSettings;
  }
): VariantFormRow[] {
  const settings = options.settings ?? defaultPricingSettings;
  return rows.map((row) => {
    if (row.priceLocked) return row;
    const costNum = Number(row.cost);
    if (!Number.isFinite(costNum) || costNum <= 0) {
      return {
        ...row,
        sellPrice: "",
        compareAt: options.priceMode === "single" ? "" : row.compareAt
      };
    }
    const result = calculatePrice(costNum, {
      currency: options.currency,
      priceMode: options.priceMode,
      settings
    });
    return {
      ...row,
      sellPrice: String(result.sellPrice),
      compareAt:
        options.priceMode === "single" || result.compareAtPrice == null
          ? ""
          : String(result.compareAtPrice)
    };
  });
}

/** Mark row as manually edited (✎). */
export function lockVariantPrice(row: VariantFormRow, patch: Partial<Pick<VariantFormRow, "sellPrice" | "compareAt">>): VariantFormRow {
  return {
    ...row,
    ...patch,
    priceLocked: true
  };
}

export function countLockedVariants(rows: VariantFormRow[]): number {
  return rows.filter((r) => r.priceLocked).length;
}

export function formatVariantPriceLine(
  row: VariantFormRow,
  priceMode: PriceMode
): string {
  const sell = row.sellPrice.trim() ? `NT$ ${row.sellPrice}` : "售價未算";
  if (priceMode === "single") {
    return `→ ${sell}${row.priceLocked ? "（✎ 手動）" : ""}`;
  }
  const cmp = row.compareAt.trim() ? `／定價 ${row.compareAt}` : "";
  return `→ ${sell}${cmp}${row.priceLocked ? "（✎ 手動）" : ""}`;
}
