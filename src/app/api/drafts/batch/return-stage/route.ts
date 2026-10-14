/**
 * REVIEW-FLOW B2: batch 退回 — station② → ① (文案) and station③ → ① (文案) / ② (改圖).
 *
 * Per eligible id this does exactly what POST /api/drafts/[id]/return-stage does
 * (same fields, same review_logs row — both go through applyReturnStage); ineligible ids
 * are skipped with a reason (checkReviewTransition) instead of failing the whole batch.
 * Auth: signed-in operator+, draft ids scoped through RLS before any service-role write.
 */
import { NextRequest } from "next/server";
import {
  loadAuthorizedDraftIds,
  resolveRequestPrincipal
} from "@/lib/api/requestPrincipal";
import {
  checkReviewTransition,
  raceMismatchMessage,
  type ReviewTransitionAction
} from "@/lib/drafts/reviewTransitions";
import {
  BATCH_RETURN_DEFAULT_COMMENT,
  applyReturnStage
} from "@/lib/drafts/returnStageWrite";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_BATCH_IDS = 200;

type SkippedItem = { id: string; reason: string };

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const ids: unknown = body.ids;
  const target =
    body.target === "image_review"
      ? "image_review"
      : body.target === "copy_review"
        ? "copy_review"
        : null;

  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string")) {
    return Response.json({ error: "ids must be a non-empty string array" }, { status: 400 });
  }
  if (!target) {
    return Response.json(
      { error: "target must be copy_review or image_review" },
      { status: 400 }
    );
  }
  const uniqueIds = [...new Set((ids as string[]).map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0 || uniqueIds.length > MAX_BATCH_IDS) {
    return Response.json(
      { error: `ids must contain 1 to ${MAX_BATCH_IDS} draft ids` },
      { status: 400 }
    );
  }

  const comment =
    typeof body.comment === "string" && body.comment.trim() ? body.comment.trim() : null;

  const principalResult = await resolveRequestPrincipal(request);
  if (!principalResult.ok) return principalResult.response;
  if (principalResult.principal.kind !== "session") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const authorizedIdsResult = await loadAuthorizedDraftIds(principalResult.principal, uniqueIds);
  if (!authorizedIdsResult.ok) return authorizedIdsResult.response;
  const authorizedDraftIds = authorizedIdsResult.ids;
  const authorizedSet = new Set(authorizedDraftIds);

  const serviceSupabase = createServiceSupabaseClient();
  const { data: rows, error: loadError } = authorizedDraftIds.length
    ? await serviceSupabase
        .from("product_drafts")
        .select("id, status, pipeline_stage, shopify_product_id")
        .in("id", authorizedDraftIds)
    : { data: [], error: null };
  if (loadError) return Response.json({ error: loadError.message }, { status: 500 });

  const rowById = new Map<string, Record<string, unknown>>();
  for (const row of (rows ?? []) as Array<Record<string, unknown>>) {
    rowById.set(String(row.id), row);
  }

  const action: ReviewTransitionAction = target === "copy_review" ? "return_copy" : "return_image";
  const updated: string[] = [];
  const alreadyIds: string[] = [];
  const skipped: SkippedItem[] = [];

  for (const id of uniqueIds) {
    const row = rowById.get(id);
    if (!row || !authorizedSet.has(id)) {
      skipped.push({ id, reason: "找不到這筆草稿" });
      continue;
    }
    const check = checkReviewTransition(row, action);
    if (!check.ok) {
      skipped.push({ id, reason: check.message });
      continue;
    }
    if (check.noop) {
      // Already at the target (second tab / double click): counts as returned, no write.
      alreadyIds.push(id);
      updated.push(id);
      continue;
    }
    const result = await applyReturnStage(serviceSupabase, {
      draftId: id,
      target,
      userId: principalResult.principal.userId,
      comment,
      defaultComment: BATCH_RETURN_DEFAULT_COMMENT[target],
      expectedStage: typeof row.pipeline_stage === "string" ? row.pipeline_stage : null
    });
    if (result.ok) {
      updated.push(id);
    } else if (result.reason === "race") {
      skipped.push({ id, reason: raceMismatchMessage(action) });
    } else {
      skipped.push({ id, reason: result.error });
    }
  }

  return Response.json({
    ok: true,
    updated,
    alreadyIds,
    skipped
  });
}
