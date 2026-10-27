/**
 * 4a-3: operator-facing wording for OpenAI 429 errors. Display only — the raw error stays in
 * product_drafts.generation_error / generation_runs.error_message for debugging.
 */

export const AI_QUOTA_EXHAUSTED_MESSAGE = "OpenAI 額度用完了：請到 OpenAI 後台儲值，再重新生成";
export const AI_RATE_LIMITED_MESSAGE = "OpenAI 暫時太忙（429）：稍等一兩分鐘再重新生成";

/** Only OpenAI 429 texts are rewritten; anything else is returned unchanged (trimmed). */
export function humanizeAiError(text: string | null | undefined): string {
  const raw = (text ?? "").trim();
  if (!raw) return raw;
  if (!/openai/i.test(raw) || !/\b429\b/.test(raw)) return raw;
  if (/insufficient_quota|credit_balance|no credits remaining|exceeded your current quota/i.test(raw)) {
    return AI_QUOTA_EXHAUSTED_MESSAGE;
  }
  return AI_RATE_LIMITED_MESSAGE;
}
