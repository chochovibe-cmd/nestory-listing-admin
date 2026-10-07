import { scrubEnrichedTitleSegment3 } from "./titleGeneratorBase";
import {
  clampTitleByPhrases,
  finalizeProductTitle,
  PRODUCT_TITLE_MAX_LENGTH,
  type ProductTitleParts,
} from "./titleContract";

export {
  assembleIpBrandSegment,
  clampTitleByPhrases,
  finalizeProductTitle,
  joinTitleSegments,
  parseTitleSegments,
  preferEnglishBrandName,
  PRODUCT_TITLE_MAX_LENGTH,
} from "./titleContract";
export type { ProductTitleParts } from "./titleContract";

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
 * @deprecated detected_product_type is Writer evidence, not a backend append authority.
 * Kept so existing imports do not break; separator normalization only.
 */
export function appendProductTypeToSecondSegment(
  value: string | null | undefined,
  _detectedProductType: string | null | undefined,
): string {
  return normalizeTitleSeparators(value);
}

/**
 * Shared product-title finalizer.
 * Structured IP/brand/item/diff are assembled in code; raw enriched_title is fallback.
 */
export function normalizeEnrichedTitleContract(
  value: string | null | undefined,
  _detectedProductType: string | null | undefined,
  maxLen: number = PRODUCT_TITLE_MAX_LENGTH,
  extra: Omit<ProductTitleParts, "rawTitle" | "maxLen"> = {},
): string {
  const normalized = normalizeTitleSeparators(value);
  const scrubbed = extra.titleDiff || extra.titleItem || extra.titleIp || extra.detectedIpDisplay
    ? normalized
    : scrubEnrichedTitleSegment3(normalized);
  return finalizeProductTitle({
    rawTitle: scrubbed,
    maxLen,
    ...extra,
  });
}
