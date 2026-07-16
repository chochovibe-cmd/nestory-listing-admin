/**
 * E1-open: dashboard "今日待辦" buckets (backlog, not calendar day).
 * Reuses B12 stageFilter + D5 imageReview vocabulary — no new statuses, zero migration.
 *
 * Q1-A backlog · Q2-A failed union · Q4-A deep-link via sessionStorage stage · Q5-A cap 200 · Q6-A show zeros
 */

import {
  STAGE_FILTER_STORAGE_KEY_QUEUE,
  STAGE_FILTER_STORAGE_KEY_RESULTS,
  writeStoredStage,
  type StageKey
} from "@/lib/drafts/stageFilter";
import {
  classifyReviewQueueItem,
  isImageReviewApproved
} from "@/lib/images/imageReview";

export type TodoBucketKey =
  | "copy_review"
  | "image_review"
  | "failed"
  | "ready_to_publish";

export type TodoDraftRow = {
  id: string;
  status: string;
  generation_status?: string | null;
  image_status?: string | null;
  image_flags?: unknown;
  /** P1-3: required to count image review / image fail (pipeline only). */
  current_image_batch_id?: string | null;
  created_by?: string | null;
  updated_at?: string | null;
  /** E2 funnel dwell (A13 timestamps; optional for E1-only callers) */
  created_at?: string | null;
  copy_generated_at?: string | null;
  reviewed_at?: string | null;
  published_at?: string | null;
};

export const TODO_FETCH_LIMIT = 200;

/** Shared E1+E2 dashboard select (timestamps for funnel dwell). */
export const TODO_DRAFT_SELECT_COLUMNS =
  "id, status, generation_status, image_status, image_flags, current_image_batch_id, created_by, updated_at, created_at, copy_generated_at, reviewed_at, published_at";

const FLOW_FAILED_STATUSES = new Set(["failed", "api_failed"]);
const READY_PUBLISH_STATUSES = new Set(["approved", "publishing"]);

/** 文案待審 — stageFilter copy_review */
export function isCopyReviewTodo(row: TodoDraftRow): boolean {
  if (row.status === "archived") return false;
  return row.status === "ready_for_review";
}

/** 圖片待審 — D5 pending_review only (not processing/failed); requires pipeline batch (P1-3). */
export function isImageReviewTodo(row: TodoDraftRow): boolean {
  return (
    classifyReviewQueueItem({
      status: row.status,
      image_status: String(row.image_status ?? "pending"),
      image_flags: row.image_flags,
      current_image_batch_id: row.current_image_batch_id
    }) === "pending_review"
  );
}

/** 文案／發布／生成失敗（不含單純圖失敗） */
export function isFlowFailedTodo(row: TodoDraftRow): boolean {
  if (row.status === "archived") return false;
  return FLOW_FAILED_STATUSES.has(row.status) || row.generation_status === "failed";
}

/** 圖片處理失敗 — only after 送圖 pipeline (P1-3; not Vision-only image_status). */
export function isImageFailedTodo(row: TodoDraftRow): boolean {
  if (row.status === "archived") return false;
  if (row.image_status !== "failed") return false;
  const batchId = row.current_image_batch_id;
  return typeof batchId === "string" && batchId.trim().length > 0;
}

/** Q2-A: failed union by draft (flow ∪ image) */
export function isFailedUnionTodo(row: TodoDraftRow): boolean {
  return isFlowFailedTodo(row) || isImageFailedTodo(row);
}

/** 待發布 — stageFilter approved (approved + publishing) */
export function isReadyToPublishTodo(row: TodoDraftRow): boolean {
  if (row.status === "archived") return false;
  return READY_PUBLISH_STATUSES.has(row.status);
}

export type TodoBucketCounts = {
  copy_review: number;
  image_review: number;
  failed: number;
  /** image_status=failed 件數（副標「含圖失敗 n」） */
  failed_image: number;
  ready_to_publish: number;
  scanned: number;
  /** true when fetch hit TODO_FETCH_LIMIT — counts may under-report */
  truncated: boolean;
};

