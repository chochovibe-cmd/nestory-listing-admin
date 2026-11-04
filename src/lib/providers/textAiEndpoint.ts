/**
 * OPENROUTER (2026-10-28): every text-model call (Writer, Product Brief, variant-name
 * polish, Vision ×2) speaks OpenAI's chat/completions format, which OpenRouter accepts
 * as-is. OPENROUTER_API_KEY set → those calls go to OpenRouter; unset → OpenAI direct,
 * exactly as before. Image calls (images/edits, images/generations) have no OpenRouter
 * equivalent and stay on OPENAI_API_KEY in openai-image-provider.ts.
 */

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

export type TextAiEndpoint = {
  url: string;
  apiKey: string;
  via: "openrouter" | "openai";
};

const REASONING_EFFORTS = ["minimal", "low", "medium", "high"] as const;

/**
 * COPY-A1: extra request-body fields per route. OpenRouter: always ask for usage.cost
 * (real charge in USD); add reasoning effort only when TEXT_AI_REASONING_EFFORT is set
 * (reasoning tokens bill as output). OpenAI direct: nothing extra (unchanged behaviour).
 */
export function textAiExtraBody(endpoint: TextAiEndpoint): Record<string, unknown> {
  if (endpoint.via !== "openrouter") return {};
  const extra: Record<string, unknown> = { usage: { include: true } };
  const effort = process.env.TEXT_AI_REASONING_EFFORT?.trim().toLowerCase();
  if (effort && (REASONING_EFFORTS as readonly string[]).includes(effort)) {
    extra.reasoning = { effort };
  }
  return extra;
}

/** Normalised usage from a chat/completions payload; reportedCostUsd only when the route reported it. */
export function readChatUsage(payload: unknown): {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  reportedCostUsd: number | null;
} {
  const u = (payload as { usage?: Record<string, unknown> } | null)?.usage ?? {};
  const details = (u.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const cached = Number(details.cached_tokens) || 0;
  const cost = Number(u.cost);
  return {
    inputTokens: Math.max((Number(u.prompt_tokens) || 0) - cached, 0),
    outputTokens: Number(u.completion_tokens) || 0,
    cachedInputTokens: cached,
    cacheCreationTokens: 0,
    reportedCostUsd: u.cost !== undefined && u.cost !== null && Number.isFinite(cost) && cost >= 0 ? cost : null,
  };
}

/** OpenRouter wins when both keys are set; null when neither is. */
export function resolveTextAiEndpoint(): TextAiEndpoint | null {
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  if (openRouterKey) return { url: OPENROUTER_CHAT_URL, apiKey: openRouterKey, via: "openrouter" };
  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  if (openAiKey) return { url: OPENAI_CHAT_URL, apiKey: openAiKey, via: "openai" };
  return null;
}

/** OpenRouter names models "vendor/model"; bare OpenAI names get "openai/". */
export function textAiModelId(endpoint: TextAiEndpoint, model: string): string {
  return endpoint.via === "openrouter" && !model.includes("/") ? `openai/${model}` : model;
}

/** Appended right after "(status)" in error text so humanizeAiError can tell OpenRouter apart. */
export function textAiErrorTag(endpoint: TextAiEndpoint): string {
  return endpoint.via === "openrouter" ? " [openrouter]" : "";
}
