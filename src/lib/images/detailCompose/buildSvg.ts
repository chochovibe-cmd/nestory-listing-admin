/**
 * SYN-1 R4: build Horizon-style detail long SVG (no watermark).
 * Text is 100% from prepareDetailComposeCopy (already filtered + localized).
 */

import type { DetailComposeCopy } from "@/lib/images/detailCompose/prepareCopy";
import {
  DETAIL_COMPOSE_WIDTH,
  HORIZON
} from "@/lib/images/detailCompose/horizonTokens";

export type BuildDetailSvgInput = {
  copy: DetailComposeCopy;
  /** Absolute/public URL or data URI for hero (R3-A original product). */
  heroHref: string | null;
  titleFamily: string;
  bodyFamily: string;
  /**
   * When R3-B AI base was used — badge for image review (not a watermark stamp).
   * Empty in R3-A default.
   */
  reviewBadge?: string | null;
};

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Rough height estimate for long SVG (width fixed 1080). */
export function estimateDetailSvgHeight(copy: DetailComposeCopy): number {
  const hl = Math.max(copy.highlights.length, 1);
  const specs = Math.max(copy.specs.length, 1);
  // hero 720 + sections
  return (
    28 +
    40 +
    720 +
    120 +
    80 +
    hl * 56 +
    80 +
    specs * 48 +
    140 +
    120 +
    48
  );
}

/**
 * Build a self-contained SVG string. No SYN-0 watermark.
 */
