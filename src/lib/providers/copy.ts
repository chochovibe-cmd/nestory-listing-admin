import { GeneratedListingContent, ListingDraftInput } from "@/lib/contentGenerator/types";

export type CopyTone = "黑膠文藝收藏感" | "日系選物店溫柔感" | "可愛周邊輕鬆感";
export type CopyLength = "精簡" | "標準" | "詳細";

export interface CopyProviderInput {
  /** contentGenerator's deterministic output. Tags/collections here are final and must not be
   * changed by the provider -- they are already resolved against tag_rules/collection_rules. */
  ruleOutput: GeneratedListingContent;
  draft: ListingDraftInput;
  imageDescription?: string;
  specText?: string;
  webSearchSummary?: string;
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
    provider,
    model,
  };
}
