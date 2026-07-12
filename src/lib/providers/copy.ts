import { GeneratedListingContent, ListingDraftInput } from "@/lib/contentGenerator/types";

// A9 item 2: three new tones added (中二熱血宣言／小編聊天口吻／依IP自動匹配), for a
// 6-tone total matching Phase B's B8 ("語氣 6 款"). 依IP自動匹配 is NOT a voice the
// model picks itself -- it's resolved server-side to one of the other 5 tones via
// resolveCopyTone() in systemPrompt.ts before the prompt is built.
export type CopyTone =
  | "黑膠文藝收藏感"
  | "日系選物店溫柔感"
  | "可愛周邊輕鬆感"
  | "中二熱血宣言"
  | "小編聊天口吻"
  | "依IP自動匹配";
export const COPY_TONES: readonly CopyTone[] = [
  "黑膠文藝收藏感",
  "日系選物店溫柔感",
  "可愛周邊輕鬆感",
  "中二熱血宣言",
  "小編聊天口吻",
  "依IP自動匹配",
];
export type CopyLength = "精簡" | "標準" | "詳細";

// A7: the copy fields that can be regenerated one at a time. Detection fields
// (IP/character/type) are NOT regenerable here -- they stay fixed and feed the
// tag engine; single-field regen only rewrites human-readable copy.
export type CopyRegenField =
  | "enriched_title"
  | "generated_description_html"
  | "generated_faq_html"
  | "seo_title"
  | "meta_description"
  | "why_we_chose_it"
  | "product_highlights";

export const COPY_REGEN_FIELDS: readonly CopyRegenField[] = [
  "enriched_title",
  "generated_description_html",
  "generated_faq_html",
  "seo_title",
  "meta_description",
  "why_we_chose_it",
  "product_highlights",
];

// The already-finalised values of the other fields, sent as context on a
// single-field regen so the rewrite stays consistent with the rest of the copy.
export interface CopyCurrentValues {
  enrichedTitle?: string;
  generatedDescriptionHtml?: string;
  generatedFaqHtml?: string;
  seoTitle?: string;
  metaDescription?: string;
  whyWeChoseIt?: string;
  productHighlights?: string[];
  detectedIpName?: string;
  detectedCharacterName?: string;
  detectedProductType?: string;
}

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
  /** A7: when set, only this one field is regenerated; currentValues carries
   * the rest of the copy as context. */
  regenerateField?: CopyRegenField;
  currentValues?: CopyCurrentValues;
  /** A9 item 4: without these the model has no way to know a listing is
   * secondhand, so it always wrote new-item copy regardless of the draft's
   * actual is_secondhand flag -- this was a real gap, not just wording. */
  isSecondhand?: boolean;
  secondhandGrade?: string | null;
  secondhandCondition?: string | null;
  secondhandNotes?: string | null;
  /** A9 item 2: the draft's already-detected IP, used to resolve
   * 依IP自動匹配 to a concrete tone. Unknown on a draft's first-ever
   * generation (falls back to a default); known on regenerations. */
  detectedIpName?: string | null;
  /** B8: DEFAULT_IP_TONE_MAP merged with team_settings overrides. Only used
   * when tone === 依IP自動匹配; manual tones ignore this map. */
  ipToneMap?: Partial<Record<string, CopyTone>>;
}

// A13: token usage a provider reports for one generation, normalised across
// Anthropic/OpenAI. Full-rate input excludes cached reads (billed cheaper) and
// cache writes (billed dearer), which are tracked separately for the estimate.
export interface RawUsage {
  inputTokens: number;
  outputTokens: number;
  /** Cache reads (Anthropic cache_read / OpenAI cached prompt tokens). */
  cachedInputTokens?: number;
  /** Cache writes (Anthropic cache_creation); 0 for OpenAI. */
  cacheCreationTokens?: number;
}

export interface CopyUsage extends RawUsage {
  /** Rough USD estimate for this generation -- see estimateCopyCostUsd. */
  costUsd: number;
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
  /** 規格自動化 (Mockup差異備忘 差異2, 老闆 2026-07-11)：the model synthesises a
   * spec block from the evidence pool (variant options > raw title > detail-image
   * text > Vision attributes > conservative generic). Written back to spec_text
   * only when the operator left it empty. Optional so non-LLM constructors
   * (test mode) needn't set it. */
  spec?: string;
  provider: string;
  model: string;
  /** A13: present when the model reported token usage (absent in test mode). */
  usage?: CopyUsage;
}

export interface CopyProvider {
  name: string;
  generate(input: CopyProviderInput): Promise<CopyProviderOutput>;
}

