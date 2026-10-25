import { NextRequest } from "next/server";
import { canOperate } from "@/lib/auth/roles";
import { fetchAndStoreCaptureImages } from "@/lib/import/fetchRemoteImages";
import { planRestoreExcludedDetailImage } from "@/lib/images/restoreExcludedDetailImage";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/domain";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await authSupabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { data: profile } = await authSupabase.from("profiles").select("role").eq("id", user.id).single();
  if (!canOperate(profile?.role as UserRole | undefined)) {
    return Response.json({ error: "Operator role is required" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { index?: unknown; url?: unknown } | null;
  const index = typeof body?.index === "number" && Number.isInteger(body.index) && body.index >= 0
    ? body.index
    : null;
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (index == null || !url) {
    return Response.json({ error: "參數錯誤" }, { status: 400 });
  }

  const serviceSupabase = createServiceSupabaseClient();
  const { data: draft, error: draftError } = await serviceSupabase
    .from("product_drafts")
    .select("id, source_url, shopify_product_id, raw_capture")
    .eq("id", id)
    .maybeSingle();
  if (draftError || !draft) return Response.json({ error: "找不到草稿" }, { status: 404 });

  const plan = planRestoreExcludedDetailImage(draft.raw_capture, {
    index,
    url,
    published: Boolean(draft.shopify_product_id)
  });
  if (!plan.ok) return Response.json({ error: plan.error }, { status: plan.status });

  let imageResult;
  try {
    imageResult = await fetchAndStoreCaptureImages({
      serviceSupabase,
      userId: user.id,
      draftId: id,
      sourceUrl: String(draft.source_url ?? ""),
      mainImageUrls: [],
      detailImageUrls: [plan.entry.url],
      variantImageUrls: []
    });
  } catch {
    return Response.json({ error: "圖片抓取失敗，請稍後再試" }, { status: 502 });
  }
  if (imageResult.okCount !== 1) {
    return Response.json({ error: "圖片抓取失敗，請稍後再試" }, { status: 502 });
  }

  const imageId = imageResult.urlToImageId[plan.entry.url];
  if (!imageId) {
    return Response.json({ error: "圖片抓取失敗，請稍後再試" }, { status: 502 });
  }

  const { data: detailRows, error: detailError } = await serviceSupabase
    .from("product_images")
    .select("id, sort_order")
    .eq("draft_id", id)
    .eq("image_type", "detail");
  if (detailError) {
    return Response.json({ error: `讀取詳情圖排序失敗：${detailError.message}` }, { status: 500 });
  }
  const maxSortOrder = (detailRows ?? [])
    .filter((row: { id?: string }) => row.id !== imageId)
    .reduce(
      (max: number, row: { sort_order?: number | null }) =>
        typeof row.sort_order === "number" && row.sort_order > max ? row.sort_order : max,
      -1
    );
  const { error: sortError } = await serviceSupabase
    .from("product_images")
    .update({ sort_order: maxSortOrder + 1 })
    .eq("id", imageId);
  if (sortError) {
    return Response.json({ error: `更新詳情圖排序失敗：${sortError.message}` }, { status: 500 });
  }

  const raw =
    draft.raw_capture && typeof draft.raw_capture === "object" && !Array.isArray(draft.raw_capture)
      ? (draft.raw_capture as Record<string, unknown>)
      : {};
  const { error: patchError } = await serviceSupabase
    .from("product_drafts")
    .update({ raw_capture: { ...raw, server: plan.nextServer } })
    .eq("id", id);
  if (patchError) {
    return Response.json({ error: `更新排除清單失敗：${patchError.message}` }, { status: 500 });
  }

  return Response.json({ ok: true });
}
