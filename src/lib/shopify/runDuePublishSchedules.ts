import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import {
  isMissingScheduleTablesError,
  scheduleExecutionEnabled,
  SCHEDULE_MIGRATION_HINT,
  taipeiDateOnly
} from "@/lib/drafts/publishScheduleCore";
import { isRealShopifyProductId } from "@/lib/shopify/productLifecycle";
import { runPublishBatch } from "@/lib/shopify/runPublishBatch";
import type { createServiceSupabaseClient } from "@/lib/supabase/server";

type ServiceSupabase = ReturnType<typeof createServiceSupabaseClient>;

const BLOCKING_SYNC = new Set([
  "dirty",
  "syncing",
  "conflict",
  "error",
  "partial",
  "remote_deleted"
]);

export async function runDuePublishSchedules(input: {
  serviceSupabase: ServiceSupabase;
  dueDate?: string;
  claimLimit?: number;
}) {
  const dueDate = input.dueDate ?? taipeiDateOnly();
  const claimLimit = Math.max(1, Math.min(input.claimLimit ?? 50, 200));

  if (!scheduleExecutionEnabled()) {
    const { data, error } = await input.serviceSupabase
      .from("publish_schedule_items")
      .select("id,group_id,draft_id,scheduled_for,position,status")
      .eq("status", "queued")
      .lte("scheduled_for", dueDate)
      .order("scheduled_for", { ascending: true })
      .order("position", { ascending: true })
      .limit(claimLimit);

    if (error) {
      return {
        ok: false as const,
        status: isMissingScheduleTablesError(error.message) ? 503 : 500,
        error: error.message,
        hint: isMissingScheduleTablesError(error.message) ? SCHEDULE_MIGRATION_HINT : undefined
      };
    }

    return {
      ok: true as const,
      dryRun: true,
      dueDate,
      dueCount: (data ?? []).length,
      items: data ?? [],
      message: "PUBLISH_SCHEDULE_EXECUTION_ENABLED is not true; no items were claimed and no Shopify write was sent."
    };
  }

  const { data: claimed, error: claimError } = await input.serviceSupabase.rpc(
    "claim_due_publish_schedule_items",
    { p_due_date: dueDate, p_limit: claimLimit }
  );

  if (claimError) {
    return {
      ok: false as const,
      status: isMissingScheduleTablesError(claimError.message) ? 503 : 500,
      error: claimError.message,
      hint: isMissingScheduleTablesError(claimError.message) ? SCHEDULE_MIGRATION_HINT : undefined
    };
  }

  const claimedItems = (claimed ?? []) as Array<{
    id: string;
    group_id: string;
    draft_id: string;
    scheduled_for: string;
    position: number;
  }>;

  if (!claimedItems.length) {
    return { ok: true as const, dryRun: false, dueDate, claimed: 0, completed: 0, failed: 0, blocked: 0 };
  }

  const draftIds = claimedItems.map((item) => item.draft_id);
  const { data: drafts, error: draftError } = await input.serviceSupabase
    .from("product_drafts")
    .select("id,status,shopify_product_id,shopify_sync_status")
    .in("id", draftIds);

  if (draftError) {
    await input.serviceSupabase
      .from("publish_schedule_items")
      .update({ status: "queued", claimed_at: null, error_message: draftError.message, updated_at: new Date().toISOString() })
      .in("id", claimedItems.map((item) => item.id));
    return { ok: false as const, status: 500, error: draftError.message };
  }

  const byId = new Map((drafts ?? []).map((draft) => [draft.id as string, draft]));
  const eligible: string[] = [];
  const blocked: Array<{ itemId: string; draftId: string; reason: string }> = [];

  for (const item of claimedItems) {
    const draft = byId.get(item.draft_id) as any;
    let reason: string | null = null;
    if (!draft) reason = "找不到商品草稿";
    else if (draft.status !== "draft_created") reason = "商品尚未完成 Shopify DRAFT staging";
    else if (!isRealShopifyProductId(draft.shopify_product_id)) reason = "缺少真實 Shopify product ID";
    else if (draft.shopify_sync_status && BLOCKING_SYNC.has(draft.shopify_sync_status)) {
      reason = `Shopify sync 狀態為 ${draft.shopify_sync_status}，禁止自動公開舊版本`;
    }

    if (reason) {
      blocked.push({ itemId: item.id, draftId: item.draft_id, reason });
      await input.serviceSupabase
        .from("publish_schedule_items")
        .update({
          status: "blocked",
          error_message: reason,
          updated_at: new Date().toISOString()
        })
        .eq("id", item.id);
    } else {
      eligible.push(item.draft_id);
    }
  }

  let completed = 0;
  let failed = 0;
  let batchId: string | null = null;

  if (eligible.length) {
    const result = await runPublishBatch({
      serviceSupabase: input.serviceSupabase,
      draftIds: eligible,
      publishMode: "active",
      createdBy: null
    });

    if (!result.ok) {
      failed = eligible.length;
      await input.serviceSupabase
        .from("publish_schedule_items")
        .update({
          status: "failed",
          error_message: result.error,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .in("draft_id", eligible)
        .eq("status", "claimed");
    } else {
      batchId = result.batchId;
      for (const row of result.results) {
        const item = claimedItems.find((candidate) => candidate.draft_id === row.draftId);
        if (!item) continue;
        const nextStatus = row.ok ? "completed" : "failed";
        if (row.ok) completed += 1;
        else failed += 1;
        await input.serviceSupabase
          .from("publish_schedule_items")
          .update({
            status: nextStatus,
            publish_batch_id: result.batchId,
            error_message: row.error ?? null,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq("id", item.id);
      }
    }
  }

  const groupIds = [...new Set(claimedItems.map((item) => item.group_id))];
  for (const groupId of groupIds) {
    const { data: groupItems } = await input.serviceSupabase
      .from("publish_schedule_items")
      .select("status")
      .eq("group_id", groupId);
    const states = (groupItems ?? []).map((row) => row.status as string);
    const completedCount = states.filter((state) => state === "completed").length;
    const failedCount = states.filter((state) => state === "failed").length;
    const hasPending = states.some((state) => state === "queued" || state === "claimed" || state === "blocked");
    await input.serviceSupabase
      .from("publish_schedule_groups")
      .update({
        completed_count: completedCount,
        failed_count: failedCount,
        status: hasPending ? "active" : "completed",
        updated_at: new Date().toISOString()
      })
      .eq("id", groupId);
  }

  return {
    ok: true as const,
    dryRun: false,
    dueDate,
    claimed: claimedItems.length,
    completed,
    failed,
    blocked: blocked.length,
    blockedItems: blocked,
    batchId
  };
}