export function countTodoBuckets(
  rows: TodoDraftRow[],
  fetchLimit: number = TODO_FETCH_LIMIT
): TodoBucketCounts {
  let copy_review = 0;
  let image_review = 0;
  let failed = 0;
  let failed_image = 0;
  let ready_to_publish = 0;

  for (const row of rows) {
    if (row.status === "archived") continue;
    if (isCopyReviewTodo(row)) copy_review += 1;
    if (isImageReviewTodo(row)) image_review += 1;
    if (isFailedUnionTodo(row)) failed += 1;
    if (isImageFailedTodo(row)) failed_image += 1;
    if (isReadyToPublishTodo(row)) ready_to_publish += 1;
  }

  return {
    copy_review,
    image_review,
    failed,
    failed_image,
    ready_to_publish,
    scanned: rows.length,
    truncated: rows.length >= fetchLimit
  };
}

export type TodoCardDef = {
  key: TodoBucketKey;
  label: string;
  count: number;
  action: string;
  /** optional sub line under count */
  sub: string | null;
  schipClass: string;
  schipLabel: string;
  href: string;
  /** sessionStorage stage to pre-select on target page */
  stage?: StageKey;
  stageStorageKey?: string;
};

/**
 * Four cards always returned (Q6-A show zeros).
 */
export function buildTodoCards(counts: TodoBucketCounts): TodoCardDef[] {
  const failedSub =
    counts.failed_image > 0 ? `含圖失敗 ${counts.failed_image}` : null;

  return [
    {
      key: "copy_review",
      label: "文案待審",
      count: counts.copy_review,
      action: "去審文案",
      sub: null,
      schipClass: "schip schip--warn",
      schipLabel: "文案已生成・待審核",
      href: "/drafts/new",
      stage: "copy_review",
      stageStorageKey: STAGE_FILTER_STORAGE_KEY_RESULTS
    },
    {
      key: "image_review",
      label: "圖片待審",
      count: counts.image_review,
      action: "去生圖工廠",
      sub: null,
      schipClass: "schip schip--warn",
      schipLabel: "圖片待審",
      href: "/review"
    },
    {
      key: "failed",
      label: "失敗",
      count: counts.failed,
      action: "查看失敗",
      sub: failedSub,
      schipClass: "schip schip--error",
      schipLabel: "失敗",
      // R4: /drafts queue offline → workbench results or records failed tab
      href: "/drafts/new?pane=results",
      stage: "failed",
      stageStorageKey: STAGE_FILTER_STORAGE_KEY_RESULTS
    },
    {
      key: "ready_to_publish",
      label: "待發布",
      count: counts.ready_to_publish,
      action: "去發布",
      sub: null,
      schipClass: "schip schip--ok",
      schipLabel: "已核准・待發布",
      href: "/drafts/new?pane=results",
      stage: "approved",
      stageStorageKey: STAGE_FILTER_STORAGE_KEY_RESULTS
    }
  ];
}

/** Write stage into sessionStorage then return href (Q4-A). */
export function prepareTodoNavigation(
  card: Pick<TodoCardDef, "href" | "stage" | "stageStorageKey">,
  storage: Pick<Storage, "setItem"> | null | undefined
): string {
  if (card.stage && card.stageStorageKey) {
    writeStoredStage(card.stage, storage, card.stageStorageKey);
  }
  return card.href;
}

/** Truncation notice when scan hit limit. */
export function todoTruncationNotice(counts: TodoBucketCounts): string | null {
  if (!counts.truncated) return null;
  return `最多統計最近 ${TODO_FETCH_LIMIT} 件（目前掃到 ${counts.scanned} 筆）`;
}

/** Exported for tests — image flag approved helper re-export surface */
export { isImageReviewApproved };
