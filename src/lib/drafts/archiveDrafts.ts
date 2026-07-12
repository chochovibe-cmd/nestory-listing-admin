/**
 * B12: soft-archive / unarchive pure logic.
 * Batch archive skips processing/publishing per-item (like batch 送圖), never fails whole batch.
 */

import type { DraftStatus } from "@/types/domain";

/** In-flight statuses: skip on archive, do not fail the batch. */
export const ARCHIVE_BUSY_STATUSES = new Set<string>(["processing", "publishing"]);

/** Already on Shopify path — archive only hides from tool list. */
export const ARCHIVE_PUBLISHED_STATUSES = new Set<string>([
  "draft_created",
  "active_published",
  "csv_ready"
]);

export type ArchiveDraftInput = {
  id: string;
  status: string;
  title?: string | null;
  generation_status?: string | null;
  title_zh?: string | null;
  taobao_title?: string | null;
  original_title?: string | null;
};

export type ArchiveSkipItem = {
  id: string;
  title: string;
  reason: "busy" | "already_archived" | "not_archived";
};

export type EvaluateArchiveResult = {
  toArchiveIds: string[];
  skippedBusy: ArchiveSkipItem[];
  skippedAlready: ArchiveSkipItem[];
  /** True if any id that will archive is currently a published-side status. */
  includesPublished: boolean;
};

export type EvaluateUnarchiveResult = {
  toRestoreIds: string[];
  skippedNotArchived: ArchiveSkipItem[];
};

export function displayDraftTitle(draft: ArchiveDraftInput): string {
  return (
    draft.title?.trim() ||
    draft.title_zh?.trim() ||
    draft.taobao_title?.trim() ||
    draft.original_title?.trim() ||
    "未命名商品"
  );
}

export function isArchiveBusyStatus(status: string): boolean {
  return ARCHIVE_BUSY_STATUSES.has(status);
}

export function isPublishedArchiveStatus(status: string): boolean {
  return ARCHIVE_PUBLISHED_STATUSES.has(status);
}

export function evaluateBatchArchive(items: ArchiveDraftInput[]): EvaluateArchiveResult {
  const toArchiveIds: string[] = [];
  const skippedBusy: ArchiveSkipItem[] = [];
  const skippedAlready: ArchiveSkipItem[] = [];
  let includesPublished = false;

  for (const item of items) {
    const title = displayDraftTitle(item);
    if (item.status === "archived") {
      skippedAlready.push({ id: item.id, title, reason: "already_archived" });
      continue;
    }
    if (isArchiveBusyStatus(item.status)) {
      skippedBusy.push({ id: item.id, title, reason: "busy" });
      continue;
    }
    if (isPublishedArchiveStatus(item.status)) {
      includesPublished = true;
    }
    toArchiveIds.push(item.id);
  }

  return { toArchiveIds, skippedBusy, skippedAlready, includesPublished };
}

export function evaluateBatchUnarchive(items: ArchiveDraftInput[]): EvaluateUnarchiveResult {
  const toRestoreIds: string[] = [];
  const skippedNotArchived: ArchiveSkipItem[] = [];

  for (const item of items) {
    const title = displayDraftTitle(item);
    if (item.status !== "archived") {
      skippedNotArchived.push({ id: item.id, title, reason: "not_archived" });
      continue;
    }
    toRestoreIds.push(item.id);
  }

  return { toRestoreIds, skippedNotArchived };
}

/**
 * Heuristic restore when status_before_archive is missing (old rows / 024 not applied).
 */
export function resolveUnarchiveStatus(input: {
  statusBeforeArchive: string | null | undefined;
  generationStatus?: string | null;
  hasCopy?: boolean;
}): DraftStatus {
  const prior = input.statusBeforeArchive;
  if (prior && prior !== "archived") {
    return prior as DraftStatus;
  }
  if (input.generationStatus === "completed" || input.hasCopy) {
    return "ready_for_review";
  }
  if (input.generationStatus === "failed") {
    return "api_failed";
  }
  return "pending_input";
}

export const SHOPIFY_STILL_LIVE_NOTE = "Shopify 商品仍在店裡，僅從工具列表隱藏";

/**
 * Operator-facing success / partial-success message for batch or single archive.
 */
export function formatArchiveResultMessage(input: {
  archivedCount: number;
  skippedBusyCount: number;
  skippedAlreadyCount?: number;
  includesPublished: boolean;
  emptySelection?: boolean;
}): string {
  if (input.emptySelection) {
    return "請先勾選商品再批次封存。";
  }

  const parts: string[] = [];

  if (input.archivedCount > 0) {
    parts.push(`${input.archivedCount} 件已封存`);
  } else {
    parts.push("沒有商品被封存");
  }

  if (input.skippedBusyCount > 0) {
    parts.push(`${input.skippedBusyCount} 件進行中跳過（生成中／上架中）`);
  }

  if ((input.skippedAlreadyCount ?? 0) > 0) {
    parts.push(`${input.skippedAlreadyCount} 件本來就是已封存`);
  }

  let message = parts.join("、");
  if (input.archivedCount > 0 && input.includesPublished) {
    message += `。${SHOPIFY_STILL_LIVE_NOTE}`;
  } else if (input.archivedCount > 0) {
    message += "。可用「已封存」篩選找回，或按下方解除封存。";
  }

  return message;
}

export function formatUnarchiveResultMessage(input: {
  restoredCount: number;
  skippedNotArchivedCount?: number;
}): string {
  const parts: string[] = [];
  if (input.restoredCount > 0) {
    parts.push(`已解除封存 ${input.restoredCount} 件`);
  } else {
    parts.push("沒有商品被解除封存");
  }
  if ((input.skippedNotArchivedCount ?? 0) > 0) {
    parts.push(`${input.skippedNotArchivedCount} 件本來就不是封存狀態`);
  }
  return parts.join("、");
}
