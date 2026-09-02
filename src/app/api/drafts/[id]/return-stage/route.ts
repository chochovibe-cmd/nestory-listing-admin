/**
 * R3 station③: 退回改文案 → copy_review；退回改圖 → image_review.
 */
import { NextRequest } from "next/server";
import {
  loadAuthorizedDraft,
  resolveRequestPrincipal
} from "@/lib/api/requestPrincipal";
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const target = body.target === "image_review" ? "image_review" : body.target === "copy_review" ? "copy_review" : null;

  if (!target) {
    return Response.json(
      { error: "target must be copy_review or image_review" },
      { status: 400 }
    );
  }

  const principalResult = await resolveRequestPrincipal(request);
  if (!principalResult.ok) return principalResult.response;
  if (principalResult.principal.kind !== "session") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const authorizedDraft = await loadAuthorizedDraft(principalResult.principal, id);
  if (!authorizedDraft.ok) return authorizedDraft.response;
  const canonicalDraftId = authorizedDraft.id;

  const serviceSupabase = createServiceSupabaseClient();
  const comment = typeof body.comment === "string" ? body.comment : null;

  if (target === "copy_review") {
    const { error } = await serviceSupabase
      .from("product_drafts")
      .update({
        status: "needs_revision",
        pipeline_stage: mapStatusToPipelineStage("needs_revision"),
        reviewed_by: principalResult.principal.userId,
        error_message: comment
      })
      .eq("id", canonicalDraftId);

    if (error) return Response.json({ error: error.message }, { status: 500 });

    await serviceSupabase.from("review_logs").insert({
      draft_id: canonicalDraftId,
      action: "needs_revision",
      reviewer: principalResult.principal.userId,
      comment: comment ?? "站③退回改文案"
    });

    return Response.json({
      ok: true,
      pipeline_stage: "copy_review",
      status: "needs_revision",
      message: "已退回文案審核（文案已解鎖）"
    });
  }

  // image_review: keep approved + locked copy; re-mark images
  const { error } = await serviceSupabase
    .from("product_drafts")
    .update({
      pipeline_stage: "image_review",
      status: "approved",
      updated_at: new Date().toISOString()
    })
    .eq("id", canonicalDraftId);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  await serviceSupabase.from("review_logs").insert({
    draft_id: canonicalDraftId,
    action: "return_image_review",
    reviewer: principalResult.principal.userId,
    comment: comment ?? "站③退回改圖"
  });

  return Response.json({
    ok: true,
    pipeline_stage: "image_review",
    status: "approved",
    message: "已退回圖片審核（可重標後再審核）"
  });
}
