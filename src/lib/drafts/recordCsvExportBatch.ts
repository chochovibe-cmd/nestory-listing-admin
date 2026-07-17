/**
 * P1-69（回饋 69）：Showmore／Matrixify 匯出入 publish_batches 帳。
 * Best-effort — failure must never block CSV download.
 */
import { buildPublishSnapshot } from "@/lib/drafts/publishBatch";
import type { createServiceSupabaseClient } from "@/lib/supabase/server";

export type CsvExportBatchKind = "showmore" | "matrixify";

export type CsvExportBatchDraft = {
  draftId: string;
  title: string;
};

type ServiceClient = ReturnType<typeof createServiceSupabaseClient>;

/**
 * Creates a terminal completed publish_batches row + done items for a CSV export.
 * Returns batchId or null on any failure (caller ignores).
 */
export async function recordCsvExportBatch(params: {
  serviceSupabase: ServiceClient;
  kind: CsvExportBatchKind;
  drafts: CsvExportBatchDraft[];
  createdBy: string | null;
}): Promise<{ batchId: string | null; error?: string }> {
  const { serviceSupabase, kind, drafts, createdBy } = params;
  if (!drafts.length) return { batchId: null };

  const nowIso = new Date().toISOString();
  const snapshot = buildPublishSnapshot(
    drafts.map((d) => ({ draftId: d.draftId, title: d.title })),
  );

  const { data: batchRow, error: batchError } = await serviceSupabase
    .from("publish_batches")
    .insert({
      kind,
      status: "completed",
      // Fable P1-69: CSV has no draft/active publish semantics — fixed draft.
      publish_mode: "draft",
      total_count: drafts.length,
      done_count: drafts.length,
      failed_count: 0,
      created_by: createdBy,
      created_at: nowIso,
      updated_at: nowIso,
      started_at: nowIso,
      completed_at: nowIso,
      snapshot_json: snapshot,
    })
    .select("id")
    .single();

  if (batchError || !batchRow?.id) {
    return {
      batchId: null,
      error: batchError?.message ?? "publish_batches insert failed",
    };
  }

  const batchId = batchRow.id as string;

  const itemRows = drafts.map((d) => ({
    batch_id: batchId,
    draft_id: d.draftId,
    item_status: "done" as const,
    created_at: nowIso,
    completed_at: nowIso,
  }));

  const { error: itemsError } = await serviceSupabase
    .from("publish_batch_items")
    .insert(itemRows);

  if (itemsError) {
    // Leave the header row; records UI can still show the batch with empty items.
    return { batchId, error: itemsError.message };
  }

  // Point drafts at this batch (best-effort; column may be missing).
  for (const d of drafts) {
    try {
      await serviceSupabase
        .from("product_drafts")
        .update({ current_publish_batch_id: batchId })
        .eq("id", d.draftId);
    } catch {
      // ignore
    }
  }

  return { batchId };
}

/** Title helper aligned with other batch snapshot sources. */
export function csvExportDraftTitle(row: {
  title_zh?: string | null;
  taobao_title?: string | null;
  original_title?: string | null;
  id?: string;
}): string {
  return (
    row.title_zh?.trim() ||
    row.taobao_title?.trim() ||
    row.original_title?.trim() ||
    (row.id ? `草稿 ${String(row.id).slice(0, 8)}` : "（無標題）")
  );
}
