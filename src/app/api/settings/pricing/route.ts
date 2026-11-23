import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { canOperate } from "@/lib/auth/roles";
import type { UserRole } from "@/types/domain";
import { defaultPricingSettings, type PricingSettings } from "@/lib/pricing";
import { pickEditablePricing, PRICING_SETTINGS_KEY, validatePricingSettings } from "@/lib/pricingSettingsShared";

const unauthorized = () => Response.json(
  { ok: false, error: "Unauthorized", message: "請先登入" },
  { status: 401 }
);
const forbidden = () => Response.json(
  { ok: false, error: "forbidden", message: "需要 operator、reviewer 或 admin 角色" },
  { status: 403 }
);
const misconfigured = () => Response.json(
  { ok: false, error: "server_misconfigured", message: "伺服器未設定 SUPABASE_SERVICE_ROLE_KEY" },
  { status: 503 }
);

async function getAuthorizedService() {
  const authSupabase = await createServerSupabaseClient();
  const { data: { user } } = await authSupabase.auth.getUser();
  if (!user) return { response: unauthorized() } as const;
  const { data: profile } = await authSupabase.from("profiles").select("role").eq("id", user.id).single();
  if (!canOperate(profile?.role as UserRole | null)) return { response: forbidden() } as const;
  try {
    return { service: createServiceSupabaseClient(), user } as const;
  } catch {
    return { response: misconfigured() } as const;
  }
}

export async function GET() {
  const auth = await getAuthorizedService();
  if ("response" in auth) return auth.response;
  const { data, error } = await auth.service
    .from("team_settings")
    .select("value, updated_at")
    .eq("key", PRICING_SETTINGS_KEY)
    .maybeSingle();
  if (error) return Response.json({ ok: false, error: "db_error", message: "讀取雲端定價設定失敗" }, { status: 500 });
  if (!data) return Response.json({ ok: true, settings: null, updatedAt: null });
  const parsed = validatePricingSettings(data.value);
  if (!parsed.ok) {
    return Response.json({ ok: false, error: "invalid_cloud_settings", message: "雲端定價設定格式不正確，請到設定頁重新儲存一次" }, { status: 500 });
  }
  const settings: PricingSettings = { ...parsed.settings, version: data.updated_at };
  return Response.json({ ok: true, settings, updatedAt: data.updated_at });
}

export async function PUT(request: Request) {
  const auth = await getAuthorizedService();
  if ("response" in auth) return auth.response;
  const body = await request.json().catch(() => ({}));
  const { data: existing, error: readError } = await auth.service
    .from("team_settings")
    .select("value")
    .eq("key", PRICING_SETTINGS_KEY)
    .maybeSingle();
  if (readError) return Response.json({ ok: false, error: "db_error", message: "存到雲端失敗" }, { status: 500 });
  const existingParsed = existing ? validatePricingSettings(existing.value) : null;
  const base: PricingSettings = existingParsed?.ok ? existingParsed.settings : defaultPricingSettings;
  const merged = { ...base, ...pickEditablePricing(isRecord(body) ? body.settings : undefined) };
  const parsed = validatePricingSettings(merged);
  if (!parsed.ok) {
    return Response.json({ ok: false, error: "invalid_settings", field: parsed.field, message: parsed.message }, { status: 400 });
  }
  const { error: upsertError } = await auth.service.from("team_settings").upsert({
    key: PRICING_SETTINGS_KEY,
    value: parsed.settings,
    updated_by: auth.user.id
  }, { onConflict: "key" });
  if (upsertError) return Response.json({ ok: false, error: "db_error", message: "存到雲端失敗" }, { status: 500 });
  const { data, error } = await auth.service
    .from("team_settings")
    .select("value, updated_at")
    .eq("key", PRICING_SETTINGS_KEY)
    .single();
  if (error || !data) return Response.json({ ok: false, error: "db_error", message: "存到雲端失敗" }, { status: 500 });
  const saved = validatePricingSettings(data.value);
  if (!saved.ok) return Response.json({ ok: false, error: "db_error", message: "存到雲端失敗" }, { status: 500 });
  return Response.json({ ok: true, settings: { ...saved.settings, version: data.updated_at }, updatedAt: data.updated_at });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
