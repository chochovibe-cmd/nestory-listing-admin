import { NextRequest } from "next/server";
import { buildGptRawCsv, type GptRawProduct } from "@/lib/csv/gptRawExport";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAllRows";
import type { ProductImage, ProductVariantRow } from "@/types/domain";
import { assertGptCdnWriteAllowed, createGptCdnProof, GPT_CDN_BATCH_SIZE, gptCdnCandidates, isGptCdnUrl, resolveGptCdnImage, verifyGptCdnProof, withGptCdnUrls } from "@/lib/csv/gptExportCdn";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "請先登入後再匯出" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || !["admin", "reviewer"].includes(profile.role)) {
    return Response.json({ error: "目前帳號沒有匯出權限" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const action = body?.action ?? "export";
  if (!["plan", "prepare", "export"].includes(action)) return Response.json({ error: "無效匯出操作" }, { status: 400 });
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
  const candidates = gptCdnCandidates(products);
  if (action === "plan") {
    return Response.json({ images: candidates.filter((item) => !isGptCdnUrl(item.sourceUrl))
      .map(({ draftId, imageId }) => ({ draftId, imageId })), batchSize: GPT_CDN_BATCH_SIZE });
  }

  const secret = process.env.SHOPIFY_CLIENT_SECRET ?? "";
  if (action === "prepare") {
    const imageIds = Array.isArray(body?.imageIds) && body.imageIds.every((id: unknown) => typeof id === "string")
      ? [...new Set<string>(body.imageIds as string[])] : [];
    if (!imageIds.length || imageIds.length > GPT_CDN_BATCH_SIZE) {
      return Response.json({ error: "圖片準備批次超出範圍" }, { status: 400 });
    }
    const byImage = new Map(candidates.map((item) => [item.imageId, item]));
    if (imageIds.some((id) => !byImage.has(id))) {
      return Response.json({ error: "匯出圖片已有變動，請重新匯出" }, { status: 409 });
    }
    if (!secret) return Response.json({ error: "Shopify 圖片設定未完成" }, { status: 503 });
    try {
      if (imageIds.some((id) => !isGptCdnUrl(byImage.get(id)!.sourceUrl))) assertGptCdnWriteAllowed();
      // One shared operation for identical source URLs within this small batch.
      const jobs = new Map<string, Promise<string>>();
      const results = await Promise.allSettled(imageIds.map(async (id) => {
        const candidate = byImage.get(id)!;
        let job = jobs.get(candidate.sourceUrl);
        if (!job) {
          job = resolveGptCdnImage(candidate.sourceUrl);
          jobs.set(candidate.sourceUrl, job);
        }
        const url = await job;
        return [id, createGptCdnProof(candidate, user.id, url, secret)] as const;
      }));
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      const entries = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      return Response.json({ proofs: Object.fromEntries(entries) });
    } catch {
      return Response.json({ error: "Shopify 圖片準備未完成，請確認商店設定或稍後重新匯出；原始圖片及匯出紀錄未變更" }, { status: 502 });
    }
  }

  const proofs = body?.proofs && typeof body.proofs === "object" && !Array.isArray(body.proofs)
    ? body.proofs as Record<string, unknown> : {};
  const urls = new Map<string, string>();
  for (const item of candidates) {
    const url = isGptCdnUrl(item.sourceUrl) ? item.sourceUrl
      : verifyGptCdnProof(item, user.id, Object.hasOwn(proofs, item.imageId) ? proofs[item.imageId] : null, secret);
    if (!url) return Response.json({ error: "有圖片尚未轉入 Shopify CDN 或資料已有變動，請重新匯出" }, { status: 409 });
    urls.set(item.imageId, url);
  }

  let csv: string;
  try { csv = buildGptRawCsv(withGptCdnUrls(products, urls)); }
  catch { return Response.json({ error: "CSV 產生失敗，資料未更新" }, { status: 500 }); }

  const { error: updateError } = await service.from("product_drafts").update({ gpt_exported_at: new Date().toISOString() }).in("id", ids);
  if (updateError) return Response.json({ error: "匯出紀錄更新失敗，請重試" }, { status: 500 });
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8" } });
}
