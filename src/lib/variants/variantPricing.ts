import {
  calculatePrice,
  type CostCurrency,
  type PriceMode,
  type PricingSettings,
  defaultPricingSettings
} from "@/lib/pricing";
import type { VariantFormRow } from "./types";
import { isVariantRowFilled } from "./types";
import { findDuplicateVariantMergeKeyRows } from "./variantCrossExpand";

type LegacyCompatibleVariantRow = Omit<
  VariantFormRow,
  "costIsInherited" | "sellPriceLocked" | "compareAtLocked"
> & Partial<Pick<VariantFormRow, "costIsInherited" | "sellPriceLocked" | "compareAtLocked">>;

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

function normalizeOverrideState(row: LegacyCompatibleVariantRow): VariantFormRow {
  const legacyLocked = Boolean(row.priceLocked);
  const sellPriceLocked =
    typeof row.sellPriceLocked === "boolean" ? row.sellPriceLocked : legacyLocked;
  const compareAtLocked =
    typeof row.compareAtLocked === "boolean" ? row.compareAtLocked : legacyLocked;
  return {
    ...row,
    costIsInherited: Boolean(row.costIsInherited),
    sellPriceLocked,
    compareAtLocked,
    priceLocked: sellPriceLocked || compareAtLocked
  };
}

function sellLocked(row: LegacyCompatibleVariantRow): boolean {
  return typeof row.sellPriceLocked === "boolean" ? row.sellPriceLocked : Boolean(row.priceLocked);
}

function compareLocked(row: LegacyCompatibleVariantRow): boolean {
  return typeof row.compareAtLocked === "boolean" ? row.compareAtLocked : Boolean(row.priceLocked);
}

/**
 * D3.10A: recompute sell and compare independently.
 * Legacy rows may still fall back to priceLocked until they are written once with split fields.
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
  return rows.map((sourceRow) => {
    const row = normalizeOverrideState(sourceRow);
    const keepSell = sellLocked(row);
    const keepCompare = compareLocked(row);
    const costNum = effectiveVariantCost(row.cost, productCost);
    if (costNum == null) {
      return {
        ...row,
        sellPrice: keepSell ? row.sellPrice : "",
        compareAt:
          options.priceMode === "single"
            ? keepCompare ? row.compareAt : ""
            : keepCompare ? row.compareAt : "",
        sellPriceLocked: keepSell,
        compareAtLocked: keepCompare,
        priceLocked: keepSell || keepCompare
      };
    }
    const result = calculatePrice(costNum, {
      currency: options.currency,
      priceMode: options.priceMode,
      settings
    });
    const nextSell = String(result.sellPrice);
    const nextCompare =
      options.priceMode === "single" || result.compareAtPrice == null
        ? ""
        : String(result.compareAtPrice);
    return {
      ...row,
      sellPrice: keepSell ? row.sellPrice : nextSell,
      compareAt:
        options.priceMode === "single"
          ? keepCompare ? row.compareAt : ""
          : keepCompare ? row.compareAt : nextCompare,
      sellPriceLocked: keepSell,
      compareAtLocked: keepCompare,
      priceLocked: keepSell || keepCompare
    };
  });
}

/** D3.10A: only fields whose values actually changed become locked. */
export function lockVariantPrice(
  row: VariantFormRow,
  patch: Partial<Pick<VariantFormRow, "sellPrice" | "compareAt">>
): VariantFormRow {
  const previousSellLocked = sellLocked(row);
  const previousCompareLocked = compareLocked(row);
  const sellChanged =
    Object.prototype.hasOwnProperty.call(patch, "sellPrice") &&
    patch.sellPrice !== row.sellPrice;
  const compareChanged =
    Object.prototype.hasOwnProperty.call(patch, "compareAt") &&
    patch.compareAt !== row.compareAt;
  const nextSellLocked = previousSellLocked || sellChanged;
  const nextCompareLocked = previousCompareLocked || compareChanged;
  return {
    ...row,
    ...patch,
    sellPriceLocked: nextSellLocked,
    compareAtLocked: nextCompareLocked,
    priceLocked: nextSellLocked || nextCompareLocked
  };
}

export function countLockedVariants(rows: VariantFormRow[]): number {
  return rows.filter((row) => sellLocked(row) || compareLocked(row)).length;
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
  const manual = sellLocked(row) || compareLocked(row) ? "（✎ 手動）" : "";
  if (priceMode === "single") {
    return `→ ${sell}${inheritHint}${manual}`;
  }
  const cmp = row.compareAt.trim() ? `／定價 ${row.compareAt}` : "";
  return `→ ${sell}${cmp}${inheritHint}${manual}`;
}

/**
 * UX-B2-P04: when product-level cost changes, push into rows still marked inherited.
 * D3.10A normalizes legacy/form-helper rows into explicit split state before repricing.
 */
export function syncInheritedVariantCosts(
  rows: LegacyCompatibleVariantRow[],
  productCost: number | null | undefined,
  priceOpts: {
    currency: CostCurrency;
    priceMode: PriceMode;
    settings?: PricingSettings;
  }
): VariantFormRow[] {
  const has =
    productCost != null && Number.isFinite(productCost) && productCost > 0;
  const costStr = has ? String(productCost) : "";
  const next = rows.map((sourceRow) => {
    const row = normalizeOverrideState(sourceRow);
    if (row.costIsInherited) {
      return {
        ...row,
        cost: costStr,
        costIsInherited: has
      };
    }
    if (has && !row.cost.trim()) {
      return { ...row, cost: costStr, costIsInherited: true };
    }
    return row;
  });
  return recalculateUnlockedVariantPrices(next, {
    ...priceOpts,
    productCost
  });
}

/**
 * UX-S T72 / R87: write product-level cost into blank variant cost cells only.
 * Already-filled costs are never overwritten. After fill, recalculate unlocked prices.
 * Marks filled rows as costIsInherited so later product-cost changes can keep syncing.
 */
export function applyProductCostToBlankRows(
  rows: VariantFormRow[],
  options: {
    productCost: number | null | undefined;
    currency: CostCurrency;
    priceMode: PriceMode;
    settings?: PricingSettings;
  }
): { rows: VariantFormRow[]; filledCount: number } {
  const productCost = options.productCost;
  if (productCost == null || !Number.isFinite(productCost) || productCost <= 0) {
    return { rows, filledCount: 0 };
  }
  const costStr = String(productCost);
  let filledCount = 0;
  const withCost = rows.map((row) => {
    const n = Number(row.cost);
    if (Number.isFinite(n) && n > 0) return row;
    filledCount += 1;
    return { ...row, cost: costStr, costIsInherited: true };
  });
  if (filledCount === 0) {
    return { rows, filledCount: 0 };
  }
  return {
    rows: recalculateUnlockedVariantPrices(withCost, {
      currency: options.currency,
      priceMode: options.priceMode,
      settings: options.settings,
      productCost
    }),
    filledCount
  };
}

/**
 * P1-5 / 回饋 49: cost required = product cost OR every filled variant row has its own cost.
 * P0-2: duplicate option combinations are also blocked here because WorkspaceInputPanel
 * already runs this validation before persistDraft; this keeps duplicate rows out of DB
 * without adding another validation path to the large form component.
 * Returns null when ok, else error message.
 */
export function validateCostRequirement(input: {
  productCost: number;
  variants: VariantFormRow[];
}): string | null {
  const duplicateRows = findDuplicateVariantMergeKeyRows(input.variants);
  if (duplicateRows.length > 0) {
    return `款式組合重複（${duplicateRows.length} 列）— 請先修改複製列的規格值再生成`;
  }

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
