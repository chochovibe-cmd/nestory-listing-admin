/**
 * VARIANT-CLEAN: program-owned SKU, NS-<draft UUID first 6 hex, upper>-<2-digit seq>.
 *
 * The SKU is no longer taken from the AI or from Taobao. A value counts as "auto"
 * (safe to overwrite) when it is empty, already an NS- code, a bare Taobao skuId
 * (digits only) or the old AI pattern CHO-…-001. Anything else was typed by a person
 * and is kept as is. Taobao's skuId moves to source_sku_id for purchasing.
 */

export type SkuRowLike = {
  sku?: string | null;
  sort_order?: number | null;
  source_sku_id?: string | null;
};

const NS_SKU = /^NS-([0-9A-F]{6})-(\d{2,})$/;
const TAOBAO_SKU_ID = /^\d{6,}$/;
const LEGACY_AI_SKU = /^CHO-[A-Z0-9]+(?:-[A-Z0-9]+)*-001$/i;

export function skuPrefix(draftId: string): string {
  return draftId.replace(/[^0-9a-fA-F]/g, "").slice(0, 6).toUpperCase().padEnd(6, "0");
}

export function buildVariantSku(draftId: string, seq: number): string {
  return `NS-${skuPrefix(draftId)}-${String(Math.max(1, Math.trunc(seq))).padStart(2, "0")}`;
}

/** True when the SKU may be overwritten by the program (see header). */
export function isAutoSku(sku: string | null | undefined): boolean {
  const value = (sku ?? "").trim();
  if (!value) return true;
  return NS_SKU.test(value) || TAOBAO_SKU_ID.test(value) || LEGACY_AI_SKU.test(value);
}

/** Product-level SKU for single-variant drafts (and the draft.sku field). */
export function deriveDraftSku(draftId: string, currentSku: string | null | undefined): string {
  const current = (currentSku ?? "").trim();
  if (current && !isAutoSku(current)) return current;
  const own = NS_SKU.exec(current);
  if (own && own[1] === skuPrefix(draftId)) return current;
  return buildVariantSku(draftId, 1);
}

/**
 * Fill SKUs for a draft's variant rows (any order in, same order out).
 * - manual SKUs stay untouched
 * - an NS- SKU of THIS draft stays (so numbers never shift under a live product)
 * - every other row gets its 1-based position by sort_order, or the next free number
 */
export function assignVariantSkus<T extends object>(draftId: string, input: T[]): T[] {
  // Capture rows are loose records and DB rows are interfaces; both carry these three keys.
  const rows = input as Array<T & SkuRowLike>;
  const prefix = skuPrefix(draftId);
  const used = new Set<number>();
  const keep = rows.map((row) => {
    const value = (row.sku ?? "").trim();
    if (value && !isAutoSku(value)) return true;
    const own = NS_SKU.exec(value);
    if (own && own[1] === prefix && !used.has(Number(own[2]))) {
      used.add(Number(own[2]));
      return true;
    }
    return false;
  });

  const order = rows
    .map((row, index) => ({ index, sort: row.sort_order ?? index }))
    .sort((a, b) => a.sort - b.sort || a.index - b.index);

  const out = rows.map((row) => ({ ...row }));
  order.forEach(({ index }, position) => {
    if (keep[index]) return;
    let seq = position + 1;
    while (used.has(seq)) seq += 1;
    used.add(seq);
    const row = out[index];
    const old = (row.sku ?? "").trim();
    if (TAOBAO_SKU_ID.test(old) && !(row.source_sku_id ?? "").trim()) row.source_sku_id = old;
    row.sku = buildVariantSku(draftId, seq);
  });
  return out;
}
