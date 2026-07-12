/**
 * B9: batch ▶ 送圖 — client-side B5 gate, no webhook (Phase D still pending).
 */

import {
  formatReadyButPipelinePendingMessage,
  formatUnmarkedBlockMessage
} from "@/lib/images/processMarks";
import type { ProductImage } from "@/types/domain";

export type BatchSendImagesItem = {
  draftId: string;
  title: string;
  images: ProductImage[];
};

export type BatchSendImagesResult = {
  readyCount: number;
  blockedCount: number;
  blockedLines: string[];
  /** Operator-facing summary (always non-empty when items.length > 0). */
  message: string;
};

export function evaluateBatchSendImages(items: BatchSendImagesItem[]): BatchSendImagesResult {
  if (items.length === 0) {
    return {
      readyCount: 0,
      blockedCount: 0,
      blockedLines: [],
      message: "請先勾選商品再批次送圖。"
    };
  }

  const blockedLines: string[] = [];
  let readyCount = 0;
  let blockedCount = 0;
  let lastReadyMessage = "";

  for (const item of items) {
    const block = formatUnmarkedBlockMessage(item.images);
    if (block) {
      blockedCount += 1;
      blockedLines.push(`「${item.title}」：${block}`);
      continue;
    }
    readyCount += 1;
    lastReadyMessage = formatReadyButPipelinePendingMessage(item.images);
  }

  const parts: string[] = [];
  if (readyCount > 0) {
    parts.push(
      `${readyCount} 件標記齊全。${lastReadyMessage || "圖片處理管線尚未接通（Phase D）。"}`
    );
  }
  if (blockedCount > 0) {
    parts.push(`${blockedCount} 件被擋：`);
    parts.push(...blockedLines);
  }

  return {
    readyCount,
    blockedCount,
    blockedLines,
    message: parts.join("\n")
  };
}
