import { appendShowmoreDescriptionEmbedIfEnabled } from "@/lib/contentGenerator/descriptionEmbed";
import { formatPlainTextAsHtml } from "@/lib/contentGenerator/htmlFormat";
import { collapseSkuHyphens } from "@/lib/contentGenerator/sku";
import { appendVideoLinksHtml } from "@/lib/media/videoUrls";
import type { ProductDraft, ProductImage, ProductVariantRow } from "@/types/domain";
import { assembleShowmoreCopy } from "./showmoreCopyRewrite";
import {
  applyShowmoreCompareAt,
  applyShowmoreMarkup,
  DEFAULT_SHOWMORE_MARKUP_PERCENT,
  normalizeShowmoreMarkupPercent
} from "./showmorePricing";

export interface ShowmoreDraft extends ProductDraft {
  product_images?: ProductImage[];
  product_variants?: Array<
    Pick<
      ProductVariantRow,
      | "option1_name"
      | "option1_value"
      | "option2_name"
      | "option2_value"
      | "option3_name"
      | "option3_value"
      | "sku"
      | "twd_price"
      | "compare_at_price"
      | "inventory_quantity"
      | "sort_order"
    >
  >;
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
 * R3 / 回饋 55：詳情圖預設不上架；僅主圖／款式圖 + 標記「保留上架」的詳情圖。
 * 開關未上線前：detail / generated_detail 一律排除（image_flags.include_on_listing === true 例外）。
 */
export function isDetailRetainedForListing(
  image: Pick<ProductImage, "image_type"> & { image_flags?: Record<string, unknown> | null }
): boolean {
  if (image.image_type !== "detail" && image.image_type !== "generated_detail") {
    return false;
  }
  const flags = image.image_flags;
  if (!flags || typeof flags !== "object") return false;
  return flags.include_on_listing === true || flags.retain_for_listing === true;
}

export function isShowmoreListingImage(
  image: Pick<ProductImage, "image_type"> & { image_flags?: Record<string, unknown> | null }
): boolean {
  if (image.image_type === "spec") return false;
  if (image.image_type === "main" || image.image_type === "variant") return true;
  return isDetailRetainedForListing(image);
}

/**
 * D8-open + R3: exclude spec + non-retained detail.
 * Sort by sort_order; main image preferred for 主要圖片*.
 */
export function pickShowmoreImages(
  images: Array<
    ProductImage & { image_flags?: Record<string, unknown> | null }
  > | undefined
) {
  const sorted = (images ?? [])
    .filter((image) => isShowmoreListingImage(image))
    .sort((a, b) => a.sort_order - b.sort_order);
  const mainImage =
    sorted.find((image) => image.image_type === "main") ?? sorted[0];
  const otherImageUrls = sorted
    .filter((image) => image !== mainImage)
    .map((image) => imageUrl(image))
    .filter(Boolean);
  return { mainImageUrl: imageUrl(mainImage), otherImageUrls };
}

type ShowmoreRow = Record<string, string | number>;

function emptyShowmoreRow(): ShowmoreRow {
  return {
    "商品名稱*": "",
    "商品簡述": "",
    "商品介紹": "",
    "配送限定": "",
    "商品編號(sku)": "",
    "第一層樣式名稱": "",
    "第一層樣式*": "",
    "第二層樣式名稱": "",
    "第二層樣式": "",
    "第三層樣式名稱": "",
    "第三層樣式": "",
    "原價": "",
    "售價*": "",
    "成本": "",
    "官網庫存*": DEFAULT_STOCK,
    "重量(kg)*": DEFAULT_WEIGHT_KG,
    "VIP價格": "",
    "主要圖片*": "",
    "廣告圖": "",
    "商品圖片": "",
    "商品樣式圖片": ""
  };
}

function hasFilledVariant(
  v: NonNullable<ShowmoreDraft["product_variants"]>[number]
): boolean {
  return Boolean(
    (v.option1_value ?? "").trim() ||
      (v.option2_value ?? "").trim() ||
      (v.option3_value ?? "").trim()
  );
}

/**
 * R3 / 回饋 55：多款式展開。
 * 首列填商品名稱／簡述／介紹／圖；後續款式列商品名稱留白 + 各自 SKU/樣式/售價/庫存/重量。
 * 售價來源＝各款式 twd_price（已算好的售價）；缺價由 preflight 擋。
 */
export function buildShowmoreRows(
  drafts: ShowmoreDraft[],
  options: BuildShowmoreOptions = {}
): ShowmoreRow[] {
  const markupPercent = normalizeShowmoreMarkupPercent(
    options.showmoreMarkupPercent ?? DEFAULT_SHOWMORE_MARKUP_PERCENT
  );

  const rows: ShowmoreRow[] = [];

  for (const draft of drafts) {
    const { mainImageUrl, otherImageUrls } = pickShowmoreImages(
      draft.product_images as Array<
        ProductImage & { image_flags?: Record<string, unknown> | null }
      >
    );
    const copy = assembleShowmoreCopy(draft);
    const bodyHtml = appendVideoLinksHtml(
      appendShowmoreDescriptionEmbedIfEnabled(
        formatPlainTextAsHtml(copy.descriptionPlain),
        draft.product_images,
        copy.title || draft.title_zh || draft.taobao_title
      ),
      draft.video_urls
    );

    const variants = (draft.product_variants ?? [])
      .filter(hasFilledVariant)
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    if (variants.length === 0) {
      const sellPrice = applyShowmoreMarkup(draft.twd_price, markupPercent);
      const compareAt = applyShowmoreCompareAt(
        draft.compare_at_price,
        sellPrice,
        markupPercent
      );
      const row = emptyShowmoreRow();
      row["商品名稱*"] = copy.title;
      row["商品簡述"] = copy.brief;
      row["商品介紹"] = bodyHtml;
      row["商品編號(sku)"] = collapseSkuHyphens(draft.sku || "");
      row["第一層樣式名稱"] = "款式";
      row["第一層樣式*"] = "單一款式";
      row["原價"] = compareAt;
      row["售價*"] = sellPrice;
      row["成本"] = draft.twd_cost ?? "";
      row["主要圖片*"] = mainImageUrl;
      row["廣告圖"] = mainImageUrl;
      row["商品圖片"] = otherImageUrls.join(" ");
      rows.push(row);
      continue;
    }

    variants.forEach((variant, index) => {
      const sellRaw = variant.twd_price ?? draft.twd_price;
      const sellPrice = applyShowmoreMarkup(sellRaw, markupPercent);
      const compareAt = applyShowmoreCompareAt(
        variant.compare_at_price ?? draft.compare_at_price,
        sellPrice,
        markupPercent
      );
      const opt1Name = (variant.option1_name ?? "").trim() || "款式";
      const opt1Value = (variant.option1_value ?? "").trim() || "單一款式";
      const opt2Name = (variant.option2_name ?? "").trim();
      const opt2Value = (variant.option2_value ?? "").trim();
      const opt3Name = (variant.option3_name ?? "").trim();
      const opt3Value = (variant.option3_value ?? "").trim();
      const variantSku =
        collapseSkuHyphens(variant.sku) ||
        collapseSkuHyphens(
          draft.sku ? `${draft.sku}-${index + 1}` : `V${index + 1}`
        );
      const stock =
        variant.inventory_quantity != null &&
        Number.isFinite(Number(variant.inventory_quantity)) &&
        Number(variant.inventory_quantity) > 0
          ? Number(variant.inventory_quantity)
          : DEFAULT_STOCK;

      const row = emptyShowmoreRow();
      if (index === 0) {
        row["商品名稱*"] = copy.title;
        row["商品簡述"] = copy.brief;
        row["商品介紹"] = bodyHtml;
        row["主要圖片*"] = mainImageUrl;
        row["廣告圖"] = mainImageUrl;
        row["商品圖片"] = otherImageUrls.join(" ");
        row["成本"] = draft.twd_cost ?? "";
      } else {
        row["商品名稱*"] = "";
        row["商品簡述"] = "";
        row["商品介紹"] = "";
        row["主要圖片*"] = "";
        row["廣告圖"] = "";
        row["商品圖片"] = "";
        row["成本"] = "";
      }
      row["商品編號(sku)"] = variantSku;
      row["第一層樣式名稱"] = opt1Name;
      row["第一層樣式*"] = opt1Value;
      row["第二層樣式名稱"] = opt2Name;
      row["第二層樣式"] = opt2Value;
      row["第三層樣式名稱"] = opt3Name;
      row["第三層樣式"] = opt3Value;
      row["原價"] = compareAt;
      row["售價*"] = sellPrice;
      row["官網庫存*"] = stock;
      row["重量(kg)*"] = DEFAULT_WEIGHT_KG;
      rows.push(row);
    });
  }

  return rows;
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
    lines.push(headers.map((header) => escapeCsv(row[header])).join(","));
  }
  return `\uFEFF${lines.join("\n")}`;
}
