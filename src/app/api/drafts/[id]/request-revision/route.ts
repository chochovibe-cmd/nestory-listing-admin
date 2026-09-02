/**
 * Station② → ① 退回文案審核。
 * P0-63: reason/comment is optional (empty / whitespace / missing all OK).
 * Operator allowed (誰上架誰審到底); UI prompt remains UX-C.
 */
import { NextRequest } from "next/server";
import {
  loadAuthorizedDraft,
  resolveRequestPrincipal
} from "@/lib/api/requestPrincipal";
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
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
    comment: comment ?? "站②退回文案"
  });

  return Response.json({ ok: true, status: "needs_revision", pipeline_stage: "copy_review" });
}
