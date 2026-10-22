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
import { readSourceStock } from "./sourceStock";
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
    const sourceSoldOut = readSourceStock(row.source_options)?.status === "sold_out";

    return {
      optionValues,
      // No `?? 0`: a missing price is a PUBLISH-GUARD blocker, never a NT$0 listing.
      price: row.twd_price ?? null,
      compareAtPrice:
        draft.price_mode === "single" ? null : row.compare_at_price ?? null,
      cost: estimateVariantCostTwd(row, draft),
      sku: row.sku,
      inventoryQuantity: sourceSoldOut ? 0 : hasFinite ? row.inventory_quantity : null,
      inventoryPolicy: sourceSoldOut || hasFinite ? "DENY" : "CONTINUE",
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

/** A variant as read back from a Shopify DRAFT product during an api_failed retry. */
export type ResumeRemoteVariant = {
  id: string;
  title?: string | null;
  sku?: string | null;
  selectedOptions: { name: string; value: string }[];
};

export type ResumeVariantSyncPlan<R extends ResumeRemoteVariant = ResumeRemoteVariant> = {
  /** Seeds whose variant already exists on Shopify (seed order). */
  matched: { seed: ShopifyVariantSeed; variantId: string }[];
  /** Seeds with no variant on Shopify yet — the only ones a retry may bulk-create. */
  missing: ShopifyVariantSeed[];
  /** Remote variants no seed claims (never deleted automatically). */
  extraRemote: R[];
};

/** Trimmed name→value pairs as an order-insensitive key; "" when there are no pairs. */
function resumeOptionKey(pairs: { name: string; value: string }[]): string {
  return [
    ...new Set(
      pairs.map((pair) => `${String(pair?.name ?? "").trim()}\u0001${String(pair?.value ?? "").trim()}`)
    )
  ]
    .sort()
    .join("\u0002");
}

/**
 * PUBLISH-RETRY: reconcile the local variant seeds with the variants that already
 * exist on the Shopify DRAFT, so an api_failed retry only creates what is missing.
 *
 * Matching (each remote variant is claimed at most once, seeds processed in order):
 *  1. option values — seed optionValues {optionName,name} vs remote selectedOptions
 *     {name,value}, as a set of trimmed pairs (order / whitespace insensitive);
 *  2. fallback — equal non-empty trimmed SKU;
 *  3. single-variant mode — a seed without optionValues takes the only remote variant.
 */
export function planResumeVariantSync<R extends ResumeRemoteVariant>(
  seeds: ShopifyVariantSeed[],
  remote: R[]
): ResumeVariantSyncPlan<R> {
  const claimed = new Set<number>();
  const matchedRemoteIndex: (number | null)[] = seeds.map(() => null);
  const seedKeys = seeds.map((seed) =>
    resumeOptionKey(
      (seed.optionValues ?? []).map((ov) => ({ name: ov.optionName, value: ov.name }))
    )
  );
  const remoteKeys = remote.map((variant) => resumeOptionKey(variant.selectedOptions ?? []));

  // Pass 1: option values. Run for every seed first so a SKU fallback can never
  // steal a variant that a later seed matches exactly.
  seeds.forEach((_seed, seedIndex) => {
    const key = seedKeys[seedIndex];
    if (!key) return;
    const remoteIndex = remoteKeys.findIndex((remoteKey, i) => !claimed.has(i) && remoteKey === key);
    if (remoteIndex >= 0) {
      claimed.add(remoteIndex);
      matchedRemoteIndex[seedIndex] = remoteIndex;
    }
  });

  // Pass 2: SKU fallback.
  seeds.forEach((seed, seedIndex) => {
    if (matchedRemoteIndex[seedIndex] !== null) return;
    const sku = seed.sku?.trim();
    if (!sku) return;
    const remoteIndex = remote.findIndex((variant, i) => !claimed.has(i) && variant.sku?.trim() === sku);
    if (remoteIndex >= 0) {
      claimed.add(remoteIndex);
      matchedRemoteIndex[seedIndex] = remoteIndex;
    }
  });

  // Pass 3: single-variant mode (no option values on the seed).
  seeds.forEach((_seed, seedIndex) => {
    if (matchedRemoteIndex[seedIndex] !== null || seedKeys[seedIndex]) return;
    if (remote.length === 1 && !claimed.has(0)) {
      claimed.add(0);
      matchedRemoteIndex[seedIndex] = 0;
    }
  });

  const matched: ResumeVariantSyncPlan<R>["matched"] = [];
  const missing: ShopifyVariantSeed[] = [];
  seeds.forEach((seed, seedIndex) => {
    const remoteIndex = matchedRemoteIndex[seedIndex];
    if (remoteIndex === null) missing.push(seed);
    else matched.push({ seed, variantId: remote[remoteIndex].id });
  });

  return {
    matched,
    missing,
    extraRemote: remote.filter((_variant, i) => !claimed.has(i))
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
    /** VARIANT-CLEAN: Shopify MediaImage id to show for this variant (only when already known). */
    mediaId?: string | null;
  }
): Record<string, unknown> {
  const hasFinite =
    seed.inventoryPolicy === "DENY" &&
    seed.inventoryQuantity != null &&
    Number.isInteger(seed.inventoryQuantity);

  const base: Record<string, unknown> = {
    ...(seed.price != null ? { price: String(seed.price) } : {}),
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

  if (options.mediaId) {
    base.mediaId = options.mediaId;
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
