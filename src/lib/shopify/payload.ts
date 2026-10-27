import {
  formatChaochaoSalesDescriptionHtml,
  formatPlainTextAsHtml,
  htmlFaqToPlainText
} from "@/lib/contentGenerator/htmlFormat";
import { appendDescriptionImagesIfEnabled } from "@/lib/contentGenerator/descriptionDetailImages";
import { saleStatusNoticeHtml } from "@/lib/contentGenerator/saleStatusNotice";
import { repairSpecText } from "@/lib/contentGenerator/copyFormatRepair";
import { buildFaqJsonLdScriptTag } from "@/lib/contentGenerator/faqJsonLd";
import { buildInternalLinkHtml, InternalLinkMap } from "@/lib/contentGenerator/internalLinks";
import { buildImageFileNameSlug } from "@/lib/contentGenerator/imageFileNameGenerator";
import { buildExternalVideoMedia } from "@/lib/media/videoUrls";
import { resolveShopifyCategoryId } from "@/lib/shopify/taxonomyCategory";
import { isShopifyProductMediaImage } from "@/lib/images/shopifyMainImage";
export { isShopifyProductMediaImage } from "@/lib/images/shopifyMainImage";
import type { ProductDraft, ProductImage, ProductVariantRow, PublishMode } from "@/types/domain";
import {
  buildVariantPublishPlan,
  type VariantPublishPlan
} from "@/lib/variants/shopifyVariants";
import { deriveDraftSku, isAutoSku } from "@/lib/variants/variantSku";

const CHAOCHAO_SALES_TONE = "潮巢導購版";

export interface ShopifyPublishDraft extends ProductDraft {
  product_images?: ProductImage[];
  /** B7: loaded at publish time; never used pre-B7. */
  product_variants?: ProductVariantRow[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function withDownloadFilename(url: string, filename: string | null): string {
  if (!filename) return url;

  try {
    const parsed = new URL(url);
    parsed.searchParams.set("download", filename);
    return parsed.toString();
  } catch {
    return url;
  }
}

function extractUrlExtension(url: string): string {
  try {
    const lastSegment = new URL(url).pathname.split("/").pop() ?? "";
    c...[truncated]