/**
 * D5: reject image review (Q2-A). Does NOT call Image API (D4).
 * Body: { draftId: string, reason?: string }
 * - image_status → failed
 * - warnings 併「圖審拒絕：…」
 * - clear image_review approved; keep processed_file_url
 * - optional processing_error prefix on pipeline images
 */

import { NextRequest } from "next/server";
import { canOperate, canReview } from "@/lib/auth/roles";
import {
  clearImageReviewApproved,
  mergeRejectWarnings,
  prefixProcessingError
} from "@/lib/images/imageReview";
import { isPipelineImage } from "@/lib/images/processMarks";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import type { ImageType, UserRole } from "@/types/domain";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const draftId = typeof body.draftId === "string" ? body.draftId.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason : "";

  if (!draftId) {
    return Response.json({ error: "draftId is required" }, { status: 400 });
  }

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

  const { data: draft, error: loadError } = await service
    .from("product_drafts")
    .select("id, created_by, status, image_status, image_flags, warnings")
    .eq("id", draftId)
    .maybeSingle();

  if (loadError) {
    return Response.json({ error: loadError.message }, { status: 500 });
  }
  if (!draft) {
    return Response.json({ error: "找不到草稿" }, { status: 404 });
  }
  if (draft.status === "archived") {
    return Response.json({ error: "已封存商品無法圖審拒絕" }, { status: 400 });
  }
  if (!canReview(role) && draft.created_by !== user.id) {
    return Response.json({ error: "只能操作自己的商品" }, { status: 403 });
  }

  const nextFlags = clearImageReviewApproved(draft.image_flags);
  const nextWarnings = mergeRejectWarnings(
    Array.isArray(draft.warnings) ? (draft.warnings as string[]) : [],
    reason
  );

  const { error: updateError } = await service
    .from("product_drafts")
    .update({
      image_status: "failed",
      image_flags: nextFlags,
      warnings: nextWarnings
      // Do NOT touch reviewed_at / reviewed_by / status / processed URLs
    })
    .eq("id", draftId);

  if (updateError) {
    return Response.json({ error: updateError.message }, { status: 500 });
  }

  // Best-effort per-image processing_error prefix (pipeline only).
  const { data: images } = await service
    .from("product_images")
    .select("id, image_type, processing_error")
    .eq("draft_id", draftId);

  for (const img of images ?? []) {
    if (!isPipelineImage({ image_type: img.image_type as ImageType })) continue;
    const nextError = prefixProcessingError(img.processing_error as string | null, reason);
    await service
      .from("product_images")
      .update({ processing_error: nextError })
      .eq("id", img.id);
  }

  return Response.json({
    ok: true,
    draftId,
    image_status: "failed",
    message: "已記錄拒絕，狀態改為可重跑（failed）"
  });
}
