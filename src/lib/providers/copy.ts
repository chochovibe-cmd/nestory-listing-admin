import { GeneratedListingContent, ListingDraftInput } from "@/lib/contentGenerator/types";

export type CopyTone = "黑膠文藝收藏感" | "日系選物店溫柔感" | "可愛周邊輕鬆感";
export type CopyLength = "精簡" | "標準" | "詳細";

export interface CopyProviderInput {
  /** Raw product facts the model works from. The model both DETECTS the IP/
   * character/type from the title + image and writes the copy in one pass
   * (matching the 分支 prototype); the deterministic rule engine then runs
   * afterwards on the detected values to produce the authoritative tags. */
  rawTitle: string;
  saleStatus: string;
  source?: string;
  variantSummary?: string;
  price?: number | null;
  compareAtPrice?: number | null;
  note?: string | null;
  imageDescription?: string;
  specText?: string;
  webSearchSummary?: string;
  /** Canonical IP names from ip_catalog; the model must pick from this list
   * when the product matches a known IP so the detected name lines up with
   * tag_rules. It may return a new name only when nothing here fits. */
  knownIpNames?: string[];
  tone: CopyTone;
  copyLength: CopyLength;
}

export interface CopyProviderOutput {
  enrichedTitle: string;
  generatedDescriptionHtml: string;
  generatedFaqHtml: string;
  seoTitle: string;
  metaDescription: string;
  whyWeChoseIt: string;
  productHighlights: string[];
  detectedIpName: string;
  detectedCharacterName: string;
  detectedProductType: string;
  detectedCategory: string;
  sku: string;
  provider: string;
  model: string;
}

export interface CopyProvider {
  name: string;
  generate(input: CopyProviderInput): Promise<CopyProviderOutput>;
}

type ParsedCopyJson = {
  enriched_title?: string;
  generated_description_html?: string;
  generated_faq_html?: string;
  seo_title?: string;
  meta_description?: string;
  why_we_chose_it?: string;
  product_highlights?: string[];
  detected_ip_name?: string;
  detected_character_name?: string;
  detected_product_type?: string;
  detected_category?: string;
  sku?: string;
};

/** Both providers ask the model for the same JSON schema; some models wrap it in a ```json fence. */
export function parseCopyProviderJson(text: string, provider: string, model: string): CopyProviderOutput {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "");
  const parsed = JSON.parse(cleaned) as ParsedCopyJson;

  return {
    enrichedTitle: parsed.enriched_title ?? "",
    generatedDescriptionHtml: parsed.generated_description_html ?? "",
    generatedFaqHtml: parsed.generated_faq_html ?? "",
    seoTitle: parsed.seo_title ?? "",
    metaDescription: parsed.meta_description ?? "",
    whyWeChoseIt: parsed.why_we_chose_it ?? "",
    productHighlights: parsed.product_highlights ?? [],
    detectedIpName: parsed.detected_ip_name ?? "",
    detectedCharacterName: parsed.detected_character_name ?? "",
    detectedProductType: parsed.detected_product_type ?? "",
    detectedCategory: parsed.detected_category ?? "",
    sku: parsed.sku ?? "",
    provider,
    model,
  };
}
