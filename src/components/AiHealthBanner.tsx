import { aiHealthBannerText, fetchOpenRouterRemainingUsd, type AiHealthLastRun } from "@/lib/ai/aiHealth";
import { resolveTextAiEndpoint } from "@/lib/providers/textAiEndpoint";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

// COPY-A1: red line under EnvironmentBanner. Server component; never throws (a broken
// health check must not break the page). Only for signed-in users.
export async function AiHealthBanner() {
  try {
    const auth = await createServerSupabaseClient();
    const { data: { user } } = await auth.auth.getUser();
    if (!user) return null;

    const endpoint = resolveTextAiEndpoint();
    const service = createServiceSupabaseClient();
    const { data } = await service
      .from("generation_runs")
      .select("status,error_message,completed_at")
      .in("status", ["completed", "failed"])
      .order("completed_at", { ascending: false, nullsFirst: false })
      .limit(1);
    const row = data?.[0];
    const lastRun: AiHealthLastRun | null = row
      ? { status: row.status === "failed" ? "failed" : "completed", error: row.error_message ?? null, finishedAt: row.completed_at ?? null }
      : null;
    const remaining = endpoint?.via === "openrouter" ? await fetchOpenRouterRemainingUsd(endpoint.apiKey) : null;

    const text = aiHealthBannerText({ hasTextAiKey: endpoint !== null, lastRun, openRouterRemainingUsd: remaining, now: new Date() });
    if (!text) return null;
    return (
      <div className="env-banner env-banner--danger" role="alert" data-testid="ai-health-banner">
        ⚠️ {text}
      </div>
    );
  } catch {
    return null;
  }
}