export function buildDetailComposeSvg(input: BuildDetailSvgInput): string {
  const { copy, heroHref, titleFamily, bodyFamily } = input;
  const W = DETAIL_COMPOSE_WIDTH;
  const H = estimateDetailSvgHeight(copy);
  const padX = 48;
  const Htok = HORIZON;

  const metaBits = [copy.brand, copy.ip, copy.productType].filter(Boolean);
  const metaLine = metaBits.map(esc).join(" · ");

  const highlights =
    copy.highlights.length > 0
      ? copy.highlights
      : ["（草稿尚無賣點）"];

  let y = 0;
  const parts: string[] = [];

  // background
  parts.push(
    `<rect width="${W}" height="${H}" fill="${Htok.bg}"/>`
  );

  // topbar
  y = 36;
  parts.push(
    `<text x="${padX}" y="${y}" font-family="${esc(titleFamily)}" font-size="22" font-weight="600" fill="${Htok.title}" letter-spacing="4">潮巢</text>`
  );
  parts.push(
    `<text x="${padX + 70}" y="${y}" font-family="${esc(bodyFamily)}" font-size="11" fill="${Htok.body}" letter-spacing="3">NESTORY</text>`
  );

  if (input.reviewBadge?.trim()) {
    // Review annotation only (R3-B) — ink on cream, not colored chip
    const label = esc(input.reviewBadge.trim().slice(0, 24));
    parts.push(
      `<rect x="${W - 160}" y="18" width="120" height="28" rx="4" fill="${Htok.ink}"/>`
    );
    parts.push(
      `<text x="${W - 100}" y="37" text-anchor="middle" font-family="${esc(bodyFamily)}" font-size="12" fill="${Htok.onInk}">${label}</text>`
    );
  }

  // hero band
  const heroTop = 56;
  const heroH = 720;
  parts.push(
    `<rect x="0" y="${heroTop}" width="${W}" height="${heroH}" fill="${Htok.surface2}"/>`
  );
  parts.push(
    `<line x1="0" y1="${heroTop}" x2="${W}" y2="${heroTop}" stroke="${Htok.lineSoft}" stroke-width="1"/>`
  );
  parts.push(
    `<line x1="0" y1="${heroTop + heroH}" x2="${W}" y2="${heroTop + heroH}" stroke="${Htok.lineSoft}" stroke-width="1"/>`
  );

  if (heroHref) {
    // object-fit contain approximation: full width band
    parts.push(
      `<image href="${esc(heroHref)}" x="40" y="${heroTop + 20}" width="${W - 80}" height="${heroH - 40}" preserveAspectRatio="xMidYMid meet"/>`
    );
  } else {
    parts.push(
      `<text x="${W / 2}" y="${heroTop + heroH / 2}" text-anchor="middle" font-family="${esc(bodyFamily)}" font-size="16" fill="${Htok.body}">（尚無主圖）</text>`
    );
  }

  y = heroTop + heroH + 48;

  // product title block
  parts.push(
    `<text x="${padX}" y="${y}" font-family="${esc(bodyFamily)}" font-size="11" fill="${Htok.body}" letter-spacing="3">PRODUCT</text>`
  );
  y += 28;
  if (metaLine) {
    parts.push(
      `<text x="${padX}" y="${y}" font-family="${esc(bodyFamily)}" font-size="13" fill="${Htok.body}">${metaLine}</text>`
    );
    y += 32;
  }

  // Title may wrap roughly every ~22 chars
  const title = copy.title || "未命名商品";
  const titleLines = wrapText(title, 22);
  for (const line of titleLines) {
    parts.push(
      `<text x="${padX}" y="${y}" font-family="${esc(titleFamily)}" font-size="34" font-weight="600" fill="${Htok.title}">${esc(line)}</text>`
    );
    y += 48;
  }

  y += 24;
  parts.push(
    `<line x1="${padX}" y1="${y}" x2="${W - padX}" y2="${y}" stroke="${Htok.lineSoft}" stroke-width="1"/>`
  );
  y += 40;

  // highlights card
  parts.push(
    `<rect x="${padX}" y="${y}" width="${W - padX * 2}" height="${48 + highlights.length * 52}" fill="${Htok.surface2}" stroke="${Htok.lineInput}" stroke-width="1"/>`
  );
  y += 36;
  parts.push(
    `<text x="${padX + 28}" y="${y}" font-family="${esc(titleFamily)}" font-size="20" font-weight="600" fill="${Htok.title}">商品賣點</text>`
  );
  y += 36;
  highlights.forEach((h, i) => {
    const n = String(i + 1).padStart(2, "0");
    parts.push(
      `<text x="${padX + 28}" y="${y}" font-family="${esc(titleFamily)}" font-size="15" fill="${Htok.title}">${n}</text>`
    );
    const lines = wrapText(h, 28);
    let ly = y;
    for (const ln of lines) {
      parts.push(
        `<text x="${padX + 72}" y="${ly}" font-family="${esc(bodyFamily)}" font-size="16" fill="${Htok.body}">${esc(ln)}</text>`
      );
      ly += 24;
    }
    y = Math.max(y + 48, ly + 8);
  });

  y += 28;
  parts.push(
    `<line x1="${padX}" y1="${y}" x2="${W - padX}" y2="${y}" stroke="${Htok.lineSoft}" stroke-width="1"/>`
  );
  y += 40;

  // specs
  parts.push(
    `<text x="${padX}" y="${y}" font-family="${esc(titleFamily)}" font-size="20" font-weight="600" fill="${Htok.title}">規格一覽</text>`
  );
  y += 28;
  const specs =
    copy.specs.length > 0 ? copy.specs : [{ key: "", value: "（草稿尚無規格）" }];
  for (const row of specs) {
    y += 36;
    if (row.key) {
      parts.push(
        `<text x="${padX}" y="${y}" font-family="${esc(bodyFamily)}" font-size="13" fill="${Htok.body}">${esc(row.key)}</text>`
      );
      const vLines = wrapText(row.value, 36);
      let vy = y;
      for (const ln of vLines) {
        parts.push(
          `<text x="${padX + 220}" y="${vy}" font-family="${esc(bodyFamily)}" font-size="15" font-weight="500" fill="${Htok.title}">${esc(ln)}</text>`
        );
        vy += 22;
      }
      y = Math.max(y, vy - 22);
    } else {
      parts.push(
        `<text x="${padX}" y="${y}" font-family="${esc(bodyFamily)}" font-size="15" fill="${Htok.title}">${esc(row.value)}</text>`
      );
    }
    parts.push(
      `<line x1="${padX}" y1="${y + 12}" x2="${W - padX}" y2="${y + 12}" stroke="${Htok.lineSoft}" stroke-width="1"/>`
    );
    y += 16;
  }

  y += 40;
  // brand row
  parts.push(
    `<text x="${padX}" y="${y}" font-family="${esc(bodyFamily)}" font-size="11" fill="${Htok.body}" letter-spacing="3">BRAND / IP</text>`
  );
  y += 32;
  const brandLine = [copy.brand, copy.ip].filter(Boolean).join(" × ") || "潮巢嚴選";
  parts.push(
    `<text x="${padX}" y="${y}" font-family="${esc(titleFamily)}" font-size="26" font-weight="600" fill="${Htok.title}">${esc(brandLine)}</text>`
  );
  // seal
  parts.push(
    `<rect x="${W - padX - 132}" y="${y - 40}" width="132" height="64" fill="${Htok.ink}"/>`
  );
  parts.push(
    `<text x="${W - padX - 66}" y="${y - 12}" text-anchor="middle" font-family="${esc(titleFamily)}" font-size="14" fill="${Htok.onInk}">潮巢嚴選</text>`
  );
  parts.push(
    `<text x="${W - padX - 66}" y="${y + 10}" text-anchor="middle" font-family="${esc(titleFamily)}" font-size="14" fill="${Htok.onInk}">正版</text>`
  );

  y += 72;
  parts.push(
    `<line x1="${padX}" y1="${y}" x2="${W - padX}" y2="${y}" stroke="${Htok.lineSoft}" stroke-width="1"/>`
  );
  y += 40;
  parts.push(
    `<text x="${padX}" y="${y}" font-family="${esc(titleFamily)}" font-size="20" font-weight="600" fill="${Htok.title}">購買提醒</text>`
  );
  y += 32;
  const noticeLines = wrapText(copy.buyNotice, 34);
  for (const ln of noticeLines) {
    parts.push(
      `<text x="${padX}" y="${y}" font-family="${esc(bodyFamily)}" font-size="14" fill="${Htok.body}">${esc(ln)}</text>`
    );
    y += 26;
  }

  y += 40;
  parts.push(
    `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${esc(bodyFamily)}" font-size="11" fill="${Htok.body}" opacity="0.75">NESTORY · 潮巢</text>`
  );

  const finalH = Math.max(H, y + 40);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${finalH}" viewBox="0 0 ${W} ${finalH}">
${parts.join("\n")}
</svg>`;
}

function wrapText(text: string, maxChars: number): string[] {
  const t = String(text || "").trim();
  if (!t) return [""];
  const lines: string[] = [];
  let rest = t;
  while (rest.length > maxChars) {
    // prefer break at space / punctuation
    let breakAt = maxChars;
    const slice = rest.slice(0, maxChars + 1);
    const m = slice.match(/^[\s\S]{8,}?[\s，、。；：,.…]/);
    if (m && m[0].length >= 8) breakAt = m[0].length;
    lines.push(rest.slice(0, breakAt).trim());
    rest = rest.slice(breakAt).trim();
  }
  if (rest) lines.push(rest);
  return lines.length ? lines : [""];
}
