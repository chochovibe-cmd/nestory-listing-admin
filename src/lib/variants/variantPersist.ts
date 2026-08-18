/**
 * B7 safe batch overwrite for product_variants.
 *
 * Requirement: delete→insert must NOT leave "variants wiped" if insert fails.
 * Strategy:
 *   1) INSERT new rows with a temporary marker? — no temp column.
 *   Better: INSERT first into memory plan, then:
 *   A) insert new rows (with draft_id) — if success, delete OLD rows that are not in new ids
 *   OR classic two-phase with restore:
 *   1) select existing ids
 *   2) insert new
 *   3) if insert ok → delete old by old ids
 *   4) if insert fail → leave old untouched, return error
 *
 * This is insert-first-then-delete-old (not delete-first).
 */

import { normalizeOptionValueForMerge } from "./variantCrossExpand";

export type VariantInsertPayload = Record<string, unknown> & { draft_id: string };

export type PersistVariantsResult =
  | { ok: true; inserted: number; deleted: number }
  | { ok: false; error: string; phase: "validate" | "load_old" | "insert" | "delete_old" };

export type SupabaseLike = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string
      ) => PromiseLike<{ data: { id: string }[] | null; error: { message: string } | null }>;
    };
    insert: (
      rows: VariantInsertPayload[]
    ) => PromiseLike<{ error: { message: string } | null }>;
    delete: () => {
      in: (
        col: string,
        vals: string[]
      ) => PromiseLike<{ error: { message: string } | null }>;
      eq: (col: string, val: string) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

function optionValue(payload: VariantInsertPayload, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

/** Duplicate DB insert rows after the first normalized option combination. */
export function findDuplicateVariantInsertRows(
  rows: VariantInsertPayload[]
): VariantInsertPayload[] {
  const duplicates: VariantInsertPayload[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const values = [
      optionValue(row, "option1_value"),
      optionValue(row, "option2_value"),
      optionValue(row, "option3_value")
    ];
    const key = values.map((value) => normalizeOptionValueForMerge(value)).join("\u0001");
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
 * Replace all variants for a draft safely.
 * - duplicate option combinations fail before any DB read/write
 * - empty `rows` → delete all existing (single-SKU product); delete failure is reported
 * - non-empty → insert first, then delete previous ids only after insert succeeds
 */
export async function persistVariantsSafe(
  client: SupabaseLike,
  draftId: string,
  rows: VariantInsertPayload[]
): Promise<PersistVariantsResult> {
  const duplicateRows = findDuplicateVariantInsertRows(rows);
  if (duplicateRows.length > 0) {
    return {
      ok: false,
      phase: "validate",
      error: `款式組合重複（${duplicateRows.length} 列）— 請先修改重複的規格值再儲存`
    };
  }

  const { data: oldRows, error: loadError } = await client
    .from("product_variants")
    .select("id")
    .eq("draft_id", draftId);

  if (loadError) {
    return {
      ok: false,
      phase: "load_old",
      error: `讀取舊款式失敗（未改動任何列）：${loadError.message}`
    };
  }

  const oldIds = (oldRows ?? []).map((r) => r.id);

  if (rows.length === 0) {
    if (oldIds.length === 0) {
      return { ok: true, inserted: 0, deleted: 0 };
    }
    const { error: delError } = await client
      .from("product_variants")
      .delete()
      .eq("draft_id", draftId);
    if (delError) {
      return {
        ok: false,
        phase: "delete_old",
        error: `清空款式失敗（舊列仍在，可重試）：${delError.message}`
      };
    }
    return { ok: true, inserted: 0, deleted: oldIds.length };
  }

  const withDraft = rows.map((r) => ({ ...r, draft_id: draftId }));
  const { error: insertError } = await client.from("product_variants").insert(withDraft);

  if (insertError) {
    return {
      ok: false,
      phase: "insert",
      error: `寫入新款式失敗（舊款式仍保留，可重試）：${insertError.message}`
    };
  }

  if (oldIds.length > 0) {
    const { error: delError } = await client.from("product_variants").delete().in("id", oldIds);
    if (delError) {
      // New rows exist + old rows remain → duplicates until retry cleans old.
      // Still surface as error so operator retries; message is explicit.
      return {
        ok: false,
        phase: "delete_old",
        error: `新款式已寫入，但清除舊列失敗（可能暫時重複，請再按一次生成/儲存以清理）：${delError.message}`
      };
    }
  }

  return { ok: true, inserted: withDraft.length, deleted: oldIds.length };
}
