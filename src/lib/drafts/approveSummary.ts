/**
 * B11: pure helpers for the pre-approve summary modal.
 *
 * Scope (差異 11 / D1-B): summary is only for Shopify-affecting paths
 * (approve+publish single; batch draft/active). Pure approve stays one-click.
 * D3-B dirty→commit uses B10 combo path in the UI layer, not here.
 */

import {
  COPY_VERSION_FIELD_ORDER,
  type CopyVersionField,
} from "@/lib/drafts/copyVersionHistory";
import {
  isImageMarked,
  isPipelineImage,
  PROCESS_INTENT_LABELS,
} from "@/lib/images/processMarks";
import type { ImageProcessIntent, ProductImage } from "@/types/domain";

/** Short labels for the version combo line (Mockup-style). */
export const COPY_VERSION_SHORT_LABELS: Record<CopyVersionField, string> = {
  enriched_title: "標題",
  why_we_chose_it: "為什麼選",
  product_highlights: "賣點",
  generated_description_html: "描述",
  generated_faq_html: "FAQ",
  seo_title: "SEO",
  meta_description: "Meta",
};

/** D4-A: keep titles identifiable — 14 CJK/code points + ellipsis. */
export const BATCH_TITLE_TRUNCATE_LEN = 14;

export type SummaryRowTone = "ok" | "warn" | "ng" | "info";

export interface SummaryRow {
  tone: SummaryRowTone;
  text: string;
}

export interface FieldVersionInput {
  field: CopyVersionField;
  /** 1-based index of the on-screen version. */
  versionNumber: number;
  /** Total versions for that field (virtual counts as 1). */
  total: number;
}

export interface ImageMarkCounts {
  keep: number;
  de_text: number;
  regenerate: number;
  to_trad: number;
  unmarked: number;
  pipeline: number;
}

export interface SingleApproveSummary {
  rows: SummaryRow[];
  /** True when any warning or unmarked pipeline image exists. */
  hasIssues: boolean;
  warningCount: number;
  unmarkedCount: number;
  imageCounts: ImageMarkCounts;
  copyLine: string;
  imageLine: string;
}

export interface BatchProblemItem {
  draftId: string;
  /** Truncated title for list display. */
  titleShort: string;
  /** Full title for title= tooltip. */
  titleFull: string;
  warningCount: number;
  unmarkedCount: number;
  line: string;
}

export interface BatchApproveSummary {
  rows: SummaryRow[];
  problemItems: BatchProblemItem[];
  totalCount: number;
  draftsWithWarnings: number;
  draftsWithUnmarked: number;
  unmarkedTotal: number;
  warningTotal: number;
  hasIssues: boolean;
}

export function truncateTitle(
  title: string | null | undefined,
  maxLen: number = BATCH_TITLE_TRUNCATE_LEN,
): string {
  const raw = (title ?? "").trim() || "未命名草稿";
  const chars = [...raw];
  if (chars.length <= maxLen) return raw;
  return `${chars.slice(0, maxLen).join("")}…`;
}

export function countImageMarks(
  images: Array<Pick<ProductImage, "image_type" | "process_intent">>,
): ImageMarkCounts {
  const pipeline = images.filter(isPipelineImage);
  const counts: ImageMarkCounts = {
    keep: 0,
    de_text: 0,
    regenerate: 0,
    to_trad: 0,
    unmarked: 0,
    pipeline: pipeline.length,
  };
  for (const image of pipeline) {
    if (!isImageMarked(image)) {
      counts.unmarked += 1;
      continue;
    }
    const intent = image.process_intent as ImageProcessIntent;
    if (intent === "keep") counts.keep += 1;
    else if (intent === "de_text") counts.de_text += 1;
    else if (intent === "regenerate") counts.regenerate += 1;
    else if (intent === "to_trad") counts.to_trad += 1;
  }
  return counts;
}

/** e.g.「保留原圖 ×1、去簡體字 ×2」or「尚無可標記商品圖」. */
export function formatImageMarkStatsLine(counts: ImageMarkCounts): string {
  if (counts.pipeline === 0) {
    return "圖片標記：尚無可標記商品圖（詳情圖不標記）";
  }
  const parts: string[] = [];
  const intents: ImageProcessIntent[] = ["keep", "to_trad", "de_text", "regenerate"];
  for (const intent of intents) {
    const n = counts[intent];
    if (n > 0) parts.push(`${PROCESS_INTENT_LABELS[intent]} ×${n}`);
  }
  if (parts.length === 0 && counts.unmarked === counts.pipeline) {
    return `圖片標記：尚未標記（${counts.pipeline} 張）`;
  }
  if (parts.length === 0) {
    return `圖片標記：${counts.pipeline} 張已計入管線`;
  }
  return `圖片標記：${parts.join("、")}`;
}

/**
 * Build Mockup-style combo line from per-field version cursors.
 * Only fields with total > 0 appear in the parenthetical.
 */
export function formatCopyVersionSummaryLine(fields: FieldVersionInput[]): string {
  const ordered = COPY_VERSION_FIELD_ORDER.map((field) => fields.find((f) => f.field === field)).filter(
    (f): f is FieldVersionInput => Boolean(f) && f!.total > 0,
  );

  if (ordered.length === 0) {
    return "文案：尚無版本（請先生成）";
  }

  const parts = ordered.map(
    (f) => `${COPY_VERSION_SHORT_LABELS[f.field]} v${f.versionNumber}`,
  );
  return `文案：版本組合（${parts.join("＋")}）`;
}

