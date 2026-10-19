/**
 * PUBLISH-BATCH: stepwise batch publish — every item gets its OWN request.
 *
 *   createStepwisePublishBatch  validate exactly like the one-shot batch, write the
 *                               header + queued items, publish NOTHING, return at once.
 *   stepPublishBatch            claim ONE queued item (conditional update, so two tabs
 *                               can never take the same item), publish it through the
 *                               same runPublishBatchItem → publishDraft path, bump the
 *                               header; when nothing is left, finalize the batch once.
 *
 * Mock mode stays a dry run: createStepwisePublishBatch hands it to runPublishBatch's
 * read-only dry run (no rows, no Shopify, no Make) and the response says mock:true.
 */
import {
  MOCK_DRY_RUN_BATCH_ID,
  PUBLISH_IDLE_BATCH_MS,
  PUBLISH_STALE_ITEM_MS,
  formatPublishBatchOperatorMessage,
  type PublishBatchItemResult
} from "@/lib/drafts/publishBatch";
import { checkLiveTestGuard } from "@/lib/shopify/liveTestGuard";
import {
  checkPublishReadiness,
  formatPublishBlockMessage,
  type ReadinessVariantRow
} from "@/lib/shopify/publishReadiness";
import {
  recoverStalePublishBatches,
  type RecoverStalePublishBatchesOptions
} from "@/lib/shopify/recoverStalePublishBatches";
import {
  createPublishBatchRecords,
  finalizePublishBatch,
  getPublishBatchItemCounts,
  runPublishBatch,
  runPublishBatchItem,
  type PublishBatchItemCounts,
  type PublishBatchServiceClient,
  type PublishOneFn,
  type RunPublishBatchInput,
  type RunPublishBatchResult
} from "@/lib/shopify/runPublishBatch";
import { fetchAllRows } from "@/lib/supabase/fetchAllRows";
import type { PublishBatchStatus, PublishMode } from "@/types/domain";

export type StepwiseCreateResult =
  | {
      ok: true;
      mock: false;
      batchId: string;
      batchStatus: "processing";
      total: number;
      publishMode: PublishMode;
      items: Array<{ draftId: string; itemStatus: "queued" }>;
      /** Items the pre-publish readiness check already failed (never sent to Shopify). */
      preflightBlocked: Array<{ draftId: string; title: string; error: string }>;
    }
  // Mock dry run: the complete one-shot answer (nothing was written).
  | Extract<RunPublishBatchResult, { ok: true }>
  | Extract<RunPublishBatchResult, { ok: false }>;

export async function createStepwisePublishBatch(
  input: RunPublishBatchInput
): Promise<StepwiseCreateResult> {
  const { serviceSupabase, publishMode, createdBy, now = () => Date.now() } = input;
  const mockMode = input.mockMode ?? process.env.SHOPIFY_PUBLISH_MOCK !== "false";
  const uniqueIds = [
    ...new Set(input.draftIds.filter((id) => typeof id === "string" && id.length > 0))
  ];

  if (uniqueIds.length === 0) {
    return { ok: false, error: "draftIds must be a non-empty string array", status: 400 };
  }
  const liveTestGuardError = checkLiveTestGuard({ draftIds: uniqueIds, publishMode });
  if (liveTestGuardError) {
    return { ok: false, error: liveTestGuardError, status: 403 };
  }

  if (mockMode) {
    // PUBLISH-GUARD dry run: unchanged, read-only, answered in this one request.
    return runPublishBatch({ ...input, mockMode: true });
  }

  const created = await createPublishBatchRecords({
    serviceSupabase,
    uniqueIds,
    publishMode,
    createdBy,
    now
  });
  if (!created.ok) {
    return {
      ok: false,
      error: created.error,
      status: created.status,
      hint: created.hint,
      batchId: created.batchId ?? null
    };
  }
  const preflightBlocked = await preflightBlockItems(
    serviceSupabase,
    created.batchId,
    created.ordered,
    now
  );
  return {
    ok: true,
    mock: false,
    batchId: created.batchId,
    batchStatus: "processing",
    total: created.ordered.length,
    publishMode,
    items: created.ordered.map((item) => ({ draftId: item.draftId, itemStatus: "queued" as const })),
    preflightBlocked
  };
}

