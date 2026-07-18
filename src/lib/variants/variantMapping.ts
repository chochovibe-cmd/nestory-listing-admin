import {
  MAX_VARIANT_DIMENSIONS,
  MAX_VARIANT_ROWS,
  emptyVariantRow,
  isVariantRowFilled,
  type ShopifyProductOptionInput,
  type ShopifyVariantSeed,
  type VariantDbInsert,
  type VariantDimension,
  type VariantFormRow
} from "./types";
import { rebuildDimensionValuesFromRows, uniqueAxisValues } from "./variantCrossExpand";

export { MAX_VARIANT_DIMENSIONS, MAX_VARIANT_ROWS, emptyVariantRow, isVariantRowFilled };

/** Keep at most 3 non-empty dimension names; preserve optional values (pkg2b). */
export function clampDimensions(dims: VariantDimension[]): VariantDimension[] {
  const cleaned = dims
    .map((d) => {
      const name = d.name.trim();
      const values = Array.isArray(d.values)
        ? d.values.map((v) => String(v ?? "").trim()).filter((v) => v.length > 0)
        : undefined;
      return values && values.length > 0 ? { name, values } : { name };
    })
    .filter((d) => d.name.length > 0)
    .slice(0, MAX_VARIANT_DIMENSIONS);
  return cleaned;
}

/**
 * Cap rows at MAX_VARIANT_ROWS. Returns { rows, truncated, warning }.
 * warning is set when input exceeded the cap (for yellow UI).
 */
export function clampVariantRows(rows: VariantFormRow[]): {
  rows: VariantFormRow[];
  truncated: boolean;
  warning: string | null;
} {
  if (rows.length <= MAX_VARIANT_ROWS) {
    return { rows, truncated: false, warning: null };
  }
  return {
    rows: rows.slice(0, MAX_VARIANT_ROWS).map((r, i) => ({ ...r, sortOrder: i })),
    truncated: true,
    warning: `款式列已達上限 ${MAX_VARIANT_ROWS} 列，多出的未加入。請分批或合併選項。`
  };
}

export function formRowsToDbInserts(
  dimensions: VariantDimension[],
  rows: VariantFormRow[]
): VariantDbInsert[] {
  const dims = clampDimensions(dimensions);
  const names = [
    dims[0]?.name ?? "款式",
    dims[1]?.name ?? null,
    dims[2]?.name ?? null
  ] as const;

  return rows
    .filter(isVariantRowFilled)
    .map((row, index) => {
      const v0 = row.optionValues[0]?.trim() || "";
      const v1 = row.optionValues[1]?.trim() || "";
      const v2 = row.optionValues[2]?.trim() || "";
      const costNum = Number(row.cost);
      const sellNum = Number(row.sellPrice);
      const cmpNum = Number(row.compareAt);
      const qtyTrim = row.qty.trim();
      const qtyNum = qtyTrim === "" ? null : Number(qtyTrim);
      const hasFiniteQty =
        qtyNum != null && Number.isInteger(qtyNum) && qtyNum >= 0 && qtyTrim !== "";

      return {
        option1_name: names[0],
        option1_value: v0 || "Default Title",
        option2_name: names[1] && v1 ? names[1] : names[1] && dims.length > 1 ? names[1] : null,
        option2_value: names[1] && v1 ? v1 : null,
        option3_name: names[2] && v2 ? names[2] : names[2] && dims.length > 2 ? names[2] : null,
        option3_value: names[2] && v2 ? v2 : null,
        sku: row.sku.trim() || null,
        cny_price: Number.isFinite(costNum) && costNum > 0 ? costNum : null,
        twd_price: Number.isFinite(sellNum) && sellNum > 0 ? Math.round(sellNum) : null,
        compare_at_price:
          Number.isFinite(cmpNum) && cmpNum > 0 ? Math.round(cmpNum) : null,
        price_locked: row.priceLocked,
        sort_order: index,
        inventory_quantity: hasFiniteQty ? (qtyNum as number) : 0,
        inventory_policy: hasFiniteQty ? ("deny" as const) : ("continue" as const),
        image_id: row.imageId
      };
    });
}

/**
 * Build Shopify productOptions for productCreate.
 * Official (Admin GraphQL 2026-07): productCreate with productOptions creates
 * exactly ONE initial variant using the first value of each option — not the
 * full cartesian product. We put each row's values first in that row's order
 * so the initial variant aligns with sort_order 0 (no ghost Default Title).
 *
 * Strategy: for each dimension, list unique values with first-row value first.
 */
export function buildShopifyProductOptions(
  dimensions: VariantDimension[],
  rows: VariantFormRow[]
): ShopifyProductOptionInput[] {
  const dims = clampDimensions(dimensions);
  const filled = rows.filter(isVariantRowFilled);
  if (dims.length === 0 || filled.length === 0) return [];

  return dims.map((dim, dimIndex) => {
    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const row of filled) {
      const val = row.optionValues[dimIndex]?.trim() || "";
      if (!val || seen.has(val)) continue;
      seen.add(val);
      ordered.push(val);
    }
    // Shopify requires at least one value per option.
    if (ordered.length === 0) ordered.push("Default");
    return {
      name: dim.name,
      values: ordered.map((name) => ({ name }))
    };
  });
}

