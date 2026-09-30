import { NextRequest } from "next/server";
import {
  createServerSupabaseClient,
  createServiceSupabaseClient
} from "@/lib/supabase/server";
import { canOperate, isAdmin } from "@/lib/auth/roles";
import {
  disconnectYouTube,
  readYouTubeIntegrationStatus
} from "@/lib/youtube/oauth";
import type { UserRole } from "@/types/domain";

async function actor() {
  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await authSupabase.auth.getUser();
  if (!user) {
    return {
      ok: false as const,
      response: Response.json({ ok: false, error: "Unauthorized" }, { status: 401 })
    };
  }

  const { data: profile } = await authSupabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const role = profile?.role as UserRole | undefined;
  if (!canOperate(role)) {
    return {
      ok: false as const,
      response: Response.json({ ok: false, error: "forbidden" }, { status: 403 })
    };
  }
  return { ok: true as const, user, role };
}

export async function POST(request: NextRequest) {
  const auth = await actor();
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "status";

  let serviceSupabase;
  try {
    serviceSupabase = createServiceSupabaseClient();
  } catch {
    return Response.json(
      { ok: false, error: "server_misconfigured", message: "Supabase service role 尚未設定" },
      { status: 503 }
    );
  }

  if (action === "status") {
    const status = await readYouTubeIntegrationStatus(serviceSupabase);
    return Response.json({ ok: true, ...status });
  }

  if (action === "disconnect") {
    if (!isAdmin(auth.role)) {
      return Response.json(
        { ok: false, error: "forbidden", message: "只有 Admin 可以解除 YouTube 授權" },
        { status: 403 }
      );
    }
    try {
      const result = await disconnectYouTube(serviceSupabase);
      return Response.json({
        ok: true,
        connected: false,
        revoked: result.revoked,
        message: result.revoked
          ? "YouTube 授權已解除"
          : "Nestory 已解除 YouTube 連線；Google 端 token 可能已先失效"
      });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: "disconnect_failed",
          message: error instanceof Error ? error.message : String(error)
        },
        { status: 500 }
      );
    }
  }

  return Response.json(
    { ok: false, error: "invalid_action", message: "action 必須是 status / disconnect" },
    { status: 400 }
  );
}
