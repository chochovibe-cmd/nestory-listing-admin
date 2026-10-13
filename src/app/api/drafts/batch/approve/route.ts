import { NextRequest } from "next/server";
import { applyDefaultKeepMarks } from "@/lib/drafts/approveCopy";
import {
  APPROVE_GATE_COLUMNS,
  approveBlockerTexts,
  formatApproveBlockMessage
} from "@/lib/drafts/approveGate";
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import { checkReviewTransition } from "@/lib/drafts/reviewTransitions";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

type SkippedItem = { id: string; reason: string };

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const draftIds: unknown = body.draftIds;

  if (!Array.isArray(draftIds) || draftIds.length === 0 || !draftIds.every((id) => typeof id === "string")) {
    return Response.json({ error: "draftIds must be a non-empty string array" }, { status: 400 });
  }

  const authSupabase = await createServerSupabaseClient();
  const { data: { user } } = await authSupabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await authSupabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["admin", "reviewer"].includes(profile.role)) {
    return Response.json({ error: "Reviewer role is required" }, { status: 403 });
  }

  const uniqueIds = [...new Set(draftIds as string[])];
  const serviceSupabase = createServiceSupabaseClient();

  // REVIEW-FLOW B1/B6: read every row first; approve what is eligible, skip the rest
  // (wrong station / ⛔ 必修) with a per-id reason instead of writing blindly.
  const { data: rows, error: loadError } = await serviceSupabase
    .from("product_drafts")
    .select(`id, status, pipeline_stage, shopify_product_id, ${APPROVE_GATE_COLUMNS}`)
    .in("id", uniqueIds);
  if (loadError) return Response.json({ error: loadError.message }, { status: 500 });

  const rowById = new Map<string, Record<string, unknown>>();
  for (const row of (rows ?? []) as Array<Record<string, unknown>>) {
    rowById.set(String(row.id), row);
  }

  const skipped: SkippedItem[] = [];
  const toWriteIds: string[] = [];
  const alreadyApprovedIds: string[] = [];

  for (const id of uniqueIds) {
    const row = rowById.get(id);
    if (!row) {
      skipped.push({ id, reason: "找不到這筆草稿" });
      continue;
    }
    const check = checkReviewTransition(row, "approve");
    if (!check.ok) {
      skipped.push({ id, reason: check.message });
      continue;
    }
    if (check.noop) {
      alreadyApprovedIds.push(id);
      continue;
    }
    const blockers = approveBlockerTexts(row);
    if (blockers.length > 0) {
      skipped.push({ id, reason: formatApproveBlockMessage(blockers) });
      continue;
    }
    toWriteIds.push(id);
  }

  let approvedIds: string[] = [];
  let defaultKeepCount = 0;
  let keepError: string | null = null;

  if (toWriteIds.length > 0) {
    // R2 Q2-A: default keep before stage flip so DB matches UI.
    const keepResult = await applyDefaultKeepMarks(serviceSupabase, toWriteIds);
    defaultKeepCount = keepResult.updatedCount;
    keepError = keepResult.error ?? null;

    const { data: updated, error } = await serviceSupabase
      .from("product_drafts")
      .update({
        status: "approved",
        pipeline_stage: mapStatusToPipelineStage("approved"),
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString()
      })
      .in("id", toWriteIds)
      .eq("pipeline_stage", "copy_review")
      .select("id");

    if (error) return Response.json({ error: error.message }, { status: 500 });

    approvedIds = (updated ?? []).map((row) => row.id as string);
    const approvedSet = new Set(approvedIds);
    for (const id of toWriteIds) {
      // Eligible when read, but moved before the UPDATE landed (race): report, don't hide.
      if (!approvedSet.has(id)) {
        skipped.push({ id, reason: "這筆剛剛被其他操作移動了，沒有核准（請重新整理）" });
      }
    }

    if (approvedIds.length > 0) {
      await serviceSupabase.from("review_logs").insert(
        approvedIds.map((draftId) => ({
          draft_id: draftId,
          action: "approved",
          reviewer: user.id,
          comment: typeof body.comment === "string" ? body.comment : null
        }))
      );
    }
  }

  return Response.json({
    ok: true,
    approvedCount: approvedIds.length,
    approvedIds,
    // Everything that is now approved: freshly written + already-approved noops.
    approved: [...approvedIds, ...alreadyApprovedIds],
    alreadyApprovedIds,
    skipped,
    defaultKeepCount,
    keepError
  });
}
