/**
 * Station② → ① 退回文案審核。
 * P0-63: reason/comment is optional (empty / whitespace / missing all OK).
 * Operator allowed (誰上架誰審到底); UI prompt remains UX-C.
 * REVIEW-FLOW B1: guarded by checkReviewTransition(return_copy); write shared with
 * return-stage / batch return via applyReturnStage.
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
  stageMismatchBody
} from "@/lib/drafts/reviewTransitions";
import { applyReturnStage } from "@/lib/drafts/returnStageWrite";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

/** P0-63: accept missing / empty / whitespace-only; treat as no reason.
 *  Must NOT be exported — Next.js Route modules only allow HTTP method exports. */
function normalizeOptionalRevisionComment(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const principalResult = await resolveRequestPrincipal(request);
  if (!principalResult.ok) return principalResult.response;
  if (principalResult.principal.kind !== "session") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const authorizedDraft = await loadAuthorizedDraft(principalResult.principal, id);
  if (!authorizedDraft.ok) return authorizedDraft.response;
  const canonicalDraftId = authorizedDraft.id;

  const comment = normalizeOptionalRevisionComment(body.comment ?? body.reason);
  const serviceSupabase = createServiceSupabaseClient();

  // REVIEW-FLOW B1: the id is RLS-approved above; now read where the draft really is.
  const { data: row, error: loadError } = await serviceSupabase
    .from("product_drafts")
    .select("status, pipeline_stage, shopify_product_id")
    .eq("id", canonicalDraftId)
    .maybeSingle();
  if (loadError) return Response.json({ error: loadError.message }, { status: 500 });
  if (!row) return Response.json({ error: "Draft not found" }, { status: 404 });

  const check = checkReviewTransition(row, "return_copy");
  if (!check.ok) {
    return Response.json(stageMismatchBody(row, check.message), { status: 409 });
  }
  if (check.noop) {
    return Response.json({
      ok: true,
      alreadyReturned: true,
      status: row.status,
      pipeline_stage: effectiveStage(row)
    });
  }

  const result = await applyReturnStage(serviceSupabase, {
    draftId: canonicalDraftId,
    target: "copy_review",
    userId: principalResult.principal.userId,
    comment,
    defaultComment: "站②退回文案",
    expectedStage: row.pipeline_stage
  });
  if (!result.ok) {
    if (result.reason === "race") {
      return Response.json(
        stageMismatchBody(row, raceMismatchMessage("return_copy")),
        { status: 409 }
      );
    }
    return Response.json({ error: result.error }, { status: 500 });
  }

  return Response.json({ ok: true, status: "needs_revision", pipeline_stage: "copy_review" });
}