export function formRowsToShopifyVariantSeeds(
  dimensions: VariantDimension[],
  rows: VariantFormRow[],
  fallbackCost = 0
): ShopifyVariantSeed[] {
  const dims = clampDimensions(dimensions);
  const filled = rows.filter(isVariantRowFilled);

  return filled.map((row) => {
    const optionValues = dims.map((dim, i) => ({
      optionName: dim.name,
      name: row.optionValues[i]?.trim() || "Default"
    }));
    const costNum = Number(row.cost);
    const sellNum = Number(row.sellPrice);
    const cmpNum = Number(row.compareAt);
    const qtyTrim = row.qty.trim();
    const qtyNum = qtyTrim === "" ? null : Number(qtyTrim);
    const hasFiniteQty =
      qtyNum != null && Number.isInteger(qtyNum) && qtyNum >= 0 && qtyTrim !== "";

    return {
      optionValues,
      price: Number.isFinite(sellNum) && sellNum > 0 ? Math.round(sellNum) : 0,
      compareAtPrice:
        Number.isFinite(cmpNum) && cmpNum > 0 ? Math.round(cmpNum) : null,
      cost:
        Number.isFinite(costNum) && costNum > 0
          ? costNum
          : fallbackCost,
      sku: row.sku.trim() || null,
      inventoryQuantity: hasFiniteQty ? (qtyNum as number) : null,
      inventoryPolicy: hasFiniteQty ? ("DENY" as const) : ("CONTINUE" as const),
      imageId: row.imageId
    };
  });
}

/** Map DB rows back to form (e.g. reload). */
export function dbRowsToForm(
  dimensions: VariantDimension[],
  dbRows: Array<{
    option1_value?: string | null;
    option2_value?: string | null;
    option3_value?: string | null;
    option1_name?: string | null;
    option2_name?: string | null;
    option3_name?: string | null;
    cny_price?: number | null;
    twd_price?: number | null;
    compare_at_price?: number | null;
    price_locked?: boolean | null;
    sort_order?: number | null;
    inventory_quantity?: number | null;
    inventory_policy?: string | null;
    sku?: string | null;
    image_id?: string | null;
  }>
): { dimensions: VariantDimension[]; rows: VariantFormRow[] } {
  let dims = clampDimensions(dimensions);
  if (dims.length === 0 && dbRows.length > 0) {
    const first = dbRows[0];
    const inferred: VariantDimension[] = [];
    if (first.option1_name) inferred.push({ name: first.option1_name });
    if (first.option2_name) inferred.push({ name: first.option2_name });
    if (first.option3_name) inferred.push({ name: first.option3_name });
    dims = clampDimensions(inferred.length ? inferred : [{ name: "款式" }]);
  }

  const sorted = [...dbRows].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );

  const rows: VariantFormRow[] = sorted.map((r, i) => ({
    optionValues: [
      r.option1_value ?? "",
      r.option2_value ?? "",
      r.option3_value ?? ""
    ],
    cost: r.cny_price != null ? String(r.cny_price) : "",
    sellPrice: r.twd_price != null ? String(r.twd_price) : "",
    compareAt: r.compare_at_price != null ? String(r.compare_at_price) : "",
    priceLocked: Boolean(r.price_locked),
    qty:
      r.inventory_policy === "deny" && r.inventory_quantity != null
        ? String(r.inventory_quantity)
        : "",
    sku: r.sku ?? "",
    imageId: r.image_id ?? null,
    sortOrder: r.sort_order ?? i
  }));

  // pkg2b Fable: product_variants rows = combo truth.
  // When rows exist, rebuild dimensions.values from rows (never invent from values alone).
  // When no rows, keep stored values as UI assist seed.
  const dimsOut = rows.some(isVariantRowFilled)
    ? rebuildDimensionValuesFromRows(dims, rows)
    : dims.map((d) => {
        const values = uniqueAxisValues(d.values);
        return values.length > 0 ? { name: d.name, values } : { name: d.name };
      });

  return { dimensions: dimsOut, rows };
}

/**
 * Create rows from selected character names into dimension 0.
 * Fable pkg2b: **only append** — never auto-cartesian with other axes.
 * Also appends display names onto dimensions[0].values (UI assist).
 * Caps at MAX_VARIANT_ROWS.
 */
export function appendCharacterRows(
  dimensions: VariantDimension[],
  existing: VariantFormRow[],
  characterNames: string[]
): {
  dimensions: VariantDimension[];
  rows: VariantFormRow[];
  warning: string | null;
} {
  let dims = clampDimensions(dimensions);
  if (dims.length === 0) {
    dims = [{ name: "角色", values: [] }];
  } else if (!dims[0].name) {
    dims = [{ name: "角色", values: dims[0]?.values ?? [] }, ...dims.slice(1)];
  }

  const existingKeys = new Set(
    existing
      .filter(isVariantRowFilled)
      .map((r) =>
        [r.optionValues[0], r.optionValues[1], r.optionValues[2]]
          .map((v) => (v ?? "").trim().toLowerCase())
          .join("\u0001")
      )
  );

  const next = [...existing];
  const axis0Values = [...(dims[0].values ?? [])];
  for (const name of characterNames) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    // Always record on axis values (UI assist) even if row already exists.
    if (!axis0Values.some((v) => v.trim() === trimmed)) {
      axis0Values.push(trimmed);
    }
    const dedupeKey = `${trimmed.toLowerCase()}\u0001\u0001`;
    if (existingKeys.has(dedupeKey)) continue;
    if (next.length >= MAX_VARIANT_ROWS) break;
    const row = emptyVariantRow(next.length);
    row.optionValues[0] = trimmed;
    next.push(row);
    existingKeys.add(dedupeKey);
  }

  dims = [{ ...dims[0], values: axis0Values }, ...dims.slice(1)];

  const clamped = clampVariantRows(next);
  return {
    dimensions: dims,
    rows: clamped.rows,
    warning: clamped.warning
  };
}
