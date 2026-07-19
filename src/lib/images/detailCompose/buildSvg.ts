/**
 * SYN-1 R4: build Horizon-style detail long SVG (no watermark).
 * Text is 100% from prepareDetailComposeCopy (already filtered + localized).
 *
 * Layout is measured first so canvas height always equals content bottom + pad
 * (avoids bottom black band when estimate underflows).
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

export type LayoutSection = {
  name: string;
  top: number;
  bottom: number;
};

export type DetailSvgLayout = {
  canvasWidth: number;
  /** Final SVG height (contentBottom + bottomPad). */
  canvasHeight: number;
  /** Y of last ink / footer baseline + margin. */
  contentBottom: number;
  sections: LayoutSection[];
};

export type BuildDetailSvgResult = {
  svg: string;
  layout: DetailSvgLayout;
};

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function wrapText(text: string, maxChars: number): string[] {
  const t = String(text || "").trim();
  if (!t) return [""];
  const lines: string[] = [];
  let rest = t;
  while (rest.length > maxChars) {
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

const BOTTOM_PAD = 48;
const HERO_TOP = 56;
const HERO_H = 720;

/**
 * Measure vertical layout (same rules as paint). Pure — no DOM.
 * Guarantees contentBottom grows monotonically; sections do not overlap.
 */
export function measureDetailSvgLayout(copy: DetailComposeCopy): DetailSvgLayout {
  const sections: LayoutSection[] = [];
  let y = 0;

  // topbar
  const topbarTop = 0;
  y = 56;
  sections.push({ name: "topbar", top: topbarTop, bottom: y });

  // hero
  const heroTop = HERO_TOP;
  const heroBottom = heroTop + HERO_H;
  sections.push({ name: "hero", top: heroTop, bottom: heroBottom });
  y = heroBottom + 48;

  // product title block
  const titleTop = y;
  y += 28; // PRODUCT kicker
  const metaBits = [copy.brand, copy.ip, copy.productType].filter(Boolean);
  if (metaBits.length) y += 32;
  const titleLines = wrapText(copy.title || "未命名商品", 22);
  y += titleLines.length * 48;
  y += 24; // gap before line
  y += 1; // line
  y += 40; // after line
  sections.push({ name: "title", top: titleTop, bottom: y });

  // highlights
  const highlights =
    copy.highlights.length > 0 ? copy.highlights : ["（草稿尚無賣點）"];
  const hlTop = y;
  let hlInner = 36 + 36; // card pad + heading
  for (const h of highlights) {
    const lines = wrapText(h, 28);
    const rowH = Math.max(48, lines.length * 24 + 8);
    hlInner += rowH;
  }
  hlInner += 20; // bottom pad inside card
  y = hlTop + hlInner;
  y += 28; // after card
  sections.push({ name: "highlights", top: hlTop, bottom: y });

  // specs
  y += 1; // divider
  y += 40;
  const specsTop = y;
  y += 28; // heading
  const specs =
    copy.specs.length > 0 ? copy.specs : [{ key: "", value: "（草稿尚無規格）" }];
  for (const row of specs) {
    y += 36;
    if (row.key) {
      const vLines = wrapText(row.value, 36);
      const rowExtra = Math.max(0, (vLines.length - 1) * 22);
      y += rowExtra;
    }
    y += 16; // line + gap
  }
  sections.push({ name: "specs", top: specsTop, bottom: y });

  // brand
  y += 40;
  const brandTop = y;
  y += 32; // label
  y += 32; // brand name line
  // seal extends from brand name -40 to +24 → need room below name
  y += 40; // space under seal bottom
  sections.push({ name: "brand", top: brandTop, bottom: y });

  // buy notice
  y += 1;
  y += 40;
  const noticeTop = y;
  y += 32; // heading
  const noticeLines = wrapText(copy.buyNotice, 34);
  y += noticeLines.length * 26;
  sections.push({ name: "buy_notice", top: noticeTop, bottom: y });

  // footer
  y += 40;
  const footTop = y;
  y += 16;
  sections.push({ name: "footer", top: footTop, bottom: y });

  const contentBottom = y;
  const canvasHeight = contentBottom + BOTTOM_PAD;

  // Assert monotonic non-overlap in measure itself
  for (let i = 1; i < sections.length; i++) {
    const prev = sections[i - 1]!;
    const cur = sections[i]!;
    if (cur.top + 0.5 < prev.bottom) {
      // clamp: force non-overlap for safety (should not happen)
      cur.top = prev.bottom;
    }
  }

  return {
    canvasWidth: DETAIL_COMPOSE_WIDTH,
    canvasHeight,
    contentBottom,
    sections
  };
}

/**
 * Sections must be strictly ordered and non-overlapping; canvas covers content.
 */
export function assertDetailLayoutSound(layout: DetailSvgLayout): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (layout.canvasHeight < layout.contentBottom) {
    errors.push(
      `canvasHeight ${layout.canvasHeight} < contentBottom ${layout.contentBottom}`
    );
  }
  if (layout.canvasHeight !== layout.contentBottom + BOTTOM_PAD) {
    errors.push(
      `canvasHeight ${layout.canvasHeight} !== contentBottom+pad ${layout.contentBottom + BOTTOM_PAD}`
    );
  }
  for (let i = 0; i < layout.sections.length; i++) {
    const s = layout.sections[i]!;
    if (s.bottom < s.top) {
      errors.push(`section ${s.name}: bottom < top`);
    }
    if (i > 0) {
      const prev = layout.sections[i - 1]!;
      if (s.top + 0.01 < prev.bottom) {
        errors.push(
          `section ${s.name} overlaps ${prev.name}: top ${s.top} < prev.bottom ${prev.bottom}`
        );
      }
    }
  }
  const last = layout.sections[layout.sections.length - 1];
  if (last && last.bottom > layout.contentBottom + 0.01) {
    errors.push(`last section bottom ${last.bottom} > contentBottom ${layout.contentBottom}`);
  }
  return { ok: errors.length === 0, errors };
}

/** @deprecated use measureDetailSvgLayout(...).canvasHeight */
export function estimateDetailSvgHeight(copy: DetailComposeCopy): number {
  return measureDetailSvgLayout(copy).canvasHeight;
}

/**
 * Build a self-contained SVG string. No SYN-0 watermark.
 * Background rect uses measured canvasHeight (no black band at bottom).
 */
export function buildDetailComposeSvg(input: BuildDetailSvgInput): string {
  return buildDetailComposeSvgWithLayout(input).svg;
}

export function buildDetailComposeSvgWithLayout(
  input: BuildDetailSvgInput
): BuildDetailSvgResult {
  const { copy, heroHref, titleFamily, bodyFamily } = input;
  const W = DETAIL_COMPOSE_WIDTH;
  const layout = measureDetailSvgLayout(copy);
  const H = layout.canvasHeight;
  const padX = 48;
  const Htok = HORIZON;

  const metaBits = [copy.brand, copy.ip, copy.productType].filter(Boolean);
  const metaLine = metaBits.map(esc).join(" · ");

  const highlights =
    copy.highlights.length > 0
      ? copy.highlights
      : ["（草稿尚無賣點）"];

  const parts: string[] = [];

  // Full-canvas cream background FIRST (height = measured final)
  parts.push(`<rect width="${W}" height="${H}" fill="${Htok.bg}"/>`);

  // topbar
  let y = 36;
  parts.push(
    `<text x="${padX}" y="${y}" font-family="${esc(titleFamily)}" font-size="22" font-weight="600" fill="${Htok.title}" letter-spacing="4">潮巢</text>`
  );
  parts.push(
    `<text x="${padX + 70}" y="${y}" font-family="${esc(bodyFamily)}" font-size="11" fill="${Htok.body}" letter-spacing="3">NESTORY</text>`
  );

  if (input.reviewBadge?.trim()) {
    const label = esc(input.reviewBadge.trim().slice(0, 24));
    parts.push(
      `<rect x="${W - 160}" y="18" width="120" height="28" rx="4" fill="${Htok.ink}"/>`
    );
    parts.push(
      `<text x="${W - 100}" y="37" text-anchor="middle" font-family="${esc(bodyFamily)}" font-size="12" fill="${Htok.onInk}">${label}</text>`
    );
  }

  // hero band
  const heroTop = HERO_TOP;
  const heroH = HERO_H;
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

  // highlights card — height measured from content (no overflow)
  const hlTop = y;
  let hlInner = 36 + 36;
  for (const h of highlights) {
    const lines = wrapText(h, 28);
    hlInner += Math.max(48, lines.length * 24 + 8);
  }
  hlInner += 20;
  parts.push(
    `<rect x="${padX}" y="${hlTop}" width="${W - padX * 2}" height="${hlInner}" fill="${Htok.surface2}" stroke="${Htok.lineInput}" stroke-width="1"/>`
  );
  y = hlTop + 36;
  parts.push(
    `<text x="${padX + 28}" y="${y}" font-family="${esc(titleFamily)}" font-size="20" font-weight="600" fill="${Htok.title}">商品賣點</text>`
  );
  y += 36;
  for (let i = 0; i < highlights.length; i++) {
    const h = highlights[i]!;
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
  }
  y = hlTop + hlInner + 28;

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
  // brand row — seal sits within brand block (not past canvas)
  parts.push(
    `<text x="${padX}" y="${y}" font-family="${esc(bodyFamily)}" font-size="11" fill="${Htok.body}" letter-spacing="3">BRAND / IP</text>`
  );
  y += 32;
  const brandLine = [copy.brand, copy.ip].filter(Boolean).join(" × ") || "潮巢嚴選";
  parts.push(
    `<text x="${padX}" y="${y}" font-family="${esc(titleFamily)}" font-size="26" font-weight="600" fill="${Htok.title}">${esc(brandLine)}</text>`
  );
  // seal aligned to brand name baseline band (within cream)
  const sealTop = y - 28;
  parts.push(
    `<rect x="${W - padX - 132}" y="${sealTop}" width="132" height="64" fill="${Htok.ink}"/>`
  );
  parts.push(
    `<text x="${W - padX - 66}" y="${sealTop + 28}" text-anchor="middle" font-family="${esc(titleFamily)}" font-size="14" fill="${Htok.onInk}">潮巢嚴選</text>`
  );
  parts.push(
    `<text x="${W - padX - 66}" y="${sealTop + 50}" text-anchor="middle" font-family="${esc(titleFamily)}" font-size="14" fill="${Htok.onInk}">正版</text>`
  );

  y = Math.max(y + 40, sealTop + 64 + 16);
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

  // Paint y should land near measured contentBottom (allow small drift from seal max)
  const paintBottom = y + 8;
  const finalH = Math.max(H, paintBottom + BOTTOM_PAD);
  // If paint drifted past measure, re-stretch background (replace first rect)
  if (finalH > H) {
    parts[0] = `<rect width="${W}" height="${finalH}" fill="${Htok.bg}"/>`;
  }

  const canvasHeight = finalH;
  const contentBottom = Math.max(layout.contentBottom, paintBottom);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${canvasHeight}" viewBox="0 0 ${W} ${canvasHeight}">
${parts.join("\n")}
</svg>`;

  return {
    svg,
    layout: {
      canvasWidth: W,
      canvasHeight,
      contentBottom,
      sections: layout.sections
    }
  };
}
