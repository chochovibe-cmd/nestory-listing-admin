/**
 * COPY-A1: per-stage AI cost bookkeeping for one product generation.
 * OpenRouter reports the real charge (usage.cost, USD) when asked; otherwise we fall back
 * to the list-price estimate in providers/copy.ts. Display/warning only — never blocks a run.
 */
import { estimateCopyCostUsd, type RawUsage } from "@/lib/providers/copy";

export const AI_COST_TWD_PER_USD = 32;
/** 每件 AI 總成本上限（老闆 10-28）。 */
export const AI_COST_CAP_TWD = 2;
/** 每件平均目標（只顯示，不擋）。 */
export const AI_COST_TARGET_TWD = 1;

export type AiStage = "vision" | "understand" | "writer" | "review" | "fix";
export type AiVia = "openrouter" | "openai" | "none";

export type AiStageCost = {
  stage: AiStage;
  model: string;
  via: AiVia;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** true = OpenRouter's own usage.cost; false = our list-price estimate. */
  reported: boolean;
};

export type AiCostRecord = {
  version: "copy-a-cost-1";
  stages: AiStageCost[];
  totalUsd: number;
  totalTwd: number;
  capTwd: number;
  overCap: boolean;
};

const STAGE_LABEL: Record<AiStage, string> = { vision: "看圖", understand: "看懂商品", writer: "寫文案", review: "文案審稿", fix: "自動補寫" };

function finiteNonNeg(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function usdToTwd(usd: number): number {
  return Math.round(usd * AI_COST_TWD_PER_USD * 100) / 100;
}

/** Reported (OpenRouter) cost wins; otherwise list-price estimate. */
export function stageCost(input: {
  stage: AiStage;
  model: string;
  via: AiVia;
  usage: RawUsage;
  reportedCostUsd?: number | null;
}): AiStageCost {
  const reported = typeof input.reportedCostUsd === "number" && Number.isFinite(input.reportedCostUsd) && input.reportedCostUsd >= 0;
  return {
    stage: input.stage,
    model: input.model,
    via: input.via,
    inputTokens: finiteNonNeg(input.usage.inputTokens) + finiteNonNeg(input.usage.cachedInputTokens),
    outputTokens: finiteNonNeg(input.usage.outputTokens),
    costUsd: reported
      ? Math.round((input.reportedCostUsd as number) * 1_000_000) / 1_000_000
      : estimateCopyCostUsd(input.model, input.usage),
    reported,
  };
}

export function buildCostRecord(stages: AiStageCost[]): AiCostRecord {
  const totalUsd = Math.round(stages.reduce((sum, s) => sum + finiteNonNeg(s.costUsd), 0) * 1_000_000) / 1_000_000;
  const totalTwd = usdToTwd(totalUsd);
  return { version: "copy-a-cost-1", stages, totalUsd, totalTwd, capTwd: AI_COST_CAP_TWD, overCap: totalTwd > AI_COST_CAP_TWD };
}

/** Yellow card warning when one product cost more than the cap; null otherwise. */
export function costOverCapWarning(record: AiCostRecord): string | null {
  if (!record.overCap) return null;
  const parts = record.stages
    .filter((s) => s.costUsd > 0)
    .map((s) => `${STAGE_LABEL[s.stage]} NT$${usdToTwd(s.costUsd).toFixed(2)}`);
  return `💸 這件 AI 花費約 NT$${record.totalTwd.toFixed(2)}，超過每件上限 NT$${AI_COST_CAP_TWD}（${parts.join("／")}）`;
}

/** Vision usage relayed by the browser (analyze-images → /api/generate). Bookkeeping only; clamp hard. */
export function sanitizeRelayedStageCost(value: unknown): AiStageCost | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.stage !== "vision" || typeof v.model !== "string" || !v.model.trim()) return null;
  const via: AiVia = v.via === "openrouter" || v.via === "openai" ? v.via : "none";
  const costUsd = Math.min(finiteNonNeg(v.costUsd), 1);
  return {
    stage: "vision",
    model: v.model.trim().slice(0, 80),
    via,
    inputTokens: Math.min(Math.round(finiteNonNeg(v.inputTokens)), 2_000_000),
    outputTokens: Math.min(Math.round(finiteNonNeg(v.outputTokens)), 200_000),
    costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
    reported: v.reported === true,
  };
}
