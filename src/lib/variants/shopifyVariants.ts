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
import { normalizeOptionValueForMerge } from "./variantCrossExpand";
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

/**
 * PKG2A: merge axis names across all rows so first-row missing names still work.
 * If a value exists on any row but no name was stored, fall back to 款式/選項2/選項3.
 */
export function resolveDimNames(rows: ProductVariantRow[]): string[] {
  const found: [string | null, string | null, string | null] = [null, null, null];
  let maxAxis = 0;
  for (const row of rows) {
    const n1 = row.option1_name?.trim();
    const n2 = row.option2_name?.trim();
    const n3 = row.option3_name?.trim();
    if (n1 && !found[0]) found[0] = n1;
    if (n2 && !found[1]) found[1] = n2;
    if (n3 && !found[2]) found[2] = n3;
    if (row.option1_value?.trim() || n1) maxAxis = Math.max(maxAxis, 1);
    if (row.option2_value?.trim() || n2) maxAxis = Math.max(maxAxis, 2);
    if (row.option3_value?.trim() || n3) maxAxis = Math.max(maxAxis, 3);
  }
  const defaults = ["款式", "選項2", "選項3"] as const;
  if (maxAxis === 0) return ["款式"];
  const names: string[] = [];
  for (let i = 0; i < maxAxis; i++) {
    names.push(found[i] || defaults[i]);
  }
  return names;
}

/** Values aligned to resolved dim count — value present even when that row's name is empty. */
function optionValuesFromRow(row: ProductVariantRow, dimCount: number): string[] {
  const raw = [
    row.option1_value?.trim() || "",
    row.option2_value?.trim() || "",
    row.option3_value?.trim() || ""
  ];
  const out: string[] = [];
  for (let i = 0; i < dimCount; i++) {
    out.push(raw[i] || "Default");
  }
  return out;
}

function isValidVariantRow(row: ProductVariantRow): boolean {
  return Boolean(row.option1_value?.trim() || row.option2_value?.trim() || row.option3_value?.trim());
}

/**
 * Return every duplicate DB variant row after the first normalized option combination.
 * Character aliases use the same normalization as VariantEditor merge logic, so e.g.
 * 米飛 / 米菲 cannot bypass the duplicate guard as two visually different strings.
 */
export function findDuplicateProductVariantRows(
  rows: ProductVariantRow[] | null | undefined
): ProductVariantRow[] {
  const duplicates: ProductVariantRow[] = [];
  const seen = new Set<string>();
  const sorted = [...(rows ?? [])]
    .filter(isValidVariantRow)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  for (const row of sorted) {
    const raw = [
      row.option1_value?.trim() || "",
      row.option2_value?.trim() || "",
      row.option3_value?.trim() || ""
    ];
    const key = raw.map((value) => normalizeOptionValueForMerge(value)).join("\u0001");
    if (!key.replace(/\u0001/g, "")) continue;
    if (seen.has(key)) {
      duplicates.push(row);
      continue;
    }
    seen.add(key);
  }

  return duplicates;
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

  // PKG2A: merge names across rows; first-row missing name + value present still counts.
  const dimNames = resolveDimNames(sorted);

  // productOptions: unique values per dim, first-row values first (aligns with productCreate initial).
  const productOptions: ShopifyProductOptionInput[] = dimNames.map((name, dimIndex) => {
    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const row of sorted) {
      const vals = optionValuesFromRow(row, dimNames.length);
      const val = vals[dimIndex] ?? "Default";
      if (seen.has(val)) continue;
      seen.add(val);
      ordered.push(val);
    }
    if (ordered.length === 0) ordered.push("Default");
    return { name, values: ordered.map((n) => ({ name: n })) };
  });

  const seeds: ShopifyVariantSeed[] = sorted.map((row) => {
    const values = optionValuesFromRow(row, dimNames.length);
    const optionValues = dimNames.map((optionName, i) => ({
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
