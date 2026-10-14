/**
 * VARIANT-CLEAN: write the program-assigned SKUs (and the Taobao skuId moved to
 * source_sku_id) back to product_variants. Best effort: a missing source_sku_id column
 * (migration 20261014100000 not applied) degrades to writing the SKU alone.
 */
type Row = { id: string; sku?: string | null; source_sku_id?: string | null };

export async function persistAssignedVariantSkus(
  serviceSupabase: { from: (table: string) => any },
  before: Row[],
  after: Row[]
): Promise<void> {
  for (const row of after) {
    const old = before.find((r) => r.id === row.id);
    if (!old) continue;
    const skuChanged = (old.sku ?? null) !== (row.sku ?? null);
    const sourceChanged = (old.source_sku_id ?? null) !== (row.source_sku_id ?? null);
    if (!skuChanged && !sourceChanged) continue;
    const { error } = await serviceSupabase
      .from("product_variants")
      .update({ sku: row.sku ?? null, ...(sourceChanged ? { source_sku_id: row.source_sku_id ?? null } : {}) })
      .eq("id", row.id);
    if (error && sourceChanged) {
      await serviceSupabase.from("product_variants").update({ sku: row.sku ?? null }).eq("id", row.id);
    }
  }
}
