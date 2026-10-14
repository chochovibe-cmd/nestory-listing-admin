/**
 * REVIEW-FLOW B1: server-side transition guard for the three review routes
 * (approve / request-revision / return-stage, single + batch).
 *
 * Why: the routes used to write status + pipeline_stage unconditionally, so a stale
 * card (open in another tab, or one an operator had already moved on) could pull a
 * 站③ item back to 站②, or touch a draft that is publishing / published / archived.
 *
 * Pure — no DB, no React. The "where is this draft really" answer is the same
 * `resolveDraftStation` the UI uses, so card and server agree by construction.
 *
 * Matrix (effective stage = valid pipeline_stage, else mapped from status):
 *   Blocked for every action: stage published / archived / input, or status in
 *   publishing / processing / pending_input / pending_copy.
 *   approve       only from copy_review; noop when status=approved + stage=image_review
 *                 (double click / second tab). ready etc. is blocked.
 *   return_copy   from copy_review / image_review / ready; noop when copy_review + needs_revision.
 *   return_image  from ready / image_review / copy_review (copy_review stays allowed:
 *                 quickUndo of a return lands there); noop when image_review + approved.
 */

import {
  resolveDraftStation
} from "@/lib/drafts/stationFilter";
import type { PipelineStage } from "@/lib/drafts/pipelineStage";

export type ReviewTransitionAction = "approve" | "return_copy" | "return_image";

export type ReviewTransitionDraft = {
  status?: string | null;
  pipeline_stage?: string | null;
  shopify_product_id?: string | null;
};

export type ReviewTransitionResult =
  | { ok: true; noop: boolean }
  | { ok: false; code: "STAGE_MISMATCH"; message: string };

/** Statuses during which no review transition may touch the row. */
export const REVIEW_TRANSITION_BLOCKED_STATUSES: readonly string[] = [
  "publishing",
  "processing",
  "pending_input",
  "pending_copy"
];

const BLOCKED_STATUS_SET = new Set<string>(REVIEW_TRANSITION_BLOCKED_STATUSES);

/** Verb phrase used in the mismatch message ("不能{動作}"). */
export const REVIEW_TRANSITION_ACTION_LABEL: Record<ReviewTransitionAction, string> = {
  approve: "核准文案",
  return_copy: "退回文案",
  return_image: "退回改圖"
};

/** User-visible station names (same wording as STATION_OPTIONS / station pills). */
const STAGE_LABEL: Record<PipelineStage, string> = {
  input: "生成中",
  copy_review: "文案待審核",
  image_review: "圖片待標示",
  ready: "完成待發布",
  published: "已發布",
  archived: "已封存"
};

/** Valid pipeline_stage, else derived from status (+ Shopify GID). */
export function effectiveStage(draft: ReviewTransitionDraft): PipelineStage {
  return resolveDraftStation({
    pipeline_stage: draft.pipeline_stage,
    status: draft.status,
    shopify_product_id: draft.shopify_product_id
  });
}

/** Human location of a draft for the mismatch message. */
export function describeReviewLocation(draft: ReviewTransitionDraft): string {
  const status = draft.status ?? "";
  if (status === "publishing") return "發布中";
  if (status === "processing" || status === "pending_copy" || status === "pending_input") {
    return "生成中";
  }
  return STAGE_LABEL[effectiveStage(draft)];
}

function mismatch(
  draft: ReviewTransitionDraft,
  action: ReviewTransitionAction
): ReviewTransitionResult {
  return {
    ok: false,
    code: "STAGE_MISMATCH",
    message: `這筆目前在「${describeReviewLocation(draft)}」，不能${REVIEW_TRANSITION_ACTION_LABEL[action]}（畫面可能過時，請重新整理）`
  };
}

export function checkReviewTransition(
  draft: ReviewTransitionDraft,
  action: ReviewTransitionAction
): ReviewTransitionResult {
  const status = draft.status ?? "";
  const stage = effectiveStage(draft);

  if (BLOCKED_STATUS_SET.has(status)) return mismatch(draft, action);
  if (stage === "published" || stage === "archived" || stage === "input") {
    return mismatch(draft, action);
  }

  switch (action) {
    case "approve": {
      if (stage === "copy_review") return { ok: true, noop: false };
      if (stage === "image_review" && status === "approved") return { ok: true, noop: true };
      return mismatch(draft, action);
    }
    case "return_copy": {
      if (stage === "copy_review") {
        return { ok: true, noop: status === "needs_revision" };
      }
      if (stage === "image_review" || stage === "ready") return { ok: true, noop: false };
      return mismatch(draft, action);
    }
    case "return_image": {
      if (stage === "image_review") {
        return { ok: true, noop: status === "approved" };
      }
      if (stage === "ready" || stage === "copy_review") return { ok: true, noop: false };
      return mismatch(draft, action);
    }
    default:
      return mismatch(draft, action);
  }
}

/** The row was read as eligible but moved before our UPDATE landed (race). */
export function raceMismatchMessage(action: ReviewTransitionAction): string {
  return `這筆剛剛被其他操作移動了，不能${REVIEW_TRANSITION_ACTION_LABEL[action]}（畫面可能過時，請重新整理）`;
}

/** Body of the HTTP 409 returned by every guarded route. */
export function stageMismatchBody(
  draft: ReviewTransitionDraft,
  message: string
): {
  error: string;
  code: "STAGE_MISMATCH";
  status: string | null;
  pipeline_stage: PipelineStage;
} {
  return {
    error: message,
    code: "STAGE_MISMATCH",
    status: draft.status ?? null,
    pipeline_stage: effectiveStage(draft)
  };
}
