import { generateSku } from "@/lib/contentGenerator/sku";
import {
  formatChaochaoSalesDescriptionHtml,
  formatPlainTextAsHtml,
  htmlFaqToPlainText
} from "@/lib/contentGenerator/htmlFormat";
import { appendDescriptionEmbedIfEnabled } from "@/lib/contentGenerator/descriptionEmbed";
import { saleStatusNoticeHtml } from "@/lib/contentGenerator/saleStatusNotice";
import { buildFaqJsonLdScriptTag } from "@/lib/contentGenerator/faqJsonLd";
import { buildInternalLinkHtml, InternalLinkMap } from "@/lib/contentGenerator/internalLinks";
import { buildImageFileNameSlug } from "@/lib/contentGenerator/imageFileNameGenerator";
import { buildExternalVideoMedia } from "@/lib/media/videoUrls";
import type { ProductDraft, ProductImage, ProductVariantRow, PublishMode } from "@/types/domain";
import {
  buildVariantPublishPlan,
  type VariantPublishPlan
} from "@/lib/variants/shopifyVariants";

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
    const match = lastSegment.match(/\.([a-zA-Z0-9]+)$/);
    return match ? match[1] : "webp";
  } catch {
    return "webp";
  }
}

function buildProductMetafields(draft: ShopifyPublishDraft): { namespace: string; key: string; type: string; value: string }[] {
  const metafields: { namespace: string; key: string; type: string; value: string }[] = [];

  if (draft.why_we_chose_it?.trim()) {
    metafields.push({
      namespace: "custom",
      key: "why_nestory_pick",
      type: "multi_line_text_field",
      value: draft.why_we_chose_it.trim()
    });
  }

  if (draft.product_highlights?.length) {
    metafields.push({
      namespace: "custom",
      key: "product_highlights",
      type: "multi_line_text_field",
      value: draft.product_highlights.map((line) => `・${line}`).join("\n")
    });
  }

  const faqPlainText = htmlFaqToPlainText(draft.generated_faq_html);
  if (faqPlainText) {
    metafields.push({ namespace: "custom", key: "product_faq", type: "multi_line_text_field", value: faqPlainText });
  }

  if (draft.spec_text?.trim()) {
    metafields.push({
      namespace: "custom",
      key: "product_specs",
      type: "multi_line_text_field",
      value: draft.spec_text.trim()
    });
  }

  return metafields;
}

