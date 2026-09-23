import {
  ENRICHED_TITLE_MAX_LENGTH,
  scrubEnrichedTitleSegment3,
} from "./titleGeneratorBase";

/** COPY C1 owner fix #1: normalize pipe spelling only; segment text is otherwise preserved. */
export function normalizeTitleSeparators(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw || !/[|｜]/u.test(raw)) return raw;
  return raw
    .split(/\s*[|｜]\s*/u)
    .map((segment) => segment.trim())
    .join(" | ");
}

/**
 * @deprecated COPY C5A: detected_product_type is a fallback/reference for the Writer,
 * not a backend append authority. Kept as a public compatibility helper so existing
 * imports do not break; it now performs separator normalization only.
 */
export function appendProductTypeToSecondSegment(
  value: string | null | undefined,
  _detectedProductType: string | null | undefined,
): string {
  return normalizeTitleSeparators(value);
}

/**
 * Shared enriched-title boundary for Full Generate and single-field title regen.
 * COPY C5A keeps the backend as a finalizer only: normalize separators, delegate
 * the existing Production segment-3 safety scrub, then preserve the 80-char clamp.
 * The Writer owns segment-2 product specificity and segment-3 editorial selection;
 * the caller still applies the normal 60-char official-title clamp.
 */
export function normalizeEnrichedTitleContract(
  value: string | null | undefined,
  _detectedProductType: string | null | undefined,
  maxLen: number = ENRICHED_TITLE_MAX_LENGTH,
): string {
  const normalized = normalizeTitleSeparators(value);
  const scrubbed = scrubEnrichedTitleSegment3(normalized);
  return Array.from(scrubbed).length > maxLen
    ? Array.from(scrubbed).slice(0, maxLen).join("")
    : scrubbed;
}
