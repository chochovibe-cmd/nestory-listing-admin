/**
 * P0-62: after a full /api/generate success, force-sync the three fields the
 * queue card uses for fail lights / station placement.
 *
 * Failure path only sets generation_status=failed (Q7-A, leave legacy status).
 * Success must always pull generation_status (and status when it was failed)
 * back so the card cannot stay red after a green progress bar.
 */
import { mapStatusToPipelineStage, type PipelineStage } from "@/lib/drafts/pipelineStage";

export type GenerateSuccessStatusPatch = {
  status: "ready_for_review" | "needs_revision";
  pipeline_stage: PipelineStage;
  generation_status: "completed" | "failed";
  generation_error: string | null;
};

/**
 * Pure dual-write patch for a completed generate run.
 * @param draftState — provider `draft_state` (`blocked` keeps fail lights).
 * @param validationErrors — only used when blocked.
 */
export function buildGenerateSuccessStatusPatch(
  draftState: string | null | undefined,
  validationErrors: string[] = [],
): GenerateSuccessStatusPatch {
  const blocked = draftState === "blocked";
  const status = blocked ? "needs_revision" : "ready_for_review";
  return {
    status,
    pipeline_stage: mapStatusToPipelineStage(status),
    generation_status: blocked ? "failed" : "completed",
    generation_error: blocked
      ? validationErrors.filter(Boolean).join("; ") || "blocked"
      : null,
  };
}
