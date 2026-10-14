/**
 * PUBLISH-BATCH: auto-close publish batches that a killed serverless function left behind.
 *
 * Real incident: a 5-item ACTIVE batch ran in ONE 60s request; item 3 took >47s, the
 * function was killed, items 4/5 stayed "queued" and the batch stayed "processing"
 * forever, while item 3's draft was api_failed even though Shopify had the product.
 *
 * Rules (per `processing` batch):
 *  1. items `processing` and no batch activity for > staleItemMs  → the run died:
 *       - active batch + draft has a real Shopify product → reconcile (remote ACTIVE
 *         ⇒ item done), otherwise
 *       - item failed (PUBLISH_INTERRUPTED_ITEM_MESSAGE); a draft still in "publishing"
 *         goes to api_failed exactly like markDraftFailed, so the normal retry/resume
 *         path can pick it up.
 *  2. no batch activity for > idleBatchMs and items still `queued` → skipped
 *     (PUBLISH_BATCH_ABORTED_SKIP_REASON).
 *  3. no queued / processing items left → finalize (terminal status + notice, once).
 *
 * Activity proxy: publish_batch_items has no updated_at column (and this package adds no
 * migration), so the batch header's updated_at is the clock. The stepwise route bumps it
 * whenever it claims or completes an item, so a legitimately running item (≤ 60s) is
 * always far younger than staleItemMs.
 */
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import {
  PUBLISH_BATCH_ABORTED_SKIP_REASON,
  PUBLISH_IDLE_BATCH_MS,
  PUBLISH_INTERRUPTED_ITEM_MESSAGE,
  PUBLISH_STALE_ITEM_MS
} from "@/lib/drafts/publishBatch";
import { isRealShopifyProductId, type ShopifyAdminGraphQLCaller } from "@/lib/shopify/productLifecycle";
import { reconcileDraftWithShopify, type ReconcileResult } from "@/lib/shopify/reconcileDraft";
import {
  finalizePublishBatch,
  getPublishBatchItemCounts,
  type PublishBatchServiceClient
} from "@/lib/shopify/runPublishBatch";
import type { PublishMode } from "@/types/domain";

export type RecoverStalePublishBatchesOptions = {
  /** Only this batch (the stepwise route). Default: every stale `processing` batch. */
  batchId?: string;
  staleItemMs?: number;
  idleBatchMs?: number;
  /** Max batches per global sweep. */
  limit?: number;
  now?: () => number;
  /** Shopify caller for the reconcile check (tests inject a fake). */
  caller?: ShopifyAdminGraphQLCaller;
  /** Inject for tests. */
  reconcile?: (
    client: PublishBatchServiceClient,
    draftId: string,
    caller?: ShopifyAdminGraphQLCaller
  ) => Promise<ReconcileResult>;
  skipMakeWebhook?: boolean;
};

export type RecoverStalePublishBatchesResult = {
  batchesChecked: number;
  itemsReconciled: number;
  itemsFailed: number;
  itemsSkipped: number;
  batchesFinalized: number;
  errors: string[];
};

type BatchHeader = {
  id: string;
  status: string;
  publish_mode: string | null;
  updated_at: string | null;
  created_at: string | null;
};

