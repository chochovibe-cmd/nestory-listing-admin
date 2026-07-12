import { NextRequest } from "next/server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { canOperate } from "@/lib/auth/roles";
import {
  isSameCharacterIdentity,
  normalizeCharacterIdentity,
} from "@/lib/characters/normalizeCharacterIdentity";
import { localizeToTaiwanTraditionalText } from "@/lib/zhTwLocalizer";

/**
 * B4: one-click add missing character into ip_characters as pending.
 * - Operator-facing; writes via service role (RLS only allows admin writes).
 * - Does NOT write tag_rules (V2 is authoritative; see Mockup差異備忘).
 * - Duplicate check uses NFKC + trim identity normalize before compare.
 * - is_active=true so regenerate can emit 角色_ tags immediately.
 * - review_status=pending for Phase C admin governance (not a hard gate).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const rawCharacter =
    typeof body.characterName === "string"
      ? body.characterName
      : typeof body.character === "string"
        ? body.character
        : "";
  const rawIp =
    typeof body.ipName === "string" ? body.ipName : typeof body.ip === "string" ? body.ip : "";
  const draftId = typeof body.draftId === "string" ? body.draftId : null;

  const characterName = normalizeCharacterIdentity(
    localizeToTaiwanTraditionalText(rawCharacter),
  );
  const ipName = normalizeCharacterIdentity(rawIp);

  if (!characterName) {
    return Response.json({ error: "請提供角色名稱" }, { status: 400 });
  }
  if (!ipName) {
    return Response.json(
      { error: "請先確認 IP 已偵測／建檔後再新增角色（缺少 ipName）" },
      { status: 400 },
    );
  }

  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await authSupabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await authSupabase.from("profiles").select("role").eq("id", user.id).single();
  if (!canOperate(profile?.role)) {
    return Response.json({ error: "Operator role is required" }, { status: 403 });
  }

  const serviceSupabase = createServiceSupabaseClient();

  // 2A: IP must already exist in ip_catalog (FK). Do not auto-create IP.
  const { data: ipRow, error: ipError } = await serviceSupabase
    .from("ip_catalog")
    .select("ip_name")
    .eq("ip_name", ipName)
    .maybeSingle();

  if (ipError) {
    return Response.json({ error: `查詢 IP 失敗：${ipError.message}` }, { status: 500 });
  }

  // Also try alias match if exact ip_name miss (AI may return alias display form).
  let resolvedIpName = ipRow?.ip_name as string | undefined;
  if (!resolvedIpName) {
    const { data: catalogRows, error: catalogError } = await serviceSupabase
      .from("ip_catalog")
      .select("ip_name,aliases")
      .eq("is_active", true);
    if (catalogError) {
      return Response.json({ error: `查詢 IP 清單失敗：${catalogError.message}` }, { status: 500 });
    }
    const match = (catalogRows ?? []).find((entry) => {
      if (isSameCharacterIdentity(entry.ip_name, ipName)) return true;
      return (entry.aliases ?? []).some((alias: string) => isSameCharacterIdentity(alias, ipName));
    });
    resolvedIpName = match?.ip_name;
  }

  if (!resolvedIpName) {
    return Response.json(
      {
        error: `請先在設定把 IP「${ipName}」建檔（或確認偵測 IP 名稱）後再新增角色`,
        code: "ip_not_in_catalog",
      },
      { status: 400 },
    );
  }

  const { data: existingRows, error: listError } = await serviceSupabase
    .from("ip_characters")
    .select("id,ip_name,character_name,aliases,review_status,is_active")
    .eq("ip_name", resolvedIpName);

  if (listError) {
    return Response.json({ error: `查詢角色字典失敗：${listError.message}` }, { status: 500 });
  }

  const existing = (existingRows ?? []).find((row) => {
    if (isSameCharacterIdentity(row.character_name, characterName)) return true;
    return (row.aliases ?? []).some((alias: string) => isSameCharacterIdentity(alias, characterName));
  });

  if (existing) {
    return Response.json({
      ok: true,
      alreadyExists: true,
      character: {
        id: existing.id,
        ipName: existing.ip_name,
        characterName: existing.character_name,
        reviewStatus: existing.review_status ?? "approved",
        isActive: existing.is_active,
      },
      message: `角色「${existing.character_name}」已在字典中，請按重新生成以產出角色 tag`,
      draftId,
    });
  }

  const { data: inserted, error: insertError } = await serviceSupabase
    .from("ip_characters")
    .insert({
      ip_name: resolvedIpName,
      character_name: characterName,
      aliases: [],
      sort_order: 0,
      is_active: true,
      review_status: "pending",
      created_by: user.id,
    })
    .select("id,ip_name,character_name,review_status,is_active")
    .single();

  if (insertError) {
    // Race: unique (ip_name, character_name) — treat as already exists after re-read.
    if (insertError.code === "23505") {
      return Response.json({
        ok: true,
        alreadyExists: true,
        message: `角色「${characterName}」已在字典中，請按重新生成以產出角色 tag`,
        draftId,
      });
    }
    // Column missing (migration 021 not applied yet)
    if (
      insertError.message?.includes("review_status") ||
      insertError.message?.includes("created_by") ||
      insertError.code === "42703"
    ) {
      return Response.json(
        {
          error:
            "資料庫尚未套用 migration 021（ip_characters.review_status）。請到 Supabase SQL Editor 執行 supabase/migrations/021_ip_characters_pending.sql 後再試。",
          code: "migration_021_required",
        },
        { status: 503 },
      );
    }
    return Response.json({ error: `新增角色失敗：${insertError.message}` }, { status: 500 });
  }

  return Response.json({
    ok: true,
    alreadyExists: false,
    character: {
      id: inserted.id,
      ipName: inserted.ip_name,
      characterName: inserted.character_name,
      reviewStatus: inserted.review_status,
      isActive: inserted.is_active,
    },
    message: `已新增角色「${inserted.character_name}」（待審），請按重新生成以產出角色 tag`,
    draftId,
  });
}
