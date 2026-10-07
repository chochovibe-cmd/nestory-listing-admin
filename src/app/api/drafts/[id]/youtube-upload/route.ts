import { NextRequest } from "next/server";
import { canPublish } from "@/lib/auth/roles";
import {
  createServerSupabaseClient,
  createServiceSupabaseClient
} from "@/lib/supabase/server";
import { ensureDraftVideosOnYouTube } from "@/lib/youtube/ensureDraftVideos";
import type { UserRole } from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (body.confirm !== true) {
    return Response.json(
      { ok: false, error: "confirm_required", message: "YouTube 上傳是外部寫入，需 confirm=true" },
      { status: 400 }
    );
  }

  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await authSupabase.auth.getUser();
  if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await authSupabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!canPublish(profile?.role as UserRole | undefined)) {
    return Response.json(
      { ok: false, error: "forbidden", message: "Reviewer/Admin 才能把影片寫入 YouTube" },
      { status: 403 }
    );
  }

  const { data: visible } = await authSupabase
    .from("product_drafts")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!visible?.id) {
    return Response.json({ ok: false, error: "not_found", message: "找不到商品草稿" }, { status: 404 });
  }

  const serviceSupabase = createServiceSupabaseClient();
  const { data: draft, error } = await serviceSupabase
    .from("product_drafts")
    .select("id, title_zh, taobao_title, video_urls")
    .eq("id", id)
    .single();
  if (error || !draft) {
    return Response.json(
      { ok: false, error: "load_failed", message: error?.message ?? "找不到商品草稿" },
      { status: 500 }
    );
  }

  const result = await ensureDraftVideosOnYouTube({
    serviceSupabase,
    draft
  });
  return Response.json({ ok: true, ...result });
}
