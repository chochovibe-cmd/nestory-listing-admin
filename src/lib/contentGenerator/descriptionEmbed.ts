/**
 * D8a-open: append up to 2 product images into description HTML at the
 * Shopify boundary (payload / Matrixify). Never write back to DB.
 *
 * Q1-A: env DESCRIPTION_EMBED_IMAGES — unset/empty = on; 0/false/off = off
 * Q2-A: second image detail → generated_detail → other non-main
 * Q4-A: Showmore default off (SHOWMORE_DESCRIPTION_EMBED_IMAGES)
 * Q6-A: any usable URL embeds (CDN preferred when choosing among equals)
 */

import type { ImageType, ProductImage } from "@/types/domain";

export const DESCRIPTION_EMBED_MAX = 2;

export type DescriptionEmbedImageInput = Pick<
  ProductImage,
  | "id"
  | "image_type"
  | "sort_order"
  | "alt_text"
  | "processed_file_url"
  | "original_file_url"
  | "generated_file_url"
>;

export type DescriptionEmbedPick = {
  id: string;
  imageType: ImageType | string;
  url: string;
  alt: string;
  isShopifyCdn: boolean;
};

function normalizeEnvFlag(raw: string | undefined): boolean | null {
  if (raw == null) return null;
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  return null;
}

/**
 * Shopify path: default ON when env unset.
 * DESCRIPTION_EMBED_IMAGES or NESTORY_DESCRIPTION_EMBED_IMAGES.
 */
export function isDescriptionEmbedEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const parsed = normalizeEnvFlag(
    env.DESCRIPTION_EMBED_IMAGES ?? env.NESTORY_DESCRIPTION_EMBED_IMAGES
  );
  return parsed !== false;
}

/**
 * Showmore path: default OFF when env unset (HTML img not verified).
 */
export function isShowmoreDescriptionEmbedEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const parsed = normalizeEnvFlag(env.SHOWMORE_DESCRIPTION_EMBED_IMAGES);
  return parsed === true;
}

export function resolveImageSourceUrl(
  image: DescriptionEmbedImageInput
): string | null {
  const url =
    image.processed_file_url?.trim() ||
    image.original_file_url?.trim() ||
    image.generated_file_url?.trim() ||
    "";
  return url || null;
}

export function isShopifyCdnUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.includes("cdn.shopify.com") || host.includes("shopifycdn.com");
  } catch {
    return /cdn\.shopify\.com|shopifycdn\.com/i.test(url);
  }
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fallbackAlt(
  image: DescriptionEmbedImageInput,
  titleFallback: string | null | undefined
): string {
  const alt = image.alt_text?.trim();
  if (alt) return alt;
  const title = (titleFallback || "").trim();
  if (title) return title;
  return "Nestory product image";
}

function toCandidate(
  image: DescriptionEmbedImageInput,
  titleFallback: string | null | undefined
): DescriptionEmbedPick | null {
  if (image.image_type === "spec") return null;
  const url = resolveImageSourceUrl(image);
  if (!url) return null;
  return {
    id: image.id,
    imageType: image.image_type,
    url,
    alt: fallbackAlt(image, titleFallback),
    isShopifyCdn: isShopifyCdnUrl(url)
  };
}

/** Prefer Shopify CDN when two candidates equal otherwise by order. */
function preferCdn(a: DescriptionEmbedPick, b: DescriptionEmbedPick): number {
  if (a.isShopifyCdn === b.isShopifyCdn) return 0;
  return a.isShopifyCdn ? -1 : 1;
}

/**
 * Pick up to 2 images: main + detail (scene = generated_detail) with fallbacks.
 * Pure — no I/O.
 */
export function pickDescriptionEmbedImages(
  images: DescriptionEmbedImageInput[] | null | undefined,
  titleFallback?: string | null,
  max: number = DESCRIPTION_EMBED_MAX
): DescriptionEmbedPick[] {
  if (!images?.length || max <= 0) return [];

  const sorted = [...images].sort((a, b) => a.sort_order - b.sort_order);
  const candidates = sorted
    .map((img) => toCandidate(img, titleFallback))
    .filter((c): c is DescriptionEmbedPick => c !== null);

  if (!candidates.length) return [];

  const byType = (type: string) =>
    candidates
      .filter((c) => c.imageType === type)
      .sort(preferCdn);

  const picked: DescriptionEmbedPick[] = [];
  const usedIds = new Set<string>();
  const usedUrls = new Set<string>();

  const take = (list: DescriptionEmbedPick[]) => {
    for (const c of list) {
      if (picked.length >= max) return;
      if (usedIds.has(c.id) || usedUrls.has(c.url)) continue;
      usedIds.add(c.id);
      usedUrls.add(c.url);
      picked.push(c);
      return;
    }
  };

  // 1) Main
  const mains = byType("main");
  if (mains.length) {
    take(mains);
  } else {
    take(candidates.slice().sort(preferCdn));
  }

  if (picked.length >= max) return picked;

  // 2) detail → generated_detail → other non-main (variant last)
  const detail = byType("detail");
  take(detail);
  if (picked.length >= max) return picked;

  const scene = byType("generated_detail");
  take(scene);
  if (picked.length >= max) return picked;

  const others = candidates
    .filter(
      (c) =>
        c.imageType !== "main" &&
        c.imageType !== "detail" &&
        c.imageType !== "generated_detail" &&
        c.imageType !== "variant"
    )
    .sort(preferCdn);
  take(others);
  if (picked.length >= max) return picked;

  const variants = byType("variant");
  take(variants);
  if (picked.length >= max) return picked;

  // Last resort: any remaining (e.g. second main)
  take(candidates.filter((c) => !usedIds.has(c.id)));

  return picked;
}

/**
 * Build HTML snippet for description embed (empty if no picks).
 */
export function buildDescriptionEmbedHtml(
  images: DescriptionEmbedImageInput[] | null | undefined,
  titleFallback?: string | null,
  opts?: { max?: number; enabled?: boolean }
): string {
  if (opts?.enabled === false) return "";
  const picks = pickDescriptionEmbedImages(
    images,
    titleFallback,
    opts?.max ?? DESCRIPTION_EMBED_MAX
  );
  if (!picks.length) return "";

  const parts = picks.map(
    (p) =>
      `<p><img src="${escapeHtmlAttr(p.url)}" alt="${escapeHtmlAttr(p.alt)}" loading="lazy" style="max-width:100%;height:auto;" /></p>`
  );

  return `<!-- nestory-desc-embed -->${parts.join("")}`;
}

/**
 * Shopify / Matrixify boundary helper: respect env unless enabled forced.
 */
export function appendDescriptionEmbedIfEnabled(
  bodyHtml: string,
  images: DescriptionEmbedImageInput[] | null | undefined,
  titleFallback?: string | null,
  env: NodeJS.ProcessEnv = process.env
): string {
  if (!isDescriptionEmbedEnabled(env)) return bodyHtml;
  return bodyHtml + buildDescriptionEmbedHtml(images, titleFallback);
}

/**
 * Showmore boundary: only when SHOWMORE_DESCRIPTION_EMBED_IMAGES=true.
 */
export function appendShowmoreDescriptionEmbedIfEnabled(
  bodyHtml: string,
  images: DescriptionEmbedImageInput[] | null | undefined,
  titleFallback?: string | null,
  env: NodeJS.ProcessEnv = process.env
): string {
  if (!isShowmoreDescriptionEmbedEnabled(env)) return bodyHtml;
  return bodyHtml + buildDescriptionEmbedHtml(images, titleFallback);
}
