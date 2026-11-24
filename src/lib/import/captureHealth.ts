import {
  allVariantCostsIdentical,
  hasHiddenVariantPriceEvidence,
  isVariantPriceConfirmed,
  isVariantPriceUnconfirmedCapture,
  readHiddenVariantPriceEvidence,
  type ReadinessVariantRow
} from "@/lib/shopify/publishReadiness";

export type CaptureHealthIssueCode =
  | "variant_cost_missing"
  | "variant_cost_unconfirmed"
  | "same_price_with_range"
  | "no_variants"
  | "no_detail_images";

export type CaptureHealthIssue = { code: CaptureHealthIssueCode; label: string };

export type CaptureHealthInput = {
  rawCapture: unknown;
  productCny: number | string | null | undefined;
  variants: Array<{
    cny_price?: number | string | null;
    cost_is_inherited?: boolean | null;
  }>;
  detailImageCount: number;
  shopifyProductId?: string | null;
};

export const CAPTURE_HEALTH_TITLE = "抓取可能不完整，建議重抓";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function usable(value: unknown): boolean {
  if (value == null || value === "") return false;
  const number = Number(value);
  return Number.isFinite(number) && number > 0.01;
}

function emptyResult(): { incomplete: false; issues: [] } {
  return { incomplete: false, issues: [] };
}

export function assessCaptureHealth(input: CaptureHealthInput): {
  incomplete: boolean;
  issues: CaptureHealthIssue[];
} {
  const raw = asRecord(input.rawCapture);
  if (!raw) return emptyResult();

  const clientMeta = asRecord(raw.client_meta);
  const server = asRecord(raw.server);
  if (!clientMeta && !server) return emptyResult();

  const shopifyProductId = input.shopifyProductId;
  if (typeof shopifyProductId === "string" && shopifyProductId.trim() && shopifyProductId !== "mock-product-id") {
    return emptyResult();
  }

  const productCostAvailable = usable(input.productCny);
  const variants = Array.isArray(input.variants) ? input.variants : [];
  const issues: CaptureHealthIssue[] = [];
  let hasPriceIssue = false;

  if (variants.length > 0) {
    const missing = variants.filter((variant) =>
      !usable(variant.cny_price) && !productCostAvailable
    ).length;
    if (missing > 0) {
      hasPriceIssue = true;
      issues.push({
        code: "variant_cost_missing",
        label: `款式價格有缺（${missing} 款沒有成本）`
      });
    }

    if (isVariantPriceUnconfirmedCapture(input.rawCapture)) {
      const inherited = variants.filter((variant) =>
        (variant.cost_is_inherited === true || !usable(variant.cny_price)) && productCostAvailable
      ).length;
      if (inherited > 0) {
        hasPriceIssue = true;
        issues.push({
          code: "variant_cost_unconfirmed",
          label: `款式價格有缺（淘寶隱藏各款價格，${inherited} 款暫用商品成本）`
        });
      }
    }
  } else if (!productCostAvailable) {
    hasPriceIssue = true;
    issues.push({ code: "variant_cost_missing", label: "沒抓到成本" });
  }

  if (
    !hasPriceIssue &&
    variants.length >= 2 &&
    hasHiddenVariantPriceEvidence(clientMeta) &&
    !isVariantPriceConfirmed(input.rawCapture) &&
    allVariantCostsIdentical(
      variants as ReadinessVariantRow[],
      usable(input.productCny) ? Number(input.productCny) : null
    )
  ) {
    issues.push({
      code: "same_price_with_range",
      label: "每款都同價（但頁面顯示價格有高低或被隱藏）"
    });
  }

  if (variants.length === 0) {
    const skuDimensions = clientMeta?.sku_dimensions;
    const droppedConstantAxes = Array.isArray(server?.dropped_constant_axes)
      ? server.dropped_constant_axes.length
      : 0;
    const excludedVariants = Array.isArray(server?.excluded_variants)
      ? server.excluded_variants.length
      : 0;
    const pageShowsVariants =
      typeof skuDimensions === "number" &&
      skuDimensions >= 1 &&
      droppedConstantAxes < skuDimensions ||
      readHiddenVariantPriceEvidence(clientMeta).priceRange ||
      excludedVariants > 0;
    if (pageShowsVariants) {
      issues.push({ code: "no_variants", label: "0 個款式（頁面有款式選項）" });
    }
  }

  if (input.detailImageCount === 0) {
    issues.push({ code: "no_detail_images", label: "0 張詳情圖" });
  }

  return { incomplete: issues.length > 0, issues };
}

export function captureHealthHowTo(issues: CaptureHealthIssue[]): string {
  return issues.some((issue) => issue.code === "no_variants" || issue.code === "no_detail_images")
    ? "款式或詳情圖缺少時，要先封存這筆草稿，再用外掛重抓，才會重新建立。"
    : "用外掛重抓同一個網址，會補上還沒確認的成本。";
}
