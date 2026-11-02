import type { ProductDraft, ProductImage, ProductVariantRow } from "@/types/domain";

export interface GptRawProduct extends ProductDraft {
  product_images: ProductImage[];
  product_variants: ProductVariantRow[];
}

/** Only the fields needed to render the handoff list; export keeps its full product shape. */
export type GptRawListItem = Pick<ProductDraft,
  | "id" | "created_by" | "source_platform" | "source_url" | "original_title"
  | "taobao_title" | "cny_price" | "gpt_handoff_at" | "gpt_exported_at"
> & {
  server_price_confidence: string | null;
  client_price_confidence: string | null;
  product_images: Pick<ProductImage,
    "id" | "draft_id" | "image_type" | "sort_order" | "processed_file_url" | "original_file_url"
  >[];
  product_variants: Pick<ProductVariantRow, "id" | "draft_id" | "sort_order" | "cny_price">[];
};

export const GPT_RAW_HEADERS = [
  "商品編號", "來源平台", "來源連結", "原始標題", "品牌", "IP", "角色", "規格參數", "備註", "影片連結",
  "主圖", "詳情圖", "價格提醒", "選項1名稱", "選項1", "選項2名稱", "選項2", "選項3名稱", "選項3",
  "SKU", "成本（人民幣）", "促銷價（人民幣）", "來源庫存", "來源狀態", "款式圖"
] as const;

const text = (value: unknown): string => value == null ? "" : String(value);
const numeric = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};
const usableCost = (value: unknown): string => {
  const n = numeric(value);
  return n == null || n <= 0.01 ? "" : String(value);
};
const orderedImages = (p: GptRawProduct, type: "main" | "detail") =>
  (p.product_images ?? []).filter((image) => image.image_type === type)
    .slice().sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
    .map((image) => (image.processed_file_url || image.original_file_url || "").trim()).filter(Boolean);

function captureMetadata(product: GptRawProduct) {
  const capture = product.raw_capture && typeof product.raw_capture === "object" ? product.raw_capture as Record<string, unknown> : {};
  const client = capture.client_meta && typeof capture.client_meta === "object" ? capture.client_meta as Record<string, unknown> : {};
  const server = capture.server && typeof capture.server === "object" ? capture.server as Record<string, unknown> : {};
  const confidence = typeof server.price_confidence === "string" ? server.price_confidence : typeof client.price_confidence === "string" ? client.price_confidence : null;
  const payload = capture.payload && typeof capture.payload === "object" ? capture.payload as Record<string, unknown> : {};
  const flatVariants = Array.isArray(payload.variants_flat) ? payload.variants_flat as Array<Record<string, unknown>> : [];
  return {
    confidence,
    productPromoPrice: client.promo_price_cny ?? payload.promo_price_cny,
    flatVariants
  };
}

function matchingCaptureVariant(product: GptRawProduct, variant: ProductVariantRow | null, metadata: ReturnType<typeof captureMetadata>) {
  if (!variant) return metadata.flatVariants.length === 1 ? metadata.flatVariants[0] : null;
  return metadata.flatVariants.find((candidate) =>
    (variant.source_sku_id && candidate.source_sku_id === variant.source_sku_id) ||
    (variant.sku && candidate.sku === variant.sku) ||
    (variant.option1_value && candidate.option1_value === variant.option1_value &&
      (!variant.option2_value || candidate.option2_value === variant.option2_value) &&
      (!variant.option3_value || candidate.option3_value === variant.option3_value))
  ) ?? null;
}

export function gptPriceWarnings(product: GptRawProduct): string {
  return gptPriceWarningsFromCosts(
    captureMetadata(product).confidence,
    product.cny_price,
    product.product_variants.map((variant) => variant.cny_price)
  );
}

export function gptPriceWarningsFromCosts(
  confidence: string | null | undefined,
  productCost: number | null | undefined,
  variantCosts: Array<number | null | undefined>
): string {
  const warnings: string[] = [];
  if (["needs_confirmation", "conflict", "display_only", "unknown"].includes(confidence ?? "")) {
    warnings.push("來源價格需確認");
  }
  if (variantCosts.length) {
    const costs = variantCosts.map(usableCost);
    if (costs.some(Boolean) && costs.some((cost) => !cost)) warnings.push("部分款式沒抓到成本");
    else if (costs.every((cost) => !cost)) warnings.push("沒抓到成本");
  } else if (!usableCost(productCost)) {
    warnings.push("沒抓到成本");
  }
  return warnings.join("；");
}

function csvCell(value: unknown): string {
  return `"${text(value).replace(/"/g, '""')}"`;
}

export function buildGptRawCsv(products: GptRawProduct[]): string {
  const rows: string[][] = [[...GPT_RAW_HEADERS]];
  for (const product of products) {
    const variants = product.product_variants.slice()
      .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
    const images = product.product_images;
    const mainImages = orderedImages(product, "main");
    const detailImages = orderedImages(product, "detail");
    const title = text(product.original_title || product.taobao_title);
    const warnings = gptPriceWarnings(product);
    const metadata = captureMetadata(product);
    const common = [
      product.source_platform, product.source_url, title, product.product_brand, product.ip_name, product.character_name,
      product.spec_text, product.note, (product.video_urls ?? []).join("\n"),
      mainImages.map((url, index) => `主圖${index + 1} ${url}`).join("\n"),
      detailImages.map((url, index) => `詳情圖${index + 1} ${url}`).join("\n"), warnings
    ];
    const entries = variants.length ? variants : [null];
    entries.forEach((variant, index) => {
      const capturedVariant = matchingCaptureVariant(product, variant, metadata);
      const image = variant?.image_id ? images.find((item) => item.id === variant.image_id) : null;
      const variantImageUrl = image ? (image.processed_file_url || image.original_file_url || "") : "";
      const values = [
        product.id.slice(0, 8),
        ...(index === 0 ? common : ["", "", title, "", "", "", "", "", "", "", "", ""]),
        variant?.option1_name ?? "", variant?.option1_value ?? "", variant?.option2_name ?? "", variant?.option2_value ?? "",
        variant?.option3_name ?? "", variant?.option3_value ?? "", variant ? variant.sku : product.sku,
        usableCost(variant ? variant.cny_price : product.cny_price),
        text(capturedVariant?.promo_price_cny ?? (!variant ? metadata.productPromoPrice : "")),
        text(variant?.source_options?.stock?.quantity ?? capturedVariant?.source_quantity),
        (variant?.source_options?.stock?.status ?? capturedVariant?.source_stock_status) === "in_stock" ? "有貨" : (variant?.source_options?.stock?.status ?? capturedVariant?.source_stock_status) === "sold_out" ? "售完" : "不明",
        variantImageUrl
      ];
      rows.push(values.map(text));
    });
  }
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
