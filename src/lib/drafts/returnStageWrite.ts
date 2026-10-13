/**
 * REVIEW-FLOW B2: the ONE place that writes a "return to an earlier station" transition.
 *
 * Used by POST /api/drafts/[id]/return-stage, POST /api/drafts/[id]/request-revision and
 * POST /api/drafts/batch/return-stage, so single and batch always write the same fields
 * and the same review_logs row. Callers run `checkReviewTransition` first; this helper
 * additionally guards the UPDATE with the stage that was just read, so a concurrent move
 * (another tab / operator) is reported as a race instead of silently overwritten.
 *
 * Server-only (takes the service-role client as a parameter; no Next / React imports).
 */

import { isPipelineStage, mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";

export type ReturnTarget = "copy_review" | "image_review";

/** Minimal shape of the service-role client (kept loose like approveCopy.ts). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = { from: (table: string) => any };

export const RETURN_RESULT_MESSAGE: Record<ReturnTarget, string> = {
  copy_review: "已退回文案審核（文案已解鎖）",
  image_review: "已退回圖片審核（可重標後再審核）"
};

/** Default review_logs comment when the caller gives none. */
export const RETURN_DEFAULT_COMMENT: Record<ReturnTarget, string> = {
  copy_review: "站③退回改文案",
  image_review: "站③退回改圖"
};

export const BATCH_RETURN_DEFAULT_COMMENT: Record<ReturnTarget, string> = {
  copy_review: "批次退回文案",
  image_review: "批次退回改圖"
};

export type ApplyReturnStageInput = {
  draftId: string;
  target: ReturnTarget;
  userId: string;
  /** Raw comment (already normalised by the caller; null = none). */
  comment: string | null;
  /** review_logs comment used when `comment` is null. */
  defaultComment: string;
  /** pipeline_stage read just before this write; the UPDATE only lands if it is unchanged. */
  expectedStage?: string | null;
};

export type ApplyReturnStageResult =
  | { ok: true; status: string; pipeline_stage: ReturnTarget }
  | { ok: false; reason: "race" }
  | { ok: false; reason: "db"; error: string };

export async function applyReturnStage(
  serviceSupabase: ServiceClient,
  input: ApplyReturnStageInput
): Promise<ApplyReturnStageResult> {
  const { draftId, target, userId, comment, defaultComment, expectedStage } = input;

  const patch =
    target === "copy_review"
      ? {
          status: "needs_revision",
          pipeline_stage: mapStatusToPipelineStage("needs_revision"),
          reviewed_by: userId,
          error_message: comment
        }
      : {
          // image_review: keep approved + locked copy; re-mark images
          pipeline_stage: "image_review",
          status: "approved",
          updated_at: new Date().toISOString()
        };

  let query = serviceSupabase.from("product_drafts").update(patch).eq("id", draftId);
  if (isPipelineStage(expectedStage)) {
    query = query.eq("pipeline_stage", expectedStage);
  }
  const { data, error } = await query.select("id");

  if (error) return { ok: false, reason: "db", error: error.message as string };
  if (!Array.isArray(data) || data.length === 0) return { ok: false, reason: "race" };

  await serviceSupabase.from("review_logs").insert({
    draft_id: draftId,
    action: target === "copy_review" ? "needs_revision" : "return_image_review",
    reviewer: userId,
    comment: comment ?? defaultComment
  });

  return {
    ok: true,
    status: target === "copy_review" ? "needs_revision" : "approved",
    pipeline_stage: target
  };
}
