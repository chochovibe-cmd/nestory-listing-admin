/**
 * COPY-A1: one red line at the top of every page when text AI is down or about to run dry.
 * 10-20 (missing key) and 10-22 (OpenAI out of credit) were only noticed days later.
 */
import { humanizeAiError } from "@/lib/drafts/aiErrorMessage";
import { AI_COST_TWD_PER_USD } from "./aiCost";

/** 低於這個餘額就提醒（約 60–100 件商品的量）。 */
export const AI_HEALTH_LOW_BALANCE_USD = 2;
/** 失敗多久以內才提醒；之後有成功的生成就自動消失。 */
export const AI_HEALTH_FAILURE_WINDOW_HOURS = 48;

export type AiHealthLastRun = { status: "completed" | "failed"; error: string | null; finishedAt: string | null };

export type AiHealthInput = {
  hasTextAiKey: boolean;
  lastRun: AiHealthLastRun | null;
  openRouterRemainingUsd: number | null;
  now: Date;
};

/** Provider-side failure (auth, credit, rate limit, 5xx, missing key) — not timeouts or network blips. */
export function isAiProviderFailure(message: string | null | undefined): boolean {
  const text = (message ?? "").trim();
  if (!text) return false;
  return /failed \((?:401|402|403|429|5\d\d)\)|not configured|insufficient_quota/i.test(text);
}

function taipeiTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

/** Banner text, or null when everything is fine. Priority: no key > recent failure > low balance. */
export function aiHealthBannerText(input: AiHealthInput): string | null {
  if (!input.hasTextAiKey) {
    return "AI 文案停擺：伺服器沒有設定 OPENROUTER_API_KEY（或 OPENAI_API_KEY），新商品產不出文案。";
  }
  const run = input.lastRun;
  if (run && run.status === "failed" && isAiProviderFailure(run.error)) {
    const finished = run.finishedAt ? new Date(run.finishedAt).getTime() : NaN;
    const ageHours = Number.isFinite(finished) ? (input.now.getTime() - finished) / 3_600_000 : 0;
    if (ageHours <= AI_HEALTH_FAILURE_WINDOW_HOURS) {
      const reason = humanizeAiError(run.error).replace(/\s+/g, " ").slice(0, 80);
      const when = taipeiTime(run.finishedAt);
      return `AI 文案生成失敗${when ? `（${when}）` : ""}：${reason}。修好前新商品產不出文案。`;
    }
  }
  const remaining = input.openRouterRemainingUsd;
  if (typeof remaining === "number" && Number.isFinite(remaining) && remaining < AI_HEALTH_LOW_BALANCE_USD) {
    const twd = Math.max(0, Math.round(remaining * AI_COST_TWD_PER_USD));
    return `OpenRouter 餘額剩 US$${Math.max(0, remaining).toFixed(2)}（約 NT$${twd}），快用完了：請到 OpenRouter 儲值。`;
  }
  return null;
}

/** GET /api/v1/credits → total_credits - total_usage (USD). Any problem → null (no balance line). */
export async function fetchOpenRouterRemainingUsd(apiKey: string): Promise<number | null> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(3000),
      next: { revalidate: 600 },
    } as RequestInit);
    if (!response.ok) return null;
    const payload = (await response.json()) as { data?: { total_credits?: unknown; total_usage?: unknown } };
    const credits = Number(payload?.data?.total_credits);
    const usage = Number(payload?.data?.total_usage);
    if (!Number.isFinite(credits) || !Number.isFinite(usage)) return null;
    return Math.round((credits - usage) * 100) / 100;
  } catch {
    return null;
  }
}
