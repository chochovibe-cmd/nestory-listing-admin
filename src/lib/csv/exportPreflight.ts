/**
 * D9-open + R3: pure export preflight (no LLM).
 * error → block download; warn → allow with explicit confirm.
 * Showmore prices use the same helpers as CSV export (showmorePricing).
 * R3: station③ gate + multi-variant price checks + dual-mode table fields.
 */

import { truncateTitle } from "@/lib/drafts/approveSummary";
import { buildShopifyStorefrontProductUrl } from "@/lib/shopify/storefrontUrl";
import type { ProductDraft, ProductImage, ProductVariantRow } from "@/types/domain";
import {
  applyShowmoreCompareAt,
  applyShowmoreMarkup,
  DEFAULT_SHOWMORE_MARKUP_PERCENT,
  normalizeShowmoreMarkupPercent
} from "./showmorePricing";

export type ExportKind = "showmore" | "matrixify";

export type PreflightLevel = "error" | "warn" | "info";

export const EXPORTABLE_STATUSES = ["approved", "api_failed", "csv_ready"] as const;

export type ExportableStatus = (typeof EXPORTABLE_STATUSES)[number];

export function isExportableStatus(status: string | null | undefined): boolean {
  return EXPORTABLE_STATUSES.includes(status as ExportableStatus);
}

/** R3: ready station or legacy exportable status. */
export function isExportableDraft(draft: {
  status?: string | null;
  pipeline_stage?: string | null;
}): boolean {
  if (draft.pipeline_stage === "ready") return true;
  // api_failed / csv_ready may still re-download (records / R4); approved alone
  // without ready is station①/② — block unless already left (csv_ready).
  if (draft.status === "csv_ready" || draft.status === "api_failed") return true;
  if (draft.status === "approved" && draft.pipeline_stage == null) {
    // pre-migration rows: allow (legacy D9)
    return true;
  }
  return false;
}

export interface PreflightIssue {
  level: PreflightLevel;
  code: string;
  message: string;
}

export type PreflightVariantInput = Pick<
  ProductVariantRow,
  "option1_value" | "option2_value" | "option3_value" | "twd_price" | "sku" | "sort_order"
>;

/** Minimal draft shape for rules + price preview (full ProductDraft works). */
export type PreflightDraftInput = {
  id: string;
  title_zh?: string | null;
  taobao_title?: string | null;
  original_title?: string | null;
  status?: string | null;
  pipeline_stage?: string | null;
  sku?: string | null;
  twd_price?: number | null;
  twd_cost?: number | null;
  compare_at_price?: number | null;
  price_mode?: ProductDraft["price_mode"];
  description_html?: string | null;
  description_plain?: string | null;
  variant_dimensions?: ProductDraft["variant_dimensions"];
  /** D9 iframe: Online Store handle when already generated / published */
  shopify_handle?: string | null;
  shopify_product_id?: string | null;
  shopify_admin_url?: string | null;
  product_images?: Array<
    Pick<
      ProductImage,
      "image_type" | "processed_file_url" | "original_file_url" | "sort_order"
    > & { list_thumb_url?: string | null; vision_mid_url?: string | null }
  >;
  product_variants?: PreflightVariantInput[];
};

export interface PreflightItem {
  draftId: string;
  titleFull: string;
  titleShort: string;
  status: string;
  /** After Showmore markup+beautify, or raw Matrixify sell. null if missing. */
  sellPriceDisplay: number | null;
  compareAtDisplay: number | null;
  costDisplay: number | null;
  /** Dual-mode table columns (R3 §10). */
  skuDisplay: string;
  variantCount: number;
  imageCount: number;
  issues: PreflightIssue[];
  hasError: boolean;
  hasWarn: boolean;
  /**
   * D9: storefront mock fields + optional live Shopify Online Store URL.
   * Plain or HTML description + image URLs for customer-page preview.
   */
  descriptionText: string;
  imageUrls: string[];
  /** https://{shop}/products/{handle} when domain+handle known; else null */
  storefrontUrl: string | null;
  shopifyAdminUrl: string | null;
  shopifyHandle: string | null;
}

