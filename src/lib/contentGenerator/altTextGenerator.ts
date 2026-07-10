import type { ImageType } from '@/types/domain';
import { extractFeatureTerms } from './featureTerms';
import {
  DisplayLabelContext,
  formatCharacterShortNameFromContext,
  formatListingIpDisplayNameFromContext,
  isCharacterRedundantWithIpDisplay,
  removeDuplicateDisplayTerms,
} from './displayLabels';
import { normalizeProductTypeForDisplay } from '../productTypeLabels';

// A10: ALT text is template-assembled by the rule engine, NEVER by the LLM
// (文案·三·9) -- "{IP} {角色} {類型} {款式} 主圖/細節圖N/情境圖". Written to
// product_images.alt_text (existed since 005_phase2_columns, unused until now).

// spec images are intentionally excluded -- per 圖床架構 they're only ever
// shown to the AI (OCR input) and never uploaded to Shopify Files, so an ALT
// text for them would never be displayed anywhere.
const IMAGE_ROLE_LABELS: Partial<Record<ImageType, string>> = {
  main: '主圖',
  detail: '細節圖',
  generated_detail: '情境圖',
  variant: '款式圖',
};

/** Bare label when it's the only image of its type in the draft, numbered when there are several. */
export function buildImageRoleLabel(
  imageType: ImageType,
  indexInType: number,
  countInType: number,
): string | null {
  const base = IMAGE_ROLE_LABELS[imageType];
  if (!base) return null;
  return countInType > 1 ? `${base}${indexInType + 1}` : base;
}

export interface AltTextContext {
  ip: string;
  character: string;
  productType: string;
  imageDescription?: string | null;
}

/**
 * Builds one image's ALT text: "{IP} {角色} {類型} {款式} {主圖/細節圖N/情境圖}".
 * Returns null for image types with no Shopify-facing role (currently: spec).
 */
export function buildImageAltText(
  context: AltTextContext,
  displayContext: DisplayLabelContext,
  imageType: ImageType,
  indexInType: number,
  countInType: number,
): string | null {
  const roleLabel = buildImageRoleLabel(imageType, indexInType, countInType);
  if (!roleLabel) return null;

  const ipDisplayName = formatListingIpDisplayNameFromContext(context.ip, displayContext);
  const characterShortName = formatCharacterShortNameFromContext(context.character, context.ip, displayContext);
  const character =
    context.character && !isCharacterRedundantWithIpDisplay(characterShortName, ipDisplayName)
      ? characterShortName
      : '';
  const productType = normalizeProductTypeForDisplay(context.productType);
  const style = extractFeatureTerms(context.imageDescription, null)[0] ?? '';

  const factParts = removeDuplicateDisplayTerms([ipDisplayName, character, productType, style]).filter(Boolean);

  return [...factParts, roleLabel].join(' ');
}
