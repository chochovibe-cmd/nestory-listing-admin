/**
 * 4f COPY-REF 文案參考圖：AI 讀哪幾張圖上的字當文案證據。
 * - 沒指定＝自動挑（1 張主圖＋平均分布的詳情圖，共最多 6 張）。
 * - 指定了＝只讀指定的那幾張（主圖或詳情圖，最多 6 張）。
 * 指定存在 product_drafts.image_flags.copy_reference_image_ids，不寫 product_images
 * （product_images 任何更新都會觸發 mark_linked_product_image_dirty，把已上架商品標成「需同步」）。
 * Pure module: shared by /api/analyze-images (server) and the card UI (client) so both pick the same images.
 */

export const COPY_REFERENCE_FLAG_KEY = "copy_reference_image_ids";
export const MAX_COPY_REFERENCE_IMAGES = 6;

export type VisionImageCandidate = {
  /** product_images.id — needed to match a manual pick; optional for legacy callers. */
  id?: string;
  imageType: "main" | "detail";
  url: string;
  sortOrder: number;
};

export type CopyReferenceImageRow = {
  id?: string | null;
  image_type: string;
  original_file_url?: string | null;
  /** A19: ~1280 mid copy, preferred by Vision when present. */
  vision_mid_url?: string | null;
  sort_order?: number | null;
};

export type CopyReferenceMode = "auto" | "manual";

export type CopyReferenceSelection = {
  mode: CopyReferenceMode;
  selected: VisionImageCandidate[];
};

/** Badge state per image; null = not a candidate (款式圖、合成詳情圖、沒網址) → no badge. */
export type CopyReferenceBadgeState = "manual" | "auto" | "off" | null;

export type CopyReferenceToggleResult =
  | { ok: true; nextIds: string[] }
  | { ok: false; reason: "max" | "not_candidate" };

/** Main + detail rows only; URL = vision_mid_url, else original_file_url (same rule as analyze-images). */
export function copyReferenceCandidates(
  rows: readonly CopyReferenceImageRow[],
): VisionImageCandidate[] {
  const candidates: VisionImageCandidate[] = [];
  for (const row of rows) {
    if (row.image_type !== "main" && row.image_type !== "detail") continue;
    const mid = typeof row.vision_mid_url === "string" ? row.vision_mid_url.trim() : "";
    const original = typeof row.original_file_url === "string" ? row.original_file_url.trim() : "";
    const url = mid || original;
    if (!url) continue;
    candidates.push({
      ...(row.id ? { id: row.id } : {}),
      imageType: row.image_type,
      url,
      sortOrder: Number(row.sort_order ?? 0),
    });
  }
  return candidates;
}

function uniqueVisionCandidates(
  candidates: readonly VisionImageCandidate[],
): VisionImageCandidate[] {
  const seen = new Set<string>();
  return candidates
    .filter((candidate) => candidate.url.trim())
    .slice()
    // Stable sort, no id tie-break: keeps the pre-4f fingerprint byte-identical (old drafts stay cached).
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((candidate) => {
      const url = candidate.url.trim();
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });
}

function evenlySpaced<T>(items: readonly T[], count: number): T[] {
  if (count <= 0 || items.length === 0) return [];
  if (items.length <= count) return [...items];
  if (count === 1) return [items[0]!];
  return Array.from({ length: count }, (_, index) => {
    const sourceIndex = Math.round((index * (items.length - 1)) / (count - 1));
    return items[sourceIndex]!;
  });
}

/** One hero image, then detail images spread across the full ordered set. */
export function selectRepresentativeVisionImages(
  candidates: readonly VisionImageCandidate[],
  cap = MAX_COPY_REFERENCE_IMAGES,
): VisionImageCandidate[] {
  const safeCap = Math.max(0, Math.min(MAX_COPY_REFERENCE_IMAGES, Math.floor(cap)));
  if (safeCap === 0) return [];
  const unique = uniqueVisionCandidates(candidates);
  const mains = unique.filter((candidate) => candidate.imageType === "main");
  const details = unique.filter((candidate) => candidate.imageType === "detail");
  const selected: VisionImageCandidate[] = [];
  if (mains[0]) selected.push(mains[0]);
  selected.push(...evenlySpaced(details, safeCap - selected.length));
  for (const main of mains.slice(1)) {
    if (selected.length >= safeCap) break;
    selected.push(main);
  }
  return selected.slice(0, safeCap);
}

/**
 * Changes when the ordered image set (or the manual pick) changes, so unchanged images can skip Vision.
 * No manual pick → identical to the pre-4f fingerprint (old drafts are not re-read).
 */