/** Table-mode column keys for dual preview (6–8). */
export const EXPORT_TABLE_COLUMNS = [
  { key: "title", label: "標題" },
  { key: "sell", label: "售價" },
  { key: "compare", label: "原價" },
  { key: "sku", label: "SKU" },
  { key: "variants", label: "款式" },
  { key: "images", label: "圖" },
  { key: "status", label: "燈" }
] as const;

export interface ExportPreflightReport {
  kind: ExportKind;
  /** Showmore only; null for Matrixify. */
  markupPercent: number | null;
  totalSelected: number;
  items: PreflightItem[];
  /** Flattened error messages (item + batch). */
  errorMessages: string[];
  /** Flattened warn messages (item + batch). info does not count. */
  warningMessages: string[];
  /** Non-blocking tips (e.g. Showmore default stock/weight). */
  infoMessages: string[];
  errorCount: number;
  warnCount: number;
  infoCount: number;
  hasErrors: boolean;
  /** True when there is at least one warn-level issue (info alone does not flip this). */
  hasWarnings: boolean;
  /** True when no errors and at least one selected item. */
  canExport: boolean;
}

export interface RunExportPreflightOptions {
  kind: ExportKind;
  /** Client/settings value; server default 5 when showmore. */
  showmoreMarkupPercent?: number;
  /**
   * D9: Shopify Online Store host (from /api/status shopifyStoreDomain).
   * Used only to build public /products/{handle} preview URLs.
   */
  shopifyStoreDomain?: string | null;
}

function draftTitle(draft: PreflightDraftInput): string {
  return (
    (draft.title_zh ?? "").trim() ||
    (draft.taobao_title ?? "").trim() ||
    (draft.original_title ?? "").trim() ||
    ""
  );
}

