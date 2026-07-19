/**
 * D5 image review queue helpers (zero migration).
 *
 * Q1-A: human pass = image_flags.image_review = "approved" (image_status stays done).
 * Q2-A: reject → image_status failed + warnings line.
 * Q3-A: queue kinds = pending_review | processing | failed.
 *
 * P1-3 / 回饋 52: Vision writes image_flags.vision_status only — never image_status.
 * Review queue requires real pipeline enrollment (current_image_batch_id) so
 * copy-only / Vision-only drafts never appear on /review.
 */

import { imageSlotLabel, isPipelineImage } from "@/lib/images/processMarks";
import type { ImageProcessIntent, ImageStatus, ImageType, ProductImage } from "@/types/domain";

export const IMAGE_REVIEW_FLAG_KEY = "image_review";
export const IMAGE_REVIEW_APPROVED = "approved";
export const IMAGE_REVIEWED_AT_KEY = "image_reviewed_at";
/** P1-3: Vision analyze-images status (not the D3/D5 image pipeline). */
export const VISION_STATUS_FLAG_KEY = "vision_status";

export type ImageReviewQueueKind = "pending_review" | "processing" | "failed";

export const REVIEW_QUEUE_IMAGE_STATUSES: ImageStatus[] = ["done", "processing", "failed"];

export const REVIEW_FETCH_LIMIT = 100;

export const REVIEW_DRAFT_SELECT_COLUMNS =
  "id, title_zh, taobao_title, original_title, status, image_status, image_flags, warnings, current_image_batch_id, created_by, created_at, updated_at";

export type ReviewDraftRow = {
  id: string;
  title_zh: string | null;
  taobao_title: string | null;
  original_title: string | null;
  status: string;
  image_status: string;
  image_flags: unknown;
  warnings: string[] | null;
  /** Set by send-images — required for /review queue (P1-3). */
  current_image_batch_id?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ReviewImageRow = Pick<
  ProductImage,
  | "id"
  | "draft_id"
  | "image_type"
  | "original_file_url"
  | "processed_file_url"
  | "process_intent"
  | "is_spec_process"
  | "processing_error"
  | "sort_order"
  | "created_at"
>;

/** Normalize jsonb image_flags to string record (drop non-string safely). */
export function parseImageFlags(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") {
      out[key] = value;
    } else if (value != null && typeof value !== "object") {
      out[key] = String(value);
    }
  }
  return out;
}

export function isImageReviewApproved(flags: unknown): boolean {
  return parseImageFlags(flags)[IMAGE_REVIEW_FLAG_KEY] === IMAGE_REVIEW_APPROVED;
}

/**
 * Merge-only: never wipe other image_flags keys with {}.
 */
export function mergeImageReviewApproved(
  existing: unknown,
  reviewedAtIso: string
): Record<string, string> {
  return {
    ...parseImageFlags(existing),
    [IMAGE_REVIEW_FLAG_KEY]: IMAGE_REVIEW_APPROVED,
    [IMAGE_REVIEWED_AT_KEY]: reviewedAtIso
  };
}

/** Clear pass flag on reject (merge preserve other keys). */
export function clearImageReviewApproved(existing: unknown): Record<string, string> {
  const next = { ...parseImageFlags(existing) };
  delete next[IMAGE_REVIEW_FLAG_KEY];
  delete next[IMAGE_REVIEWED_AT_KEY];
  return next;
}

/**
 * True when this draft was enrolled in the real image pipeline (送圖).
 * Vision-only analyze-images never sets current_image_batch_id (P1-3).
 */
export function isImagePipelineEnrolled(input: {
  current_image_batch_id?: string | null;
}): boolean {
  const id = input.current_image_batch_id;
  return typeof id === "string" && id.trim().length > 0;
}

/**
 * Q3-A queue classification. null = not on review page list.
 * P1-3: without pipeline enrollment, ignore image_status (covers old Vision pollution).
 */
