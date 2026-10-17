/**
 * D7-open: rate-limited batch publish (Q1-A server-side).
 *
 * - Creates publish_batches + items, runs publishDraft serially with ≥600ms gap
 * - Time budget 60s / stop <8s remaining → remaining items skipped (Q2-A)
 * - Never HTTP self-fetch; never rewrites publishDraft GraphQL
 * - Optional MAKE_WEBHOOK_URL publish_batch_submitted; fail never 500
 * - D6-#2: after terminal batch update → safeTryNotifyPublishBatchIfComplete
 *   (Q3b claim; notify failure never changes run ok)
 * - PUBLISH-GUARD: mock mode is a dry run. No publish_batches / items rows, no
 *   current_publish_batch_id, no Make webhook, no batch notifications; each draft
 *   only goes through publishDraft's read-only checks (see runPublishBatchDryRun).
 *
 * PUBLISH-BATCH: the same pieces also drive the stepwise mode (one request per
 * item, see publishBatchStepwise.ts):
 *   createPublishBatchRecords  header + queued items (+ draft pointer)
 *   runPublishBatchItem        publish ONE item and write its result row
 *   finalizePublishBatch       terminal header write, claimed exactly once
 * runPublishBatch below is the original one-request loop built from them.
 */

import {
  MIGRATION_027_HINT,
  MOCK_DRY_RUN_BATCH_ID,
  TIME_BUDGET_SKIP_REASON,
  buildPublishSnapshot,
  formatMockPublishBatchMessage,
  formatPublishBatchOperatorMessage,
  isMissingPublishBatchesError,
  processTagFromImageIntents,
  resolvePublishItemGapMs,
  shouldStopForTimeBudget,
  sleepMs,
  summarizePublishBatchStatus,
  type PublishBatchItemResult,
  type PublishBatchSnapshotDraft,
  PUBLISH_BATCH_DEADLINE_MS,
  PUBLISH_BATCH_MIN_REMAINING_MS
} from "@/lib/drafts/publishBatch";
import { notifyMake } from "@/lib/notifications/make";
import { safeTryNotifyPublishBatchIfComplete } from "@/lib/notifications/tryNotifyPublishBatchIfComplete";
import { checkLiveTestGuard } from "@/lib/shopify/liveTestGuard";
import { publishDraft, type PublishDraftResult } from "@/lib/shopify/publishDraft";
import { fetchAllRows } from "@/lib/supabase/fetchAllRows";
import type { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { PublishBatchStatus, PublishMode } from "@/types/domain";

export type PublishBatchServiceClient = ReturnType<typeof createServiceSupabaseClient>;

export type RunPublishBatchInput = {
  serviceSupabase: PublishBatchServiceClient;
  draftIds: string[];
  publishMode: PublishMode;
  createdBy: string | null;
  /** Inject for tests. */
  now?: () => number;
  gapMs?: number;
  deadlineMs?: number;
  minRemainingMs?: number;
  /** Inject publishDraft for unit tests. */
  publishOne?: PublishOneFn;
  /** Skip Make webhook (tests). */
  skipMakeWebhook?: boolean;
  /** Inject for tests; default = SHOPIFY_PUBLISH_MOCK is anything but exactly "false". */
  mockMode?: boolean;
  /** Single-card publish only: the operator confirmed the variant costs. */
  confirmVariantPrices?: boolean;
};

/** Per-draft options forwarded to publishDraft (same shape as its deps). */
export type PublishOneOptions = {
  confirmVariantPrices?: boolean;
  confirmedBy?: string | null;
  mockMode?: boolean;
};

export type PublishOneFn = (
  client: PublishBatchServiceClient,
  id: string,
  mode: PublishMode,
  opts?: PublishOneOptions
) => Promise<PublishDraftResult>;

export type RunPublishBatchResult =
  | {
      ok: true;
      /** true = dry run: batchId is the MOCK_DRY_RUN_BATCH_ID sentinel, nothing was written. */
      mock?: boolean;
      batchId: string;
      batchStatus: PublishBatchStatus;
      succeeded: number;
      failed: number;
      skipped: number;
      results: PublishBatchItemResult[];
      message: string;
      stoppedEarly: boolean;
      elapsedMs: number;
      makeWebhook: "sent" | "skipped" | "error";
    }
  | {
      ok: false;
      error: string;
      status: number;
      hint?: string;
      batchId?: string | null;
    };

export function draftTitle(row: {
  title_zh?: string | null;
  taobao_title?: string | null;
  original_title?: string | null;
} | null): string {
  return (
    row?.title_zh?.trim() ||
    row?.taobao_title?.trim() ||
    row?.original_title?.trim() ||
    "未命名草稿"
  );
}

/**
 * Mock-mode batch: read-only. Never touches publish_batches / publish_batch_items /
 * product_drafts, never sends Make, never calls Shopify. publishDraft itself runs
 * in dry-run mode (mockMode forwarded) and returns the checks + payload only.
 */
async function runPublishBatchDryRun(
  input: RunPublishBatchInput,
  uniqueIds: string[]
): Promise<RunPublishBatchResult> {
  const {
    serviceSupabase,
    publishMode,
    createdBy,
    now = () => Date.now(),
    deadlineMs = PUBLISH_BATCH_DEADLINE_MS,
    minRemainingMs = PUBLISH_BATCH_MIN_REMAINING_MS,
    publishOne = publishDraft,
    confirmVariantPrices = false
  } = input;
  const startedAt = now();

  const { data: drafts, error: draftError } = await serviceSupabase
    .from("product_drafts")
    .select("id, title_zh, taobao_title, original_title")
    .in("id", uniqueIds);
  if (draftError) {
    return { ok: false, error: draftError.message, status: 500 };
  }
  const draftById = new Map((drafts ?? []).map((d) => [d.id as string, d]));

  const results: PublishBatchItemResult[] = [];
  let passedCount = 0;
  let blockedCount = 0;
  let skippedCount = 0;
  let stoppedEarly = false;

  for (const id of uniqueIds) {
    const row = draftById.get(id) ?? null;
    const title = row ? draftTitle(row) : "找不到草稿";

    // No Shopify calls in a dry run, so the rate-limit gap is not needed; the
    // time budget still applies because each check reads several tables.
    if (shouldStopForTimeBudget(startedAt, now(), { deadlineMs, minRemainingMs })) {
      stoppedEarly = true;
      results.push({
        draftId: id,
        title,
        itemStatus: "skipped",
        ok: false,
        error: TIME_BUDGET_SKIP_REASON,
        mock: true,
        timeBudget: true
      });
      skippedCount += 1;
      continue;
    }

    if (!row) {
      results.push({
        draftId: id,
        title,
        itemStatus: "failed",
        ok: false,
        error: "草稿不存在或無權限",
        mock: true
      });
      blockedCount += 1;
      continue;
    }

    let pubResult: PublishDraftResult;
    try {
      pubResult = await publishOne(serviceSupabase, id, publishMode, {
        confirmVariantPrices,
        confirmedBy: createdBy,
        mockMode: true
      });
    } catch (e) {
      results.push({
        draftId: id,
        title,
        itemStatus: "failed",
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        mock: true
      });
      blockedCount += 1;
      continue;
    }

    if (pubResult.ok) {
      // Whatever publishOne returned, a dry run never reports a Shopify product.
      results.push({
        draftId: id,
        title,
        itemStatus: "done",
        ok: true,
        mock: true,
        productId: null,
        adminUrl: null,
        mockNotes: "mockNotes" in pubResult ? pubResult.mockNotes : undefined
      });
      passedCount += 1;
    } else {
      results.push({
        draftId: id,
        title,
        itemStatus: "failed",
        ok: false,
        error: pubResult.error || "發布前檢查未通過",
        mock: true,
        ...(pubResult.code ? { code: pubResult.code } : {}),
        ...(pubResult.blockers ? { blockers: pubResult.blockers } : {})
      });
      blockedCount += 1;
    }
  }

  return {
    ok: true,
    mock: true,
    batchId: MOCK_DRY_RUN_BATCH_ID,
    batchStatus: summarizePublishBatchStatus({
      total: uniqueIds.length,
      done: passedCount,
      failed: blockedCount,
      skipped: skippedCount
    }),
    succeeded: passedCount,
    failed: blockedCount,
    skipped: skippedCount,
    results,
    message: formatMockPublishBatchMessage({
      passed: passedCount,
      blocked: blockedCount,
      skipped: skippedCount
    }),
    stoppedEarly,
    elapsedMs: now() - startedAt,
    makeWebhook: "skipped"
  };
}

// ---------------------------------------------------------------------------
// PUBLISH-BATCH: reusable pieces (one-shot loop + stepwise mode)
// ---------------------------------------------------------------------------

export type PublishBatchPlanItem = {
  draftId: string;
  title: string;
  processTag: ReturnType<typeof processTagFromImageIntents>;
};

export type CreatePublishBatchRecordsResult =
  | {
      ok: true;
      batchId: string;
      ordered: PublishBatchPlanItem[];
      snapshot: PublishBatchSnapshotDraft[];
      /** Drafts that exist (and are visible), by id. */
      draftById: Map<string, Record<string, unknown>>;
    }
  | { ok: false; error: string; status: number; hint?: string; batchId?: string | null };

/**
 * Header (status "processing") + one "queued" row per draft + draft pointer.
 * Does NOT publish anything. Callers have already validated ids / live-test guard.
 */
export async function createPublishBatchRecords(input: {
  serviceSupabase: PublishBatchServiceClient;
  uniqueIds: string[];
  publishMode: PublishMode;
  createdBy: string | null;
  now?: () => number;
}): Promise<CreatePublishBatchRecordsResult> {
  const { serviceSupabase, uniqueIds, publishMode, createdBy, now = () => Date.now() } = input;

  const { data: drafts, error: draftError } = await serviceSupabase
    .from("product_drafts")
    .select("id, title_zh, taobao_title, original_title")
    .in("id", uniqueIds);

  if (draftError) {
    return { ok: false, error: draftError.message, status: 500 };
  }

  // R4 Q3-A: freeze processTag into snapshot at publish time (no migration).
  const { data: imageRows, error: imageError } = await fetchAllRows((from, to) =>
    serviceSupabase
      .from("product_images")
      .select("draft_id, image_type, process_intent")
      .in("draft_id", uniqueIds)
      .order("id")
      .range(from, to)
  );
  if (imageError) {
    return { ok: false, error: imageError.message, status: 500 };
  }

  const imagesByDraft = new Map<
    string,
    Array<{ image_type?: string | null; process_intent?: string | null }>
  >();
  for (const img of imageRows ?? []) {
    const draftId = img.draft_id as string;
    const list = imagesByDraft.get(draftId) ?? [];
    list.push({
      image_type: img.image_type as string | null,
      process_intent: img.process_intent as string | null
    });
    imagesByDraft.set(draftId, list);
  }

  const draftById = new Map(
    (drafts ?? []).map((d) => [d.id as string, d as Record<string, unknown>])
  );
  const ordered: PublishBatchPlanItem[] = [];
  for (const id of uniqueIds) {
    const row = draftById.get(id) ?? null;
    const imgs = imagesByDraft.get(id) ?? [];
    ordered.push({
      draftId: id,
      title: row ? draftTitle(row as Parameters<typeof draftTitle>[0]) : "找不到草稿",
      processTag: processTagFromImageIntents(imgs)
    });
  }

  const snapshot: PublishBatchSnapshotDraft[] = buildPublishSnapshot(ordered);
  const createNow = new Date(now()).toISOString();

  const { data: batchRow, error: batchError } = await serviceSupabase
    .from("publish_batches")
    .insert({
      kind: "shopify_api",
      status: "processing",
      publish_mode: publishMode,
      total_count: ordered.length,
      done_count: 0,
      failed_count: 0,
      created_by: createdBy,
      created_at: createNow,
      updated_at: createNow,
      started_at: createNow,
      snapshot_json: snapshot
    })
    .select("id")
    .single();

  if (batchError || !batchRow) {
    const msg = batchError?.message ?? "建立發布批次失敗";
    return {
      ok: false,
      error: msg,
      status: 500,
      hint: isMissingPublishBatchesError(msg) ? MIGRATION_027_HINT : undefined,
      batchId: null
    };
  }

  const batchId = batchRow.id as string;

  const itemRows = ordered.map((item) => ({
    batch_id: batchId,
    draft_id: item.draftId,
    item_status: "queued" as const,
    created_at: createNow
  }));

  const { error: itemsError } = await serviceSupabase.from("publish_batch_items").insert(itemRows);
  if (itemsError) {
    const msg = itemsError.message;
    await serviceSupabase
      .from("publish_batches")
      .update({
        status: "failed",
        error_summary: msg.slice(0, 500),
        completed_at: new Date(now()).toISOString(),
        updated_at: new Date(now()).toISOString()
      })
      .eq("id", batchId);
    return {
      ok: false,
      error: msg,
      status: 500,
      hint: isMissingPublishBatchesError(msg) ? MIGRATION_027_HINT : undefined,
      batchId
    };
  }

  // Point drafts at this batch (best-effort; column may be missing if 027 partial)
  for (const item of ordered) {
    try {
      await serviceSupabase
        .from("product_drafts")
        .update({ current_publish_batch_id: batchId })
        .eq("id", item.draftId);
    } catch {
      // ignore missing column / RLS
    }
  }

  return { ok: true, batchId, ordered, snapshot, draftById };
}

/**
 * Publish ONE item of a batch and write its result row (done / failed).
 * `alreadyClaimed` = the stepwise route already moved the row queued → processing
 * with a conditional update, so this must not flip it again.
 */
export async function runPublishBatchItem(input: {
  serviceSupabase: PublishBatchServiceClient;
  batchId: string;
  draftId: string;
  title: string;
  /** false → "草稿不存在或無權限" without calling publishDraft. */
  draftExists: boolean;
  publishMode: PublishMode;
  createdBy: string | null;
  publishOne?: PublishOneFn;
  confirmVariantPrices?: boolean;
  now?: () => number;
  alreadyClaimed?: boolean;
}): Promise<PublishBatchItemResult> {
  const {
    serviceSupabase,
    batchId,
    draftId,
    title,
    draftExists,
    publishMode,
    createdBy,
    publishOne = publishDraft,
    confirmVariantPrices = false,
    now = () => Date.now(),
    alreadyClaimed = false
  } = input;

  const writeItem = (patch: Record<string, unknown>) =>
    serviceSupabase
      .from("publish_batch_items")
      .update(patch)
      .eq("batch_id", batchId)
      .eq("draft_id", draftId);

  if (!draftExists) {
    const err = "草稿不存在或無權限";
    await writeItem({
      item_status: "failed",
      error_message: err,
      completed_at: new Date(now()).toISOString()
    });
    return { draftId, title, itemStatus: "failed", ok: false, error: err };
  }

  if (!alreadyClaimed) {
    await writeItem({ item_status: "processing" });
  }

  let pubResult: PublishDraftResult;
  try {
    pubResult = await publishOne(serviceSupabase, draftId, publishMode, {
      confirmVariantPrices,
      confirmedBy: createdBy,
      // The batch already decided live; publishDraft must not re-read the env.
      mockMode: false
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    await writeItem({
      item_status: "failed",
      error_message: err.slice(0, 500),
      completed_at: new Date(now()).toISOString()
    });
    return { draftId, title, itemStatus: "failed", ok: false, error: err };
  }

  if (pubResult.ok) {
    const productId = "productId" in pubResult ? pubResult.productId : null;
    const adminUrl = "adminUrl" in pubResult ? pubResult.adminUrl : null;
    const mock = "mock" in pubResult && pubResult.mock === true;
    const reconciled = "code" in pubResult && pubResult.code === "RECONCILED";
    const warnings = "warnings" in pubResult && pubResult.warnings?.length ? pubResult.warnings : undefined;
    await writeItem({
      item_status: "done",
      error_message: null,
      shopify_product_id: productId ?? null,
      shopify_admin_url: adminUrl ?? null,
      completed_at: new Date(now()).toISOString()
    });
    return {
      draftId,
      title,
      itemStatus: "done",
      ok: true,
      mock: mock || undefined,
      productId: productId ?? null,
      adminUrl: adminUrl ?? null,
      ...(reconciled ? { reconciled: true } : {}),
      ...(warnings ? { warnings } : {})
    };
  }

  const err = pubResult.error || "發布失敗";
  await writeItem({
    item_status: "failed",
    error_message: err.slice(0, 500),
    completed_at: new Date(now()).toISOString()
  });
  return {
    draftId,
    title,
    itemStatus: "failed",
    ok: false,
    error: err,
    // PUBLISH-GUARD: readiness blockers travel with the item (HTTP 409 semantics).
    ...(pubResult.code ? { code: pubResult.code } : {}),
    ...(pubResult.blockers ? { blockers: pubResult.blockers } : {})
  };
}

export type PublishBatchItemCounts = {
  total: number;
  done: number;
  failed: number;
  skipped: number;
  queued: number;
  processing: number;
};

export async function getPublishBatchItemCounts(
  serviceSupabase: PublishBatchServiceClient,
  batchId: string
): Promise<PublishBatchItemCounts> {
  const { data } = await serviceSupabase
    .from("publish_batch_items")
    .select("item_status")
    .eq("batch_id", batchId);
  const counts: PublishBatchItemCounts = {
    total: 0,
    done: 0,
    failed: 0,
    skipped: 0,
    queued: 0,
    processing: 0
  };
  for (const row of (data ?? []) as Array<{ item_status?: string }>) {
    counts.total += 1;
    switch (row.item_status) {
      case "done":
        counts.done += 1;
        break;
      case "failed":
        counts.failed += 1;
        break;
      case "skipped":
        counts.skipped += 1;
        break;
      case "processing":
        counts.processing += 1;
        break;
      default:
        counts.queued += 1;
    }
  }
  return counts;
}

export type FinalizePublishBatchInput = {
  serviceSupabase: PublishBatchServiceClient;
  batchId: string;
  publishMode: PublishMode;
  /** One-shot passes its in-memory tally; stepwise/recovery leave it out (read from items). */
  counts?: { total: number; done: number; failed: number; skipped: number };
  stoppedEarly?: boolean;
  /** Why items were skipped, for error_summary. Default: time budget. */
  skipNote?: string;
  /** Result list for the Make payload; default = derived from the item rows. */
  results?: PublishBatchItemResult[];
  /** Default = read from the batch header. */
  snapshot?: PublishBatchSnapshotDraft[];
  now?: () => number;
  skipMakeWebhook?: boolean;
};

export type FinalizePublishBatchResult = {
  /** true = THIS call performed the processing → terminal transition (and sent the notices). */
  claimed: boolean;
  batchStatus: PublishBatchStatus;
  counts: { total: number; done: number; failed: number; skipped: number };
  makeWebhook: "sent" | "skipped" | "error";
};

/**
 * Terminal header write + notifications. The write is conditional on
 * status = 'processing', so however many tabs / recovery sweeps race here,
 * exactly one caller wins and only the winner sends the notification and the
 * Make webhook.
 */
export async function finalizePublishBatch(
  input: FinalizePublishBatchInput
): Promise<FinalizePublishBatchResult> {
  const {
    serviceSupabase,
    batchId,
    publishMode,
    now = () => Date.now(),
    stoppedEarly = false,
    skipNote = "時間不足",
    skipMakeWebhook = false
  } = input;

  let tally = input.counts;
  if (!tally) {
    const fromDb = await getPublishBatchItemCounts(serviceSupabase, batchId);
    tally = {
      total: fromDb.total,
      done: fromDb.done,
      failed: fromDb.failed,
      // Anything still queued/processing at this point is abandoned work.
      skipped: fromDb.skipped + fromDb.queued + fromDb.processing
    };
  }
  const doneCount = tally.done;
  const failedCount = tally.failed;
  const skippedCount = tally.skipped;

  const batchStatus = summarizePublishBatchStatus({
    total: tally.total,
    done: doneCount,
    failed: failedCount,
    skipped: skippedCount
  });

  const errorSummaryParts: string[] = [];
  if (failedCount > 0) errorSummaryParts.push(`失敗 ${failedCount}`);
  if (skippedCount > 0) errorSummaryParts.push(`略過 ${skippedCount}（${skipNote}）`);
  const completedAt = new Date(now()).toISOString();

  const { data: claimedRow, error: claimError } = await serviceSupabase
    .from("publish_batches")
    .update({
      status: batchStatus,
      done_count: doneCount,
      failed_count: failedCount,
      error_summary: errorSummaryParts.length ? errorSummaryParts.join("；") : null,
      completed_at: completedAt,
      updated_at: completedAt
      // notify_sent_at claimed only by tryNotify when ≥1 channel sent (Q3b)
    })
    .eq("id", batchId)
    .eq("status", "processing")
    .select("id")
    .maybeSingle();

  const claimed = !claimError && Boolean(claimedRow?.id);
  if (!claimed) {
    return { claimed: false, batchStatus, counts: tally, makeWebhook: "skipped" };
  }

  // Event #2: after terminal write; never throws into publish result
  await safeTryNotifyPublishBatchIfComplete(batchId, { serviceSupabase });

  let makeWebhook: "sent" | "skipped" | "error" = "skipped";
  if (!skipMakeWebhook && process.env.MAKE_WEBHOOK_URL) {
    try {
      let snapshot = input.snapshot;
      let results = input.results;
      if (!snapshot || !results) {
        const [{ data: header }, { data: itemRows }] = await Promise.all([
          serviceSupabase
            .from("publish_batches")
            .select("snapshot_json")
            .eq("id", batchId)
            .maybeSingle(),
          serviceSupabase
            .from("publish_batch_items")
            .select("draft_id, item_status, error_message, shopify_product_id")
            .eq("batch_id", batchId)
        ]);
        snapshot = snapshot ?? ((header?.snapshot_json as PublishBatchSnapshotDraft[] | null) ?? []);
        const titleById = new Map(snapshot.map((s) => [s.draftId, s.title]));
        results =
          results ??
          ((itemRows ?? []) as Array<{
            draft_id: string;
            item_status: PublishBatchItemResult["itemStatus"];
            error_message?: string | null;
            shopify_product_id?: string | null;
          }>).map((row) => ({
            draftId: row.draft_id,
            title: titleById.get(row.draft_id) ?? "未命名草稿",
            itemStatus: row.item_status,
            ok: row.item_status === "done",
            error: row.error_message ?? undefined,
            productId: row.shopify_product_id ?? null
          }));
      }
      await notifyMake("publish_batch_submitted", {
        batchId,
        publishMode,
        batchStatus,
        totalCount: tally.total,
        doneCount,
        failedCount,
        skippedCount,
        stoppedEarly,
        snapshot,
        results: results.map((r) => ({
          draftId: r.draftId,
          itemStatus: r.itemStatus,
          ok: r.ok,
          error: r.error ?? null,
          productId: r.productId ?? null
        }))
      });
      makeWebhook = "sent";
    } catch {
      makeWebhook = "error";
    }
  }

  return { claimed: true, batchStatus, counts: tally, makeWebhook };
}

// ---------------------------------------------------------------------------
// One-shot batch (original behaviour: everything inside ONE request)
// ---------------------------------------------------------------------------

export async function runPublishBatch(
  input: RunPublishBatchInput
): Promise<RunPublishBatchResult> {
  const {
    serviceSupabase,
    publishMode,
    createdBy,
    now = () => Date.now(),
    deadlineMs = PUBLISH_BATCH_DEADLINE_MS,
    minRemainingMs = PUBLISH_BATCH_MIN_REMAINING_MS,
    publishOne = publishDraft,
    skipMakeWebhook = false,
    confirmVariantPrices = false
  } = input;
  const mockMode = input.mockMode ?? process.env.SHOPIFY_PUBLISH_MOCK !== "false";

  const gapMs = input.gapMs ?? resolvePublishItemGapMs();
  const uniqueIds = [...new Set(input.draftIds.filter((id) => typeof id === "string" && id.length > 0))];

  if (uniqueIds.length === 0) {
    return { ok: false, error: "draftIds must be a non-empty string array", status: 400 };
  }

  // Defense-in-depth for non-HTTP callers: a configured live-test allowlist
  // must not be bypassed by invoking the batch runner directly.
  const liveTestGuardError = checkLiveTestGuard({ draftIds: uniqueIds, publishMode });
  if (liveTestGuardError) {
    return { ok: false, error: liveTestGuardError, status: 403 };
  }

  if (mockMode) {
    return runPublishBatchDryRun(input, uniqueIds);
  }

  const startedAt = now();

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
  const { batchId, ordered, snapshot, draftById } = created;

  const results: PublishBatchItemResult[] = [];
  let doneCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let stoppedEarly = false;
  let firstItem = true;

  for (const item of ordered) {
    if (shouldStopForTimeBudget(startedAt, now(), { deadlineMs, minRemainingMs })) {
      stoppedEarly = true;
      const completedAt = new Date(now()).toISOString();
      await serviceSupabase
        .from("publish_batch_items")
        .update({
          item_status: "skipped",
          error_message: TIME_BUDGET_SKIP_REASON,
          completed_at: completedAt
        })
        .eq("batch_id", batchId)
        .eq("draft_id", item.draftId);

      results.push({
        draftId: item.draftId,
        title: item.title,
        itemStatus: "skipped",
        ok: false,
        error: TIME_BUDGET_SKIP_REASON,
        timeBudget: true
      });
      skippedCount += 1;
      continue;
    }

    if (!firstItem && gapMs > 0) {
      await sleepMs(gapMs);
      // Re-check budget after sleep
      if (shouldStopForTimeBudget(startedAt, now(), { deadlineMs, minRemainingMs })) {
        stoppedEarly = true;
        const completedAt = new Date(now()).toISOString();
        await serviceSupabase
          .from("publish_batch_items")
          .update({
            item_status: "skipped",
            error_message: TIME_BUDGET_SKIP_REASON,
            completed_at: completedAt
          })
          .eq("batch_id", batchId)
          .eq("draft_id", item.draftId);

        results.push({
          draftId: item.draftId,
          title: item.title,
          itemStatus: "skipped",
          ok: false,
          error: TIME_BUDGET_SKIP_REASON,
          timeBudget: true
        });
        skippedCount += 1;
        // Mark rest without sleeping again
        const rest = ordered.slice(ordered.indexOf(item) + 1);
        for (const r of rest) {
          await serviceSupabase
            .from("publish_batch_items")
            .update({
              item_status: "skipped",
              error_message: TIME_BUDGET_SKIP_REASON,
              completed_at: new Date(now()).toISOString()
            })
            .eq("batch_id", batchId)
            .eq("draft_id", r.draftId);
          results.push({
            draftId: r.draftId,
            title: r.title,
            itemStatus: "skipped",
            ok: false,
            error: TIME_BUDGET_SKIP_REASON,
            timeBudget: true
          });
          skippedCount += 1;
        }
        break;
      }
    }
    firstItem = false;

    const itemResult = await runPublishBatchItem({
      serviceSupabase,
      batchId,
      draftId: item.draftId,
      title: item.title,
      draftExists: draftById.has(item.draftId),
      publishMode,
      createdBy,
      publishOne,
      confirmVariantPrices,
      now
    });
    results.push(itemResult);
    if (itemResult.ok) doneCount += 1;
    else failedCount += 1;
  }

  // If we stopped early via continue loop, remaining ordered items may still be queued
  const handledIds = new Set(results.map((r) => r.draftId));
  for (const item of ordered) {
    if (handledIds.has(item.draftId)) continue;
    stoppedEarly = true;
    await serviceSupabase
      .from("publish_batch_items")
      .update({
        item_status: "skipped",
        error_message: TIME_BUDGET_SKIP_REASON,
        completed_at: new Date(now()).toISOString()
      })
      .eq("batch_id", batchId)
      .eq("draft_id", item.draftId);
    results.push({
      draftId: item.draftId,
      title: item.title,
      itemStatus: "skipped",
      ok: false,
      error: TIME_BUDGET_SKIP_REASON,
      timeBudget: true
    });
    skippedCount += 1;
  }

  const finalized = await finalizePublishBatch({
    serviceSupabase,
    batchId,
    publishMode,
    counts: { total: ordered.length, done: doneCount, failed: failedCount, skipped: skippedCount },
    stoppedEarly,
    results,
    snapshot,
    now,
    skipMakeWebhook
  });

  const message = formatPublishBatchOperatorMessage({
    succeeded: doneCount,
    failed: failedCount,
    skipped: skippedCount,
    batchStatus: finalized.batchStatus,
    publishMode
  });

  return {
    ok: true,
    batchId,
    batchStatus: finalized.batchStatus,
    succeeded: doneCount,
    failed: failedCount,
    skipped: skippedCount,
    results,
    message,
    stoppedEarly,
    elapsedMs: now() - startedAt,
    makeWebhook: finalized.makeWebhook
  };
}
