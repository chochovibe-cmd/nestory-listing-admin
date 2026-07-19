/**
 * BX7: rough pre-generate cost range for the form CTA (not an invoice).
 * Uses same ballpark as copy rates + Vision + optional web search.
 * Display only; honesty label always says 僅供參考.
 */

import { DEFAULT_USD_TO_TWD, usdToNtd } from "@/lib/dashboard/costBudgetStats";

export type GenerateCostHintInput = {
  /** Main + variant thumbs about to go through Vision. */
  mainImageCount: number;
  /** Detail images (Vision description). */
  detailImageCount: number;
  useWebSearch: boolean;
  provider: "claude" | "openai";
  /** Test mode → free. (ModeSwitcher: llm | test) */
  runMode?: "llm" | "test" | string;
};

export type GenerateCostHint = {
  minNtd: number;
  maxNtd: number;
  /** Short line under the generate button. */
  label: string;
  /** Longer title/tooltip. */
  title: string;
};

/** Typical full-copy tokens (conservative mid). */
const COPY_IN = 2800;
const COPY_OUT = 2200;

/** Per-image vision rough USD (gpt-4o-mini order of magnitude). */
const VISION_USD_PER_IMAGE = 0.004;
/** Web search add-on rough USD when enabled. */
const WEB_SEARCH_USD = 0.015;

function copyUsd(provider: "claude" | "openai"): number {
  // sonnet ~$3/$15 per M; gpt-4o ~$2.5/$10
  if (provider === "openai") {
    return (COPY_IN / 1e6) * 2.5 + (COPY_OUT / 1e6) * 10;
  }
  return (COPY_IN / 1e6) * 3 + (COPY_OUT / 1e6) * 15;
}

/**
 * Build a soft NT$ range. Spreads ±35% so we never look like a fixed quote.
 */
export function buildGenerateCostHint(input: GenerateCostHintInput): GenerateCostHint {
  if (input.runMode === "test") {
    return {
      minNtd: 0,
      maxNtd: 0,
      label: "測試模式 · 本次 $0（不呼叫 AI）",
      title: "測試模式不會呼叫付費 AI"
    };
  }

  const mains = Math.max(0, Math.min(8, Math.floor(input.mainImageCount || 0)));
  const details = Math.max(0, Math.min(12, Math.floor(input.detailImageCount || 0)));
  const visionUsd = (mains + details) * VISION_USD_PER_IMAGE;
  const webUsd = input.useWebSearch ? WEB_SEARCH_USD : 0;
  const midUsd = copyUsd(input.provider) + visionUsd + webUsd;
  const lowUsd = midUsd * 0.65;
  const highUsd = midUsd * 1.45 + 0.01;

  const minNtd = Math.max(1, Math.round(usdToNtd(lowUsd, DEFAULT_USD_TO_TWD)));
  const maxNtd = Math.max(minNtd + 1, Math.round(usdToNtd(highUsd, DEFAULT_USD_TO_TWD)));

  return {
    minNtd,
    maxNtd,
    label: `本次預估約 NT$${minNtd}–${maxNtd}（僅供參考）`,
    title:
      "依目前模型／圖片數／Web Search 粗估，不是帳單。實際以生成後 generation_cost_estimate 為準。"
  };
}
