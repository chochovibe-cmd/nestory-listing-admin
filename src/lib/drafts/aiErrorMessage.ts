/**
 * 4a-3: operator-facing wording for OpenAI 429 and OpenRouter 402/429 errors. Display only — the raw error stays in
 * product_drafts.generation_error / generation_runs.error_message for debugging.
 */

export const AI_QUOTA_EXHAUSTED_MESSAGE = "OpenAI 額度用完了：請到 OpenAI 後台儲值，再重新生成";
export const AI_RATE_LIMITED_MESSAGE = "OpenAI 暫時太忙（429）：稍等一兩分鐘再重新生成";
export const OPENROUTER_CREDITS_EXHAUSTED_MESSAGE = "OpenRouter 點數用完了：請到 OpenRouter 儲值，再重新生成";
export const OPENROUTER_RATE_LIMITED_MESSAGE = "OpenRouter 暫時太忙（429）：稍等一兩分鐘再重新生成";

/** OpenAI 429 and OpenRouter 402/429 texts are rewritten; anything else stays unchanged. */
export function humanizeAiError(text: string | null | undefined): string {
  const raw = (text ?? "").trim();
  if (!raw) return raw;
  // OPENROUTER: errors from this route carry " [openrouter]" (textAiEndpoint.ts).
  if (/\[openrouter\]/i.test(raw)) {
    if (/\b402\b/.test(raw)) return OPENROUTER_CREDITS_EXHAUSTED_MESSAGE;
    if (/\b429\b/.test(raw)) return OPENROUTER_RATE_LIMITED_MESSAGE;
    return raw;
  }
  if (!/openai/i.test(raw) || !/\b429\b/.test(raw)) return raw;
  if (/insufficient_quota|credit_balance|no credits remaining|exceeded your current quota/i.test(raw)) {
    return AI_QUOTA_EXHAUSTED_MESSAGE;
  }
  return AI_RATE_LIMITED_MESSAGE;
}
