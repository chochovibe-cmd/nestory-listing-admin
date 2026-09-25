import { NextRequest } from "next/server";
import { applyDefaultKeepMarks } from "@/lib/drafts/approveCopy";
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { copyRuntimeVersion } from "@/lib/providers/copyVersion";

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

  // Preserve the actual approved text as a separate, human-labelled snapshot.
  // Historical generation_history rows alone do not say which version was used.
  const { data: finalCopy } = await serviceSupabase.from("product_drafts")
    .select("title_zh,description_html,generated_faq_html,seo_title,seo_description,why_we_chose_it,product_highlights,generation_rule_version,generation_model")
    .eq("id", id).maybeSingle();
  let feedbackError: string | null = null;
  if (finalCopy) {
    const { data: previous } = await serviceSupabase.from("generation_runs")
      .select("id,output_payload,rule_version,model")
      .eq("draft_id", id).eq("mode", "api_llm")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const { error: snapshotError } = await serviceSupabase.from("generation_runs").insert({
      draft_id: id, mode: "manual", provider: "other", status: "completed",
      rule_version: finalCopy.generation_rule_version ?? previous?.rule_version ?? copyRuntimeVersion(),
      model: "human-approved", created_by: user.id,
      completed_at: new Date().toISOString(),
      input_payload: { source_run_id: previous?.id ?? null, source_model: previous?.model ?? finalCopy.generation_model ?? null, source_output: previous?.output_payload ?? null },
      output_payload: { final_copy: finalCopy, approved_by: user.id },
    });
    feedbackError = snapshotError?.message ?? null;
  }

  return Response.json({
    ok: true,
    status: "approved",
    pipeline_stage: "image_review",
    defaultKeepCount: keepResult.updatedCount,
    keepError: keepResult.error ?? null,
    feedbackError,
  });
}
