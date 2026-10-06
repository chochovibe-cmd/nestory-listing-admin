import { runDuePublishSchedules } from "@/lib/shopify/runDuePublishSchedules";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

function isProtectedRuntime(): boolean {
  return process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview";
}

function authorize(request: Request): { ok: true } | { ok: false; reason: string } {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization");
  if (secret) {
    return auth === `Bearer ${secret}`
      ? { ok: true }
      : { ok: false, reason: "invalid_or_missing_bearer" };
  }
  if (isProtectedRuntime()) return { ok: false, reason: "cron_secret_not_configured" };
  return { ok: true };
}

export async function GET(request: Request) {
  const auth = authorize(request);
  if (!auth.ok) {
    return Response.json(
      { ok: false, error: "unauthorized", reason: auth.reason },
      { status: 401 }
    );
  }

  try {
    const result = await runDuePublishSchedules({
      serviceSupabase: createServiceSupabaseClient(),
      claimLimit: Number(process.env.PUBLISH_SCHEDULE_CLAIM_LIMIT ?? 50)
    });

    if (!result.ok) {
      return Response.json(result, { status: result.status });
    }
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      { ok: false, error: "scheduled_publish_failed", message: message.slice(0, 500) },
      { status: 500 }
    );
  }
}
