import { NextRequest } from "next/server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { canOperate } from "@/lib/auth/roles";
import { describeProductImages, ocrSpecImages } from "@/lib/providers/visionProvider";
import { localizeToTaiwanTraditionalText } from "@/lib/zhTwLocalizer";
import type { ImageType } from "@/types/domain";

// A2: standalone sync route so Vision's latency never eats into /api/generate's
// time budget (Vercel 10s limit is the reason this is split out -- 文案·一).
// Main+detail images -> a description written to product_drafts.image_description;
// spec images -> OCR (簡轉繁 via the existing localizer) written to spec_text.
// The two Vision calls run in parallel via Promise.allSettled so one failing
// doesn't block the other from writing its half of the result.

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
    .in("image_type", ["main", "detail", "spec"])
    .order("sort_order", { ascending: true });

  if (imagesError) {
    return Response.json({ error: imagesError.message }, { status: 500 });
  }

  const rows = (imageRows ?? []) as ImageRow[];
  const describeUrls = rows
    .filter((row) => (row.image_type === "main" || row.image_type === "detail") && row.original_file_url)
    .map((row) => row.original_file_url as string);
  const specUrls = rows
    .filter((row) => row.image_type === "spec" && row.original_file_url)
    .map((row) => row.original_file_url as string);

  const serviceSupabase = createServiceSupabaseClient();

  if (describeUrls.length === 0 && specUrls.length === 0) {
    await serviceSupabase.from("product_drafts").update({ image_status: "skipped" }).eq("id", draftId);
    return Response.json({ ok: true, skipped: true, imageDescription: null, specText: null, warnings: [] });
  }

  await serviceSupabase.from("product_drafts").update({ image_status: "processing" }).eq("id", draftId);

  const [descResult, ocrResult] = await Promise.allSettled([
    describeUrls.length > 0 ? describeProductImages(describeUrls) : Promise.resolve(null),
    specUrls.length > 0 ? ocrSpecImages(specUrls) : Promise.resolve(null),
  ]);

  const warnings: string[] = [];
  let imageDescription: string | null = null;
  let specText: string | null = null;

  if (describeUrls.length > 0) {
    if (descResult.status === "fulfilled") {
      imageDescription = descResult.value;
    } else {
      warnings.push(`主圖／詳情圖辨識失敗：${descResult.reason instanceof Error ? descResult.reason.message : String(descResult.reason)}`);
    }
  }

  if (specUrls.length > 0) {
    if (ocrResult.status === "fulfilled" && ocrResult.value) {
      specText = localizeToTaiwanTraditionalText(ocrResult.value);
    } else if (ocrResult.status === "rejected") {
      warnings.push(`規格圖 OCR 失敗：${ocrResult.reason instanceof Error ? ocrResult.reason.message : String(ocrResult.reason)}`);
    }
  }

  // "failed" when every call we actually attempted came back empty-handed;
  // partial success (one side worked) still counts as done -- the operator
  // gets the warning and can retry, but usable data was written either way.
  const attempted = (describeUrls.length > 0 ? 1 : 0) + (specUrls.length > 0 ? 1 : 0);
  const succeeded = (imageDescription ? 1 : 0) + (specText ? 1 : 0);
  const imageStatus = succeeded === 0 && attempted > 0 ? "failed" : "done";

  const { error: updateError } = await serviceSupabase
    .from("product_drafts")
    .update({
      image_description: imageDescription,
      spec_text: specText,
      image_status: imageStatus,
    })
    .eq("id", draftId);

  if (updateError) {
    return Response.json({ error: updateError.message }, { status: 500 });
  }

  if (imageStatus === "failed") {
    return Response.json({ error: warnings.join("; ") || "圖片辨識失敗", warnings }, { status: 502 });
  }

  return Response.json({ ok: true, imageDescription, specText, warnings });
}
