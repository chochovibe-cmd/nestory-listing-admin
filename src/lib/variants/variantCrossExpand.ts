/**
 * UX-S pkg2b / Fable 2026-07-19:
 * Multi-axis cartesian expand + merge (hand-fill preserve).
 * product_variants rows = combo source of truth; dimensions.values = axis order / UI assist only.
 * Do NOT reverse-generate rows from values on conflict — rebuild values from rows.
 * formRowsToDbInserts / persistVariantsSafe stay unchanged.
 */

import { lookupCharacterAliasPatch } from "../characters/characterAliasMap";
import { normalizeCharacterIdentity } from "../characters/normalizeCharacterIdentity";
import {
  MAX_VARIANT_DIMENSIONS,
  MAX_VARIANT_ROWS,
  emptyVariantRow,
  isVariantRowFilled,
  type VariantDimension,
  type VariantFormRow
} from "./types";

/** Fable clamp copy for cartesian expand > 50. */
export const CARTESIAN_CLAMP_WARNING =
  "款式組合超過 50，已截斷——請減少軸值或分兩件商品上架";

/**
 * Extra merge surfaces so P2-79 orthography pairs align offline
 * (patch has 米飛→Miffy; seed UI often shows 米菲).
 */
const MERGE_EXTRA_TO_CANONICAL: ReadonlyArray<readonly [string, string]> = [
  ["米菲", "Miffy"],
  ["米菲兔", "Miffy"]
];

function patchKey(value: string): string {
  return normalizeCharacterIdentity(value).toLowerCase();
}

/**
 * Normalize one option cell for merge key — aligned with P2-79 character identity
 * + code-side alias patches (米飛／米菲 → same key).
 */
export function normalizeOptionValueForMerge(raw: string): string {
  const identity = normalizeCharacterIdentity(raw ?? "");
  if (!identity) return "";

  const patch = lookupCharacterAliasPatch(identity);
  if (patch?.character_name) {
    return patchKey(patch.character_name);
  }

  const idKey = patchKey(identity);
  for (const [surface, canonical] of MERGE_EXTRA_TO_CANONICAL) {
    if (patchKey(surface) === idKey) return patchKey(canonical);
  }

  return idKey;
}

/** Merge key = normalized optionValues triple (axis 0|1|2). */
export function optionValuesMergeKey(
  optionValues: [string, string, string] | string[]
): string {
  const v0 = normalizeOptionValueForMerge(optionValues[0] ?? "");
  const v1 = normalizeOptionValueForMerge(optionValues[1] ?? "");
  const v2 = normalizeOptionValueForMerge(optionValues[2] ?? "");
  return `${v0}\u0001${v1}\u0001${v2}`;
}

/** True when the row has hand-filled data worth protecting. */
export function isVariantRowHandFilled(row: VariantFormRow): boolean {
  if (row.priceLocked) return true;
  if (row.imageId) return true;
  if (row.sku.trim()) return true;
  if (row.qty.trim()) return true;
  if (row.sellPrice.trim()) return true;
  if (row.compareAt.trim()) return true;
  const costNum = Number(row.cost);
  if (row.cost.trim() && Number.isFinite(costNum) && costNum > 0) return true;
  return false;
}

function preservedHandFields(row: VariantFormRow): Pick<
  VariantFormRow,
  | "cost"
  | "costIsInherited"
  | "sellPrice"
  | "compareAt"
  | "priceLocked"
  | "qty"
  | "sku"
  | "imageId"
> {
  return {
    cost: row.cost,
    costIsInherited: row.costIsInherited,
    sellPrice: row.sellPrice,
    compareAt: row.compareAt,
    priceLocked: row.priceLocked,
    qty: row.qty,
    sku: row.sku,
    imageId: row.imageId
  };
}

/** Unique display values; first form wins when merge-keys collide. */
export function uniqueAxisValues(values: string[] | null | undefined): string[] {
  if (!values?.length) return [];
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const display = String(raw ?? "").trim();
    if (!display) continue;
    const key = normalizeOptionValueForMerge(display);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    ordered.push(display);
  }
  return ordered;
}

