import {
  ENRICHED_TITLE_MAX_LENGTH,
  scrubEnrichedTitleSegment3,
} from "./titleGeneratorBase";

function normalizeDetectedProductType(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** COPY C1 owner fix #1: normalize pipe spelling only; segment text is otherwise preserved. */
export function normalizeTitleSeparators(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw || !/[|｜]/u.test(raw)) return raw;
  return raw
    .split(/\s*[|｜]\s*/u)
    .map((segment) => segment.trim())
    .join(" | ");
}

/** COPY C1 owner fix #2: append detected product type to the existing second segment only. */
export function appendProductTypeToSecondSegment(
  value: string | null | undefined,
  detectedProductType: string | null | undefined,
): string {
  const normalized = normalizeTitleSeparators(value);
  const segments = normalized.split(" | ");
  if (segments.length < 2) return normalized;

  const productType = normalizeDetectedProductType(detectedProductType);
  if (!productType) return normalized;

  const secondSegment = segments[1]?.trim() ?? "";
  if (!secondSegment.includes(productType)) {
    segments[1] = [secondSegment, productType].filter(Boolean).join(" ");
  }

  return segments.join(" | ");
}

/**
 * Shared enriched-title boundary for Full Generate and single-field title regen.
 * After the two Owner fixes, delegate segment-3 scrub to the exact Production
 * helper and preserve Production's original Array.from(...).slice 80-char clamp.
 * The caller then applies the normal 60-char official-title clamp.
 */
export function normalizeEnrichedTitleContract(
  value: string | null | undefined,
  detectedProductType: string | null | undefined,
  maxLen: number = ENRICHED_TITLE_MAX_LENGTH,
): string {
  const withType = appendProductTypeToSecondSegment(value, detectedProductType);
  const scrubbed = scrubEnrichedTitleSegment3(withType);
  return Array.from(scrubbed).length > maxLen
    ? Array.from(scrubbed).slice(0, maxLen).join("")
    : scrubbed;
}