export function classifyReviewQueueItem(input: {
  status: string;
  image_status: string;
  image_flags: unknown;
  current_image_batch_id?: string | null;
}): ImageReviewQueueKind | null {
  if (input.status === "archived") return null;
  if (!isImagePipelineEnrolled(input)) return null;
  if (input.image_status === "processing") return "processing";
  if (input.image_status === "failed") return "failed";
  if (input.image_status === "done" && !isImageReviewApproved(input.image_flags)) {
    return "pending_review";
  }
  return null;
}

/**
 * P1-4 / 回饋 50 / UX-I T53: human-readable fail reasons for /review failed cards.
 * Prefer per-image processing_error; also surface draft warnings (pipeline/圖審).
 * Display-only — does not change worker / API write paths.
 */
export type ReviewFailInput = {
  images: Array<{ processing_error?: string | null }>;
  warnings?: string[] | null;
};

/** Unique fail lines (processing_error first, then image-related warnings). */
export function collectReviewFailLines(input: ReviewFailInput): string[] {
  const lines: string[] = [];
  for (const img of input.images) {
    const err = img.processing_error?.trim();
    if (err && !lines.includes(err)) lines.push(err);
  }
  const warns = Array.isArray(input.warnings) ? input.warnings : [];
  for (const w of warns) {
    if (typeof w !== "string") continue;
    const t = w.trim();
    if (!t) continue;
    // Keep image-pipeline / fail-related lines; skip pure copy tips noise when possible.
    const lower = t.toLowerCase();
    const looksImage =
      t.includes("圖") ||
      t.includes("處理") ||
      t.includes("sharp") ||
      t.includes("CDN") ||
      t.includes("finalize") ||
      t.includes("送圖") ||
      t.includes("Image") ||
      lower.includes("image") ||
      t.includes("失敗");
    if (looksImage && !lines.includes(t)) lines.push(t);
  }
  return lines;
}

export function formatReviewFailReasons(input: ReviewFailInput): string {
  const lines = collectReviewFailLines(input);
  if (lines.length === 0) {
    return "處理失敗（尚無詳細原因）。可填寫拒絕理由留下指令。";
  }
  return lines.slice(0, 8).join("；");
}

/** Collapsed row: one short line; multi-error →「首則＋另 N 則」. */
export function formatReviewFailReasonsShort(
  input: ReviewFailInput,
  maxChars = 42
): string {
  const lines = collectReviewFailLines(input);
  if (lines.length === 0) {
    return "原因未記錄，請重試或看紀錄";
  }
  const first = lines[0]!;
  const truncated =
    first.length > maxChars ? `${first.slice(0, Math.max(1, maxChars - 1))}…` : first;
  if (lines.length === 1) return truncated;
  return `${truncated}＋另 ${lines.length - 1} 則`;
}

export function canConfirmReviewKind(kind: ImageReviewQueueKind | null): boolean {
  return kind === "pending_review";
}

export function reviewDisplayTitle(
  row: Pick<ReviewDraftRow, "title_zh" | "taobao_title" | "original_title">
): string {
  const zh = row.title_zh?.trim();
  if (zh) return zh;
  const tao = row.taobao_title?.trim();
  if (tao) return tao;
  const orig = row.original_title?.trim();
  if (orig) return orig;
  return "（無標題）";
}

export function reviewSchipMeta(
  kind: ImageReviewQueueKind,
  pipelineCount?: number
): { className: string; label: string } {
  if (kind === "processing") {
    return { className: "schip schip--run", label: "圖片處理中" };
  }
  if (kind === "failed") {
    return { className: "schip schip--error", label: "圖片處理失敗" };
  }
  const n = pipelineCount ?? 0;
  if (n > 0) {
    return { className: "schip schip--warn", label: `圖片待審・${n} 張` };
  }
  return { className: "schip schip--warn", label: "圖片待審" };
}

/**
 * Slider only when processed is present and differs from original (差異 20).
 */
export function hasComparableProcessed(
  originalUrl: string | null | undefined,
  processedUrl: string | null | undefined
): boolean {
  const original = originalUrl?.trim() ?? "";
  const processed = processedUrl?.trim() ?? "";
  if (!processed) return false;
  if (!original) return true;
  return processed !== original;
}

export function buildRejectWarning(reason?: string | null): string {
  const trimmed = reason?.trim();
  if (trimmed) return `圖審拒絕：${trimmed}`;
  return "圖審拒絕";
}

