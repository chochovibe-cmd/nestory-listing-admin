import sharp from "sharp";
import { resolveDetailComposeFonts } from "@/lib/images/detailCompose/fonts";

export type AdCreativeCopy = {
  headline: string;
  subline?: string | null;
  eyebrow?: string | null;
};

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapText(value: string, maxChars: number, maxLines: number): string[] {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const lines: string[] = [];
  let current = "";
  for (const ch of Array.from(text)) {
    if (current.length >= maxChars) {
      lines.push(current);
      current = ch;
      if (lines.length >= maxLines) break;
    } else {
      current += ch;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  return lines.slice(0, maxLines);
}

export async function renderAdCreativeCard(
  visual: Buffer,
  copy: AdCreativeCopy
): Promise<{
  buffer: Buffer;
  width: number;
  height: number;
  fontWarnings: string[];
}> {
  const W = 1080;
  const H = 1350;
  const fonts = resolveDetailComposeFonts();
  const headlineLines = wrapText(copy.headline, 14, 2);
  const sublineLines = wrapText(copy.subline ?? "", 24, 2);
  const eyebrow = (copy.eyebrow ?? "CHOCHO NESTORY").trim().slice(0, 40);

  const base = await sharp(visual, { failOn: "none" })
    .rotate()
    .resize(W, H, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();

  const headlineSvg = headlineLines
    .map(
      (line, index) =>
        `<text x="70" y="${1030 + index * 72}" font-family="${esc(fonts.titleFamily)}" font-size="54" font-weight="700" fill="#202020">${esc(line)}</text>`
    )
    .join("\n");
  const subStart = 1030 + Math.max(1, headlineLines.length) * 72 + 18;
  const subSvg = sublineLines
    .map(
      (line, index) =>
        `<text x="70" y="${subStart + index * 34}" font-family="${esc(fonts.bodyFamily)}" font-size="24" font-weight="500" fill="#4a4a4a">${esc(line)}</text>`
    )
    .join("\n");

  const overlay = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#faf8f3" stop-opacity="0"/>
      <stop offset="38%" stop-color="#faf8f3" stop-opacity="0.82"/>
      <stop offset="100%" stop-color="#faf8f3" stop-opacity="0.98"/>
    </linearGradient>
  </defs>
  <rect x="0" y="820" width="${W}" height="530" fill="url(#fade)"/>
  <rect x="70" y="930" width="76" height="8" rx="4" fill="#c8ff00"/>
  <text x="70" y="980" font-family="${esc(fonts.bodyFamily)}" font-size="18" font-weight="600" fill="#2a2a2a" letter-spacing="3">${esc(eyebrow)}</text>
  ${headlineSvg}
  ${subSvg}
</svg>`;

  const out = await sharp(base)
    .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
    .webp({ quality: 88 })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: out.data,
    width: out.info.width,
    height: out.info.height,
    fontWarnings: fonts.warnings
  };
}
