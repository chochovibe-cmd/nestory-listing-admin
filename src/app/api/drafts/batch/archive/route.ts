import { NextRequest } from "next/server";
import { canOperate } from "@/lib/auth/roles";
import {
  evaluateBatchArchive,
  evaluateBatchUnarchive,
  formatArchiveResultMessage,
  formatUnarchiveResultMessage,
  isPublishedArchiveStatus,
  resolveUnarchiveStatus
} from "@/lib/drafts/archiveDrafts";
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/domain";

type Action = "archive" | "unarchive";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const draftIds: unknown = body.draftIds;
  const action: unknown = body.action;

  if (!Array.isArray(draftIds) || draftIds.length === 0 || !draftIds.every((id) => typeof id === "string")) {
    return Response.json({ error: "draftIds must be a non-empty string array" }, { status: 400 });
  }
  if (action !== "archive" && action !== "unarchive") {
    return Response.json({ error: "action must be archive or unarchive" }, { status: 400 });
  }

  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await authSupabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await authSupabase.from("profiles").select("role").eq("id", user.id).single();
  if (!canOperate(profile?.role as UserRole | undefined)) {
    return Response.json({ error: "Operator role is required" }, { status: 403 });
  }

  const serviceSupabase = createServiceSupabaseClient();
  const { data: rows, error: loadError } = await serviceSupabase
    .from("product_drafts")
    .select(
      "id, status, generation_status, title_zh, taobao_title, original_title, status_before_archive, description_html, description_plain, shopify_product_id"
    )
    .in("id", draftIds as string[]);

  if (loadError) {
    // 024 not applied: status_before_archive missing — retry without restore columns.
    const fallback = await serviceSupabase
      .from("product_drafts")
      .select(
        "id, status, generation_status, title_zh, taobao_title, original_title, description_html, description_plain, shopify_product_id"
      )
      .in("id", draftIds as string[]);
    if (fallback.error) {
      return Response.json({ error: fallback.error.message }, { status: 500 });
    }
    return handleAction(action as Action, fallback.data ?? [], serviceSupabase, true);
  }

  return handleAction(action as Action, rows ?? [], serviceSupabase, false);
}

async function handleAction(
  action: Action,
  rows: Array<Record<string, unknown>>,
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  missingRestoreColumns: boolean
) {
  if (action === "archive") {
    return archiveRows(rows, serviceSupabase, missingRestoreColumns);
  }
  return unarchiveRows(rows, serviceSupabase, missingRestoreColumns);
}

async function archiveRows(
  rows: Array<Record<string, unknown>>,
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  missingRestoreColumns: boolean
) {
  const evaluated = evaluateBatchArchive(
    rows.map((row) => ({
      id: String(row.id),
      status: String(row.status ?? ""),
      generation_status: (row.generation_status as string | null) ?? null,
      title_zh: (row.title_zh as string | null) ?? null,
      taobao_title: (row.taobao_title as string | null) ?? null,
      original_title: (row.original_title as string | null) ?? null
    }))
  );

  const archivedIds: string[] = [];
  const now = new Date().toISOString();
  let includesPublished = evaluated.includesPublished;

  for (const id of evaluated.toArchiveIds) {
    const row = rows.find((r) => String(r.id) === id);
    if (!row) continue;
    const priorStatus = String(row.status);
    if (isPublishedArchiveStatus(priorStatus)) includesPublished = true;

    const patch: Record<string, unknown> = {
      status: "archived",
      pipeline_stage: mapStatusToPipelineStage("archived")
    };
    if (!missingRestoreColumns) {
      patch.status_before_archive = priorStatus === "archived" ? null : priorStatus;
      patch.archived_at = now;
    }

    const { error } = await serviceSupabase.from("product_drafts").update(patch).eq("id", id);
    if (!error) archivedIds.push(id);
  }

  const message = formatArchiveResultMessage({
    archivedCount: archivedIds.length,
    skippedBusyCount: evaluated.skippedBusy.length,
    skippedAlreadyCount: evaluated.skippedAlready.length,
    includesPublished
  });

  return Response.json({
    ok: true,
    action: "archive",
    archivedCount: archivedIds.length,
    archivedIds,
    skippedBusyCount: evaluated.skippedBusy.length,
    skippedBusy: evaluated.skippedBusy,
    skippedAlreadyCount: evaluated.skippedAlready.length,
    includesPublished,
    message,
    migration024Missing: missingRestoreColumns
  });
}

async function unarchiveRows(
  rows: Array<Record<string, unknown>>,
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  missingRestoreColumns: boolean
) {
  const evaluated = evaluateBatchUnarchive(
    rows.map((row) => ({
      id: String(row.id),
      status: String(row.status ?? ""),
      title_zh: (row.title_zh as string | null) ?? null,
      taobao_title: (row.taobao_title as string | null) ?? null,
      original_title: (row.original_title as string | null) ?? null
    }))
  );

  const restoredIds: string[] = [];

  for (const id of evaluated.toRestoreIds) {
    const row = rows.find((r) => String(r.id) === id);
    if (!row) continue;

    const hasCopy = Boolean(
      (typeof row.description_html === "string" && row.description_html.trim()) ||
        (typeof row.description_plain === "string" && row.description_plain.trim()) ||
        (typeof row.title_zh === "string" && row.title_zh.trim())
    );

    const restoreStatus = resolveUnarchiveStatus({
      statusBeforeArchive: missingRestoreColumns
        ? null
        : ((row.status_before_archive as string | null) ?? null),
      generationStatus: (row.generation_status as string | null) ?? null,
      hasCopy
    });

    // Q6-A: restore status then map (no pipeline_stage_before_archive this pack).
    const patch: Record<string, unknown> = {
      status: restoreStatus,
      pipeline_stage: mapStatusToPipelineStage(restoreStatus, {
        shopifyProductId: (row.shopify_product_id as string | null) ?? null
      })
    };
    if (!missingRestoreColumns) {
      patch.status_before_archive = null;
      patch.archived_at = null;
    }

    const { error } = await serviceSupabase.from("product_drafts").update(patch).eq("id", id);
    if (!error) restoredIds.push(id);
  }

  const message = formatUnarchiveResultMessage({
    restoredCount: restoredIds.length,
    skippedNotArchivedCount: evaluated.skippedNotArchived.length
  });

  return Response.json({
    ok: true,
    action: "unarchive",
    restoredCount: restoredIds.length,
    restoredIds,
    skippedNotArchivedCount: evaluated.skippedNotArchived.length,
    message,
    migration024Missing: missingRestoreColumns
  });
}