function parseMs(value: string | null | undefined): number {
  const ms = value ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

export async function recoverStalePublishBatches(
  serviceSupabase: PublishBatchServiceClient,
  options: RecoverStalePublishBatchesOptions = {}
): Promise<RecoverStalePublishBatchesResult> {
  const {
    batchId,
    staleItemMs = PUBLISH_STALE_ITEM_MS,
    idleBatchMs = PUBLISH_IDLE_BATCH_MS,
    limit = 20,
    now = () => Date.now(),
    caller,
    reconcile = reconcileDraftWithShopify,
    skipMakeWebhook = false
  } = options;

  const out: RecoverStalePublishBatchesResult = {
    batchesChecked: 0,
    itemsReconciled: 0,
    itemsFailed: 0,
    itemsSkipped: 0,
    batchesFinalized: 0,
    errors: []
  };

  let query = serviceSupabase
    .from("publish_batches")
    .select("id, status, publish_mode, updated_at, created_at")
    .eq("status", "processing");
  if (batchId) query = query.eq("id", batchId);
  const { data: batchRows, error: batchError } = await query
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (batchError) {
    out.errors.push(batchError.message);
    return out;
  }

  for (const batch of (batchRows ?? []) as BatchHeader[]) {
    out.batchesChecked += 1;
    try {
      await recoverOneBatch(batch);
    } catch (e) {
      out.errors.push(`${batch.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;

  async function recoverOneBatch(batch: BatchHeader) {
    const publishMode: PublishMode = batch.publish_mode === "active" ? "active" : "draft";
    const idleMs = now() - (parseMs(batch.updated_at) || parseMs(batch.created_at));

    const { data: itemRows, error: itemsError } = await serviceSupabase
      .from("publish_batch_items")
      .select("id, draft_id, item_status")
      .eq("batch_id", batch.id);
    if (itemsError) {
      out.errors.push(`${batch.id}: ${itemsError.message}`);
      return;
    }
    const items = (itemRows ?? []) as Array<{ id: string; draft_id: string; item_status: string }>;

    // 1) Killed mid-publish.
    if (idleMs > staleItemMs) {
      for (const item of items.filter((i) => i.item_status === "processing")) {
        await recoverStaleItem(batch, item, publishMode);
      }
    }

    // 2) Abandoned batch: whatever never started will not start.
    let counts = await getPublishBatchItemCounts(serviceSupabase, batch.id);
    if (idleMs > idleBatchMs && counts.queued > 0) {
      const { data: skipped, error: skipError } = await serviceSupabase
        .from("publish_batch_items")
        .update({
          item_status: "skipped",
          error_message: PUBLISH_BATCH_ABORTED_SKIP_REASON,
          completed_at: new Date(now()).toISOString()
        })
        .eq("batch_id", batch.id)
        .eq("item_status", "queued")
        .select("id");
      if (skipError) out.errors.push(`${batch.id}: ${skipError.message}`);
      else out.itemsSkipped += Array.isArray(skipped) ? skipped.length : 0;
      counts = await getPublishBatchItemCounts(serviceSupabase, batch.id);
    }

    // 3) Nothing left to run. (A header with zero item rows is only closed once it is
    //    clearly abandoned: createPublishBatchRecords inserts header first, items second.)
    const nothingLeft = counts.queued === 0 && counts.processing === 0;
    if (nothingLeft && (counts.total > 0 || idleMs > idleBatchMs)) {
      const finalized = await finalizePublishBatch({
        serviceSupabase,
        batchId: batch.id,
        publishMode,
        skipNote: "批次中斷",
        now,
        skipMakeWebhook
      });
      if (finalized.claimed) out.batchesFinalized += 1;
    }
  }

  async function recoverStaleItem(
    batch: BatchHeader,
    item: { id: string; draft_id: string },
    publishMode: PublishMode
  ) {
    const { data: draft } = await serviceSupabase
      .from("product_drafts")
      .select("id, status, shopify_product_id, shopify_admin_url, current_publish_batch_id")
      .eq("id", item.draft_id)
      .maybeSingle();

    // Reconcile only for ACTIVE batches: only then would a live Shopify product mean
    // "this item actually succeeded".
    if (
      publishMode === "active" &&
      draft &&
      isRealShopifyProductId(draft.shopify_product_id) &&
      ["api_failed", "publishing", "active_published"].includes(draft.status as string)
    ) {
      let rec: ReconcileResult | null = null;
      try {
        rec = await reconcile(serviceSupabase, item.draft_id, caller);
      } catch (e) {
        out.errors.push(`${batch.id}/${item.draft_id}: reconcile ${e instanceof Error ? e.message : String(e)}`);
      }
      if (rec?.reconciled) {
        const { data: closed } = await serviceSupabase
          .from("publish_batch_items")
          .update({
            item_status: "done",
            error_message: null,
            shopify_product_id: rec.productId ?? draft.shopify_product_id,
            shopify_admin_url: rec.adminUrl ?? draft.shopify_admin_url ?? null,
            completed_at: new Date(now()).toISOString()
          })
          .eq("id", item.id)
          .eq("item_status", "processing")
          .select("id")
          .maybeSingle();
        if (closed) out.itemsReconciled += 1;
        return;
      }
    }

    const { data: failedRow } = await serviceSupabase
      .from("publish_batch_items")
      .update({
        item_status: "failed",
        error_message: PUBLISH_INTERRUPTED_ITEM_MESSAGE,
        completed_at: new Date(now()).toISOString()
      })
      .eq("id", item.id)
      .eq("item_status", "processing")
      .select("id")
      .maybeSingle();
    if (!failedRow) return; // someone else already settled it
    out.itemsFailed += 1;

    // A draft still stuck in "publishing" belongs to this dead run (unless a newer batch
    // owns it): move it to api_failed like markDraftFailed so retry/resume works.
    const ownedByThisBatch =
      !draft?.current_publish_batch_id || draft.current_publish_batch_id === batch.id;
    if (draft && draft.status === "publishing" && ownedByThisBatch) {
      await serviceSupabase
        .from("product_drafts")
        .update({
          status: "api_failed",
          pipeline_stage: mapStatusToPipelineStage("api_failed"),
          publish_status: "api_failed",
          error_message: PUBLISH_INTERRUPTED_ITEM_MESSAGE
        })
        .eq("id", item.draft_id)
        .eq("status", "publishing");
    }
  }
}

/**
 * Sweep used when a NEW batch is created (and by the cron). Never throws, and does
 * nothing in mock mode (a dry run must stay write-free).
 */
export async function recoverStalePublishBatchesBestEffort(
  serviceSupabase: PublishBatchServiceClient,
  options: RecoverStalePublishBatchesOptions & { mockMode?: boolean } = {}
): Promise<RecoverStalePublishBatchesResult | null> {
  const mockMode = options.mockMode ?? process.env.SHOPIFY_PUBLISH_MOCK !== "false";
  if (mockMode) return null;
  try {
    return await recoverStalePublishBatches(serviceSupabase, options);
  } catch {
    return null;
  }
}