/**
 * Cartesian product over non-empty axes only (空軸不參與).
 * Axis order fixed 0 → 1 → 2; empty-value axes skipped but slot indices preserved.
 */
export function cartesianOptionValueCombos(
  dimensions: VariantDimension[]
): [string, string, string][] {
  const dims = dimensions.slice(0, MAX_VARIANT_DIMENSIONS);
  const active: { index: number; values: string[] }[] = [];
  for (let i = 0; i < dims.length; i++) {
    const values = uniqueAxisValues(dims[i]?.values);
    if (values.length > 0) active.push({ index: i, values });
  }
  if (active.length === 0) return [];

  let combos: [string, string, string][] = [["", "", ""]];
  for (const axis of active) {
    const next: [string, string, string][] = [];
    for (const base of combos) {
      for (const v of axis.values) {
        const ov: [string, string, string] = [base[0], base[1], base[2]];
        ov[axis.index] = v;
        next.push(ov);
      }
    }
    combos = next;
  }
  return combos;
}

export type ExpandMergeResult = {
  rows: VariantFormRow[];
  truncated: boolean;
  warning: string | null;
  /** Existing hand-filled rows whose full merge key is absent from the new expand set. */
  wouldDiscardHandFilled: VariantFormRow[];
  /** Theoretical combo count before clamp. */
  comboCount: number;
};

/**
 * Build existing map by merge key; duplicate keys keep smallest sortOrder.
 */
export function indexRowsByMergeKey(
  rows: VariantFormRow[]
): Map<string, VariantFormRow> {
  const map = new Map<string, VariantFormRow>();
  const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const row of sorted) {
    if (!isVariantRowFilled(row)) continue;
    const key = optionValuesMergeKey(row.optionValues);
    if (!key.replace(/\u0001/g, "")) continue;
    if (!map.has(key)) map.set(key, row);
  }
  return map;
}

/**
 * Expand from dimensions.values (cartesian) and merge with existing rows.
 * Hit → keep cost/sell/lock/qty/sku/image. Miss on hand-fill → listed for confirm.
 * Cap at MAX_VARIANT_ROWS with Fable clamp copy.
 * UX-B4-P03: VariantEditor may call this on axis-value change (auto path);
 * still never silently discard wouldDiscardHandFilled — caller must confirm.
 */
export function expandAndMergeVariantRows(
  dimensions: VariantDimension[],
  existing: VariantFormRow[]
): ExpandMergeResult {
  const combos = cartesianOptionValueCombos(dimensions);
  const comboCount = combos.length;
  const existingByKey = indexRowsByMergeKey(existing);

  const expandedKeys = new Set(
    combos.map((ov) => optionValuesMergeKey(ov))
  );

  const wouldDiscardHandFilled: VariantFormRow[] = [];
  for (const [key, row] of existingByKey) {
    if (!expandedKeys.has(key) && isVariantRowHandFilled(row)) {
      wouldDiscardHandFilled.push(row);
    }
  }

  let rows: VariantFormRow[] = combos.map((optionValues, i) => {
    const base = emptyVariantRow(i);
    base.optionValues = optionValues;
    const hit = existingByKey.get(optionValuesMergeKey(optionValues));
    if (hit) {
      return {
        ...base,
        ...preservedHandFields(hit),
        optionValues,
        sortOrder: i
      };
    }
    return base;
  });

  let truncated = false;
  let warning: string | null = null;
  if (rows.length > MAX_VARIANT_ROWS) {
    truncated = true;
    warning = CARTESIAN_CLAMP_WARNING;
    rows = rows.slice(0, MAX_VARIANT_ROWS).map((r, i) => ({ ...r, sortOrder: i }));
  }

  return { rows, truncated, warning, wouldDiscardHandFilled, comboCount };
}

/**
 * Rebuild dimensions.values from actual rows (source of truth).
 * Never invents values that do not appear on a row.
 */