/** Product images for export (exclude spec), sorted. */
export function pickExportableImages(
  images: PreflightDraftInput["product_images"] | undefined
) {
  return (images ?? [])
    .filter((image) => image.image_type !== "spec")
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

function imageUrl(
  image:
    | (Pick<ProductImage, "processed_file_url" | "original_file_url"> & {
        list_thumb_url?: string | null;
      })
    | undefined
): string {
  if (!image) return "";
  // A19: prefer list thumb for lightweight preview when present
  return (
    (typeof image.list_thumb_url === "string" && image.list_thumb_url) ||
    image.processed_file_url ||
    image.original_file_url ||
    ""
  );
}

/** Prefer full-size (or mid) for storefront hero; fall back to list thumb. */
function storefrontImageUrl(
  image:
    | (Pick<ProductImage, "processed_file_url" | "original_file_url"> & {
        list_thumb_url?: string | null;
        vision_mid_url?: string | null;
      })
    | undefined
): string {
  if (!image) return "";
  return (
    (typeof image.vision_mid_url === "string" && image.vision_mid_url) ||
    image.processed_file_url ||
    image.original_file_url ||
    (typeof image.list_thumb_url === "string" && image.list_thumb_url) ||
    ""
  );
}

export function hasProductImageUrl(
  images: PreflightDraftInput["product_images"] | undefined
): boolean {
  return pickExportableImages(images).some((image) => Boolean(imageUrl(image)));
}

/** True when there is at least one product image URL, but none is processed/CDN. */
export function hasOnlyOriginalImageUrls(
  images: PreflightDraftInput["product_images"] | undefined
): boolean {
  const list = pickExportableImages(images);
  if (!list.length) return false;
  const withUrl = list.filter((image) => Boolean(imageUrl(image)));
  if (!withUrl.length) return false;
  return withUrl.every((image) => !image.processed_file_url && Boolean(image.original_file_url));
}

function hasDescription(draft: PreflightDraftInput): boolean {
  return Boolean(
    (draft.description_html ?? "").trim() || (draft.description_plain ?? "").trim()
  );
}

function filledVariants(draft: PreflightDraftInput): PreflightVariantInput[] {
  return (draft.product_variants ?? []).filter((v) =>
    Boolean(
      (v.option1_value ?? "").trim() ||
        (v.option2_value ?? "").trim() ||
        (v.option3_value ?? "").trim()
    )
  );
}

function checkItem(
  draft: PreflightDraftInput,
  kind: ExportKind,
  markupPercent: number,
  shopifyStoreDomain?: string | null
): PreflightItem {
  const titleFull = draftTitle(draft) || "未命名草稿";
  const titleShort = truncateTitle(titleFull);
  const issues: PreflightIssue[] = [];
  const variants = filledVariants(draft);
  const imageCount = pickExportableImages(draft.product_images).filter((img) =>
    Boolean(imageUrl(img))
  ).length;

  const rawTitle = draftTitle(draft);
  if (!rawTitle) {
    issues.push({
      level: "error",
      code: "title_empty",
      message: "標題空白"
    });
  }

  // R3: multi-variant → each row needs sell price (Showmore expand)
  if (variants.length > 0) {
    const missingPrice = variants.filter(
      (v) =>
        v.twd_price == null ||
        !Number.isFinite(Number(v.twd_price)) ||
        Number(v.twd_price) <= 0
    );
    if (missingPrice.length > 0) {
      issues.push({
        level: "error",
        code: "variant_price_empty",
        message: `有 ${missingPrice.length} 個款式缺售價（請先算好每款售價）`
      });
    }
  }

  const sellRaw =
    variants.length > 0
      ? variants.find(
          (v) =>
            v.twd_price != null &&
            Number.isFinite(Number(v.twd_price)) &&
            Number(v.twd_price) > 0
        )?.twd_price ?? draft.twd_price
      : draft.twd_price;
  const hasSell =
    sellRaw != null && Number.isFinite(Number(sellRaw)) && Number(sellRaw) > 0;
  if (!hasSell && variants.length === 0) {
    issues.push({
      level: "error",
      code: "price_empty",
      message: "無售價"
    });
  }

  if (!isExportableDraft(draft)) {
    issues.push({
      level: "error",
      code: "status_not_exportable",
      message: "這件還沒到「完成待發布」，不能匯出"
    });
  }

  const hasImage = hasProductImageUrl(draft.product_images);
  if (!hasImage) {
    if (kind === "showmore") {
      issues.push({
        level: "error",
        code: "image_empty",
        message: "沒有可上架的商品圖（主要圖片必填）"
      });
    } else {
      issues.push({
        level: "warn",
        code: "image_empty",
        message: "沒有商品圖（Matrixify 可空，匯入後請補圖）"
      });
    }
  } else if (hasOnlyOriginalImageUrls(draft.product_images)) {
    issues.push({
      level: "warn",
      code: "image_original_only",
      message: "圖還是原圖網址，尚未轉檔／圖床（發布時會補）"
    });
  }

  if (!hasDescription(draft)) {
    issues.push({
      level: "warn",
      code: "description_empty",
      message: "商品介紹空白"
    });
  }

  const cost = draft.twd_cost;
  if (cost == null || !Number.isFinite(Number(cost)) || Number(cost) <= 0) {
    issues.push({
      level: "warn",
      code: "cost_empty",
      message: "缺成本"
    });
  }

  if (draft.price_mode === "sale") {
    const cmp = draft.compare_at_price;
    if (cmp == null || !Number.isFinite(Number(cmp)) || Number(cmp) <= 0) {
      issues.push({
        level: "warn",
        code: "compare_at_empty",
        message: "特價模式缺原價"
      });
    }
  }

  let sellPriceDisplay: number | null = null;
  let compareAtDisplay: number | null = null;
  if (hasSell) {
    if (kind === "showmore") {
      const sell = applyShowmoreMarkup(Number(sellRaw), markupPercent);
      sellPriceDisplay = typeof sell === "number" ? sell : null;
      const compare = applyShowmoreCompareAt(
        draft.compare_at_price,
        sell,
        markupPercent
      );
      compareAtDisplay = typeof compare === "number" ? compare : null;
    } else {
      sellPriceDisplay = Number(sellRaw);
      const cmp = draft.compare_at_price;
      compareAtDisplay =
        cmp != null && Number.isFinite(Number(cmp)) && Number(cmp) > 0
          ? Number(cmp)
          : null;
    }
  } else if (kind === "showmore" && draft.compare_at_price != null) {
    const compare = applyShowmoreCompareAt(draft.compare_at_price, "", markupPercent);
    compareAtDisplay = typeof compare === "number" ? compare : null;
  } else if (draft.compare_at_price != null && Number(draft.compare_at_price) > 0) {
    compareAtDisplay = Number(draft.compare_at_price);
  }

  const costDisplay =
    cost != null && Number.isFinite(Number(cost)) && Number(cost) > 0
      ? Number(cost)
      : null;

  const hasError = issues.some((i) => i.level === "error");
  const hasWarn = issues.some((i) => i.level === "warn");
  const skuDisplay =
    (variants[0]?.sku ?? draft.sku ?? "").trim() || "—";

  const exportImages = pickExportableImages(draft.product_images);
  const imageUrls = exportImages
    .map((img) => storefrontImageUrl(img))
    .filter(Boolean)
    .slice(0, 6);
  const descriptionText = (
    draft.description_html ??
    draft.description_plain ??
    ""
  ).trim();

  const handle =
    typeof draft.shopify_handle === "string" && draft.shopify_handle.trim()
      ? draft.shopify_handle.trim()
      : null;
  const storefrontUrl = buildShopifyStorefrontProductUrl({
    storeDomain: shopifyStoreDomain,
    handle
  });
  const shopifyAdminUrl =
    typeof draft.shopify_admin_url === "string" &&
    draft.shopify_admin_url.trim().startsWith("http")
      ? draft.shopify_admin_url.trim()
      : null;

  return {
    draftId: draft.id,
    titleFull,
    titleShort,
    status: draft.status ?? "",
    sellPriceDisplay,
    compareAtDisplay,
    costDisplay,
    skuDisplay,
    variantCount: variants.length,
    imageCount,
    issues,
    hasError,
    hasWarn,
    descriptionText,
    imageUrls,
    storefrontUrl,
    shopifyAdminUrl,
    shopifyHandle: handle
  };
}

/**
 * Run field preflight for one or more drafts (pure; no I/O).
 */
export function runExportPreflight(
  drafts: PreflightDraftInput[],
  options: RunExportPreflightOptions
): ExportPreflightReport {
  const kind = options.kind;
  const markupPercent =
    kind === "showmore"
      ? normalizeShowmoreMarkupPercent(
          options.showmoreMarkupPercent ?? DEFAULT_SHOWMORE_MARKUP_PERCENT
        )
      : null;

  const batchIssues: PreflightIssue[] = [];
  if (!drafts.length) {
    batchIssues.push({
      level: "error",
      code: "empty_selection",
      message: "未選擇任何商品"
    });
  }

  const items = drafts.map((draft) =>
    checkItem(
      draft,
      kind,
      markupPercent ?? DEFAULT_SHOWMORE_MARKUP_PERCENT,
      options.shopifyStoreDomain
    )
  );

  if (kind === "showmore" && drafts.length > 0) {
    batchIssues.push({
      level: "info",
      code: "showmore_defaults",
      message: "庫存 999／重量 0.1kg 為預設；上傳前請在 Showmore 確認"
    });
  }

  const errorMessages: string[] = [];
  const warningMessages: string[] = [];
  const infoMessages: string[] = [];

  for (const issue of batchIssues) {
    if (issue.level === "error") errorMessages.push(issue.message);
    else if (issue.level === "warn") warningMessages.push(issue.message);
    else infoMessages.push(issue.message);
  }

  for (const item of items) {
    for (const issue of item.issues) {
      const line = `${item.titleShort}：${issue.message}`;
      if (issue.level === "error") errorMessages.push(line);
      else if (issue.level === "warn") warningMessages.push(line);
      else infoMessages.push(line);
    }
  }

  const errorCount = errorMessages.length;
  const warnCount = warningMessages.length;
  const infoCount = infoMessages.length;
  const hasErrors = errorCount > 0;
  const hasWarnings = warnCount > 0;

  return {
    kind,
    markupPercent,
    totalSelected: drafts.length,
    items,
    errorMessages,
    warningMessages,
    infoMessages,
    errorCount,
    warnCount,
    infoCount,
    hasErrors,
    hasWarnings,
    canExport: !hasErrors && drafts.length > 0
  };
}

export function exportPreflightHeading(kind: ExportKind): string {
  return kind === "showmore" ? "匯出 Showmore 預覽" : "匯出 Matrixify 預覽";
}

export function exportPrimaryLabel(report: ExportPreflightReport): string {
  if (!report.canExport) return "無法下載（請先修正錯誤）";
  if (report.hasWarnings) return "仍要下載（含警告）";
  return "確認下載 CSV";
}

export function formatPriceCell(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${Math.round(value)}`;
}
