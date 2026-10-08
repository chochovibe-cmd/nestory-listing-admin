import { NextRequest } from "next/server";
import { canPublish } from "@/lib/auth/roles";
import {
  buildScheduleAssignments,
  isMissingScheduleTablesError,
  normalizeScheduleDraftIds,
  SCHEDULE_MIGRATION_HINT,
  scheduleDbWriteEnabled,
  scheduleExecutionEnabled,
  scheduleStagingEnabled
} from "@/lib/drafts/publishScheduleCore";
import { runPublishBatch } from "@/lib/shopify/runPublishBatch";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 60;

async function requirePublisher() {
  const auth = await createServerSupabaseClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return { ok: false as const, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const { data: profile } = await auth.from("profiles").select("role").eq("id", user.id).single();
  if (!canPublish(profile?.role as UserRole | undefined)) {
    return { ok: false as const, response: Response.json({ error: "Reviewer role is required" }, { status: 403 }) };
  }
  return { ok: true as const, user };
}

export async function GET() {
  const auth = await requirePublisher();
  if (!auth.ok) return auth.response;

  const service = createServiceSupabaseClient();
  const { data: groups, error } = await service
    .from("publish_schedule_groups")
    .select("id,created_by,start_date,daily_limit,timezone,active_weekdays,status,total_count,completed_count,failed_count,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    return Response.json(
      {
        error: error.message,
        hint: isMissingScheduleTablesError(error.message) ? SCHEDULE_MIGRATION_HINT : undefined
      },
      { status: isMissingScheduleTablesError(error.message) ? 503 : 500 }
    );
  }

  const ids = (groups ?? []).map((group) => group.id as string);
  let items: Array<Record<string, unknown>> = [];
  if (ids.length) {
    const { data, error: itemError } = await service
      .from("publish_schedule_items")
      .select("id,group_id,draft_id,scheduled_for,position,status,claimed_at,completed_at,error_message,publish_batch_id,created_at,updated_at")
      .in("group_id", ids)
      .order("scheduled_for", { ascending: true })
      .order("position", { ascending: true })
      .limit(500);
    if (itemError) {
      return Response.json({ error: itemError.message }, { status: 500 });
    }

    const rawItems = (data ?? []) as Array<Record<string, unknown>>;
    const draftIds = [...new Set(rawItems.map((item) => String(item.draft_id ?? "")).filter(Boolean))];
    let draftById = new Map<string, {
      title: string;
      pipelineStage: string | null;
      syncStatus: string | null;
      shopifyProductId: string | null;
    }>();

    if (draftIds.length) {
      const { data: draftRows, error: draftError } = await service
        .from("product_drafts")
        .select("id,title_zh,taobao_title,original_title,pipeline_stage,shopify_sync_status,shopify_product_id")
        .in("id", draftIds);
      if (draftError) {
        return Response.json({ error: draftError.message }, { status: 500 });
      }
      draftById = new Map(
        (draftRows ?? []).map((draft) => [
          String(draft.id),
          {
            title:
              String(draft.title_zh ?? "").trim() ||
              String(draft.taobao_title ?? "").trim() ||
              String(draft.original_title ?? "").trim() ||
              "未命名商品",
            pipelineStage: typeof draft.pipeline_stage === "string" ? draft.pipeline_stage : null,
            syncStatus: typeof draft.shopify_sync_status === "string" ? draft.shopify_sync_status : null,
            shopifyProductId:
              typeof draft.shopify_product_id === "string" ? draft.shopify_product_id : null
          }
        ])
      );
    }

    items = rawItems.map((item) => {
      const draft = draftById.get(String(item.draft_id ?? ""));
      return {
        ...item,
        title: draft?.title ?? "商品",
        pipeline_stage: draft?.pipelineStage ?? null,
        shopify_sync_status: draft?.syncStatus ?? null,
        shopify_product_id: draft?.shopifyProductId ?? null
      };
    });
  }

  return Response.json({
    ok: true,
    groups: groups ?? [],
    items,
    safety: {
      dbWriteEnabled: scheduleDbWriteEnabled(),
      stagingEnabled: scheduleStagingEnabled(),
      executionEnabled: scheduleExecutionEnabled()
    }
  });
}

