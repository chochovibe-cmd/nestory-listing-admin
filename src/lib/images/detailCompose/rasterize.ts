/**
 * SYN-1 B2: SVG → PNG via sharp + non-blank text self-check.
 */

import sharp from "sharp";
import {
  HORIZON,
  DETAIL_COMPOSE_WIDTH
} from "@/lib/images/detailCompose/horizonTokens";
import { resolveDetailComposeFonts } from "@/lib/images/detailCompose/fonts";
import { buildDetailComposeSvg } from "@/lib/images/detailCompose/buildSvg";
import type { DetailComposeCopy } from "@/lib/images/detailCompose/prepareCopy";

export type RasterizeResult = {
  png: Buffer;
  width: number;
  height: number;
  fontWarnings: string[];
  usedFontFallback: boolean;
  /** True when known probe string produced non-cream pixels. */
  textInkOk: boolean;
  textInkWarning?: string;
};

/** Cream bg from Horizon — used for non-blank ink detection. */
const CREAM = {
  r: parseInt(HORIZON.bg.slice(1, 3), 16),
  g: parseInt(HORIZON.bg.slice(3, 5), 16),
  b: parseInt(HORIZON.bg.slice(5, 7), 16)
};

/**
 * Count pixels that differ from cream background (ink / content).
 */
export function countNonCreamPixels(
  raw: Buffer,
  channels: number,
  tol = 10
): number {
  let n = 0;
  for (let i = 0; i < raw.length; i += channels) {
    const r = raw[i];
    const g = raw[i + 1];
    const b = raw[i + 2];
    if (
      Math.abs(r - CREAM.r) > tol ||
      Math.abs(g - CREAM.g) > tol ||
      Math.abs(b - CREAM.b) > tol
    ) {
      n += 1;
    }
  }
  return n;
}

/**
 * Probe: render a known CJK string; assert non-blank ink vs empty cream.
 * Used by verify-syn1 and before production compose (soft warning).
 */
export async function probeCjkTextInk(): Promise<{
  ok: boolean;
  textPixels: number;
  emptyPixels: number;
  fonts: ReturnType<typeof resolveDetailComposeFonts>;
}> {
  const fonts = resolveDetailComposeFonts();
  const probe = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="480" height="120">
  <rect width="480" height="120" fill="${HORIZON.bg}"/>
  <text x="24" y="72" font-family="${fonts.titleFamily}" font-size="36" fill="${HORIZON.title}">潮巢測試字NESTORY</text>
</svg>`;
  const empty = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="480" height="120">
  <rect width="480" height="120" fill="${HORIZON.bg}"/>
</svg>`;

  const textPng = await sharp(Buffer.from(probe)).png().toBuffer();
  const emptyPng = await sharp(Buffer.from(empty)).png().toBuffer();
  const { data: td, info: ti } = await sharp(textPng)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data: ed } = await sharp(emptyPng)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const textPixels = countNonCreamPixels(td, ti.channels);
  const emptyPixels = countNonCreamPixels(ed, ti.channels);
  // Require meaningful ink vs empty (blank-font failure → ~0)
  const ok = textPixels > 200 && textPixels > emptyPixels + 100;
  return { ok, textPixels, emptyPixels, fonts };
}

export async function rasterizeDetailComposeSvg(input: {
  copy: DetailComposeCopy;
  heroHref: string | null;
  reviewBadge?: string | null;
}): Promise<RasterizeResult> {
  const fonts = resolveDetailComposeFonts();
  const svg = buildDetailComposeSvg({
    copy: input.copy,
    heroHref: input.heroHref,
    titleFamily: fonts.titleFamily,
    bodyFamily: fonts.bodyFamily,
    reviewBadge: input.reviewBadge
  });

  const png = await sharp(Buffer.from(svg), { density: 96 })
    .png()
    .toBuffer();

  const meta = await sharp(png).metadata();
  const width = meta.width ?? DETAIL_COMPOSE_WIDTH;
  const height = meta.height ?? 1;

  const probe = await probeCjkTextInk();
  let textInkOk = probe.ok;
  let textInkWarning: string | undefined;
  if (!probe.ok) {
    textInkOk = false;
    textInkWarning =
      "詳情圖字型可能未正確載入（CJK 探測像素過低，輸出可能空白字）";
  }

  return {
    png,
    width,
    height,
    fontWarnings: [...fonts.warnings, ...(textInkWarning ? [textInkWarning] : [])],
    usedFontFallback: fonts.usedFallback,
    textInkOk,
    textInkWarning
  };
}

/** Expose cream constants for tests. */
export const DETAIL_CREAM_RGB = CREAM;
