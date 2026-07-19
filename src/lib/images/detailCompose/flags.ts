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