export async function POST(request: NextRequest) {
  const auth = await requirePublisher();
  if (!auth.ok) return auth.response;

  if (!scheduleDbWriteEnabled()) {
    return Response.json(
      {
        error: "排程資料寫入安全鎖目前關閉；Preview 只能讀取與 dry-run，不會寫入 Production schedule tables。",
        code: "SCHEDULE_DB_WRITE_DISABLED"
      },
      { status: 409 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const draftIds = normalizeScheduleDraftIds(body.draftIds);
  const startDate = typeof body.startDate === "string" ? body.startDate : "";
  const dailyLimit = Number(body.dailyLimit ?? 20);
  const activeWeekdays = Array.isArray(body.activeWeekdays)
    ? body.activeWeekdays.map(Number).filter((day: number) => Number.isInteger(day) && day >= 0 && day <= 6)
    : [0, 1, 2, 3, 4, 5, 6];

  if (!draftIds.length) {
    return Response.json({ error: "draftIds must be a non-empty string array" }, { status: 400 });
  }
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 200) {
    return Response.json({ error: "dailyLimit must be 1-200" }, { status: 400 });
  }
  if (!activeWeekdays.length) {
    return Response.json({ error: "At least one weekday is required" }, { status: 400 });
  }

  const service = createServiceSupabaseClient();

  const { data: selectedDrafts, error: selectedDraftsError } = await service
    .from("product_drafts")
    .select("id,pipeline_stage,status")
    .in("id", draftIds);

  if (selectedDraftsError) {
    return Response.json({ error: selectedDraftsError.message }, { status: 500 });
  }

  const foundIds = new Set((selectedDrafts ?? []).map((draft) => String(draft.id)));
  const missingIds = draftIds.filter((id) => !foundIds.has(id));
  const notReadyIds = (selectedDrafts ?? [])
    .filter((draft) => draft.pipeline_stage !== "ready")
    .map((draft) => String(draft.id));

  if (missingIds.length || notReadyIds.length) {
    return Response.json(
      {
        error: "只有「完成待發布」商品可以加入排程",
        missingDraftIds: missingIds,
        notReadyDraftIds: notReadyIds
      },
      { status: 409 }
    );
  }

  let scheduleIds = draftIds;
  let staging:
    | { enabled: false }
    | { enabled: true; batchId: string | null; failedDraftIds: string[] } = { enabled: false };

  if (scheduleStagingEnabled()) {
    const staged = await runPublishBatch({
      serviceSupabase: service,
      draftIds,
      publishMode: "draft",
      createdBy: auth.user.id
    });
    if (!staged.ok) {
      return Response.json(
        { error: staged.error, hint: staged.hint, stage: "shopify_draft" },
        { status: staged.status }
      );
    }
    const succeeded = staged.results.filter((row) => row.ok).map((row) => row.draftId);
    const failed = staged.results.filter((row) => !row.ok).map((row) => row.draftId);
    scheduleIds = succeeded;
    staging = { enabled: true, batchId: staged.batchId, failedDraftIds: failed };
    if (!scheduleIds.length) {
      return Response.json(
        { error: "Shopify DRAFT staging failed for every selected product", staging },
        { status: 409 }
      );
    }
  }

  const { preview, assignments } = buildScheduleAssignments({
    draftIds: scheduleIds,
    startDate,
    dailyLimit,
    activeWeekdays
  });

  if (!assignments.length || !preview.finishDate) {
    return Response.json({ error: "Unable to build schedule" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { data: group, error: groupError } = await service
    .from("publish_schedule_groups")
    .insert({
      created_by: auth.user.id,
      start_date: preview.startDate,
      daily_limit: dailyLimit,
      timezone: "Asia/Taipei",
      active_weekdays: activeWeekdays,
      status: "active",
      total_count: assignments.length,
      completed_count: 0,
      failed_count: 0,
      created_at: now,
      updated_at: now
    })
    .select("id")
    .single();

  if (groupError || !group?.id) {
    const message = groupError?.message ?? "Unable to create schedule group";
    return Response.json(
      {
        error: message,
        hint: isMissingScheduleTablesError(message) ? SCHEDULE_MIGRATION_HINT : undefined
      },
      { status: isMissingScheduleTablesError(message) ? 503 : 500 }
    );
  }

  const rows = assignments.map((item) => ({
    group_id: group.id,
    draft_id: item.draftId,
    scheduled_for: item.scheduledFor,
    position: item.position,
    status: "queued",
    created_at: now,
    updated_at: now
  }));

  const { error: itemError } = await service.from("publish_schedule_items").insert(rows);
  if (itemError) {
    await service.from("publish_schedule_groups").delete().eq("id", group.id);
    const message = itemError.message;
    return Response.json(
      {
        error: message,
        hint: isMissingScheduleTablesError(message) ? SCHEDULE_MIGRATION_HINT : undefined
      },
      { status: message.includes("uq_publish_schedule_active_draft") ? 409 : 500 }
    );
  }

  return Response.json({
    ok: true,
    groupId: group.id,
    total: assignments.length,
    finishDate: preview.finishDate,
    staging,
    safety: {
      dbWriteEnabled: scheduleDbWriteEnabled(),
      stagingEnabled: scheduleStagingEnabled(),
      executionEnabled: scheduleExecutionEnabled()
    },
    message: scheduleStagingEnabled()
      ? "Shopify 草稿已建立；成功件已加入排程"
      : "測試排程已建立；Shopify DRAFT／ACTIVE 安全鎖目前關閉，未送出任何 Shopify 寫入"
  });
}
