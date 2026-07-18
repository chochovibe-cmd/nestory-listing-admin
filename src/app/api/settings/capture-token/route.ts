import { NextRequest } from "next/server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { canOperate } from "@/lib/auth/roles";
import {
  issueCaptureToken,
  readCaptureTokenStatus
} from "@/lib/import/captureAuth";
import type { UserRole } from "@/types/domain";

/**
 * CAP-1: personal capture token status / generate / reset.
 * Session auth (operator+admin); service role writes hash columns.
 * route.ts exports only HTTP methods.
 */
export async function POST(request: NextRequest) {
  let action = "status";
  try {
    const body = await request.json().catch(() => ({}));
    if (body && typeof body.action === "string") {
      action = body.action.trim().toLowerCase();
    }
  } catch {
    // empty body → status
  }

  if (!["status", "generate", "reset"].includes(action)) {
    return Response.json(
      {
        ok: false,
        error: "invalid_action",
        message: "action 必須是 status / generate / reset"
      },
      { status: 400 }
    );
  }

  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await authSupabase.auth.getUser();
  if (!user) {
    return Response.json({ ok: false, error: "Unauthorized", message: "請先登入" }, { status: 401 });
  }

  const { data: profile } = await authSupabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!canOperate(profile?.role as UserRole | null)) {
    return Response.json(
      { ok: false, error: "forbidden", message: "需要 operator 或 admin 角色" },
      { status: 403 }
    );
  }

  let serviceSupabase;
  try {
    serviceSupabase = createServiceSupabaseClient();
  } catch {
    return Response.json(
      {
        ok: false,
        error: "server_misconfigured",
        message: "伺服器未設定 SUPABASE_SERVICE_ROLE_KEY"
      },
      { status: 503 }
    );
  }

  if (action === "status") {
    const status = await readCaptureTokenStatus(serviceSupabase, user.id);
    if (!status.ok) {
      return Response.json(
        { ok: false, error: status.error, message: status.message },
        { status: status.error === "migration_required" ? 503 : 500 }
      );
    }
    return Response.json({
      ok: true,
      hasToken: status.hasToken,
      prefix: status.prefix,
      created_at: status.created_at
    });
  }

  // generate + reset both issue a new token (overwrite hash)
  const issued = await issueCaptureToken(serviceSupabase, user.id);
  if (!issued.ok) {
    return Response.json(
      { ok: false, error: issued.error, message: issued.message },
      { status: issued.error === "migration_required" ? 503 : 500 }
    );
  }

  return Response.json({
    ok: true,
    action,
    token: issued.token,
    prefix: issued.prefix,
    created_at: issued.created_at,
    message:
      action === "reset"
        ? "已重設擷取 token（舊 token 立即失效）。請複製新 token 到擴充設定。"
        : "已產生擷取 token。請立刻複製保存，離開後無法再顯示完整內容。"
  });
}
