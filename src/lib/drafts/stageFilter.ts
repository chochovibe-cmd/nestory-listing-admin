/**
 * B12: shared stage filter for workbench results + /drafts queue.
 * Uses existing draft_status vocabulary (+ derived「圖片未標記」); no new statuses.
 */

import type { DraftStatus, ProductImage } from "@/types/domain";

export type StageKey =
  | "all"
  | "pending_input"
  | "copy_review"
  | "needs_revision"
  | "approved"
  | "unmarked_images"
  | "failed"
  | "published"
  | "archived";

export const STAGE_FILTER_STORAGE_KEY_RESULTS = "nestory:results-stage";
export const STAGE_FILTER_STORAGE_KEY_QUEUE = "nestory:queue-stage";

export const DEFAULT_STAGE: StageKey = "all";

export const STAGE_OPTIONS: { key: StageKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "pending_input", label: "待輸入" },
  { key: "copy_review", label: "文案待審" },
  { key: "needs_revision", label: "需修改" },
  { key: "approved", label: "已核准" },
  { key: "unmarked_images", label: "圖片未標記" },
  { key: "failed", label: "失敗" },
  { key: "published", label: "已發布" },
  { key: "archived", label: "已封存" }
];

const STAGE_KEYS = new Set<StageKey>(STAGE_OPTIONS.map((o) => o.key));

export function isStageKey(value: unknown): value is StageKey {
  return typeof value === "string" && STAGE_KEYS.has(value as StageKey);
}

export function readStoredStage(
  storage: Pick<Storage, "getItem"> | null | undefined,
  storageKey: string
): StageKey {
  try {
    const raw = storage?.getItem(storageKey);
    if (isStageKey(raw)) return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_STAGE;
}

export function writeStoredStage(
  stage: StageKey,
  storage: Pick<Storage, "setItem"> | null | undefined,
  storageKey: string
): void {
  try {
    storage?.setItem(storageKey, stage);
  } catch {
    /* ignore */
  }
}

export type StageDraft = {
  id: string;
  status: DraftStatus | string;
  generation_status?: string | null;
};

export type StageImage = Pick<ProductImage, "draft_id" | "image_type" | "process_intent">;

const FAILED_STATUSES = new Set(["failed", "api_failed"]);
const APPROVED_STATUSES = new Set(["approved", "publishing"]);
const PUBLISHED_STATUSES = new Set(["draft_created", "active_published", "csv_ready"]);

function isPipelineImageType(imageType: string | null | undefined): boolean {
  return imageType === "main" || imageType === "spec" || imageType === "variant";
}

function hasUnmarkedPipeline(draftId: string, images: StageImage[] | undefined): boolean {
  if (!images?.length) return false;
  return images.some(
    (img) =>
      img.draft_id === draftId &&
      isPipelineImageType(img.image_type) &&
      img.process_intent == null
  );
}

/**
 * "全部" = every non-archived draft.
 * "已封存" = only archived.
 * Other stages exclude archived automatically.
 */
export function matchesStage(
  draft: StageDraft,
  stage: StageKey,
  images?: StageImage[]
): boolean {
  const status = draft.status;
  const isArchived = status === "archived";

  if (stage === "archived") return isArchived;
  if (isArchived) return false;

  switch (stage) {
    case "all":
      return true;
    case "pending_input":
      return status === "pending_input";
    case "copy_review":
      return status === "ready_for_review";
    case "needs_revision":
      return status === "needs_revision";
    case "approved":
      return APPROVED_STATUSES.has(status);
    case "unmarked_images":
      return hasUnmarkedPipeline(draft.id, images);
    case "failed":
      return FAILED_STATUSES.has(status) || draft.generation_status === "failed";
    case "published":
      return PUBLISHED_STATUSES.has(status);
    default:
      return true;
  }
}

export function filterDraftsByStage<T extends StageDraft>(
  drafts: T[],
  stage: StageKey,
  images?: StageImage[]
): T[] {
  return drafts.filter((d) => matchesStage(d, stage, images));
}

export function countByStage(
  drafts: StageDraft[],
  images?: StageImage[]
): Record<StageKey, number> {
  const counts = Object.fromEntries(STAGE_OPTIONS.map((o) => [o.key, 0])) as Record<
    StageKey,
    number
  >;
  for (const draft of drafts) {
    for (const { key } of STAGE_OPTIONS) {
      if (matchesStage(draft, key, images)) {
        counts[key] += 1;
      }
    }
  }
  return counts;
}

/** Queue coarse groups used before B12 — kept for tests / migration notes. */
export function legacyQueueBucket(
  status: string
): "pending" | "approved" | "failed" | "archived" | "other" {
  if (status === "archived") return "archived";
  if (
    ["pending_input", "pending_copy", "processing", "ready_for_review", "needs_revision"].includes(
      status
    )
  ) {
    return "pending";
  }
  if (["approved", "publishing", "draft_created", "active_published", "csv_ready"].includes(status)) {
    return "approved";
  }
  if (["api_failed", "failed"].includes(status)) return "failed";
  return "other";
}