/**
 * Run the pure readiness check over the whole batch once, so a draft that publishDraft would
 * refuse is failed up front (no Shopify call, draft untouched). A read error skips the
 * preflight: publishDraft still runs the same check per item.
 */
async function preflightBlockItems(
  serviceSupabase: PublishBatchServiceClient,
  batchId: string,
  ordered: Array<{ draftId: string; title: string }>,
  now: () => number
): Promise<Array<{ draftId: string; title: string; error: string }>> {
  const ids = ordered.map((item) => item.draftId);
  const { data: draftRows, error: draftError } = await fetchAllRows((from, to) =>
    serviceSupabase
      .from("product_drafts")
      .select("id, cny_price, twd_price, raw_capture")
      .in("id", ids)
      .order("id")
      .range(from, to)
  );
  if (draftError || !draftRows) return [];
  const { data: variantRows, error: variantError } = await fetchAllRows((from, to) =>
    serviceSupabase
      .from("product_variants")
      .select("*")
      .in("draft_id", ids)
      .order("draft_id")
      .order("sort_order", { ascending: true })
      .order("id")
      .range(from, to)
  );
  if (variantError || !variantRows) return [];

  const variantsByDraft = new Map<string, ReadinessVariantRow[]>();
  for (const row of variantRows as Array<ReadinessVariantRow & { draft_id: string }>) {
    const list = variantsByDraft.get(row.draft_id) ?? [];
    list.push(row);
    variantsByDraft.set(row.draft_id, list);
  }
  const draftById = new Map(
    (draftRows as Array<{ id: string; cny_price: unknown; twd_price: unknown; raw_capture: unknown }>).map(
      (row) => [row.id, row] as const
    )
  );

  const blocked: Array<{ draftId: string; title: string; error: string }> = [];
  for (const item of ordered) {
    const draft = draftById.get(item.draftId);
    if (!draft) continue; // missing drafts are failed by runPublishBatchItem
    const readiness = checkPublishReadiness(draft, variantsByDraft.get(item.draftId) ?? [], {
      confirmVariantPrices: false
    });
    if (!readiness.blocked) continue;
    const error = "發布前檢查擋下：" + formatPublishBlockMessage(readiness.blockers);
    const { error: writeError } = await serviceSupabase
      .from("publish_batch_items")
      .update({
        item_status: "failed",
        error_message: error.slice(0, 500),
        completed_at: new Date(now()).toISOString()
      })
      .eq("batch_id", batchId)
      .eq("draft_id", item.draftId)
      .eq("item_status", "queued");
    if (writeError) continue; // stays queued; publishDraft blocks it at its own turn
    blocked.push({ draftId: item.draftId, title: item.title, error });
  }
  return blocked;
}

export type StepPublishBatchInput = {
  serviceSupabase: PublishBatchServiceClient;
  batchId: string;
  /** The signed-in user running this step (becomes confirmedBy, like the one-shot createdBy). */
  actorId: string | null;
  now?: () => number;
  publishOne?: PublishOneFn;
  skipMakeWebhook?: boolean;
  staleItemMs?: number;
  idleBatchMs?: number;
  /** Forwarded to recoverStalePublishBatches (tests inject a fake Shopify caller). */
  recover?: Pick<RecoverStalePublishBatchesOptions, "caller" | "reconcile">;
};

export type StepProcessedItem = {
  draftId: string;
  title: string;
  itemStatus: PublishBatchItemResult["itemStatus"];
  ok: boolean;
  error?: string;
  code?: PublishBatchItemResult["code"];
  blockers?: PublishBatchItemResult["blockers"];
  productId?: string | null;
  adminUrl?: string | null;
  reconciled?: boolean;
  warnings?: string[];
};

export type StepCounts = PublishBatchItemCounts;

export type StepPublishBatchResult =
  | {
      ok: true;
      batchId: string;
      batchStatus: PublishBatchStatus;
      /** true = the batch is terminal; stop calling step. */
      done: boolean;
      /** The item this call published, or null (nothing claimable / batch finished). */
      processed: StepProcessedItem | null;
      counts: StepCounts;
      /** Present on every done:true answer (operator wording, same as the one-shot batch). */
      message?: string;
    }
  | { ok: false; error: string; status: number };

