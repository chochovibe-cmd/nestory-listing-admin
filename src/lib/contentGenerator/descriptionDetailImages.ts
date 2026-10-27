/**
 * 4e DETAIL-LISTING: the product description carries every remaining detail image.
 *
 * Order: Shopify main image → generated_detail (sort_order) → detail (sort_order).
 * Only Shopify CDN URLs are ever embedded (Supabase egress is the free-tier bottleneck);
 * a picked detail image that is not on Shopify Files yet is simply left out, and
 * uploadDescriptionImagesToShopifyFiles is what puts it there at publish / sync time.
 * Pure — no I/O. Keeps the D8a marker so reconcileFields.descriptionCompareText still
 * ignores the image block.
 */

import { isDescriptionEmbedEnabled } from "@/lib/contentGenerator/descriptionEmbed";
import { isDescriptionDetailImagesEnabled } from "@/lib/images/detailCompose/flags";
import { pickDescriptionDetailRows } from "@/lib/images/descriptionDetailRows";
import { pickShopifyMainImage } from "@/lib/images/shopifyMainImage";
import { isShopifyCdnUrl } from "@/lib/shopify/filesUpload";

export { isDescriptionDetailImageType, pickDescriptionDetailRows } from "@/lib/images/descriptionDetailRows";

export const DESCRIPTION_IMAGES_MARKER = "<!-- nestory-desc-embed -->";

export type DescriptionImageRow = {
  id: string;
  image_type: string;
  sort_order: number;
  alt_text?: string | null;
  processed_file_url?: string | null;
  original_file_url?: string | null;
  generated_file_url?: string | null;
};

/** First Shopify CDN URL among processed → original → generated; null when none. */
export function shopifyCdnUrlOf(image: DescriptionImageRow): string | null {
  for (const raw of [image.processed_file_url, image.original_file_url, image.generated_file_url]) {
    const url = typeof raw === "string" ? raw.trim() : "";
    if (url && isShopifyCdnUrl(url)) return url;
  }
  return null;
}

/** Picked detail rows that still need Shopify Files (no CDN URL yet). */
export function listDescriptionImagesToUpload<T extends DescriptionImageRow>(images: T[] | null | undefined): T[] {
  return pickDescriptionDetailRows(images).filter((row) =>...[truncated]