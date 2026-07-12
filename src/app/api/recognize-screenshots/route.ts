import { NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canOperate } from "@/lib/auth/roles";
import {
  recognizeProductScreenshots,
  type ScreenshotRecognizeMode
} from "@/lib/providers/visionProvider";
import {
  MAX_SCREENSHOT_IMAGES,
  parseRecognitionJson,
  type RecognitionFields
} from "@/lib/screenshotRecognition";
import { localizeToTaiwanTraditionalText } from "@/lib/zhTwLocalizer";

// B3: 截圖辨識（商品頁／規格表）。瀏覽器已直傳 Storage，本 API 只收公開 URL，
// 不接收檔案本體（Vercel 4.5MB 上限）。回結構化欄位供表單只填空白（2A 在前端做）。

function localizeFields(fields: RecognitionFields): RecognitionFields {
  return {
    title: fields.title ? localizeToTaiwanTraditionalText(fields.title) : null,
    costCny: fields.costCny,
    features: fields.features ? localizeToTaiwanTraditionalText(fields.features) : null,
    specText: fields.specText ? localizeToTaiwanTraditionalText(fields.specText) : null,
    variants: fields.variants.map((v) => ({
      name: localizeToTaiwanTraditionalText(v.name),
      costCny: v.costCny
    }))
  };
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const rawUrls = Array.isArray(body.imageUrls) ? body.imageUrls : [];
  const imageUrls = rawUrls
    .filter((u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u.trim()))
    .map((u: string) => u.trim())
    .slice(0, MAX_SCREENSHOT_IMAGES);

  const modeRaw = typeof body.mode === "string" ? body.mode : "product";
  const mode: ScreenshotRecognizeMode = modeRaw === "spec" ? "spec" : "product";

  if (imageUrls.length === 0) {
    return Response.json(
      { error: "請至少上傳一張截圖（imageUrls 需為可公開讀取的 https 網址）" },
      { status: 400 }
    );
  }

  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await authSupabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await authSupabase.from("profiles").select("role").eq("id", user.id).single();
  if (!canOperate(profile?.role)) {
    return Response.json({ error: "Operator role is required" }, { status: 403 });
  }

  try {
    const raw = await recognizeProductScreenshots(imageUrls, mode);
    const parsed = localizeFields(parseRecognitionJson(raw));
    return Response.json({
      ok: true,
      mode,
      fields: parsed,
      rawPreview: raw.slice(0, 200)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: `截圖辨識失敗：${message}` }, { status: 502 });
  }
}
