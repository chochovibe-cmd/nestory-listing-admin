import { formatPlainTextAsHtml } from "@/lib/contentGenerator/htmlFormat";
import type { ProductDraft, ProductImage } from "@/types/domain";
import {
  applyShowmoreCompareAt,
  applyShowmoreMarkup,
  DEFAULT_SHOWMORE_MARKUP_PERCENT,
  normalizeShowmoreMarkupPercent
} from "./showmorePricing";

export interface ShowmoreDraft extends ProductDraft {
  product_images?: ProductImage[];
}

export interface BuildShowmoreOptions {
  /** From client pricing settings; server defaults to 5. */
  showmoreMarkupPercent?: number;
}

// Nestory doesn't track these at all -- Showmore's new-product template
// requires them, so exported rows need a human to confirm/adjust after
// download rather than leaving a required column blank.
const DEFAULT_STOCK = 999;
const DEFAULT_WEIGHT_KG = 0.1;

function escapeCsv(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

/** Image URL preference: processed (CDN) → original; never invent URLs. */
function imageUrl(image: ProductImage | undefined): string {
  if (!image) return "";
  return image.processed_file_url || image.original_file_url || "";
}

/**
 * D8-open: exclude spec reference images (same idea as Matrixify).
 * Sort by sort_order; main image preferred for 主要圖片*.
 */
function pickShowmoreImages(images: ProductImage[] | undefined) {
  const sorted = (images ?? [])
    .filter((image) => image.image_type !== "spec")
    .sort((a, b) => a.sort_order - b.sort_order);
  const mainImage = sorted.find((image) => image.image_type === "main") ?? sorted[0];
  const otherImageUrls = sorted
    .filter((image) => image !== mainImage)
    .map((image) => imageUrl(image))
    .filter(Boolean);
  return { mainImageUrl: imageUrl(mainImage), otherImageUrls };
}

export function buildShowmoreRows(
  drafts: ShowmoreDraft[],
  options: BuildShowmoreOptions = {}
) {
  const markupPercent = normalizeShowmoreMarkupPercent(
    options.showmoreMarkupPercent ?? DEFAULT_SHOWMORE_MARKUP_PERCENT
  );

  return drafts.map((draft) => {
    const { mainImageUrl, otherImageUrls } = pickShowmoreImages(draft.product_images);
    const sellPrice = applyShowmoreMarkup(draft.twd_price, markupPercent);
    const compareAt = applyShowmoreCompareAt(
      draft.compare_at_price,
      sellPrice,
      markupPercent
    );

    // Body at export boundary only (A25 / A23 pattern): DB stays plain text.
    const bodySource = draft.description_html || draft.description_plain || "";
    const bodyHtml = formatPlainTextAsHtml(bodySource);

    return {
      "商品名稱*": draft.title_zh || draft.taobao_title || draft.original_title || "",
      // Q5-B: empty; full marketing template / rewrite is D8b
      "商品簡述": "",
      "商品介紹": bodyHtml,
      "配送限定": "",
      "商品編號(sku)": draft.sku || "",
      // Q3-A: single row only; multi-variant expansion is out of D8-open
      "第一層樣式名稱": "款式",
      "第一層樣式*": "單一款式",
      "第二層樣式名稱": "",
      "第二層樣式": "",
      "第三層樣式名稱": "",
      "第三層樣式": "",
      "原價": compareAt,
      "售價*": sellPrice,
      // Cost is never marked up
      "成本": draft.twd_cost ?? "",
      "官網庫存*": DEFAULT_STOCK,
      "重量(kg)*": DEFAULT_WEIGHT_KG,
      "VIP價格": "",
      "主要圖片*": mainImageUrl,
      "廣告圖": mainImageUrl,
      "商品圖片": otherImageUrls.join(" "),
      "商品樣式圖片": ""
    };
  });
}

export function buildShowmoreCsv(
  drafts: ShowmoreDraft[],
  options: BuildShowmoreOptions = {}
) {
  const rows = buildShowmoreRows(drafts, options);
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsv(row[header as keyof typeof row])).join(","));
  }
  return `\uFEFF${lines.join("\n")}`;
}
