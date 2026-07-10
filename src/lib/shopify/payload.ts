import { generateSku } from "@/lib/contentGenerator/sku";
import { formatPlainTextAsHtml, htmlFaqToPlainText } from "@/lib/contentGenerator/htmlFormat";
import { buildFaqJsonLdScriptTag } from "@/lib/contentGenerator/faqJsonLd";
import type { ProductDraft, ProductImage, PublishMode } from "@/types/domain";

export interface ShopifyPublishDraft extends ProductDraft {
  product_images?: ProductImage[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// A22b (2026-07-10 A14 finding): why_we_chose_it / product_highlights /
// generated_faq_html / spec_text were all generated and stored, but nothing
// ever mapped them into Shopify product metafields -- the store's four
// existing custom.* definitions sat empty on every published product.
// namespace/key values below were confirmed against the live store's
// metafieldDefinitions query (not guessed): all four are multi_line_text_field.
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
    // A23 (2026-07-10 A14 finding): description_html is stored as PLAIN TEXT
    // on purpose (ResultCard.tsx edits it in a plain <textarea> so reviewers
    // see readable Chinese, not markup) -- the conversion to real HTML only
    // happens here, at the Shopify boundary, not at save time. Converting at
    // save time would make the DB column (and the edit textarea) show raw
    // <p>/<ul> tags instead of readable text.
    // A21-2: FAQPage JSON-LD appended the same way -- generated at the
    // Shopify boundary only, never written back to the DB column or the
    // app's own FAQ tab UI.
    descriptionHtml:
      formatPlainTextAsHtml(draft.description_html || draft.description_plain || "") +
      buildFaqJsonLdScriptTag(draft.generated_faq_html),
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
    // A22b: computed default, overridable by the legacy metafields_json
    // column (worker/complete path) or generatedProduct, same precedence the
    // handle/other overrides already followed here.
    metafields: buildProductMetafields(draft),
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
