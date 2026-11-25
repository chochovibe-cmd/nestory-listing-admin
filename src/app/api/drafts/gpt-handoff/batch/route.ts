import { NextRequest } from "next/server";
import { canOperate } from "@/lib/auth/roles";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/domain";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const draftIds: unknown = body?.draftIds;
  if (!Array.isArray(draftIds) || draftIds.length === 0 || !draftIds.every((id) => typeof id === "string" && id.trim().length > 0)) {
    return Response.json({ error: "請選擇要送出的擷取草稿" }, { status: 400 });
  }
  const ids = [...new Set<string>(draftIds)];
  if (ids.length > 100) {
    return Response.json({ error: "一次最多送出 100 件" }, { status: 400 });
  }

  const authSupabase = await createServerSupabaseClient();
  const { data: { user } } = await authSupabase.auth.getUser();
  if (!user) return Response.json({ error: "請先登入" }, { status: 401 });

  const { data: profile } = await authSupabase.from("profiles").select("role").eq("id", user.id).single();
  if (!canOperate(profile?.role as UserRole | undefined)) {
    return Response.json({ error: "目前帳號沒有送出權限" }, { status: 403 });
  }

  const service = createServiceSupabaseClient();
  const now = new Date().toISOString();
  const { data, error } = await service.from("product_drafts")
    .update({ gpt_handoff_at: now, gpt_exported_at: null })
    .in("id", ids)
    .eq("created_by", user.id)
    .eq("source_type", "capture")
    .eq("status", "pending_input")
    .is("gpt_handoff_at", null)
    .select("id");

  if (error) return Response.json({ error: "送出失敗，資料未更新，請稍後重試" }, { status: 500 });
  const sentIds = (data ?? []).map((row) => row.id as string);
  if (!sentIds.length) {
    return Response.json({ error: "這些擷取草稿已經送過或有變動，請重新整理" }, { status: 409 });
  }
  return Response.json({ sentIds, skipped: ids.length - sentIds.length });
}
