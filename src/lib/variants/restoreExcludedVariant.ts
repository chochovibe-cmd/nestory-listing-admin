/**
 * VARIANT-CLEAN: 「恢復」an option the capture import excluded as a non-product 款式.
 * Pure planning; the API route does the writes. The excluded list lives in
 * product_drafts.raw_capture.server.excluded_variants.
 */
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

  const { image_url: _imageUrl, ...base } = entry.row;
  const sortOrder = input.existing.reduce((max, r) => Math.max(max, (r.sort_order ?? 0) + 1), 0);
  const draft: Record<string, unknown> = {
    ...base,
    draft_id: input.draftId,
    sort_order: sortOrder,
    // Originals stay on record, same as imported rows.
    source_options: {
      names: [base.option1_name ?? null, base.option2_name ?? null, base.option3_name ?? null],
      values: [base.option1_value ?? null, base.option2_value ?? null, base.option3_value ?? null]
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