export function rebuildDimensionValuesFromRows(
  dimensions: VariantDimension[],
  rows: VariantFormRow[]
): VariantDimension[] {
  const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
  return dimensions.slice(0, MAX_VARIANT_DIMENSIONS).map((dim, di) => {
    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const row of sorted) {
      const display = (row.optionValues[di] ?? "").trim();
      if (!display) continue;
      const key = normalizeOptionValueForMerge(display);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      ordered.push(display);
    }
    return { name: dim.name, values: ordered };
  });
}

/**
 * Drop a dimension: shift option slots, then merge by new full key.
 * On partial collision (same remaining axes), keep smallest sortOrder.
 * Lists discarded hand-filled losers for double-confirm.
 */
export function removeDimensionMergingRows(
  dimensions: VariantDimension[],
  rows: VariantFormRow[],
  dimIndex: number
): {
  dimensions: VariantDimension[];
  rows: VariantFormRow[];
  wouldDiscardHandFilled: VariantFormRow[];
} {
  if (dimIndex < 0 || dimIndex >= dimensions.length) {
    return {
      dimensions,
      rows,
      wouldDiscardHandFilled: []
    };
  }

  const nextDims = dimensions.filter((_, i) => i !== dimIndex);
  const shifted: VariantFormRow[] = rows.map((row) => {
    const optionValues: [string, string, string] = [
      row.optionValues[0] ?? "",
      row.optionValues[1] ?? "",
      row.optionValues[2] ?? ""
    ];
    for (let i = dimIndex; i < 2; i++) {
      optionValues[i] = optionValues[i + 1] ?? "";
    }
    optionValues[2] = "";
    return { ...row, optionValues };
  });

  const winners = new Map<string, VariantFormRow>();
  const wouldDiscardHandFilled: VariantFormRow[] = [];
  const sorted = [...shifted].sort((a, b) => a.sortOrder - b.sortOrder);

  for (const row of sorted) {
    if (!isVariantRowFilled(row)) continue;
    const key = optionValuesMergeKey(row.optionValues);
    const prev = winners.get(key);
    if (!prev) {
      winners.set(key, row);
      continue;
    }
    // prev already has smaller sortOrder (we iterate sorted ascending)
    if (isVariantRowHandFilled(row)) {
      wouldDiscardHandFilled.push(row);
    }
  }

  const nextRows = [...winners.values()].map((r, i) => ({ ...r, sortOrder: i }));
  const dimsRebuilt = rebuildDimensionValuesFromRows(nextDims, nextRows);

  return {
    dimensions: dimsRebuilt,
    rows: nextRows,
    wouldDiscardHandFilled
  };
}

/** Append a value to a dimension's values list (UI assist); no row expand. */
export function appendDimensionValue(
  dimensions: VariantDimension[],
  dimIndex: number,
  value: string
): VariantDimension[] {
  const trimmed = value.trim();
  if (!trimmed) return dimensions;
  if (dimIndex < 0 || dimIndex >= dimensions.length) return dimensions;
  return dimensions.map((dim, i) => {
    if (i !== dimIndex) return dim;
    const next = uniqueAxisValues([...(dim.values ?? []), trimmed]);
    return { ...dim, values: next };
  });
}

/** Remove one axis value by display/merge identity. */
export function removeDimensionValue(
  dimensions: VariantDimension[],
  dimIndex: number,
  value: string
): VariantDimension[] {
  if (dimIndex < 0 || dimIndex >= dimensions.length) return dimensions;
  const dropKey = normalizeOptionValueForMerge(value);
  return dimensions.map((dim, i) => {
    if (i !== dimIndex) return dim;
    const next = (dim.values ?? []).filter(
      (v) => normalizeOptionValueForMerge(v) !== dropKey
    );
    return { ...dim, values: uniqueAxisValues(next) };
  });
}

/** True when at least one axis has a value to expand. */
export function canExpandFromDimensions(dimensions: VariantDimension[]): boolean {
  return dimensions.some((d) => uniqueAxisValues(d.values).length > 0);
}
