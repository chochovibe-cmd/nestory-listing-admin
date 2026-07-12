/**
 * B9: client-side sort for the results panel.
 * Preference key lives in sessionStorage (tab session only).
 */

export type ResultSortMode =
  | "newest"
  | "needs_attention"
  | "price_high"
  | "price_low";

export const RESULT_SORT_STORAGE_KEY = "nestory:results-sort";

export const RESULT_SORT_OPTIONS: { value: ResultSortMode; label: string }[] = [
  { value: "newest", label: "最新在上" },
  { value: "needs_attention", label: "⚠ 待處理優先" },
  { value: "price_high", label: "售價高→低" },
  { value: "price_low", label: "售價低→高" }
];

export function isResultSortMode(value: unknown): value is ResultSortMode {
  return (
    value === "newest" ||
    value === "needs_attention" ||
    value === "price_high" ||
    value === "price_low"
  );
}

export function readStoredResultSort(storage?: Pick<Storage, "getItem"> | null): ResultSortMode {
  try {
    const raw = storage?.getItem(RESULT_SORT_STORAGE_KEY);
    if (isResultSortMode(raw)) return raw;
  } catch {
    // private mode / SSR
  }
  return "newest";
}

export function writeStoredResultSort(
  mode: ResultSortMode,
  storage?: Pick<Storage, "setItem"> | null
): void {
  try {
    storage?.setItem(RESULT_SORT_STORAGE_KEY, mode);
  } catch {
    // ignore quota / private mode
  }
}

/** Minimal draft shape for sorting (avoids full ProductDraft import in tests). */
export type SortableDraft = {
  id: string;
  updated_at: string;
  created_at?: string;
  twd_price: number | null;
  warnings?: string[] | null;
};

export type SortableImage = {
  draft_id: string;
  image_type: string;
  process_intent: string | null;
};

function isPipelineImageType(imageType: string): boolean {
  return imageType === "main" || imageType === "spec" || imageType === "variant";
}

export function countUnmarkedPipelineImages(
  draftId: string,
  images: SortableImage[]
): number {
  return images.filter(
    (image) =>
      image.draft_id === draftId &&
      isPipelineImageType(image.image_type) &&
      image.process_intent == null
  ).length;
}

export function warningCount(draft: SortableDraft): number {
  return draft.warnings?.length ?? 0;
}

/**
 * D5-A: 有 warnings 優先；同組內圖片未標記再優先；再比 updated_at 新→舊。
 */
export function compareNeedsAttention(
  a: SortableDraft,
  b: SortableDraft,
  images: SortableImage[]
): number {
  const warnA = warningCount(a) > 0 ? 1 : 0;
  const warnB = warningCount(b) > 0 ? 1 : 0;
  if (warnA !== warnB) return warnB - warnA;

  const unmarkedA = countUnmarkedPipelineImages(a.id, images) > 0 ? 1 : 0;
  const unmarkedB = countUnmarkedPipelineImages(b.id, images) > 0 ? 1 : 0;
  if (unmarkedA !== unmarkedB) return unmarkedB - unmarkedA;

  // Secondary: more warnings first, then more unmarked count
  const warnCountDiff = warningCount(b) - warningCount(a);
  if (warnCountDiff !== 0) return warnCountDiff;

  const unmarkedCountDiff =
    countUnmarkedPipelineImages(b.id, images) - countUnmarkedPipelineImages(a.id, images);
  if (unmarkedCountDiff !== 0) return unmarkedCountDiff;

  return b.updated_at.localeCompare(a.updated_at);
}

function priceValue(draft: SortableDraft): number | null {
  return draft.twd_price == null || Number.isNaN(draft.twd_price) ? null : draft.twd_price;
}

export function compareResultDrafts(
  a: SortableDraft,
  b: SortableDraft,
  mode: ResultSortMode,
  images: SortableImage[] = []
): number {
  switch (mode) {
    case "needs_attention":
      return compareNeedsAttention(a, b, images);
    case "price_high": {
      const pa = priceValue(a);
      const pb = priceValue(b);
      if (pa == null && pb == null) return b.updated_at.localeCompare(a.updated_at);
      if (pa == null) return 1; // nulls last
      if (pb == null) return -1;
      if (pb !== pa) return pb - pa;
      return b.updated_at.localeCompare(a.updated_at);
    }
    case "price_low": {
      const pa = priceValue(a);
      const pb = priceValue(b);
      if (pa == null && pb == null) return b.updated_at.localeCompare(a.updated_at);
      if (pa == null) return 1;
      if (pb == null) return -1;
      if (pa !== pb) return pa - pb;
      return b.updated_at.localeCompare(a.updated_at);
    }
    case "newest":
    default:
      return b.updated_at.localeCompare(a.updated_at);
  }
}

export function sortResultDrafts<T extends SortableDraft>(
  drafts: T[],
  mode: ResultSortMode,
  images: SortableImage[] = []
): T[] {
  return [...drafts].sort((a, b) => compareResultDrafts(a, b, mode, images));
}
