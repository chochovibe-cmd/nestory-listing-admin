import { NextRequest } from "next/server";
import { applyDefaultKeepMarks } from "@/lib/drafts/approveCopy";
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
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

  const serviceSupabase = createServiceSupabaseClient();
  // New approve → image_review (no GID); map without shopifyProductId.
  // R2 Q2-A: write keep on unmarked pipeline images at approve time.
  const keepResult = await applyDefaultKeepMarks(serviceSupabase, [id]);

  const { error } = await serviceSupabase
    .from("product_drafts")
    .update({
      status: "approved",
      pipeline_stage: mapStatusToPipelineStage("approved"),
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString()
    })
    .eq("id", id);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  await serviceSupabase.from("review_logs").insert({
    draft_id: id,
    action: "approved",
    reviewer: user.id,
    comment: typeof body.comment === "string" ? body.comment : null
  });

  return Response.json({
    ok: true,
    status: "approved",
    pipeline_stage: "image_review",
    defaultKeepCount: keepResult.updatedCount,
    keepError: keepResult.error ?? null
  });
}
