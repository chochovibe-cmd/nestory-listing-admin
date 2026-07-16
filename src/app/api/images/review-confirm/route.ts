/**
 * D5: mark product image review as passed (Q1-A).
 * Body: { draftIds: string[] }
 * - merge image_flags.image_review = approved (+ image_reviewed_at)
 * - image_status stays done; no draft.status / publish / finalize
 */

import { NextRequest } from "next/server";
import { canOperate, canReview } from "@/lib/auth/roles";
import {
  classifyReviewQueueItem,
  mergeImageReviewApproved
} from "@/lib/images/imageReview";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/domain";

export const runtime = "nodejs";

function canActOnDraft(role: UserRole | undefined, userId: string, createdBy: string | null): boolean {
  if (canReview(role)) return true; // admin / reviewer
  return createdBy === userId;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const draftIdsRaw: unknown = body.draftIds;

  if (
    !Array.isArray(draftIdsRaw) ||
    draftIdsRaw.length === 0 ||
    !draftIdsRaw.every((id) => typeof id === "string" && id.trim())
  ) {
    return Response.json({ error: "draftIds must be a non-empty string array" }, { status: 400 });
  }

  const draftIds = [...new Set((draftIdsRaw as string[]).map((id) => id.trim()))];

  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await authSupabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await authSupabase.from("profiles").select("role").eq("id", user.id).single();
  const role = profile?.role as UserRole | undefined;
  if (!canOperate(role)) {
    return Response.json({ error: "Operator role is required" }, { status: 403 });
  }

  const service = createServiceSupabaseClient();

  const { data: drafts, error: loadError } = await service
    .from("product_drafts")
    .select("id, created_by, status, image_status, image_flags")
    .in("id", draftIds);

  if (loadError) {
    return Response.json({ error: loadError.message }, { status: 500 });
  }

  const byId = new Map((drafts ?? []).map((d) => [d.id as string, d]));
  const reviewedAt = new Date().toISOString();
  const confirmed: string[] = [];
  const skipped: Array<{ draftId: string; reason: string }> = [];

  for (const id of draftIds) {
    const draft = byId.get(id);
    if (!draft) {
      skipped.push({ draftId: id, reason: "找不到草稿" });
      continue;
    }
    if (!canActOnDraft(role, user.id, draft.created_by as string | null)) {
      skipped.push({ draftId: id, reason: "只能確認自己的商品" });
      continue;
    }

    const kind = classifyReviewQueueItem({
      status: String(draft.status),
      image_status: String(draft.image_status),
      image_flags: draft.image_flags
    });

    if (kind !== "pending_review") {
      skipped.push({
        draftId: id,
        reason:
          kind === "processing"
            ? "圖片仍在處理中"
            : kind === "failed"
              ? "圖片處理失敗，無法確認"
              : "不在待圖審狀態（可能已確認或尚未處理）"
      });
      continue;
    }

    const nextFlags = mergeImageReviewApproved(draft.image_flags, reviewedAt);
    // R2: 圖審通過 → station③ ready
    const { error: updateError } = await service
      .from("product_drafts")
      .update({
        image_flags: nextFlags,
        pipeline_stage: "ready"
      })
      .eq("id", id);

    if (updateError) {
      skipped.push({ draftId: id, reason: updateError.message });
      continue;
    }
    confirmed.push(id);
  }

  return Response.json({
    ok: confirmed.length > 0,
    confirmed,
    skipped,
    message:
      confirmed.length > 0
        ? `已確認 ${confirmed.length} 件圖審`
        : "沒有可確認的商品"
  });
}
