/**
 * B14: pure helpers for creating an image-send batch (no DB / no secrets).
 * Used by POST /api/drafts/batch/send-images and verify-b14.
 */

import {
  formatUnmarkedBlockMessage,
  isPipelineImage,
  listPipelineImages
} from "@/lib/images/processMarks";
import type { ImageProcessIntent, ProductImage } from "@/types/domain";

export type ImageBatchItemInput = {
  draftId: string;
  title: string;
  images: Array<
    Pick<
      ProductImage,
      "id" | "image_type" | "process_intent" | "is_spec_process" | "sort_order" | "created_at"
    >
  >;
};

export type ImageBatchSnapshotDraft = {
  draftId: string;
  title: string;
  images: Array<{
    imageId: string;
    imageType: string;
    processIntent: ImageProcessIntent;
    isSpecProcess: boolean;
    sortOrder: number;
  }>;
};

export type EvaluateCreateImageBatchResult = {
  ready: ImageBatchItemInput[];
  blocked: Array<{ draftId: string; title: string; reason: string }>;
  readyCount: number;
  blockedCount: number;
  regenerateItemCount: number;
  /** Lightweight create-time snapshot for image_batches.snapshot_json */
  snapshot: ImageBatchSnapshotDraft[];
  /** Operator-facing message when nothing is ready (no batch created). */
  emptyMessage: string | null;
};

/** Success notice after batch row is written (Phase D not wired). */
export function formatImageBatchCreatedMessage(readyCount: number): string {
  return `已建立送圖批次（${readyCount} 件），處理管線 Phase D 接通後自動執行`;
}

export function formatImageBatchPartialMessage(
  readyCount: number,
  blockedLines: string[]
): string {
  const parts = [formatImageBatchCreatedMessage(readyCount)];
  if (blockedLines.length > 0) {
    parts.push(`${blockedLines.length} 件被擋：`);
    parts.push(...blockedLines);
  }
  return parts.join("\n");
}

/** True if this draft has ≥1 pipeline image with process_intent = regenerate (4A). */
export function draftHasRegenerateMark(
  images: Array<Pick<ProductImage, "image_type" | "process_intent">>
): boolean {
  return images.some(
    (img) => isPipelineImage(img) && img.process_intent === "regenerate"
  );
}

export function buildDraftSnapshot(
  item: ImageBatchItemInput
): ImageBatchSnapshotDraft {
  const pipeline = listPipelineImages(item.images as ProductImage[]);
  return {
    draftId: item.draftId,
    title: item.title,
    images: pipeline.map((img) => ({
      imageId: img.id,
      imageType: img.image_type,
      processIntent: img.process_intent as ImageProcessIntent,
      isSpecProcess: Boolean(img.is_spec_process),
      sortOrder: img.sort_order ?? 0
    }))
  };
}

/**
 * Split selection into ready (all pipeline images marked) vs blocked.
 * Ready items get snapshot + regenerate count; no DB side effects.
 */
export function evaluateCreateImageBatch(
  items: ImageBatchItemInput[]
): EvaluateCreateImageBatchResult {
  if (items.length === 0) {
    return {
      ready: [],
      blocked: [],
      readyCount: 0,
      blockedCount: 0,
      regenerateItemCount: 0,
      snapshot: [],
      emptyMessage: "請先勾選商品再批次送圖。"
    };
  }

  const ready: ImageBatchItemInput[] = [];
  const blocked: Array<{ draftId: string; title: string; reason: string }> = [];

  for (const item of items) {
    const reason = formatUnmarkedBlockMessage(item.images as ProductImage[]);
    if (reason) {
      blocked.push({ draftId: item.draftId, title: item.title, reason });
      continue;
    }
    ready.push(item);
  }

  const snapshot = ready.map(buildDraftSnapshot);
  const regenerateItemCount = ready.filter((item) =>
    draftHasRegenerateMark(item.images)
  ).length;

  let emptyMessage: string | null = null;
  if (ready.length === 0) {
    if (blocked.length === 0) {
      emptyMessage = "請先勾選商品再批次送圖。";
    } else {
      emptyMessage = [
        "0 件可建立送圖批次。",
        `${blocked.length} 件被擋：`,
        ...blocked.map((b) => `「${b.title}」：${b.reason}`)
      ].join("\n");
    }
  }

  return {
    ready,
    blocked,
    readyCount: ready.length,
    blockedCount: blocked.length,
    regenerateItemCount,
    snapshot,
    emptyMessage
  };
}

/** Compose final operator message after a batch was (or was not) created. */
export function formatCreateImageBatchResponseMessage(
  evaluated: EvaluateCreateImageBatchResult,
  options?: { batchCreated: boolean }
): string {
  const batchCreated = options?.batchCreated ?? evaluated.readyCount > 0;
  if (!batchCreated || evaluated.readyCount === 0) {
    return evaluated.emptyMessage ?? "無法建立送圖批次。";
  }

  const blockedLines = evaluated.blocked.map(
    (b) => `「${b.title}」：${b.reason}`
  );
  if (blockedLines.length === 0) {
    return formatImageBatchCreatedMessage(evaluated.readyCount);
  }
  return formatImageBatchPartialMessage(evaluated.readyCount, blockedLines);
}
