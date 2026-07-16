import {
  calculatePrice,
  type CostCurrency,
  type PriceMode,
  type PricingSettings,
  defaultPricingSettings
} from "@/lib/pricing";
import type { VariantFormRow } from "./types";
import { isVariantRowFilled } from "./types";

/**
 * Effective cost for a variant row (P1-5 / 回饋 8):
 * - row cost filled → use it
 * - blank → fall back to product-level cost when positive
 */
export function effectiveVariantCost(
  rowCost: string | number | null | undefined,
  productCost: number | null | undefined
): number | null {
  const rowNum = Number(rowCost);
  if (Number.isFinite(rowNum) && rowNum > 0) return rowNum;
  if (productCost != null && Number.isFinite(productCost) && productCost > 0) {
    return productCost;
  }
  return null;
}

/**
 * Recompute sell/compare for unlocked rows from each row's cost.
 * P1-5: blank row cost inherits productCost when provided.
 * Locked rows (✎) are left unchanged.
 */
export function recalculateUnlockedVariantPrices(
  rows: VariantFormRow[],
  options: {
    currency: CostCurrency;
    priceMode: PriceMode;
    settings?: PricingSettings;
    /** Product-level cost (same unit as row.cost / form price). */
    productCost?: number | null;
  }
): VariantFormRow[] {
  const settings = options.settings ?? defaultPricingSettings;
  const productCost = options.productCost ?? null;
  return rows.map((row) => {
    if (row.priceLocked) return row;
    const costNum = effectiveVariantCost(row.cost, productCost);
    if (costNum == null) {
      return {
        ...row,
        sellPrice: "",
        compareAt: options.priceMode === "single" ? "" : ""
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
  priceMode: PriceMode,
  options?: { productCost?: number | null }
): string {
  const productCost = options?.productCost ?? null;
  const rowHasCost = Number(row.cost) > 0;
  const inherited = !rowHasCost && productCost != null && productCost > 0;
  const sell = row.sellPrice.trim() ? `NT$ ${row.sellPrice}` : "售價未算";
  const inheritHint = inherited ? `（同商品成本）` : "";
  if (priceMode === "single") {
    return `→ ${sell}${inheritHint}${row.priceLocked ? "（✎ 手動）" : ""}`;
  }
  const cmp = row.compareAt.trim() ? `／定價 ${row.compareAt}` : "";
  return `→ ${sell}${cmp}${inheritHint}${row.priceLocked ? "（✎ 手動）" : ""}`;
}

/**
 * P1-5 / 回饋 49: cost required = product cost OR every filled variant row has its own cost.
 * Returns null when ok, else error message.
 */
export function validateCostRequirement(input: {
  productCost: number;
  variants: VariantFormRow[];
}): string | null {
  const productOk = Number.isFinite(input.productCost) && input.productCost > 0;
  const filled = input.variants.filter(isVariantRowFilled);
  if (filled.length === 0) {
    return productOk ? null : "請輸入商品成本，或在每一款式列填寫成本";
  }
  const allVariantCosts = filled.every((row) => {
    const n = Number(row.cost);
    return Number.isFinite(n) && n > 0;
  });
  if (productOk || allVariantCosts) return null;
  const missing = filled.filter((row) => !(Number(row.cost) > 0)).length;
  if (missing > 0 && filled.some((row) => Number(row.cost) > 0)) {
    return `款式成本未填齊（還有 ${missing} 列空白）— 請補齊，或改填上方商品成本`;
  }
  return "請輸入商品成本，或在每一款式列填寫成本";
}