export function buildSingleApproveSummary(input: {
  fieldVersions: FieldVersionInput[];
  images: Array<Pick<ProductImage, "image_type" | "process_intent">>;
  warnings: string[] | null | undefined;
  /** D3-B: surface a yellow note when on-screen copy is not yet committed. */
  hasDirtyCopy?: boolean;
}): SingleApproveSummary {
  const imageCounts = countImageMarks(input.images);
  const warnings = (input.warnings ?? []).map((w) => w.trim()).filter(Boolean);
  const copyLine = formatCopyVersionSummaryLine(input.fieldVersions);
  const imageLine = formatImageMarkStatsLine(imageCounts);
  const rows: SummaryRow[] = [];

  rows.push({ tone: "ok", text: copyLine });

  if (input.hasDirtyCopy) {
    rows.push({
      tone: "warn",
      text: "⚠ 畫面文案有未定案修改；送出將先依 B10 定案目前組合（所見即所核）",
    });
  }

  if (imageCounts.pipeline === 0) {
    rows.push({ tone: "info", text: imageLine });
  } else if (imageCounts.unmarked === 0) {
    rows.push({ tone: "ok", text: imageLine });
  } else {
    rows.push({ tone: "ok", text: imageLine });
    rows.push({
      tone: "warn",
      text: `⚠ ${imageCounts.unmarked} 張商品圖未標記（核准／發布不硬擋；送圖仍會擋）`,
    });
  }

  if (warnings.length === 0) {
    rows.push({ tone: "ok", text: "未處理警告：無" });
  } else {
    for (const warning of warnings) {
      rows.push({
        tone: "ng",
        text: warning.startsWith("⚠") ? warning : `⚠ ${warning}`,
      });
    }
  }

  return {
    rows,
    hasIssues: warnings.length > 0 || imageCounts.unmarked > 0 || Boolean(input.hasDirtyCopy),
    warningCount: warnings.length,
    unmarkedCount: imageCounts.unmarked,
    imageCounts,
    copyLine,
    imageLine,
  };
}

export function buildBatchApproveSummary(
  items: Array<{
    draftId: string;
    title: string | null | undefined;
    warnings: string[] | null | undefined;
    images: Array<Pick<ProductImage, "image_type" | "process_intent">>;
  }>,
): BatchApproveSummary {
  const totalCount = items.length;
  let draftsWithWarnings = 0;
  let draftsWithUnmarked = 0;
  let unmarkedTotal = 0;
  let warningTotal = 0;
  const problemItems: BatchProblemItem[] = [];

  for (const item of items) {
    const warnings = (item.warnings ?? []).map((w) => w.trim()).filter(Boolean);
    const counts = countImageMarks(item.images);
    warningTotal += warnings.length;
    unmarkedTotal += counts.unmarked;
    if (warnings.length > 0) draftsWithWarnings += 1;
    if (counts.unmarked > 0) draftsWithUnmarked += 1;

    if (warnings.length > 0 || counts.unmarked > 0) {
      const titleFull = (item.title ?? "").trim() || "未命名草稿";
      const titleShort = truncateTitle(titleFull);
      const bits: string[] = [];
      if (warnings.length > 0) bits.push(`⚠ ${warnings.length} 則`);
      if (counts.unmarked > 0) bits.push(`未標記 ${counts.unmarked} 張`);
      problemItems.push({
        draftId: item.draftId,
        titleShort,
        titleFull,
        warningCount: warnings.length,
        unmarkedCount: counts.unmarked,
        line: `${titleShort}（${bits.join("／")}）`,
      });
    }
  }

  const rows: SummaryRow[] = [];
  rows.push({
    tone: "info",
    text: `共 ${totalCount} 件將核准並送出至 Shopify`,
  });
  rows.push({
    tone: draftsWithWarnings > 0 ? "warn" : "ok",
    text:
      draftsWithWarnings > 0
        ? `有警告：${draftsWithWarnings} 件（共 ${warningTotal} 則）`
        : "有警告：0 件",
  });
  rows.push({
    tone: unmarkedTotal > 0 ? "warn" : "ok",
    text:
      unmarkedTotal > 0
        ? `圖片未標記：合計 ${unmarkedTotal} 張（${draftsWithUnmarked} 件商品）`
        : "圖片未標記：0 張",
  });
  rows.push({
    tone: "ok",
    text: "文案版本：各件以資料庫目前已存組合為準（批次不讀各卡未定案畫面）",
  });

  if (problemItems.length === 0) {
    rows.push({ tone: "ok", text: `${totalCount} 件皆無待確認警告與未標記圖` });
  } else {
    rows.push({
      tone: "warn",
      text: `有問題 ${problemItems.length} 件（標題截短以便辨識）：`,
    });
    for (const p of problemItems) {
      rows.push({ tone: "ng", text: p.line });
    }
  }

  return {
    rows,
    problemItems,
    totalCount,
    draftsWithWarnings,
    draftsWithUnmarked,
    unmarkedTotal,
    warningTotal,
    hasIssues: problemItems.length > 0,
  };
}

/**
 * D2-A / D3-B primary button label.
 * dirty → always「先定案並送出」(D3-B; then publish mode still applies under the hood);
 * clean draft →「仍要送出」; clean active →「仍要送出並上架」(D2-A).
 */
export function primaryConfirmLabel(opts: {
  publishMode: "draft" | "active";
  hasDirtyCopy: boolean;
  /** Batch has no on-screen dirty; pass false. */
}): string {
  if (opts.hasDirtyCopy) {
    return "先定案並送出";
  }
  return opts.publishMode === "active" ? "仍要送出並上架" : "仍要送出";
}

export function modalHeading(opts: { batchCount?: number }): string {
  if (opts.batchCount != null && opts.batchCount > 1) {
    return `✓ 核准前確認（${opts.batchCount} 件）`;
  }
  if (opts.batchCount === 1) {
    return "✓ 核准前確認（1 件）";
  }
  return "✓ 核准前確認";
}
