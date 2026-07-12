/**
 * B9 + B14: batch ▶ 送圖 — B5 gate + create-batch message shape.
 * Server persists batch via POST /api/drafts/batch/send-images;
 * this helper remains for client pre-check / verify scripts.
 */

import {
  evaluateCreateImageBatch,
  formatCreateImageBatchResponseMessage,
  type ImageBatchItemInput
} from "@/lib/drafts/createImageBatch";
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
  /** B14: true when a batch would be created (readyCount > 0). */
  wouldCreateBatch: boolean;
};

export function evaluateBatchSendImages(items: BatchSendImagesItem[]): BatchSendImagesResult {
  const evaluated = evaluateCreateImageBatch(items as ImageBatchItemInput[]);
  const blockedLines = evaluated.blocked.map((b) => `「${b.title}」：${b.reason}`);
  return {
    readyCount: evaluated.readyCount,
    blockedCount: evaluated.blockedCount,
    blockedLines,
    message: formatCreateImageBatchResponseMessage(evaluated, {
      batchCreated: evaluated.readyCount > 0
    }),
    wouldCreateBatch: evaluated.readyCount > 0
  };
}
