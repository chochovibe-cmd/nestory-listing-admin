import { NextRequest } from "next/server";
import { buildGptRawCsv, type GptRawProduct } from "@/lib/csv/gptRawExport";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAllRows";
import type { ProductImage, ProductVariantRow } from "@/types/domain";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "請先登入後再匯出" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || !["admin", "reviewer"].includes(profile.role)) {
    return Response.json({ error: "目前帳號沒有匯出權限" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body?.draftIds) && body.draftIds.every((id: unknown) => typeof id === "string")
    ? [...new Set(body.draftIds as string[])] : null;
  if (!ids?.length) return Response.json({ error: "請選擇要匯出的商品" }, { status: 400 });
  if (ids.length > 100) return Response.json({ error: "一次最多匯出 100 件" }, { status: 400 });

  const service = createServiceSupabaseClient();
  const { data, error } = await service.from("product_drafts").select("*, product_images(*)")
    .in("id", ids).order("created_at", { ascending: false });
  if (error) return Response.json({ error: "讀取商品資料失敗，請稍後重試" }, { status: 500 });
  const drafts = (data ?? []) as GptRawProduct[];
  if (drafts.length !== ids.length || drafts.some((draft) => draft.status === "archived" || !draft.gpt_handoff_at)) {
    return Response.json({ error: "有商品不在「交給 GPT」清單，請重新整理" }, { status: 400 });
  }

  const { data: variantRows, error: variantError } = await fetchAllRows((from, to) =>
    service.from("product_variants").select("*").in("draft_id", ids)
      .order("sort_order", { ascending: true }).order("id").range(from, to));
  if (variantError) return Response.json({ error: "讀取款式資料失敗，請稍後重試" }, { status: 500 });
  const byDraft = new Map<string, ProductVariantRow[]>();
  for (const row of (variantRows ?? []) as ProductVariantRow[]) {
    const list = byDraft.get(row.draft_id) ?? [];
    list.push(row);
    byDraft.set(row.draft_id, list);
  }
  const products = drafts.map((draft) => ({
    ...draft,
    product_images: ((draft.product_images ?? []) as ProductImage[]),
    product_variants: byDraft.get(draft.id) ?? []
  }));
  let csv: string;
  try { csv = buildGptRawCsv(products); }
  catch { return Response.json({ error: "CSV 產生失敗，資料未更新" }, { status: 500 }); }

  const { error: updateError } = await service.from("product_drafts").update({ gpt_exported_at: new Date().toISOString() }).in("id", ids);
  if (updateError) return Response.json({ error: "匯出紀錄更新失敗，請重試" }, { status: 500 });
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8" } });
}
