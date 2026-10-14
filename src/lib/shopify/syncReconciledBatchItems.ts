/**
 * PUBLISH-BATCH: after the 對帳 button repaired a draft (Shopify was already live), the
 * draft's failed row in its latest publish batch is no longer true. Flip it to done and
 * recompute that (already terminal) batch's counts / status so 發布紀錄 stops listing it
 * as a failure. Only the draft's CURRENT batch is touched; older history stays as is.
 *
 * Kept out of reconcileDraft.ts on purpose: that module is imported by publishDraft, and
 * this one needs runPublishBatch (import cycle otherwise).
 */
import { summarizePublishBatchStatus } from "@/lib/drafts/publishBatch";
import {
  getPublishBatchItemCounts,
  type PublishBatchServiceClient
} from "@/lib/shopify/runPublishBatch";

export async function syncReconciledBatchItems(
  serviceSupabase: PublishBatchServiceClient,
  draftId: string,
  productId: string,
  adminUrl: string | null
): Promise<{ updatedItems: number; batchId: string | null }> {
  const { data: draft } = await serviceSupabase
    .from("product_drafts")
    .select("current_publish_batch_id")
    .eq("id", draftId)
    .maybeSingle();
  const batchId = (draft?.current_publish_batch_id as string | null | undefined) ?? null;
  if (!batchId) return { updatedItems: 0, batchId: null };

  const { data: updated } = await serviceSupabase
    .from("publish_batch_items")
    .update({
      item_status: "done",
      error_message: null,
      shopify_product_id: productId,
      shopify_admin_url: adminUrl,
      completed_at: new Date().toISOString()
    })
    .eq("batch_id", batchId)
    .eq("draft_id", draftId)
    .eq("item_status", "failed")
    .select("id");
  const updatedItems = Array.isArray(updated) ? updated.length : 0;
  if (updatedItems === 0) return { updatedItems: 0, batchId };

  const counts = await getPublishBatchItemCounts(serviceSupabase, batchId);
  if (counts.queued === 0 && counts.processing === 0) {
    const status = summarizePublishBatchStatus({
      total: counts.total,
      done: counts.done,
      failed: counts.failed,
      skipped: counts.skipped
    });
    const parts: string[] = [];
    if (counts.failed > 0) parts.push(`失敗 ${counts.failed}`);
    if (counts.skipped > 0) parts.push(`略過 ${counts.skipped}`);
    await serviceSupabase
      .from("publish_batches")
      .update({
        status,
        done_count: counts.done,
        failed_count: counts.failed,
        error_summary: parts.length ? parts.join("；") : null,
        updated_at: new Date().toISOString()
      })
      .eq("id", batchId)
      .neq("status", "processing");
  }
  return { updatedItems, batchId };
}