// A13: USD rates per 1M tokens -- a dashboard cost signal, not an invoice.
// Claude rates verified against official pricing 2026-07-10 (Fable):
// sonnet-5 $3/$15 (intro $2/$10 through 2026-08-31 -- booked at standard rate,
// so estimates run slightly conservative until then), haiku-4.5 $1/$5,
// opus-4.x $5/$25. OpenAI rates are public list prices. Order matters:
// "gpt-4o-mini" must precede "gpt-4o" (substring match).
// Cache reads are billed ~0.1x input; Anthropic cache writes ~1.25x input.
const COPY_MODEL_RATES: Array<{ match: string; inPerM: number; outPerM: number }> = [
  { match: "claude-sonnet", inPerM: 3, outPerM: 15 },
  { match: "claude-haiku", inPerM: 1, outPerM: 5 },
  { match: "claude-opus", inPerM: 5, outPerM: 25 },
  { match: "gpt-4o-mini", inPerM: 0.15, outPerM: 0.6 },
  { match: "gpt-4o", inPerM: 2.5, outPerM: 10 },
];
const DEFAULT_COPY_RATE = { inPerM: 3, outPerM: 15 };

export function estimateCopyCostUsd(model: string, usage: RawUsage): number {
  const rate = COPY_MODEL_RATES.find((entry) => model.includes(entry.match)) ?? DEFAULT_COPY_RATE;
  const fullInput = usage.inputTokens;
  const cacheRead = usage.cachedInputTokens ?? 0;
  const cacheWrite = usage.cacheCreationTokens ?? 0;
  const inputCost = ((fullInput + cacheWrite * 1.25 + cacheRead * 0.1) / 1_000_000) * rate.inPerM;
  const outputCost = (usage.outputTokens / 1_000_000) * rate.outPerM;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000; // 6dp
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
  spec?: string;
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
    spec: parsed.spec ?? "",
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
  "spec",
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
    spec: get("spec"),
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

/** Reads a single regen field's text off a parsed output (highlights joined). */
export function getCopyFieldValue(output: CopyProviderOutput, field: CopyRegenField): string {
  switch (field) {
    case "enriched_title": return output.enrichedTitle;
    case "generated_description_html": return output.generatedDescriptionHtml;
    case "generated_faq_html": return output.generatedFaqHtml;
    case "seo_title": return output.seoTitle;
    case "meta_description": return output.metaDescription;
    case "why_we_chose_it": return output.whyWeChoseIt;
    case "product_highlights": return output.productHighlights.join("\n");
  }
}

/** A7: emptiness check scoped to the single field being regenerated, so the A8
 * retry fires on that field rather than the default title/description pair. */
export function makeFieldEmptyCheck(field: CopyRegenField): (output: CopyProviderOutput) => boolean {
  return (output) => !getCopyFieldValue(output, field).trim();
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
export interface CopyModelResult {
  text: string;
  usage?: RawUsage;
}

export async function generateWithParseRetry(
  callModel: (formatReminder: string | null) => Promise<CopyModelResult>,
  provider: string,
  model: string,
  isEmpty: (output: CopyProviderOutput) => boolean = isCopyOutputEmpty,
): Promise<CopyProviderOutput> {
  // A13: token usage accumulates across attempts so a retried generation
  // reports the true total spend, not just the successful call's.
  const total: RawUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationTokens: 0 };
  let sawUsage = false;

  const attempt = async (reminder: string | null): Promise<CopyProviderOutput | null> => {
    const { text, usage } = await callModel(reminder);
    if (usage) {
      sawUsage = true;
      total.inputTokens += usage.inputTokens;
      total.outputTokens += usage.outputTokens;
      total.cachedInputTokens = (total.cachedInputTokens ?? 0) + (usage.cachedInputTokens ?? 0);
      total.cacheCreationTokens = (total.cacheCreationTokens ?? 0) + (usage.cacheCreationTokens ?? 0);
    }
    try {
      const parsed = parseCopyProviderOutput(text, provider, model);
      return isEmpty(parsed) ? null : parsed;
    } catch {
      return null;
    }
  };

  const withUsage = (output: CopyProviderOutput): CopyProviderOutput =>
    sawUsage ? { ...output, usage: { ...total, costUsd: estimateCopyCostUsd(model, total) } } : output;

  const first = await attempt(null);
  if (first) return withUsage(first);

  const second = await attempt(COPY_FORMAT_REMINDER);
  if (second) return withUsage(second);

  throw new Error("文案解析失敗：模型連續兩次未回傳可解析的內容，請稍後重試或改用其他模型。");
}
