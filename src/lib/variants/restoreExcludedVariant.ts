/**
 * VARIANT-CLEAN: 「恢復」an option the capture import excluded as a non-product 款式.
 * Pure planning; the API route does the writes. The excluded list lives in
 * product_drafts.raw_capture.server.excluded_variants.
 */
import { cleanVariantRows } from "./variantNameRules";
import { assignVariantSkus } from "./variantSku";
import { findDuplicateVariantInsertRows } from "./variantPersist";

export type ExcludedVariantEntry = {
  label: string;
  reason?: string;
  row: Record<string, unknown>;
};

export type ExistingVariantLite = {
  id: string;
  sku?: string | null;
  sort_order?: number | null;
  option1_value?: string | null;
  option2_value?: string | null;
  option3_value?: string | null;
};

type Dimension = { name: string; values?: string[] };

export type RestorePlan =
  | {
      ok: true;
      /** product_variants insert payload (draft_id included). */
      row: Record<string, unknown>;
      remaining: ExcludedVariantEntry[];
      dimensions: Dimension[];
    }
  | { ok: false; status: number; error: string };

export function readExcludedVariants(rawCapture: unknown): ExcludedVariantEntry[] {
  if (!rawCapture || typeof rawCapture !== "object" || Array.isArray(rawCapture)) return [];
  const server = (rawCapture as Record<string, unknown>).server;
  if (!server || typeof server !== "object" || Array.isArray(server)) return [];
  const list = (server as Record<string, unknown>).excluded_variants;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (item): item is ExcludedVariantEntry =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as ExcludedVariantEntry).label === "string" &&
      Boolean((item as ExcludedVariantEntry).row) &&
      typeof (item as ExcludedVariantEntry).row === "object"
  );
}

function addToDimensions(dimensions: Dimension[], row: Record<string, unknown>): Dimension[] {
  const next = dimensions.map((d) => ({ ...d, ...(d.values ? { values: [...d.values] } : {}) }));
  for (const axis of [1, 2, 3]) {
    const name = typeof row[`option${axis}_name`] === "string" ? (row[`option${axis}_name`] as string).trim() : "";
    const value = typeof row[`option${axis}_value`] === "string" ? (row[`option${axis}_value`] as string).trim() : "";
    if (!name || !value) continue;
    const dim = next.find((d) => d.name === name);
    if (dim) {
      const values = dim.values ?? [];
      if (!values.includes(value)) values.push(value);
      dim.values = values;
    } else if (next.length < 3) {
      next.push({ name, values: [value] });
    }
  }
  return next;
}

export function planRestoreExcludedVariant(input: {
  draftId: string;
  excluded: ExcludedVariantEntry[];
  index: number;
  existing: ExistingVariantLite[];
  dimensions: Dimension[];
}): RestorePlan {
  const entry = input.excluded[input.index];
  if (!Number.isInteger(input.index) || !entry) {
    return { ok: false, status: 404, error: "找不到這個已排除的款式（可能已被恢復）" };
  }

  const { image_url: _imageUrl, ...raw } = entry.row;
  // Same rule layer the import used, and the axis names the product already has, so the
  // restored row lines up with its siblings instead of opening a second axis.
  const [cleaned] = cleanVariantRows([raw as Parameters<typeof cleanVariantRows>[0][number]]);
  const base: Record<string, unknown> = { ...raw };
  [0, 1, 2].forEach((axis) => {
    const name = input.dimensions[axis]?.name ?? cleaned.names[axis];
    base[`option${axis + 1}_name`] = cleaned.values[axis] != null ? name ?? null : cleaned.names[axis];
    base[`option${axis + 1}_value`] = cleaned.values[axis];
  });
  if (entry.reason === "source_sold_out") {
    base.cny_price = null; // a restored variant always follows the product cost, so the confirm flag stays honest
    base.cost_is_inherited = true;
  }
  const sortOrder = input.existing.reduce((max, r) => Math.max(max, (r.sort_order ?? 0) + 1), 0);
  const priorStock = (entry.row.source_options as { stock?: unknown } | undefined)?.stock;
  const draft: Record<string, unknown> = {
    ...base,
    draft_id: input.draftId,
    sort_order: sortOrder,
    // Originals stay on record, same as imported rows.
    source_options: {
      names: [raw.option1_name ?? null, raw.option2_name ?? null, raw.option3_name ?? null],
      values: [raw.option1_value ?? null, raw.option2_value ?? null, raw.option3_value ?? null],
      ...(priorStock ? { stock: priorStock } : {})
    }
  };

  const duplicates = findDuplicateVariantInsertRows([
    ...input.existing.map((r) => ({
      draft_id: input.draftId,
      option1_value: r.option1_value ?? null,
      option2_value: r.option2_value ?? null,
      option3_value: r.option3_value ?? null
    })),
    draft as Record<string, unknown> & { draft_id: string }
  ]);
  if (duplicates.length > 0) {
    return { ok: false, status: 409, error: `已經有同名的款式「${entry.label}」，不需要再恢復` };
  }

  const all = assignVariantSkus(input.draftId, [
    ...input.existing.map((r) => ({ sku: r.sku ?? null, sort_order: r.sort_order ?? 0, source_sku_id: null as string | null })),
    { sku: null, sort_order: sortOrder, source_sku_id: (base.source_sku_id as string | null) ?? null }
  ]);
  const restoredSku = all[all.length - 1];

  return {
    ok: true,
    row: { ...draft, sku: restoredSku.sku, source_sku_id: restoredSku.source_sku_id ?? null },
    remaining: input.excluded.filter((_, i) => i !== input.index),
    dimensions: addToDimensions(input.dimensions, base)
  };
}

export type RestoreAllPlan =
  | { ok: true; rows: Array<Record<string, unknown>>; remaining: ExcludedVariantEntry[]; dimensions: Dimension[] }
  | { ok: false; status: number; error: string };

/**
 * CAPTURE-FIX: restore every excluded entry of one `reason` (e.g. "source_sold_out") in one plan.
 * All-or-nothing: the first failing entry fails the whole plan so nothing is written partially.
 */
export function planRestoreAllExcludedVariants(input: {
  draftId: string;
  excluded: ExcludedVariantEntry[];
  reason: string;
  existing: ExistingVariantLite[];
  dimensions: Dimension[];
}): RestoreAllPlan {
  const rows: Array<Record<string, unknown>> = [];
  const existing: ExistingVariantLite[] = [...input.existing];
  let excluded = input.excluded;
  let dimensions = input.dimensions;
  for (;;) {
    const index = excluded.findIndex((e) => e.reason === input.reason);
    if (index < 0) break;
    const plan = planRestoreExcludedVariant({ draftId: input.draftId, excluded, index, existing, dimensions });
    if (!plan.ok) return plan;
    rows.push(plan.row);
    existing.push({
      id: "pending-" + rows.length,
      sku: (plan.row.sku as string | null | undefined) ?? null,
      sort_order: plan.row.sort_order as number,
      option1_value: (plan.row.option1_value as string | null | undefined) ?? null,
      option2_value: (plan.row.option2_value as string | null | undefined) ?? null,
      option3_value: (plan.row.option3_value as string | null | undefined) ?? null
    });
    excluded = plan.remaining;
    dimensions = plan.dimensions;
  }
  if (rows.length === 0) return { ok: false, status: 404, error: "沒有可加回的款式" };
  return { ok: true, rows, remaining: excluded, dimensions };
}
