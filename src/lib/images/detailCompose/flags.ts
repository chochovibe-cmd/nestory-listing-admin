/**
 * SYN-1: draft-level generate_detail switch.
 * Default ON when missing (Fable A). UI toggle is a separate UIUX debt.
 */

/**
 * Whether to compose a generated_detail image for this draft.
 * - missing / null / {} → true (default on)
 * - generate_detail === false | "false" | 0 | "0" → false
 * - any other value → true
 */
export function isGenerateDetailEnabled(
  imageFlags: unknown
): boolean {
  if (imageFlags == null) return true;
  if (typeof imageFlags !== "object" || Array.isArray(imageFlags)) return true;
  const v = (imageFlags as Record<string, unknown>).generate_detail;
  if (v === false || v === 0) return false;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "false" || s === "0" || s === "no" || s === "off") return false;
  }
  return true;
}

/** Listing retain flags (回饋 45) — image-level when present. */
export function isDetailRetainedForListingFlags(
  flags: Record<string, unknown> | null | undefined
): boolean {
  if (!flags || typeof flags !== "object") return false;
  return (
    flags.include_on_listing === true ||
    flags.include_on_listing === "true" ||
    flags.retain_for_listing === true ||
    flags.retain_for_listing === "true"
  );
}

/** 4e: draft image_flags key for「詳情圖放進商品描述」. */
export const DESCRIPTION_DETAIL_IMAGES_FLAG = "description_detail_images";

/**
 * 4e: whether this draft's description gets the detail images (default ON).
 * - missing / null / {} → true
 * - description_detail_images === false | 0 | "false" | "0" | "no" | "off" → false
 * - any other value → true
 */
export function isDescriptionDetailImagesEnabled(imageFlags: unknown): boolean {
  if (imageFlags == null) return true;
  if (typeof imageFlags !== "object" || Array.isArray(imageFlags)) return true;
  const v = (imageFlags as Record<string, unknown>)[DESCRIPTION_DETAIL_IMAGES_FLAG];
  if (v === false || v === 0) return false;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "false" || s === "0" || s === "no" || s === "off") return false;
  }
  return true;
}

/** 4e: merge-only write; keeps every other image_flags key. Stores "true" / "false". */
export function mergeDescriptionDetailImagesFlag(
  existing: unknown,
  enabled: boolean
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  base[DESCRIPTION_DETAIL_IMAGES_FLAG] = enabled ? "true" : "false";
  return base;
}
