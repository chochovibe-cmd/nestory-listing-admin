import { generateSku } from "@/lib/contentGenerator/sku";
import type { ProductDraft, ProductImage, PublishMode } from "@/types/domain";

export interface ShopifyPublishDraft extends ProductDraft {
  product_images?: ProductImage[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function buildShopifyProductPayload(draft: ShopifyPublishDraft, mode: PublishMode) {
  const images = (draft.product_images ?? [])
    .filter((image) => image.image_type !== "spec")
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((image) => ({
      originalSource: image.processed_file_url || image.original_file_url || image.generated_file_url,
      alt: image.alt_text || draft.title_zh || draft.taobao_title || "Nestory product image",
      mediaContentType: "IMAGE"
    }))
    .filter((image) => Boolean(image.originalSource));
  const { sku } = generateSku({
    productType: draft.product_type ?? "",
    ipName: draft.ip_name ?? draft.category ?? "",
    characterName: draft.character_name
  });
  const generatedPayload = isRecord(draft.generated_payload_json) ? draft.generated_payload_json : {};
  const generatedProduct = isRecord(generatedPayload.product) ? generatedPayload.product : {};
  const generatedVariantSeed = isRecord(generatedPayload.variantSeed) ? generatedPayload.variantSeed : {};
  const tags = draft.shopify_tags?.length ? draft.shopify_tags : draft.tags || [];
  const product = {
    title: draft.title_zh || draft.taobao_title || "Nestory product",
    descriptionHtml: draft.description_html || draft.description_plain || "",
    // A24 (2026-07-10 A14 finding): fallback only, real fix is the DB column
    // default (migration 015) -- "CHOCHONEST" isn't a real vendor value in
    // this store, "潮巢 Nestory" already exists in Shopify's vendor list.
    vendor: draft.vendor || "潮巢 Nestory",
    productType: draft.product_type || draft.category || "IP 周邊",
    tags,
    status: mode === "active" ? "ACTIVE" : "DRAFT",
    seo: {
      title: draft.seo_title || draft.title_zh || "",
      description: draft.seo_description || ""
    },
    ...(draft.shopify_handle ? { handle: draft.shopify_handle } : {}),
    ...(Array.isArray(draft.metafields_json) ? { metafields: draft.metafields_json } : {}),
    ...generatedProduct
  };

  return {
    product,
    media: Array.isArray(generatedPayload.media) ? generatedPayload.media : images,
    variantSeed: {
      sku,
      price: draft.twd_price ?? 0,
      cost: draft.twd_cost ?? 0,
      // A14 fix: this was computed but never sent anywhere -- productCreate's
      // ProductInput has no variant/price fields in current API versions, and
      // nothing called the follow-up mutation that actually sets it. See
      // publishDraft.ts's productVariantsBulkUpdate call.
      compareAtPrice: draft.compare_at_price ?? null,
      inventoryQuantity: 0,
      inventoryPolicy: "DENY",
      ...generatedVariantSeed
    },
    shopifyCollections: draft.shopify_collections ?? [],
    collectionSuggestion: draft.collection_suggestion,
    generationRuleVersion: draft.generation_rule_version
  };
}

export function shopifyAdminUrl(productGid: string) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const numericId = productGid.split("/").pop();
  return domain && numericId ? `https://${domain}/admin/products/${numericId}` : null;
}