const TERMINAL_BATCH_STATUSES = ["completed", "partial_failed", "failed"];

type HeaderRow = {
  id: string;
  status: PublishBatchStatus;
  publish_mode: string | null;
  snapshot_json: unknown;
};

async function loadHeader(
  serviceSupabase: PublishBatchServiceClient,
  batchId: string
): Promise<HeaderRow | null> {
  const { data } = await serviceSupabase
    .from("publish_batches")
    .select("id, status, publish_mode, snapshot_json")
    .eq("id", batchId)
    .maybeSingle();
  return (data as HeaderRow | null) ?? null;
}

function toCounts(c: PublishBatchItemCounts): StepCounts {
  return {
    total: c.total,
    done: c.done,
    failed: c.failed,
    skipped: c.skipped,
    queued: c.queued,
    processing: c.processing
  };
}

export async function stepPublishBatch(input: StepPublishBatchInput): Promise<StepPublishBatchResult> {
  const {
    serviceSupabase,
    batchId,
    actorId,
    now = () => Date.now(),
    publishOne,
    skipMakeWebhook = false,
    staleItemMs = PUBLISH_STALE_ITEM_MS,
    idleBatchMs = PUBLISH_IDLE_BATCH_MS
  } = input;

  if (!batchId || batchId === MOCK_DRY_RUN_BATCH_ID) {
    return { ok: false, error: "模擬批次沒有可執行的步驟", status: 400 };
  }

  let header = await loadHeader(serviceSupabase, batchId);
  if (!header) return { ok: false, error: "找不到發布批次", status: 404 };

  const publishMode: PublishMode = header.publish_mode === "active" ? "active" : "draft";

  const finishedResponse = async (status: PublishBatchStatus): Promise<StepPublishBatchResult> => {
    const counts = await getPublishBatchItemCounts(serviceSupabase, batchId);
    return {
      ok: true,
      batchId,
      batchStatus: status,
      done: true,
      processed: null,
      counts: toCounts(counts),
      message: formatPublishBatchOperatorMessage({
        succeeded: counts.done,
        failed: counts.failed,
        skipped: counts.skipped,
        batchStatus: status,
        publishMode
      })
    };
  };

  if (TERMINAL_BATCH_STATUSES.includes(header.status)) {
    return finishedResponse(header.status);
  }

  // Defense in depth for non-HTTP callers: the live-test guard covers every draft of the batch.
  const { data: allItemRows } = await serviceSupabase
    .from("publish_batch_items")
    .select("draft_id")
    .eq("batch_id", batchId);
  const guardError = checkLiveTestGuard({
    draftIds: ((allItemRows ?? []) as Array<{ draft_id: string }>).map((r) => r.draft_id),
    publishMode
  });
  if (guardError) return { ok: false, error: guardError, status: 403 };

  // A killed earlier step must be settled BEFORE claiming more work.
  try {
    await recoverStalePublishBatches(serviceSupabase, {
      batchId,
      staleItemMs,
      idleBatchMs,
      now,
      skipMakeWebhook,
      ...(input.recover ?? {})
    });
  } catch {
    // recovery is best-effort; the claim below is still safe
  }
  header = await loadHeader(serviceSupabase, batchId);
  if (!header) return { ok: false, error: "找不到發布批次", status: 404 };
  if (TERMINAL_BATCH_STATUSES.includes(header.status)) {
    return finishedResponse(header.status);
  }

  const claimed = await claimNextQueuedItem(serviceSupabase, batchId, now);
  if (!claimed) {
    const counts = await getPublishBatchItemCounts(serviceSupabase, batchId);
    if (counts.queued === 0 && counts.processing === 0) {
      const finalized = await finalizePublishBatch({
        serviceSupabase,
        batchId,
        publishMode,
        now,
        skipMakeWebhook
      });
      const finalStatus = finalized.claimed
        ? finalized.batchStatus
        : ((await loadHeader(serviceSupabase, batchId))?.status ?? finalized.batchStatus);
      return {
        ok: true,
        batchId,
        batchStatus: finalStatus,
        done: true,
        processed: null,
        counts: toCounts(await getPublishBatchItemCounts(serviceSupabase, batchId)),
        message: formatPublishBatchOperatorMessage({
          succeeded: counts.done,
          failed: counts.failed,
          skipped: counts.skipped,
          batchStatus: finalStatus,
          publishMode
        })
      };
    }
    // Another tab is publishing the remaining item(s) right now.
    return {
      ok: true,
      batchId,
      batchStatus: header.status,
      done: false,
      processed: null,
      counts: toCounts(counts)
    };
  }

  const titleById = new Map(
    (Array.isArray(header.snapshot_json) ? (header.snapshot_json as Array<{ draftId: string; title: string }>) : []).map(
      (s) => [s.draftId, s.title] as const
    )
  );
  const { data: draftRow } = await serviceSupabase
    .from("product_drafts")
    .select("id")
    .eq("id", claimed.draft_id)
    .maybeSingle();

  const result = await runPublishBatchItem({
    serviceSupabase,
    batchId,
    draftId: claimed.draft_id,
    title: titleById.get(claimed.draft_id) ?? "未命名草稿",
    draftExists: Boolean(draftRow?.id),
    publishMode,
    createdBy: actorId,
    ...(publishOne ? { publishOne } : {}),
    now,
    alreadyClaimed: true
  });

  const counts = await getPublishBatchItemCounts(serviceSupabase, batchId);
  await serviceSupabase
    .from("publish_batches")
    .update({
      done_count: counts.done,
      failed_count: counts.failed,
      updated_at: new Date(now()).toISOString()
    })
    .eq("id", batchId)
    .eq("status", "processing");

  return {
    ok: true,
    batchId,
    batchStatus: "processing",
    done: false,
    processed: {
      draftId: result.draftId,
      title: result.title,
      itemStatus: result.itemStatus,
      ok: result.ok,
      ...(result.error ? { error: result.error } : {}),
      ...(result.code ? { code: result.code } : {}),
      ...(result.blockers ? { blockers: result.blockers } : {}),
      productId: result.productId ?? null,
      adminUrl: result.adminUrl ?? null,
      ...(result.reconciled ? { reconciled: true } : {}),
      ...(result.warnings ? { warnings: result.warnings } : {})
    },
    counts: toCounts(counts)
  };
}

