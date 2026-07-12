/**
 * B7 Shopify multi-variant helpers.
 *
 * Official Admin GraphQL (2026-07, shopify.dev):
 * - productCreate with productOptions creates product + options + **exactly one**
 *   initial variant using the **first value of each option** (not full cartesian).
 * - productVariantsBulkCreate adds more variants; optionValues may use optionName.
 * - ProductVariantsBulkCreateStrategy.REMOVE_STANDALONE_VARIANT deletes a lone
 *   Default Title / standalone when bulk-creating — only needed when product still
 *   has Default Title. After productOptions on create, initial is a real combo:
 *   we align first option values with sort_order=0 so that initial variant IS
 *   our first row (no ghost Default Title).
 * - Bulk create inventory uses inventoryQuantities: [{ locationId, availableQuantity }].
 * - Bulk update inventory uses quantityAdjustments (existing single-SKU path).
 */

import type { ProductVariantRow } from "@/types/domain";
import type { ShopifyProductOptionInput, ShopifyVariantSeed } from "./types";

export type MultiVariantPublishPlan = {
  mode: "multi";
  productOptions: ShopifyProductOptionInput[];
  /** First row — applied via productVariantsBulkUpdate on the auto-created variant. */
  initial: ShopifyVariantSeed;
  /** Remaining rows — productVariantsBulkCreate. */
  additional: ShopifyVariantSeed[];
  all: ShopifyVariantSeed[];
};

export type SingleVariantPublishPlan = {
  mode: "single";
};

export type VariantPublishPlan = MultiVariantPublishPlan | SingleVariantPublishPlan;

function optionNamesFromRow(row: ProductVariantRow): string[] {
  const names: string[] = [];
  if (row.option1_name) names.push(row.option1_name);
  if (row.option2_name) names.push(row.option2_name);
  if (row.option3_name) names.push(row.option3_name);
  return names;
}

function optionValuesFromRow(row: ProductVariantRow): string[] {
  const values: string[] = [];
  if (row.option1_name) values.push(row.option1_value?.trim() || "Default");
  if (row.option2_name) values.push(row.option2_value?.trim() || "Default");
  if (row.option3_name) values.push(row.option3_value?.trim() || "Default");
  return values;
}

function isValidVariantRow(row: ProductVariantRow): boolean {
  return Boolean(row.option1_value?.trim() || row.option2_value?.trim() || row.option3_value?.trim());
}

/**
 * Estimate variant cost in shop currency (TWD) for Shopify inventoryItem.cost.
 * product_variants.cny_price is source-currency cost (B7); scale by draft cost ratio when possible.
 */
export function estimateVariantCostTwd(
  row: ProductVariantRow,
  draft: { cny_price?: number | null; twd_cost?: number | null }
): number {
  const sourceCost = row.cny_price;
  if (sourceCost == null || !Number.isFinite(sourceCost) || sourceCost <= 0) {
    return draft.twd_cost ?? 0;
  }
  const draftSource = draft.cny_price ?? 0;
  const draftTwd = draft.twd_cost ?? 0;
  if (draftSource > 0 && draftTwd > 0) {
    return Math.round(sourceCost * (draftTwd / draftSource));
  }
  // Fallback: treat stored number as already TWD-ish if no ratio
  return Math.round(sourceCost);
}

export function buildVariantPublishPlan(
  rows: ProductVariantRow[] | null | undefined,
  draft: {
    cny_price?: number | null;
    twd_cost?: number | null;
    price_mode?: string | null;
  }
): VariantPublishPlan {
  const sorted = [...(rows ?? [])]
    .filter(isValidVariantRow)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  if (sorted.length === 0) {
    return { mode: "single" };
  }

  const dimNames = optionNamesFromRow(sorted[0]);
  if (dimNames.length === 0) {
    dimNames.push("款式");
  }

  // productOptions: unique values per dim, first-row values first (aligns with productCreate initial).
  const productOptions: ShopifyProductOptionInput[] = dimNames.map((name, dimIndex) => {
    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const row of sorted) {
      const vals = optionValuesFromRow(row);
      const val = vals[dimIndex] ?? "Default";
      if (seen.has(val)) continue;
      seen.add(val);
      ordered.push(val);
    }
    if (ordered.length === 0) ordered.push("Default");
    return { name, values: ordered.map((n) => ({ name: n })) };
  });

  const seeds: ShopifyVariantSeed[] = sorted.map((row) => {
    const names = optionNamesFromRow(row).length ? optionNamesFromRow(row) : dimNames;
    const values = optionValuesFromRow(row);
    const optionValues = names.map((optionName, i) => ({
      optionName,
      name: values[i] ?? "Default"
    }));
    const hasFinite =
      row.inventory_policy === "deny" &&
      row.inventory_quantity != null &&
      Number.isInteger(row.inventory_quantity);

    return {
      optionValues,
      price: row.twd_price ?? 0,
      compareAtPrice:
        draft.price_mode === "single" ? null : row.compare_at_price ?? null,
      cost: estimateVariantCostTwd(row, draft),
      sku: row.sku,
      inventoryQuantity: hasFinite ? row.inventory_quantity : null,
      inventoryPolicy: hasFinite ? "DENY" : "CONTINUE",
      imageId: row.image_id
    };
  });

  return {
    mode: "multi",
    productOptions,
    initial: seeds[0],
    additional: seeds.slice(1),
    all: seeds
  };
}

/** GraphQL variables fragment for one bulk create/update input (without id). */
export function toBulkVariantInput(
  seed: ShopifyVariantSeed,
  options: {
    includeOptionValues: boolean;
    locationId: string | null;
    /** create uses inventoryQuantities; update uses quantityAdjustments */
    inventoryMode: "create" | "update";
    variantId?: string;
  }
): Record<string, unknown> {
  const hasFinite =
    seed.inventoryPolicy === "DENY" &&
    seed.inventoryQuantity != null &&
    Number.isInteger(seed.inventoryQuantity);

  const base: Record<string, unknown> = {
    price: String(seed.price),
    ...(seed.compareAtPrice != null && seed.compareAtPrice > 0
      ? { compareAtPrice: String(seed.compareAtPrice) }
      : {}),
    inventoryPolicy: seed.inventoryPolicy,
    inventoryItem: {
      sku: seed.sku ?? "",
      cost: String(seed.cost),
      tracked: hasFinite
    }
  };

  if (options.variantId) {
    base.id = options.variantId;
  }

  if (options.includeOptionValues) {
    base.optionValues = seed.optionValues.map((ov) => ({
      optionName: ov.optionName,
      name: ov.name
    }));
  }

  if (hasFinite && options.locationId) {
    if (options.inventoryMode === "create") {
      // Official InventoryLevelInput: availableQuantity + locationId
      base.inventoryQuantities = [
        {
          locationId: options.locationId,
          availableQuantity: seed.inventoryQuantity
        }
      ];
    } else {
      base.quantityAdjustments = [
        {
          locationId: options.locationId,
          adjustment: seed.inventoryQuantity,
          changeFromQuantity: 0
        }
      ];
    }
  }

  return base;
}
