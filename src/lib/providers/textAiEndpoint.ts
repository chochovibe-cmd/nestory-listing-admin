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
