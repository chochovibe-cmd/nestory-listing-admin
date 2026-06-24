import type { ProductDraft, ProductImage, PublishMode } from "@/types/domain";

export interface ShopifyPublishDraft extends ProductDraft {
  product_images?: ProductImage[];
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

  return {
    product: {
      title: draft.title_zh || draft.taobao_title || "Nestory product",
      descriptionHtml: draft.description_html || draft.description_plain || "",
      vendor: draft.vendor || "CHOCHONEST",
      productType: draft.product_type || draft.category || "IP 周邊",
      tags: draft.tags || [],
      status: mode === "active" ? "ACTIVE" : "DRAFT",
      seo: {
        title: draft.seo_title || draft.title_zh || "",
        description: draft.seo_description || ""
      }
    },
    media: images,
    variantSeed: {
      sku: `NST-${draft.id.slice(0, 8).toUpperCase()}`,
      price: draft.twd_price ?? 0,
      cost: draft.twd_cost ?? 0,
      inventoryQuantity: 0,
      inventoryPolicy: "DENY"
    }
  };
}

export function shopifyAdminUrl(productGid: string) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const numericId = productGid.split("/").pop();
  return domain && numericId ? `https://${domain}/admin/products/${numericId}` : null;
}