export function buildShopifyProductPayload(
  draft: ShopifyPublishDraft,
  mode: PublishMode,
  internalLinkMap: InternalLinkMap = {}
) {
  const sortedImages = (draft.product_images ?? [])
    .filter((image) => image.image_type !== "spec")
    .sort((a, b) => a.sort_order - b.sort_order);
  const imageTypeCounts = new Map<string, number>();
  for (const image of sortedImages) {
    imageTypeCounts.set(image.image_type, (imageTypeCounts.get(image.image_type) ?? 0) + 1);
  }
  const imageTypeSeen = new Map<string, number>();
  const images = sortedImages
    .map((image) => {
      const sourceUrl = image.processed_file_url || image.original_file_url || image.generated_file_url;
      if (!sourceUrl) return null;

      const indexInType = imageTypeSeen.get(image.image_type) ?? 0;
      imageTypeSeen.set(image.image_type, indexInType + 1);

      const fileNameSlug = draft.shopify_handle
        ? buildImageFileNameSlug(
            draft.shopify_handle,
            image.image_type,
            indexInType,
            imageTypeCounts.get(image.image_type) ?? 1,
            extractUrlExtension(sourceUrl)
          )
        : null;

      return {
        originalSource: withDownloadFilename(sourceUrl, fileNameSlug),
        alt: image.alt_text || draft.title_zh || draft.taobao_title || "Nestory product image",
        mediaContentType: "IMAGE"
      };
    })
    .filter((image): image is { originalSource: string; alt: string; mediaContentType: string } => image !== null);

  const videoBuild = buildExternalVideoMedia(
    draft.video_urls,
    draft.title_zh || draft.taobao_title
  );
  const mediaWithVideos = [...images, ...videoBuild.media];

  const { sku } = generateSku({
    productType: draft.product_type ?? "",
    ipName: draft.ip_name ?? draft.category ?? "",
    characterName: draft.character_name
  });
  const generatedPayload = isRecord(draft.generated_payload_json) ? draft.generated_payload_json : {};
  const generatedProduct = isRecord(generatedPayload.product) ? generatedPayload.product : {};
  const generatedVariantSeed = isRecord(generatedPayload.variantSeed) ? generatedPayload.variantSeed : {};
  const tags = draft.shopify_tags?.length ? draft.shopify_tags : draft.tags || [];

  // COPY C1.1: only 潮巢導購版 changes the Shopify semantic hierarchy.
  // Original six tones keep the historical notice + <h3> formatter path byte-for-behavior.
  const plainDescription = draft.description_html || draft.description_plain || "";
  const mainDescriptionHtml = draft.generation_tone === CHAOCHAO_SALES_TONE
    ? formatChaochaoSalesDescriptionHtml(plainDescription, draft.sale_status)
    : saleStatusNoticeHtml(draft.sale_status, draft.generation_tone) + formatPlainTextAsHtml(plainDescription);

  const product = {
    title: draft.title_zh || draft.taobao_title || "Nestory product",
    descriptionHtml:
      appendDescriptionEmbedIfEnabled(
        mainDescriptionHtml,
        draft.product_images,
        draft.title_zh || draft.taobao_title
      ) +
      buildInternalLinkHtml(draft.ip_name, internalLinkMap) +
      buildFaqJsonLdScriptTag(draft.generated_faq_html),
    vendor: draft.vendor || "潮巢 Nestory",
    productType: draft.product_type || draft.category || "IP 周邊",
    tags,
    status: mode === "active" ? "ACTIVE" : "DRAFT",
    seo: {
      title: draft.seo_title || draft.title_zh || "",
      description: draft.seo_description || ""
    },
    ...(draft.shopify_handle ? { handle: draft.shopify_handle } : {}),
    metafields: buildProductMetafields(draft),
    ...(Array.isArray(draft.metafields_json) ? { metafields: draft.metafields_json } : {}),
    ...generatedProduct
  };

  const variantPlan: VariantPublishPlan = buildVariantPublishPlan(
    draft.product_variants,
    {
      cny_price: draft.cny_price,
      twd_cost: draft.twd_cost,
      price_mode: draft.price_mode
    }
  );

  const productWithOptions =
    variantPlan.mode === "multi"
      ? {
          ...product,
          productOptions: variantPlan.productOptions
        }
      : product;

  return {
    product: productWithOptions,
    media: Array.isArray(generatedPayload.media) ? generatedPayload.media : mediaWithVideos,
    variantSeed: {
      sku,
      price: draft.twd_price ?? 0,
      cost: draft.twd_cost ?? 0,
      compareAtPrice: draft.compare_at_price ?? null,
      inventoryQuantity: draft.inventory_quantity ?? 0,
      inventoryPolicy: draft.inventory_policy === "deny" ? "DENY" : "CONTINUE",
      ...generatedVariantSeed
    },
    variantPlan,
    shopifyCollections: draft.shopify_collections ?? [],
    collectionSuggestion: draft.collection_suggestion,
    generationRuleVersion: draft.generation_rule_version,
    /** D10: non-YouTube skips for draft.warnings (publishDraft merges). */
    videoWarnings: videoBuild.warnings
  };
}

export function shopifyAdminUrl(productGid: string) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const numericId = productGid.split("/").pop();
  return domain && numericId ? `https://${domain}/admin/products/${numericId}` : null;
}
