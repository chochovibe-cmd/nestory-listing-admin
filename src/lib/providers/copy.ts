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

// A4: the model now emits segmented markers ([[key]] on its own line, content
// on the following lines until the next marker) instead of a single JSON blob.
// This is streaming-friendly -- a partial stream shows readable prose per field
// rather than a half-written `{...}` (文案·一·坑1). The keys mirror the JSON
// field names so downstream mapping is unchanged.
export const COPY_SEGMENT_KEYS = [
  "detected_ip_name",
  "detected_character_name",
  "detected_product_type",
  "detected_category",
  "sku",
  "enriched_title",
  "generated_description_html",
  "generated_faq_html",
  "seo_title",
  "meta_description",
  "why_we_chose_it",
  "product_highlights",
] as const;

type CopySegmentKey = (typeof COPY_SEGMENT_KEYS)[number];

const SEGMENT_MARKER = /^\s*\[\[([a-z_]+)\]\]\s*$/;

/** True when the text contains at least one recognised `[[key]]` marker. */
export function hasCopySegmentMarkers(text: string): boolean {
  return COPY_SEGMENT_KEYS.some((key) => text.includes(`[[${key}]]`));
}

export function parseCopySegments(text: string, provider: string, model: string): CopyProviderOutput {
  const buffers = new Map<CopySegmentKey, string[]>();
  let currentKey: CopySegmentKey | null = null;

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(SEGMENT_MARKER);
    if (match && (COPY_SEGMENT_KEYS as readonly string[]).includes(match[1])) {
      currentKey = match[1] as CopySegmentKey;
      if (!buffers.has(currentKey)) buffers.set(currentKey, []);
      continue;
    }
    if (currentKey) buffers.get(currentKey)!.push(line);
  }

  const get = (key: CopySegmentKey): string => (buffers.get(key)?.join("\n") ?? "").trim();

  const productHighlights = get("product_highlights")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*・•‧·]\s*/, "").replace(/^\s*\d+[.)、]\s*/, "").trim())
    .filter(Boolean);

  return {
    enrichedTitle: get("enriched_title"),
    generatedDescriptionHtml: get("generated_description_html"),
    generatedFaqHtml: get("generated_faq_html"),
    seoTitle: get("seo_title"),
    metaDescription: get("meta_description"),
    whyWeChoseIt: get("why_we_chose_it"),
    productHighlights,
    detectedIpName: get("detected_ip_name"),
    detectedCharacterName: get("detected_character_name"),
    detectedProductType: get("detected_product_type"),
    detectedCategory: get("detected_category"),
    sku: get("sku"),
    provider,
    model,
  };
}

/**
 * Primary parser: prefer segmented markers, fall back to JSON. The fallback
 * keeps older prompts / a model that ignored the marker instruction working,
 * and covers the A8 retry that re-asks for whichever format.
 */
export function parseCopyProviderOutput(text: string, provider: string, model: string): CopyProviderOutput {
  if (hasCopySegmentMarkers(text)) return parseCopySegments(text, provider, model);
  return parseCopyProviderJson(text, provider, model);
}

/** An output is unusable when neither a title nor a description came back. */
export function isCopyOutputEmpty(output: CopyProviderOutput): boolean {
  return !output.enrichedTitle.trim() && !output.generatedDescriptionHtml.trim();
}

// A8: appended to the user message on the single retry, nudging the model back
// to the marker format when its first reply was unparseable/empty.
export const COPY_FORMAT_REMINDER =
  "提醒：請嚴格使用分段標記格式輸出——每個欄位以獨立一行的 [[欄位名]] 起頭、內容寫在下一行，" +
  "至少要有 [[enriched_title]] 與 [[generated_description_html]] 兩段，不要輸出 JSON、程式碼區塊或任何額外說明文字。";

/**
 * A8: run the model, parse, and retry EXACTLY ONCE with a format reminder if the
 * reply is unparseable or empty. No retry loop -- a second failure throws so the
 * route can mark the draft failed for a human to retry. `callModel` receives the
 * reminder to append (null on the first attempt) and returns the raw text; HTTP/
 * network errors it throws propagate immediately (they are not parse failures).
 */
export async function generateWithParseRetry(
  callModel: (formatReminder: string | null) => Promise<string>,
  provider: string,
  model: string,
): Promise<CopyProviderOutput> {
  const attempt = async (reminder: string | null): Promise<CopyProviderOutput | null> => {
    const text = await callModel(reminder);
    try {
      const parsed = parseCopyProviderOutput(text, provider, model);
      return isCopyOutputEmpty(parsed) ? null : parsed;
    } catch {
      return null;
    }
  };

  const first = await attempt(null);
  if (first) return first;

  const second = await attempt(COPY_FORMAT_REMINDER);
  if (second) return second;

  throw new Error("文案解析失敗：模型連續兩次未回傳可解析的內容，請稍後重試或改用其他模型。");
}
