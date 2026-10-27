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
  return pickDescriptionDetailRows(images).filter((row) => !shopifyCdnUrlOf(row));
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function altOf(image: DescriptionImageRow | null, titleFallback: string | null | undefined): string {
  const alt = image?.alt_text?.trim();
  if (alt) return alt;
  const title = (titleFallback || "").trim();
  return title || "Nestory product image";
}

/**
 * Description image block (empty string when nothing is on the CDN).
 * mainImageUrl: sync passes Shopify's current first gallery image, used only when the
 * main row itself has no CDN URL (and only if that URL is on the CDN too).
 */
export function buildDescriptionImagesHtml(
  images: DescriptionImageRow[] | null | undefined,
  titleFallback?: string | null,
  opts: { mainImageUrl?: string | null } = {}
): string {
  const rows = images ?? [];
  const entries: { url: string; alt: string }[] = [];
  const seen = new Set<string>();
  const push = (url: string | null, image: DescriptionImageRow | null) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    entries.push({ url, alt: altOf(image, titleFallback) });
  };

  const main = pickShopifyMainImage(rows);
  const fallbackMain =
    opts.mainImageUrl && isShopifyCdnUrl(opts.mainImageUrl) ? opts.mainImageUrl.trim() : null;
  push((main ? shopifyCdnUrlOf(main) : null) ?? fallbackMain, main);

  for (const row of pickDescriptionDetailRows(rows)) push(shopifyCdnUrlOf(row), row);

  if (!entries.length) return "";
  return (
    DESCRIPTION_IMAGES_MARKER +
    entries
      .map(
        (e) =>
          `<p><img src="${escapeHtmlAttr(e.url)}" alt="${escapeHtmlAttr(e.alt)}" loading="lazy" style="max-width:100%;height:auto;" /></p>`
      )
      .join("")
  );
}

/** Shopify payload boundary: env kill switch (D8a) AND the draft switch must both be on. */
export function appendDescriptionImagesIfEnabled(
  bodyHtml: string,
  imageFlags: unknown,
  images: DescriptionImageRow[] | null | undefined,
  titleFallback?: string | null,
  opts: { mainImageUrl?: string | null; env?: NodeJS.ProcessEnv } = {}
): string {
  if (!isDescriptionEmbedEnabled(opts.env ?? process.env)) return bodyHtml;
  if (!isDescriptionDetailImagesEnabled(imageFlags)) return bodyHtml;
  return bodyHtml + buildDescriptionImagesHtml(images, titleFallback, { mainImageUrl: opts.mainImageUrl });
}

/** First IMAGE media URL in a Shopify product snapshot (sync's main-image fallback). */
export function firstShopifyImageUrl(
  media: { mediaContentType?: string | null; image?: { url?: string | null } | null }[] | null | undefined
): string | null {
  for (const node of media ?? []) {
    if (node?.mediaContentType !== "IMAGE") continue;
    const url = node.image?.url?.trim();
    if (url) return url;
  }
  return null;
}

