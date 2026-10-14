/**
 * R3 station③: 退回改文案 → copy_review；退回改圖 → image_review.
 * REVIEW-FLOW B1: guarded by checkReviewTransition (return_copy / return_image);
 * the write itself is shared with request-revision / batch return via applyReturnStage.
 */
import { NextRequest } from "next/server";
import {
  loadAuthorizedDraft,
  resolveRequestPrincipal
} from "@/lib/api/requestPrincipal";
import {
  checkReviewTransition,
  effectiveStage,
  raceMismatchMessage,
  stageMismatchBody,
  type ReviewTransitionAction
} from "@/lib/drafts/reviewTransitions";
import {
  RETURN_DEFAULT_COMMENT,
  RETURN_RESULT_MESSAGE,
  applyReturnStage
} from "@/lib/drafts/returnStageWrite";
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
  const action: ReviewTransitionAction = target === "copy_review" ? "return_copy" : "return_image";

  // REVIEW-FLOW B1: the id is RLS-approved above; now read where the draft really is.
  const { data: row, error: loadError } = await serviceSupabase
    .from("product_drafts")
    .select("status, pipeline_stage, shopify_product_id")
    .eq("id", canonicalDraftId)
    .maybeSingle();
  if (loadError) return Response.json({ error: loadError.message }, { status: 500 });
  if (!row) return Response.json({ error: "Draft not found" }, { status: 404 });

  const check = checkReviewTransition(row, action);
  if (!check.ok) {
    return Response.json(stageMismatchBody(row, check.message), { status: 409 });
  }
  if (check.noop) {
    // Already there (double click / second tab): success, nothing to write.
    return Response.json({
      ok: true,
      alreadyReturned: true,
      pipeline_stage: effectiveStage(row),
      status: row.status,
      message: RETURN_RESULT_MESSAGE[target]
    });
  }

  const result = await applyReturnStage(serviceSupabase, {
    draftId: canonicalDraftId,
    target,
    userId: principalResult.principal.userId,
    comment,
    defaultComment: RETURN_DEFAULT_COMMENT[target],
    expectedStage: row.pipeline_stage
  });
  if (!result.ok) {
    if (result.reason === "race") {
      return Response.json(stageMismatchBody(row, raceMismatchMessage(action)), { status: 409 });
    }
    return Response.json({ error: result.error }, { status: 500 });
  }

  return Response.json({
    ok: true,
    pipeline_stage: result.pipeline_stage,
    status: result.status,
    message: RETURN_RESULT_MESSAGE[target]
  });
}
