// A21-4 (文案·三之五b item 4): Shopify Files filename keyword-ization.
// Supabase's interim storage path (ImageUploader.tsx) deliberately keeps a
// random UUID -- that URL is never public-facing, so it isn't the "亂數檔名"
// the doc item is about. This targets the filename Shopify actually stores
// the image under (what shows up in an image `src` and in Google Image
// search), applied via the `download` query param on the source URL in
// payload.ts. Whether Shopify's media importer honors that
// Content-Disposition-derived name over the URL path hasn't been confirmed
// against a real (non-mock) publish yet -- see 施工清單 待確認清單.
import type { ImageType } from '@/types/domain';

const IMAGE_ROLE_SLUGS: Partial<Record<ImageType, string>> = {
  main: 'main',
  detail: 'detail',
  generated_detail: 'scene',
  variant: 'variant',
};

/** Builds one image's Shopify Files filename off the product's own handle
 * slug (A21-1), e.g. "chiikawa-hachiware-keychain-main-2.webp". Returns null
 * for image types with no Shopify-facing role (spec images -- same exclusion
 * payload.ts's media mapping already applies). */
export function buildImageFileNameSlug(
  productSlug: string | null | undefined,
  imageType: ImageType,
  indexInType: number,
  countInType: number,
  extension: string | null | undefined,
): string | null {
  const roleSlug = IMAGE_ROLE_SLUGS[imageType];
  if (!roleSlug) return null;

  const base = productSlug?.trim() ? productSlug.trim() : 'nestory-product';
  const numberedRole = countInType > 1 ? `${roleSlug}-${indexInType + 1}` : roleSlug;
  const cleanExt = (extension ?? '').replace(/^\./, '').toLowerCase() || 'webp';

  return `${base}-${numberedRole}.${cleanExt}`;
}