/**
 * Claim the oldest runnable item without skipping work already in progress. The single
 * ordered read puts `processing` before `queued`; if another request owns that item, this
 * request waits instead of racing ahead to a later draft. The conditional update remains
 * the claim CAS. Also bumps the batch header's updated_at (the stale-recovery liveness clock).
 */
async function claimNextQueuedItem(
  serviceSupabase: PublishBatchServiceClient,
  batchId: string,
  now: () => number
): Promise<{ id: string; draft_id: string } | null> {
  const { data: candidates, error: candidatesError } = await serviceSupabase
    .from("publish_batch_items")
    .select("id, draft_id, item_status, attempt_count")
    .eq("batch_id", batchId)
    .in("item_status", ["processing", "queued"])
    .order("item_status", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1);

  if (candidatesError) throw new Error(`讀取待發布項目失敗：${candidatesError.message}`);
  if (!candidates?.length) return null;
  const candidate = (
    candidates as Array<{ id: string; draft_id: string; item_status: string; attempt_count: number | null }>
  )[0];
  if (candidate.item_status === "processing") return null;
  const attemptCount = candidate.attempt_count ?? 0;

  const { data: won, error } = await serviceSupabase
    .from("publish_batch_items")
    .update({
      item_status: "processing",
      attempt_count: attemptCount + 1,
      started_at: new Date(now()).toISOString()
    })
    .eq("id", candidate.id)
    .eq("item_status", "queued")
    .eq("attempt_count", attemptCount)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`發布項目領取失敗：${error.message}`);
  if (!won?.id) return null;

  await serviceSupabase
    .from("publish_batches")
    .update({ updated_at: new Date(now()).toISOString() })
    .eq("id", batchId)
    .eq("status", "processing");
  return { id: candidate.id, draft_id: candidate.draft_id };
}
