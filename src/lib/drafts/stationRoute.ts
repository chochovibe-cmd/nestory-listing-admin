/**
 * R2: station② 「審核」分流器 (回饋 54) + AI mark estimates.
 * Pure helpers — no DB.
 *
 * Q3-B: all-keep still runs batch→sharp→finalize (not skip pipeline).
 * AI cost count = to_trad + de_text + regenerate only.
 */

import {
  isPipelineImage,
  listPipelineImages,
} from "@/lib/images/processMarks";
import type { ImageProcessIntent, ProductImage } from "@/types/domain";
import type { PipelineStage } from "@/lib/drafts/pipelineStage";

/** Intents that require Image API (count toward AI estimate). */
export const AI_PROCESS_INTENTS: ReadonlySet<ImageProcessIntent> = new Set([
  "to_trad",
  "de_text",
  "regenerate",
]);

export type ImageMarkSummary = {
  keep: number;
  to_trad: number;
  de_text: number;
  regenerate: number;
  unmarked: number;
  pipeline: number;
  /** AI-billable marks (to_trad + de_text + regenerate). */
  aiCount: number;
};

export type StationRouteDecision =
  | {
      action: "send_images";
      /** Always true for R2: even all-keep uses batch chain (Q3-B). */
      needsBatch: true;
      allKeep: boolean;
      aiCount: number;
      marks: ImageMarkSummary;
      nextStageIfNoAiQueue: PipelineStage;
    }
  | {
      action: "return_copy";
      nextStage: "copy_review";
    }
  | {
      action: "blocked";
      reason: string;
    };

export function countImageMarkSummary(
  images: Array<Pick<ProductImage, "image_type" | "process_intent">>
): ImageMarkSummary {
  const pipeline = images.filter(isPipelineImage);
  const marks: ImageMarkSummary = {
    keep: 0,
    to_trad: 0,
    de_text: 0,
    regenerate: 0,
    unmarked: 0,
    pipeline: pipeline.length,
    aiCount: 0,
  };
  for (const img of pipeline) {
    const intent = img.process_intent as ImageProcessIntent | null;
    if (intent == null) {
      marks.unmarked += 1;
      continue;
    }
    if (intent === "keep") marks.keep += 1;
    else if (intent === "to_trad") {
      marks.to_trad += 1;
      marks.aiCount += 1;
    } else if (intent === "de_text") {
      marks.de_text += 1;
      marks.aiCount += 1;
    } else if (intent === "regenerate") {
      marks.regenerate += 1;
      marks.aiCount += 1;
    }
  }
  return marks;
}

/** Human line for station② card header, e.g.「3 保留／1 簡轉繁／0 去字／0 重生」. */
export function formatMarkSummaryLine(marks: ImageMarkSummary): string {
  if (marks.pipeline === 0) return "尚無商品圖";
  return `${marks.keep} 保留／${marks.to_trad} 簡轉繁／${marks.de_text} 去字／${marks.regenerate} 重生`;
}

/**
 * Confirm copy before station② 審核 sends images.
 * allKeep still needs batch (Q3-B); aiCount for cost estimate UI.
 */
export function decideStation2Review(input: {
  images: Array<Pick<ProductImage, "image_type" | "process_intent">>;
  /** When true, block if any pipeline image still null. */
  requireAllMarked?: boolean;
}): StationRouteDecision {
  const images = input.images;
  const pipeline = listPipelineImages(images as ProductImage[]);
  if (pipeline.length === 0) {
    return {
      action: "blocked",
      reason: "沒有可處理的商品圖。請先上傳主圖。",
    };
  }
  const marks = countImageMarkSummary(images);
  if (input.requireAllMarked !== false && marks.unmarked > 0) {
    return {
      action: "blocked",
      reason: `還有 ${marks.unmarked} 張未標記。請先標記或重新核准以寫入「保留原圖」。`,
    };
  }
  const allKeep = marks.aiCount === 0 && marks.unmarked === 0;
  return {
    action: "send_images",
    needsBatch: true,
    allKeep,
    aiCount: marks.aiCount,
    marks,
    /** After all-keep chain completes, review-confirm / chain should land ready;
     *  R2 UI treats post-send as image_review until chain finishes → ready. */
    nextStageIfNoAiQueue: "ready",
  };
}

export function isAiProcessIntent(
  intent: ImageProcessIntent | null | undefined
): boolean {
  return intent != null && AI_PROCESS_INTENTS.has(intent);
}

/** Estimate line for confirm modal. */
export function formatAiEstimateMessage(aiCount: number, allKeep: boolean): string {
  if (allKeep || aiCount <= 0) {
    return "全部保留原圖：不呼叫 AI 生圖，仍會走轉檔與圖床（不額外 AI 費用）。";
  }
  return `預估 AI 處理 ${aiCount} 張（簡轉繁／去字／重生）。確認後送生圖工廠佇列。`;
}