export function mergeRejectWarnings(
  existing: string[] | null | undefined,
  reason?: string | null
): string[] {
  const list = Array.isArray(existing) ? existing.filter((w) => typeof w === "string") : [];
  const line = buildRejectWarning(reason);
  if (!list.includes(line)) list.push(line);
  return list;
}

/** Prefix processing_error for optional per-image note (keep prior text). */
export function prefixProcessingError(
  existing: string | null | undefined,
  reason?: string | null
): string {
  const prefix = buildRejectWarning(reason);
  const prev = existing?.trim();
  if (!prev) return prefix.slice(0, 500);
  if (prev.startsWith("圖審拒絕")) return prev.slice(0, 500);
  return `${prefix}；${prev}`.slice(0, 500);
}

export function formatUnviewedBlockMessage(unviewedCount: number): string {
  return `還有 ${unviewedCount} 件未點開查看，請先展開確認後再一鍵全部確認。`;
}

/**
 * Q4-A: one-click only when every pending_review card was expanded (viewed).
 * Hard-block whole batch if any unviewed — no partial confirm.
 */
export function canBatchConfirmAll(
  pendingIds: readonly string[],
  viewedIds: ReadonlySet<string>
): { allowed: boolean; unviewedCount: number; unviewedIds: string[] } {
  const unviewedIds = pendingIds.filter((id) => !viewedIds.has(id));
  return {
    allowed: pendingIds.length > 0 && unviewedIds.length === 0,
    unviewedCount: unviewedIds.length,
    unviewedIds
  };
}

/**
 * SYN-1: images shown on /review card = pipeline marks + composed detail.
 * Does NOT change isPipelineImage (送圖標記仍只要 main/spec/variant).
 */
export function isReviewGalleryImage(
  image: Pick<ProductImage, "image_type">
): boolean {
  return isPipelineImage(image) || image.image_type === "generated_detail";
}

export function pipelineImagesForReview<
  T extends Pick<ProductImage, "image_type"> & {
    sort_order?: number | null;
    created_at?: string | null;
  }
>(images: T[]): T[] {
  return images
    .filter((img) => isReviewGalleryImage(img))
    .slice()
    .sort((a, b) => {
      const orderA = a.sort_order ?? 0;
      const orderB = b.sort_order ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      return (a.created_at ?? "").localeCompare(b.created_at ?? "");
    });
}

export function reviewImageFieldLabel(
  image: Pick<ProductImage, "image_type" | "is_spec_process" | "process_intent">,
  position1Based: number
): string {
  if (image.image_type === "generated_detail") {
    return `合成詳情圖`;
  }
  const base = imageSlotLabel(image, position1Based);
  const intent = image.process_intent as ImageProcessIntent | null;
  if (intent === "de_text") return `${base} · 去字`;
  if (intent === "to_trad") return `${base} · 簡轉繁`;
  if (intent === "regenerate") return `${base} · 重生`;
  if (intent === "keep") return `${base} · 保留原圖`;
  return base;
}

export function pickReviewThumbUrl(
  images: Array<
    Pick<ProductImage, "image_type" | "original_file_url" | "processed_file_url"> & {
      list_thumb_url?: string | null;
      sort_order?: number | null;
      created_at?: string | null;
    }
  >
): string | null {
  const pipeline = pipelineImagesForReview(images);
  for (const img of pipeline) {
    // A19: prefer 320px list thumb when present
    const url = img.list_thumb_url || img.processed_file_url || img.original_file_url;
    if (url) return url;
  }
  return null;
}

export function countBanner(items: Array<{ kind: ImageReviewQueueKind }>): {
  processing: number;
  failed: number;
  pendingReview: number;
} {
  let processing = 0;
  let failed = 0;
  let pendingReview = 0;
  for (const item of items) {
    if (item.kind === "processing") processing += 1;
    else if (item.kind === "failed") failed += 1;
    else pendingReview += 1;
  }
  return { processing, failed, pendingReview };
}

export function isPipelineImageTypeForReview(type: ImageType | string): boolean {
  return isPipelineImage({ image_type: type as ImageType });
}
