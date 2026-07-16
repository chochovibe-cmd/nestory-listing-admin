import { NextRequest } from "next/server";
import { applyDefaultKeepMarks } from "@/lib/drafts/approveCopy";
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

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

  // R2 Q2-A: default keep before stage flip so DB matches UI.
  const keepResult = await applyDefaultKeepMarks(serviceSupabase, uniqueIds);

  const { data: updated, error } = await serviceSupabase
    .from("product_drafts")
    .update({
      status: "approved",
      pipeline_stage: mapStatusToPipelineStage("approved"),
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString()
    })
    .in("id", uniqueIds)
    .select("id");

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const approvedIds = (updated ?? []).map((row) => row.id as string);
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

  return Response.json({
    ok: true,
    approvedCount: approvedIds.length,
    approvedIds,
    defaultKeepCount: keepResult.updatedCount,
    keepError: keepResult.error ?? null
  });
}
