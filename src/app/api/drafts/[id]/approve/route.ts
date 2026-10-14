import { NextRequest } from "next/server";
import { applyDefaultKeepMarks } from "@/lib/drafts/approveCopy";
import {
  APPROVE_GATE_COLUMNS,
  approveBlockerTexts,
  formatApproveBlockMessage
} from "@/lib/drafts/approveGate";
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import {
  checkReviewTransition,
  effectiveStage,
  raceMismatchMessage,
  stageMismatchBody
} from "@/lib/drafts/reviewTransitions";
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

  // REVIEW-FLOW B1: read the row first. A stale card must not re-approve (or pull back)
  // a draft that is no longer at 站① — answer 409 STAGE_MISMATCH instead of writing.
  const { data: row, error: loadError } = await serviceSupabase
    .from("product_drafts")
    .select(`status, pipeline_stage, shopify_product_id, ${APPROVE_GATE_COLUMNS}`)
    .eq("id", id)
    .maybeSingle();
  if (loadError) return Response.json({ error: loadError.message }, { status: 500 });
  if (!row) return Response.json({ error: "Draft not found" }, { status: 404 });

  const check = checkReviewTransition(row, "approve");
  if (!check.ok) {
    return Response.json(stageMismatchBody(row, check.message), { status: 409 });
  }
  if (check.noop) {
    // Already approved (double click / second tab): success, nothing to write.
    return Response.json({
      ok: true,
      alreadyApproved: true,
      status: row.status,
      pipeline_stage: effectiveStage(row)
    });
  }

  // REVIEW-FLOW B6: ⛔ 必修 is a pure function of saved columns — same gate the card uses.
  const blockers = approveBlockerTexts(row);
  if (blockers.length > 0) {
    return Response.json(
      { error: formatApproveBlockMessage(blockers), code: "BLOCKING_WARNINGS" },
      { status: 422 }
    );
  }

  // New approve → image_review (no GID); map without shopifyProductId.
  // R2 Q2-A: write keep on unmarked pipeline images at approve time.
  const keepResult = await applyDefaultKeepMarks(serviceSupabase, [id]);

  // Conditional on still being at 站① so a concurrent move is caught, not overwritten.
  const { data: updated, error } = await serviceSupabase
    .from("product_drafts")
    .update({
      status: "approved",
      pipeline_stage: mapStatusToPipelineStage("approved"),
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString()
    })
    .eq("id", id)
    .eq("pipeline_stage", "copy_review")
    .select("id");

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!Array.isArray(updated) || updated.length === 0) {
    return Response.json(
      stageMismatchBody(row, raceMismatchMessage("approve")),
      { status: 409 }
    );
  }

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
