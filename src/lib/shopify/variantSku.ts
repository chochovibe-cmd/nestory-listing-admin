import { generateSku } from "@/lib/contentGenerator/sku";
import type { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { ProductVariantRow } from "@/types/domain";

type ServiceSupabase = ReturnType<typeof createServiceSupabaseClient>;

export type ShopifySkuIdentity = {
  product_type?: string | null;
  category?: string | null;
  ip_name?: string | null;
  character_name?: string | null;
};

export type GeneratedVariantSkuAssignment = {
  id: string;
  previousSku: string | null;
  sku: string;
};

export type FilledVariantSkus = {
  rows: ProductVariantRow[];
  generated: GeneratedVariantSkuAssignment[];
};

export function resolveShopifySkuBase(draft: ShopifySkuIdentity): string {
  return generateSku({
    productType: draft.product_type ?? "",
    ipName: draft.ip_name ?? draft.category ?? "",
    characterName: draft.character_name
  }).sku;
}

function skuForSequence(baseSku: string, sequence: number): string {
  const suffix = String(Math.max(1, sequence)).padStart(3, "0");
  return /-\d{3}$/u.test(baseSku)
    ? baseSku.replace(/-\d{3}$/u, `-${suffix}`)
    : `${baseSku}-${suffix}`;
}

/**
 * Multi-variant SKU fallback:
 * - preserve every non-empty row SKU exactly (after trimming)
 * - fill only blank rows
 * - derive from the existing Shopify publish SKU authority
 * - avoid collisions with explicit/generated row SKUs
 *
 * Generated values are intended to be persisted before a real Shopify write so
 * later reorder/sync operations keep the same row-level SKU.
 */
export function fillMissingVariantSkus(
  rows: ProductVariantRow[],
  baseSku: string
): FilledVariantSkus {
  const base = baseSku.trim();
  const next = rows.map((row) => ({ ...row }));
  if (!base || next.length === 0) return { rows: next, generated: [] };

  const used = new Set<string>();
  for (const row of next) {
    const current = row.sku?.trim();
    if (!current) continue;
    row.sku = current;
    used.add(current.toUpperCase());
  }

  const generated: GeneratedVariantSkuAssignment[] = [];
  for (let index = 0; index < next.length; index += 1) {
    const row = next[index];
    if (row.sku?.trim()) continue;

    let sequence = Number.isInteger(row.sort_order)
      ? Math.max(1, row.sort_order + 1)
      : index + 1;
    let candidate = skuForSequence(base, sequence);
    while (used.has(candidate.toUpperCase())) {
      sequence += 1;
      candidate = skuForSequence(base, sequence);
    }

    const previousSku = rows[index]?.sku ?? null;
    row.sku = candidate;
    used.add(candidate.toUpperCase());
    generated.push({ id: row.id, previousSku, sku: candidate });
  }

  return { rows: next, generated };
}

export type EnsurePersistedVariantSkusResult =
  | { ok: true; rows: ProductVariantRow[]; generated: GeneratedVariantSkuAssignment[] }
  | { ok: false; status: 409 | 500; error: string };

/**
 * Persist fallback SKUs before any real Shopify mutation.
 *
 * Each row uses a compare-and-set guard on its previous SKU. If somebody edits
 * that row concurrently, we stop before the remote write instead of overwriting
 * their value. Earlier generated SKU rows may remain persisted; that is safe and
 * idempotent because Shopify has not been touched yet.
 */
export async function ensurePersistedVariantSkus(
  serviceSupabase: ServiceSupabase,
  draftId: string,
  rows: ProductVariantRow[],
  baseSku: string
): Promise<EnsurePersistedVariantSkusResult> {
  const resolved = fillMissingVariantSkus(rows, baseSku);
  if (resolved.generated.length === 0) return { ok: true, ...resolved };

  for (const assignment of resolved.generated) {
    let query = serviceSupabase
      .from("product_variants")
      .update({ sku: assignment.sku })
      .eq("id", assignment.id)
      .eq("draft_id", draftId);

    query =
      assignment.previousSku == null
        ? query.is("sku", null)
        : query.eq("sku", assignment.previousSku);

    const { data, error } = await query
      .select("id, sku")
      .maybeSingle();

    if (error) {
      return {
        ok: false,
        status: 500,
        error: `寫入款式 SKU 失敗（Shopify 尚未變更）：${error.message}`
      };
    }
    if (!data?.id || data.sku !== assignment.sku) {
      return {
        ok: false,
        status: 409,
        error: "款式 SKU 在發布前被其他操作修改；已停止 Shopify 寫入，請重新載入後再試"
      };
    }
  }

  return { ok: true, ...resolved };
}
