/**
 * Station② → ① 退回文案審核。
 * P0-63: reason/comment is optional (empty / whitespace / missing all OK).
 * Operator allowed (誰上架誰審到底); UI prompt remains UX-C.
 */
import { NextRequest } from "next/server";
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

/** P0-63: accept missing / empty / whitespace-only; treat as no reason. */
export function normalizeOptionalRevisionComment(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

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

  // P0-63: operator + admin + reviewer (was admin/reviewer only → operator 403).
  if (!profile || !["admin", "reviewer", "operator"].includes(profile.role)) {
    return Response.json({ error: "Operator role is required" }, { status: 403 });
  }

  const comment = normalizeOptionalRevisionComment(body.comment ?? body.reason);
  const serviceSupabase = createServiceSupabaseClient();
  const { error } = await serviceSupabase
    .from("product_drafts")
    .update({
      status: "needs_revision",
      pipeline_stage: mapStatusToPipelineStage("needs_revision"),
      reviewed_by: user.id,
      error_message: comment
    })
    .eq("id", id);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  await serviceSupabase.from("review_logs").insert({
    draft_id: id,
    action: "needs_revision",
    reviewer: user.id,
    comment: comment ?? "站②退回文案"
  });

  return Response.json({ ok: true, status: "needs_revision", pipeline_stage: "copy_review" });
}