export function buildVisionSourceFingerprint(
  candidates: readonly VisionImageCandidate[],
  manualIds: readonly string[] = [],
): string {
  let source = uniqueVisionCandidates(candidates)
    .map((candidate) => `${candidate.imageType}:${candidate.sortOrder}:${candidate.url.trim()}`)
    .join("\n");
  const refs = [...manualIds].sort();
  if (refs.length > 0) source += `\nref:${refs.join(",")}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, "0")}-${source.length}`;
}

/** Stored manual pick: strings only, trimmed, de-duplicated, at most 6. */
export function parseCopyReferenceIds(flags: unknown): string[] {
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) return [];
  const raw = (flags as Record<string, unknown>)[COPY_REFERENCE_FLAG_KEY];
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const id = value.trim();
    if (!id || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= MAX_COPY_REFERENCE_IMAGES) break;
  }
  return ids;
}

/** Merge-only write: keeps every other image_flags key; empty pick removes the key (＝自動挑). */
export function mergeCopyReferenceIds(
  flags: unknown,
  ids: readonly string[],
): Record<string, unknown> {
  const base =
    flags && typeof flags === "object" && !Array.isArray(flags)
      ? { ...(flags as Record<string, unknown>) }
      : {};
  const clean = parseCopyReferenceIds({ [COPY_REFERENCE_FLAG_KEY]: ids });
  if (clean.length === 0) delete base[COPY_REFERENCE_FLAG_KEY];
  else base[COPY_REFERENCE_FLAG_KEY] = clean;
  return base;
}

/**
 * Manual pick wins when at least one picked image still exists (deleted ones are ignored);
 * order = picked main images, then picked detail images, each by sort_order. Otherwise auto.
 */
export function selectCopyReferenceImages(
  candidates: readonly VisionImageCandidate[],
  manualIds: readonly string[],
): CopyReferenceSelection {
  const wanted = new Set(manualIds);
  if (wanted.size > 0) {
    const picked = uniqueVisionCandidates(
      candidates.filter((candidate) => candidate.id && wanted.has(candidate.id)),
    );
    if (picked.length > 0) {
      return {
        mode: "manual",
        selected: [
          ...picked.filter((candidate) => candidate.imageType === "main"),
          ...picked.filter((candidate) => candidate.imageType === "detail"),
        ].slice(0, MAX_COPY_REFERENCE_IMAGES),
      };
    }
  }
  return { mode: "auto", selected: selectRepresentativeVisionImages(candidates) };
}

export function copyReferenceBadgeState(
  candidates: readonly VisionImageCandidate[],
  selection: CopyReferenceSelection,
  imageId: string,
): CopyReferenceBadgeState {
  if (!candidates.some((candidate) => candidate.id === imageId)) return null;
  if (!selection.selected.some((candidate) => candidate.id === imageId)) return "off";
  return selection.mode === "manual" ? "manual" : "auto";
}

/**
 * Click on a badge. In auto mode the current auto pick becomes the starting manual pick,
 * then the clicked image is added / removed. Empty result (nextIds = []) means back to auto.
 */
export function toggleCopyReference(
  candidates: readonly VisionImageCandidate[],
  storedIds: readonly string[],
  imageId: string,
): CopyReferenceToggleResult {
  if (!candidates.some((candidate) => candidate.id === imageId)) {
    return { ok: false, reason: "not_candidate" };
  }
  const current = selectCopyReferenceImages(candidates, storedIds).selected
    .map((candidate) => candidate.id)
    .filter((id): id is string => Boolean(id));
  if (current.includes(imageId)) {
    return { ok: true, nextIds: current.filter((id) => id !== imageId) };
  }
  if (current.length >= MAX_COPY_REFERENCE_IMAGES) return { ok: false, reason: "max" };
  return { ok: true, nextIds: [...current, imageId] };
}

/** One-line hint for the 文案參考圖 row (station② / station③). */
export function copyReferenceHint(selection: CopyReferenceSelection): string {
  const total = selection.selected.length;
  if (selection.mode === "auto") {
    return `AI 自動挑了 ${total} 張（標「✓ 自動」）讀圖上的字寫文案；想自己指定就點圖上的「文案參考」，最多 ${MAX_COPY_REFERENCE_IMAGES} 張`;
  }
  const mains = selection.selected.filter((candidate) => candidate.imageType === "main").length;
  return `你指定了 ${total} 張（主圖 ${mains}、詳情圖 ${total - mains}）；改完按「↻ 重新生成」或單欄「↻ 重生」才會用新的圖寫文案`;
}
