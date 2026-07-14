import { NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canOperate } from "@/lib/auth/roles";
import { fetchSourceUrl } from "@/lib/sourceFetch/fetchSourceUrl";

/**
 * B3-fetch-open: lightweight product URL fetch (server-side only).
 * Returns structured fields for 2A empty-only fill on the client.
 * Taobao/Tmall anti-bot empty results are honest failures (not bugs).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const sourceUrl =
    typeof body.sourceUrl === "string"
      ? body.sourceUrl
      : typeof body.url === "string"
        ? body.url
        : "";

  if (!sourceUrl.trim()) {
    return Response.json(
      {
        ok: false,
        reason: "invalid",
        message: "請先貼上商品網址。",
        fields: {
          title: null,
          costCny: null,
          features: null,
          specText: null,
          variants: []
        }
      },
      { status: 400 }
    );
  }

  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await authSupabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await authSupabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!canOperate(profile?.role)) {
    return Response.json({ error: "Operator role is required" }, { status: 403 });
  }

  const result = await fetchSourceUrl(sourceUrl);

  if (!result.ok) {
    // Q1-A: anti-bot / empty / timeout stay 200 with ok:false so UI can show info yellow.
    // Hard client mistakes (ssrf / scheme / invalid) use 400.
    const hard = result.reason === "ssrf" || result.reason === "scheme" || result.reason === "invalid";
    return Response.json(
      {
        ok: false,
        reason: result.reason,
        hostClass: result.hostClass,
        httpStatus: result.httpStatus ?? null,
        message: result.message,
        fields: result.fields
      },
      { status: hard ? 400 : 200 }
    );
  }

  return Response.json({
    ok: true,
    hostClass: result.hostClass,
    message: result.message,
    fields: result.fields
  });
}
