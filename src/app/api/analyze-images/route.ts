import { NextRequest } from "next/server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { canOperate } from "@/lib/auth/roles";
import { parseImageFlags, VISION_STATUS_FLAG_KEY } from "@/lib/images/imageReview";
import { describeProductImages } from "@/lib/providers/visionProvider";
import type { ImageType } from "@/types/domain";

// A2 (B1 對齊 Mockup差異備忘 差異2)：standalone sync route so Vision's latency
// never eats into /api/generate's time budget (Vercel 10s limit -- 文案·一).
// Main+detail images -> a description written to product_drafts.image_description.
//
// 規格圖 OCR 已廢棄（見 docs/Mockup差異備忘.md 差異2）：規格資料改由表單手填欄位
// （spec_text），未來由 B3 截圖辨識自動填。所以此路由**不再讀規格圖、不再做 OCR、
// 且絕不回寫 spec_text**——手填的 spec_text 必須被尊重，不能被這支 API 蓋成 null。
//
// P1-3 / 回饋 52: Vision MUST NOT write product_drafts.image_status (shared with D3/D5
// image pipeline). Status lives under image_flags.vision_status only.

type ImageRow = {
  image_type: ImageType;
  original_file_url: string | null;
  /** A19: prefer ~1280 mid for Vision when present */
  vision_mid_url?: string | null;
  sort_order: number;
};

type VisionStatus = "processing" | "done" | "failed" | "skipped";

async function mergeVisionStatus(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  draftId: string,
  visionStatus: VisionStatus,
  extra: Record<string, unknown> = {}
) {
  const { data: row } = await serviceSupabase
    .from("product_drafts")
    .select("image_flags")
    .eq("id", draftId)
    .maybeSingle();

  const flags = {
    ...parseImageFlags(row?.image_flags),
    [VISION_STATUS_FLAG_KEY]: visionStatus
  };

  return serviceSupabase
    .from("product_drafts")
    .update({
      ...extra,
      image_flags: flags
      // intentionally never touch image_status here
    })
    .eq("id", draftId);
}

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

  // A19: prefer vision_mid_url (~1280) over original for faster Vision; fall back if 039 not applied.
  const { data: imageRows, error: imagesError } = await authSupabase
    .from("product_images")
    .select("image_type,original_file_url,vision_mid_url,sort_order")
    .eq("draft_id", draftId)
    .in("image_type", ["main", "detail"])
    .order("sort_order", { ascending: true });

  // Column may be missing before migration 039 — retry without it.
  let rows: ImageRow[] = [];
  if (imagesError) {
    const missingMid =
      /vision_mid_url|column/i.test(imagesError.message) ||
      /schema cache/i.test(imagesError.message);
    if (!missingMid) {
      return Response.json({ error: imagesError.message }, { status: 500 });
    }
    const fallback = await authSupabase
      .from("product_images")
      .select("image_type,original_file_url,sort_order")
      .eq("draft_id", draftId)
      .in("image_type", ["main", "detail"])
      .order("sort_order", { ascending: true });
    if (fallback.error) {
      return Response.json({ error: fallback.error.message }, { status: 500 });
    }
    rows = (fallback.data ?? []) as ImageRow[];
  } else {
    rows = (imageRows ?? []) as ImageRow[];
  }

  const describeUrls = rows
    .map((row) => {
      if (row.image_type !== "main" && row.image_type !== "detail") return null;
      const mid = typeof row.vision_mid_url === "string" ? row.vision_mid_url.trim() : "";
      const orig = typeof row.original_file_url === "string" ? row.original_file_url.trim() : "";
      return mid || orig || null;
    })
    .filter((url): url is string => Boolean(url));

  const serviceSupabase = createServiceSupabaseClient();

  if (describeUrls.length === 0) {
    // Never touch spec_text here (it may hold a hand-filled value).
    // Never touch image_status (pipeline field).
    await mergeVisionStatus(serviceSupabase, draftId, "skipped");
    return Response.json({ ok: true, skipped: true, imageDescription: null, warnings: [] });
  }

  await mergeVisionStatus(serviceSupabase, draftId, "processing");

  const warnings: string[] = [];
  let imageDescription: string | null = null;

  try {
    imageDescription = await describeProductImages(describeUrls);
  } catch (error) {
    warnings.push(`主圖／詳情圖辨識失敗：${error instanceof Error ? error.message : String(error)}`);
  }

  const visionStatus: VisionStatus = imageDescription ? "done" : "failed";

  // Only image_description is written -- spec_text is intentionally left alone.
  // image_status intentionally left alone (P1-3).
  const { error: updateError } = await mergeVisionStatus(serviceSupabase, draftId, visionStatus, {
    image_description: imageDescription
  });

  if (updateError) {
    return Response.json({ error: updateError.message }, { status: 500 });
  }

  if (visionStatus === "failed") {
    return Response.json({ error: warnings.join("; ") || "圖片辨識失敗", warnings }, { status: 502 });
  }

  return Response.json({ ok: true, imageDescription, warnings });
}
