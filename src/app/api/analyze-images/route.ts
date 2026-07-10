import { NextRequest } from "next/server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { canOperate } from "@/lib/auth/roles";
import { describeProductImages } from "@/lib/providers/visionProvider";
import type { ImageType } from "@/types/domain";

// A2 (B1 對齊 Mockup差異備忘 差異2)：standalone sync route so Vision's latency
// never eats into /api/generate's time budget (Vercel 10s limit -- 文案·一).
// Main+detail images -> a description written to product_drafts.image_description.
//
// 規格圖 OCR 已廢棄（見 docs/Mockup差異備忘.md 差異2）：規格資料改由表單手填欄位
// （spec_text），未來由 B3 截圖辨識自動填。所以此路由**不再讀規格圖、不再做 OCR、
// 且絕不回寫 spec_text**——手填的 spec_text 必須被尊重，不能被這支 API 蓋成 null。

type ImageRow = { image_type: ImageType; original_file_url: string | null; sort_order: number };

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const draftId = typeof body.draftId === "string" ? body.draftId : null;

  if (!draftId) {
    return Response.json({ error: "draftId is required" }, { status: 400 });
  }

  const authSupabase = await createServerSupabaseClient();
  const { data: { user } } = await authSupabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await authSupabase.from("profiles").select("role").eq("id", user.id).single();
  if (!canOperate(profile?.role)) {
    return Response.json({ error: "Operator role is required" }, { status: 403 });
  }

  // RLS-scoped read is the authorization check for this draft, same pattern as
  // /api/generate: the query itself fails to find the row if the user can't see it.
  const { data: draftRow, error: draftError } = await authSupabase
    .from("product_drafts")
    .select("id")
    .eq("id", draftId)
    .single();

  if (draftError || !draftRow) {
    return Response.json({ error: draftError?.message ?? "Draft not found" }, { status: 404 });
  }

  const { data: imageRows, error: imagesError } = await authSupabase
    .from("product_images")
    .select("image_type,original_file_url,sort_order")
    .eq("draft_id", draftId)
    .in("image_type", ["main", "detail"])
    .order("sort_order", { ascending: true });

  if (imagesError) {
    return Response.json({ error: imagesError.message }, { status: 500 });
  }

  const rows = (imageRows ?? []) as ImageRow[];
  const describeUrls = rows
    .filter((row) => (row.image_type === "main" || row.image_type === "detail") && row.original_file_url)
    .map((row) => row.original_file_url as string);

  const serviceSupabase = createServiceSupabaseClient();

  if (describeUrls.length === 0) {
    // Never touch spec_text here (it may hold a hand-filled value).
    await serviceSupabase.from("product_drafts").update({ image_status: "skipped" }).eq("id", draftId);
    return Response.json({ ok: true, skipped: true, imageDescription: null, warnings: [] });
  }

  await serviceSupabase.from("product_drafts").update({ image_status: "processing" }).eq("id", draftId);

  const warnings: string[] = [];
  let imageDescription: string | null = null;

  try {
    imageDescription = await describeProductImages(describeUrls);
  } catch (error) {
    warnings.push(`主圖／詳情圖辨識失敗：${error instanceof Error ? error.message : String(error)}`);
  }

  const imageStatus = imageDescription ? "done" : "failed";

  // Only image_description is written -- spec_text is intentionally left alone.
  const { error: updateError } = await serviceSupabase
    .from("product_drafts")
    .update({
      image_description: imageDescription,
      image_status: imageStatus,
    })
    .eq("id", draftId);

  if (updateError) {
    return Response.json({ error: updateError.message }, { status: 500 });
  }

  if (imageStatus === "failed") {
    return Response.json({ error: warnings.join("; ") || "圖片辨識失敗", warnings }, { status: 502 });
  }

  return Response.json({ ok: true, imageDescription, warnings });
}
