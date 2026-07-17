import { NextRequest } from "next/server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { canOperate } from "@/lib/auth/roles";
import { generateListingContent } from "@/lib/contentGenerator/generateListingContent";
import { normalizeDescriptionToPlainText } from "@/lib/contentGenerator/htmlFormat";
import {
  appendNestoryBrandSuffix,
  generateSeoContent,
  injectScenarioKeywordsIntoMetaDescription,
  injectScenarioKeywordsIntoSeoTitle,
} from "@/lib/contentGenerator/seoGenerator";
import { ListingDraftInput, GeneratedListingContent } from "@/lib/contentGenerator/types";
import { DisplayLabelContext } from "@/lib/contentGenerator/displayLabels";
import { buildImageAltText } from "@/lib/contentGenerator/altTextGenerator";
import {
  appendScenarioBulletToDescription,
  mergeScenarioKeywordMap,
  pickScenarioKeywords,
} from "@/lib/contentGenerator/scenarioKeywords";
import { generateShopifyHandleSlug } from "@/lib/contentGenerator/handleGenerator";
import { buildGenerateSuccessStatusPatch } from "@/lib/drafts/generateSuccessStatus";
import { extractFeatureTerms } from "@/lib/contentGenerator/featureTerms";
import { buildMetaContentGapWarning, buildMetaDuplicateWarning } from "@/lib/contentGenerator/metaUniqueness";
import { normalizeProductTypeForDisplay } from "@/lib/productTypeLabels";
import { buildNestoryTagsV2Result } from "@/lib/nestoryTagsV2";
import { localizeGeneratedListingContent, localizeToTaiwanTraditionalText } from "@/lib/zhTwLocalizer";
import { listActiveListingTagRules } from "@/lib/tagRules";
import { ClaudeCopyProvider } from "@/lib/providers/claude-copy-provider";
import { OpenAICopyProvider } from "@/lib/providers/openai-copy-provider";
import { buildForbiddenTermWarning } from "@/lib/providers/forbiddenTerms";
import {
  COPY_REGEN_FIELDS,
  COPY_TONES,
  CopyLength,
  CopyProvider,
  CopyProviderOutput,
  CopyRegenField,
  CopyTone,
  getCopyFieldValue,
} from "@/lib/providers/copy";
import { mergeIpToneMap } from "@/lib/providers/ipToneMap";
import { buildXiaobianMissingEmojiWarning } from "@/lib/providers/emojiPolicy";
import { normalizeDetectedProductBrand } from "@/lib/providers/productBrand";
import { resolveCopyTone } from "@/lib/providers/systemPrompt";
import { resolveCanonicalCharacterName } from "@/lib/characters/resolveCanonicalCharacter";
import {
  resolveWebSearchForGenerate,
  WEB_SEARCH_USED_WARNING,
  type WebSearchCache,
} from "@/lib/providers/webSearch";
import type { GenerationProvider, ImageType, ProductDraft } from "@/types/domain";
import {
  buildClassificationDuplicateWarning,
  queryDuplicateMatches,
} from "@/lib/drafts/checkDuplicate";
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import { mergeRegenCurrentValues } from "@/lib/drafts/copyVersionHistory";

const COPY_PROVIDERS: Record<"openai" | "claude", CopyProvider> = {
  openai: new OpenAICopyProvider(),
  claude: new ClaudeCopyProvider(),
};

const PROVIDER_TO_GENERATION_PROVIDER: Record<"openai" | "claude", GenerationProvider> = {
  openai: "openai",
  claude: "anthropic",
};

// tag_rules-sourced errors/warnings are meaningless once Tags V2 takes over
// shopify_tags (B4 1A: also filter warnings so one-click + regen does not leave
// a ghost「尚未建立 tag_rules」line next to the real V2 dictionary warning).
function isLegacyTagRuleMappingMessage(message: string): boolean {
  return message.includes("tag_rules") || message.includes("找不到二手商品屬性標籤");
}

/** @deprecated name kept for call-site clarity; same predicate as warnings filter. */
function isLegacyTagRuleMappingError(message: string): boolean {
  return isLegacyTagRuleMappingMessage(message);
}

function uniqueMessages(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

/** A7: reuse draft-cached search text without spending another Tavily call. */
function parseCachedWebSearchSummary(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const summary = (raw as { summary?: unknown }).summary;
  return typeof summary === "string" && summary.trim() ? summary : undefined;
}

// The IP/character/type are no longer typed into the form -- the AI detects
// them from the title/image (Phase 4). `detected` carries those resolved
// values into the rule engine so tags still come from tag_rules deterministically.
type DetectedClassification = {
  ip: string;
  character: string;
  productType: string;
  category: string;
  sku: string;
};

/**
 * P1-66: store the concrete resolved tone (never the meta「依IP自動匹配」).
 * Invalid → null, never blocks generation.
 */
function resolvedGenerationTone(
  tone: CopyTone,
  detectedIpName: string | null | undefined,
  ipToneMap: ReturnType<typeof mergeIpToneMap>,
): string | null {
  const resolved = resolveCopyTone(tone, detectedIpName, ipToneMap);
  if (resolved === "依IP自動匹配") return null;
  if (!(COPY_TONES as readonly string[]).includes(resolved)) return null;
  return resolved;
}

function toListingDraftInput(
  draft: ProductDraft,
  detected: DetectedClassification,
  variantSummary?: string | null,
  /** P1-75a: brand effective for this pass (detected or existing). */
  productBrand?: string | null,
): ListingDraftInput {
  return {
    source_url: draft.source_url,
    product_status: draft.is_secondhand ? "secondhand" : "general",
    ip: detected.ip,
    characters: detected.character ? [detected.character] : [],
    // 夜工包（回饋 27/29）+ P1-75a：聯名品牌與款式文字進標題/SEO 骨架
    product_brand: productBrand ?? draft.product_brand ?? null,
    variant_text: variantSummary ?? null,
    product_types: detected.productType ? [detected.productType] : [],
    use_cases: [],
    sale_status: draft.sale_status,
    recommend_tags: [],
    product_name: draft.title_zh ?? draft.taobao_title ?? draft.original_title ?? "",
    variant_feature: null,
    usage_scene: null,
    intro: draft.note,
    notes: draft.note,
    price: draft.twd_price,
    compare_at_price: draft.compare_at_price,
    image_description: draft.image_description,
    sku: detected.sku || null,
    secondhand_grade: draft.secondhand_grade,
    secondhand_condition: draft.secondhand_condition,
    secondhand_notes: draft.secondhand_notes,
  };
}

// Resolve the AI's detected IP string to a canonical ip_catalog name (matching
// ip_name or any alias, case-insensitive). Falls back to the raw guess when
// nothing matches -- the rule engine then flags a missing IP tag downstream.
function resolveIpName(detected: string, ipCatalog: { ip_name: string; aliases: string[] }[]): string {
  const norm = (value: string) => value.normalize("NFKC").trim().toLowerCase();
  const target = norm(detected);
  if (!target) return detected;

  const byName = ipCatalog.find((entry) => norm(entry.ip_name) === target);
  if (byName) return byName.ip_name;

  const byAlias = ipCatalog.find((entry) => (entry.aliases ?? []).some((alias) => norm(alias) === target));
  if (byAlias) return byAlias.ip_name;

  const byContains = ipCatalog.find((entry) => {
    const name = norm(entry.ip_name);
    return name && (target.includes(name) || name.includes(target));
  });
  if (byContains) return byContains.ip_name;

  return detected;
}

// Mirrors applyTagsV2ToGeneratedContent() from the boss's tool's
// listingGeneration.ts: Tags V2 (nestoryTagsV2.ts) fully replaces the
// DB tag_rules-driven shopify_tags/seo output computed by generateListingContent.
function applyTagsV2(
  generatedContent: GeneratedListingContent,
  payload: ListingDraftInput,
  displayContext: DisplayLabelContext,
  scenarioTerms: string[] = [],
): GeneratedListingContent {
  const tagResult = buildNestoryTagsV2Result(payload, displayContext);
  const seoContent = generateSeoContent(payload, { ...displayContext, scenarioTerms });
  const validationErrors = uniqueMessages([
    ...generatedContent.validation_errors.filter((message) => !isLegacyTagRuleMappingError(message)),
    ...tagResult.missing,
  ]);

  // B4 1A: drop legacy tag_rules mapping warnings (V2 is authoritative).
  const legacyFilteredWarnings = generatedContent.validation_warnings.filter(
    (message) => !isLegacyTagRuleMappingMessage(message),
  );

  return {
    ...generatedContent,
    draft_state: validationErrors.length > 0 ? "blocked" : "ready",
    meta_description: seoContent.meta_description,
    seo_title: seoContent.seo_title,
    shopify_tags: tagResult.tags,
    validation_errors: validationErrors,
    validation_warnings: uniqueMessages([...legacyFilteredWarnings, ...tagResult.warnings]),
  };
}

// Test/DEMO mode: skip the paid LLM copy call entirely and reuse the rule
// engine's own deterministic output as the "copy". Tags/title skeleton/
// description/FAQ are all real (the rule engine costs nothing); only the
// LLM's value-added polish (why_we_chose_it / product_highlights) is absent.
// This lets an operator dry-run the whole flow with zero API cost and no key.
function buildTestModeOutput(ruleOutput: GeneratedListingContent, detected: DetectedClassification): CopyProviderOutput {
  return {
    enrichedTitle: ruleOutput.display_title ?? "",
    generatedDescriptionHtml: ruleOutput.generated_description_html,
    generatedFaqHtml: ruleOutput.generated_faq_html,
    seoTitle: ruleOutput.seo_title,
    metaDescription: ruleOutput.meta_description,
    whyWeChoseIt: "",
    productHighlights: [],
    detectedIpName: detected.ip,
    detectedCharacterName: detected.character,
    detectedProductType: detected.productType,
    detectedProductBrand: "",
    detectedCategory: detected.category,
    sku: detected.sku,
    provider: "test",
    model: "test-mode",
  };
}

// A7: maps each regenerable field to the product_drafts column it writes back to.
const REGEN_FIELD_TO_COLUMN: Record<CopyRegenField, string> = {
  enriched_title: "title_zh",
  generated_description_html: "description_html",
  generated_faq_html: "generated_faq_html",
  seo_title: "seo_title",
  meta_description: "seo_description",
  why_we_chose_it: "why_we_chose_it",
  product_highlights: "product_highlights",
};

// A7: regenerate a single copy field. Keeps detection/tags untouched, writes
// only the one column, and appends a generation_history row so the version UI
// (B10) still sees every rewrite.
async function handleFieldRegen(params: {
  regenField: CopyRegenField;
  providerKey: "openai" | "claude";
  draft: ProductDraft;
  draftId: string;
  userId: string;
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>;
  source?: string;
  variantSummary?: string;
  tone: CopyTone;
  copyLength: CopyLength;
  scenarioKeywordMap: Record<string, string[]>;
  ipToneMap: ReturnType<typeof mergeIpToneMap>;
  /** B10 D4: optional on-screen combination as LLM context (falls back to draft). */
  clientCurrentValues?: unknown;
}): Promise<Response> {
  const { regenField, providerKey, draft, draftId, userId, serviceSupabase, source, variantSummary, tone, copyLength, scenarioKeywordMap, ipToneMap, clientCurrentValues } = params;
  const currentValues = mergeRegenCurrentValues(draft, clientCurrentValues);
  // A16/A17: same scenario terms the initial generation would have picked for
  // this draft's already-detected product type, so a single-field regen of
  // description/seo_title/meta_description stays consistent with the rest.
  const scenarioTerms = pickScenarioKeywords(
    [normalizeProductTypeForDisplay(draft.product_type ?? "")],
    scenarioKeywordMap,
  );

  let raw: CopyProviderOutput;
  try {
    raw = await COPY_PROVIDERS[providerKey].generate({
      rawTitle: draft.taobao_title ?? draft.original_title ?? "",
      saleStatus: draft.sale_status,
      source,
      variantSummary,
      price: draft.twd_price,
      compareAtPrice: draft.compare_at_price,
      note: draft.note,
      imageDescription: draft.image_description ?? undefined,
      specText: draft.spec_text ?? undefined,
      // A7: single-field regen does not re-search (cost). Reuse cached summary if present.
      webSearchSummary: parseCachedWebSearchSummary(draft.web_search_cache),
      tone,
      copyLength,
      // A9 items 2/4: 依IP自動匹配 resolution and honest 二手 copy both need
      // these; on a regen the draft's classification/secondhand facts are
      // already known (unlike the very first generation).
      isSecondhand: draft.is_secondhand,
      secondhandGrade: draft.secondhand_grade,
      secondhandCondition: draft.secondhand_condition,
      secondhandNotes: draft.secondhand_notes,
      detectedIpName: draft.ip_name,
      ipToneMap,
      regenerateField: regenField,
      currentValues,
    });
  } catch (providerError) {
    await serviceSupabase
      .from("product_drafts")
      .update({ generation_error: providerError instanceof Error ? providerError.message : "Copy regen failed" })
      .eq("id", draftId);
    return Response.json(
      { error: providerError instanceof Error ? providerError.message : "Copy regen failed" },
      { status: 502 },
    );
  }

  const update: Record<string, unknown> = {};
  let responseHighlights: string[] | undefined;
  let historyContent: string;

  if (regenField === "product_highlights") {
    const localized = raw.productHighlights.map(localizeToTaiwanTraditionalText).filter((value) => value.trim());
    update.product_highlights = localized;
    responseHighlights = localized;
    historyContent = localized.join("\n");
  } else {
    let value = localizeToTaiwanTraditionalText(getCopyFieldValue(raw, regenField));
    // Mirror the main flow's display-title term swap.
    if (regenField === "enriched_title") value = value.split("包包吊飾").join("包包掛件");
    // A9 item 6: the model no longer writes the brand suffix itself.
    if (regenField === "seo_title") {
      value = appendNestoryBrandSuffix(injectScenarioKeywordsIntoSeoTitle(value, scenarioTerms));
    }
    if (regenField === "meta_description") {
      value = injectScenarioKeywordsIntoMetaDescription(value, scenarioTerms);
    }
    if (regenField === "generated_description_html") {
      value = normalizeDescriptionToPlainText(
        appendScenarioBulletToDescription(value, scenarioTerms),
      );
    }
    update[REGEN_FIELD_TO_COLUMN[regenField]] = value;
    historyContent = value;
  }

  // A13: a regen is extra spend -- accumulate onto the draft's running totals.
  if (raw.usage) {
    update.generation_cost_estimate = Number(draft.generation_cost_estimate ?? 0) + raw.usage.costUsd;
    update.generation_input_tokens = Number(draft.generation_input_tokens ?? 0) + raw.usage.inputTokens;
    update.generation_output_tokens = Number(draft.generation_output_tokens ?? 0) + raw.usage.outputTokens;
  }

  const { error: updateError } = await serviceSupabase
    .from("product_drafts")
    .update(update)
    .eq("id", draftId);

  if (updateError) {
    return Response.json({ error: updateError.message }, { status: 500 });
  }

  // P1-66: regen may switch tone — soft write (migration 034).
  await serviceSupabase
    .from("product_drafts")
    .update({ generation_tone: resolvedGenerationTone(tone, draft.ip_name, ipToneMap) })
    .eq("id", draftId);

  if (historyContent.trim()) {
    await serviceSupabase.from("generation_history").insert({
      draft_id: draftId,
      field_name: regenField,
      content: historyContent,
      provider: raw.provider,
      model: raw.model,
      created_by: userId,
    });
  }

  return Response.json({
    ok: true,
    regeneratedField: regenField,
    result: {
      field: regenField,
      value: regenField === "product_highlights" ? responseHighlights : historyContent,
      provider: raw.provider,
      model: raw.model,
    },
  });
}

// A10: template-assembled ALT text (rule engine, never the LLM -- 文案·三·9),
// written once per generate call using the just-finalised classification.
// Always overwrites; there's no manual-edit UI for alt_text yet, so nothing to
// preserve. Best-effort: a failure here shouldn't fail the whole generate call,
// so callers should not await-and-throw this without a try/catch.
async function writeImageAltTexts(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  draftId: string,
  detected: DetectedClassification,
  displayContext: DisplayLabelContext,
  imageDescription: string | null,
): Promise<void> {
  const { data: imageRows, error } = await serviceSupabase
    .from("product_images")
    .select("id,image_type,sort_order")
    .eq("draft_id", draftId)
    .order("sort_order", { ascending: true });

  if (error || !imageRows || imageRows.length === 0) return;

  const rows = imageRows as { id: string; image_type: ImageType; sort_order: number }[];
  const countByType = new Map<ImageType, number>();
  for (const row of rows) {
    countByType.set(row.image_type, (countByType.get(row.image_type) ?? 0) + 1);
  }

  const indexByType = new Map<ImageType, number>();
  const updates = rows
    .map((row) => {
      const indexInType = indexByType.get(row.image_type) ?? 0;
      indexByType.set(row.image_type, indexInType + 1);
      const altText = buildImageAltText(
        { ip: detected.ip, character: detected.character, productType: detected.productType, imageDescription },
        displayContext,
        row.image_type,
        indexInType,
        countByType.get(row.image_type) ?? 1,
      );
      return altText ? { id: row.id, altText } : null;
    })
    .filter((entry): entry is { id: string; altText: string } => entry !== null);

  await Promise.all(
    updates.map(({ id, altText }) =>
      serviceSupabase.from("product_images").update({ alt_text: altText }).eq("id", id),
    ),
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const draftId = typeof body.draftId === "string" ? body.draftId : null;
  const providerKey: "openai" | "claude" = body.provider === "claude" ? "claude" : "openai";
  const runMode: "test" | "llm" = body.mode === "test" ? "test" : "llm";
  // B8: default ON when omitted (form default + ResultCard 重新生成 without toggle).
  // Explicit false still turns it off.
  const useWebSearch = body.useWebSearch !== false;
  const source = typeof body.source === "string" ? body.source : undefined;
  const variantSummary = typeof body.variantSummary === "string" ? body.variantSummary : undefined;
  const tone: CopyTone = (COPY_TONES as readonly string[]).includes(body.tone)
    ? body.tone
    : "黑膠文藝收藏感";
  const copyLength: CopyLength = ["精簡", "標準", "詳細"].includes(body.copyLength) ? body.copyLength : "標準";
  // R2 §4: 重新生成彈窗「修改方向／補充」— prepend into note for this run only
  const regenNotes =
    typeof body.regenNotes === "string" && body.regenNotes.trim()
      ? body.regenNotes.trim().slice(0, 2000)
      : "";
  // B1: analyze-images runs client-side before generate and must never block it
  // (requirement: skip image info, still generate). Any image-analysis failures
  // arrive here as strings so they end up in the draft's warnings (黃字), rather
  // than being lost when the operator moves on.
  const imageWarnings: string[] = Array.isArray(body.imageWarnings)
    ? body.imageWarnings.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  // A7: optional single-field regen. When present, only this field is rewritten.
  const regenField: CopyRegenField | null =
    typeof body.field === "string" && (COPY_REGEN_FIELDS as readonly string[]).includes(body.field)
      ? (body.field as CopyRegenField)
      : null;

  if (!draftId) {
    return Response.json({ error: "draftId is required" }, { status: 400 });
  }

  const authSupabase = await createServerSupabaseClient();
  const { data: { user } } = await authSupabase.auth.getUser();

  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await authSupabase.from("profiles").select("role").eq("id", user.id).single();

  if (!canOperate(profile?.role)) {
    return Response.json({ error: "Operator role is required" }, { status: 403 });
  }

  // RLS on product_drafts already limits this to rows the user may see
  // (own drafts, or admin/reviewer). Using the auth-scoped client here is
  // the authorization check itself, not just a data fetch.
  const { data: draftRow, error: draftError } = await authSupabase
    .from("product_drafts")
    .select("*")
    .eq("id", draftId)
    .single();

  if (draftError || !draftRow) {
    return Response.json({ error: draftError?.message ?? "Draft not found" }, { status: 404 });
  }

  const draft = draftRow as ProductDraft;
  const serviceSupabase = createServiceSupabaseClient();

  // A16: team_settings-editable override of the default scenario keyword
  // dictionary (scenarioKeywords.ts). Missing row/key just falls back to the
  // built-in defaults -- no admin UI writes this yet, so it's normal for the
  // row not to exist until someone edits it directly in Supabase.
  // B8: same pattern for IP→tone overrides (ip_tone_map_overrides).
  const [scenarioSettingsResult, ipToneSettingsResult] = await Promise.all([
    serviceSupabase
      .from("team_settings")
      .select("value")
      .eq("key", "scenario_keywords_by_type")
      .maybeSingle(),
    serviceSupabase
      .from("team_settings")
      .select("value")
      .eq("key", "ip_tone_map_overrides")
      .maybeSingle(),
  ]);
  const scenarioKeywordMap = mergeScenarioKeywordMap(
    (scenarioSettingsResult.data?.value as Record<string, string[]> | null) ?? null,
  );
  const ipToneMap = mergeIpToneMap(
    (ipToneSettingsResult.data?.value as Record<string, string> | null) ?? null,
  );

  // A7: single-field regen path. Rewrites just one copy field using the rest of
  // the current draft as context; it does NOT re-detect IP/type or recompute
  // tags (those stay fixed), so it returns early before the full pipeline.
  if (regenField) {
    return handleFieldRegen({
      regenField,
      providerKey,
      draft,
      draftId,
      userId: user.id,
      serviceSupabase,
      source,
      variantSummary,
      tone,
      copyLength,
      scenarioKeywordMap,
      ipToneMap,
      // B10 D4: UI may send the on-screen multi-version combination as context.
      clientCurrentValues: body.currentValues,
    });
  }

  const [tagRulesResult, ipCatalogResult, ipCharactersResult] = await Promise.allSettled([
    listActiveListingTagRules(serviceSupabase),
    serviceSupabase.from("ip_catalog").select("id,ip_name,aliases,sort_order,is_active,created_at,updated_at").eq("is_active", true),
    serviceSupabase.from("ip_characters").select("id,ip_name,character_name,aliases,sort_order,is_active,created_at,updated_at").eq("is_active", true),
  ]);

  if (tagRulesResult.status === "rejected") {
    return Response.json(
      { error: `Failed to load tag_rules: ${tagRulesResult.reason?.message ?? tagRulesResult.reason}` },
      { status: 500 }
    );
  }

  if (ipCatalogResult.status === "rejected" || ipCatalogResult.value.error) {
    const message = ipCatalogResult.status === "rejected" ? ipCatalogResult.reason?.message : ipCatalogResult.value.error?.message;
    return Response.json({ error: `Failed to load ip_catalog: ${message}` }, { status: 500 });
  }

  if (ipCharactersResult.status === "rejected" || ipCharactersResult.value.error) {
    const message = ipCharactersResult.status === "rejected" ? ipCharactersResult.reason?.message : ipCharactersResult.value.error?.message;
    return Response.json({ error: `Failed to load ip_characters: ${message}` }, { status: 500 });
  }

  const tagRules = tagRulesResult.value;
  const displayContext: DisplayLabelContext = {
    ipCatalog: ipCatalogResult.value.data ?? [],
    ipCharacters: ipCharactersResult.value.data ?? [],
  };

  const knownIpNames = (displayContext.ipCatalog ?? []).map((entry) => entry.ip_name).filter(Boolean);
  const ipCatalogEntries = (displayContext.ipCatalog ?? []).map((entry) => ({
    ip_name: entry.ip_name,
    aliases: entry.aliases ?? [],
  }));

  const extraWarnings: string[] = [];

  // B1: carry forward any image-analysis warnings collected client-side so they
  // land in validation_warnings (黃字) instead of silently vanishing.
  if (imageWarnings.length > 0) extraWarnings.push(...imageWarnings);

  // B8/B19: real web search (Tavily) with draft-level cache. Missing key = honest
  // warning, never fake results. Single-field regen does not re-search.
  const rawTitleForSearch = draft.taobao_title ?? draft.original_title ?? "";
  let webSearchSummary: string | undefined;
  let webSearchCacheToPersist: WebSearchCache | null = null;
  if (runMode !== "test") {
    const searchOutcome = await resolveWebSearchForGenerate({
      useWebSearch,
      rawTitle: rawTitleForSearch,
      ipName: draft.ip_name,
      characterName: draft.character_name,
      productType: draft.product_type,
      existingCache: draft.web_search_cache,
    });
    if (searchOutcome.warnings.length > 0) extraWarnings.push(...searchOutcome.warnings);
    if (searchOutcome.result?.summary) {
      webSearchSummary = searchOutcome.result.summary;
      extraWarnings.push(WEB_SEARCH_USED_WARNING);
    }
    if (searchOutcome.cacheToPersist) {
      webSearchCacheToPersist = searchOutcome.cacheToPersist;
    }
  } else if (useWebSearch) {
    extraWarnings.push("測試模式未呼叫 Web Search。");
  }

  // Phase 4: the AI detects IP/character/type from the title+image (form no
  // longer collects them). Test mode has no LLM, so it falls back to whatever
  // classification the draft already carries.
  let providerOutput: CopyProviderOutput | null = null;
  let detected: DetectedClassification = {
    ip: draft.ip_name ?? "",
    character: draft.character_name ?? "",
    productType: draft.product_type ?? "",
    category: draft.detected_category ?? "",
    sku: draft.sku ?? "",
  };

  if (runMode !== "test") {
    try {
      const noteForRun = regenNotes
        ? [draft.note?.trim() || null, `【重新生成方向】${regenNotes}`].filter(Boolean).join("\n")
        : draft.note;
      const raw = await COPY_PROVIDERS[providerKey].generate({
        rawTitle: rawTitleForSearch,
        saleStatus: draft.sale_status,
        source,
        variantSummary,
        price: draft.twd_price,
        compareAtPrice: draft.compare_at_price,
        note: noteForRun,
        imageDescription: draft.image_description ?? undefined,
        // A3: spec_text (規格圖 OCR from analyze-images) was never passed to the
        // copy provider even though CopyProviderInput/buildCopyUserMessage
        // already support it. Sizes/materials in the copy's D 段 must come from
        // here (or the spec field), never from Vision's visual guess (風險 #2).
        specText: draft.spec_text ?? undefined,
        webSearchSummary,
        knownIpNames,
        tone,
        copyLength,
        // A9 item 4: honest 二手 copy needs these facts, which the model
        // previously never received at all.
        isSecondhand: draft.is_secondhand,
        secondhandGrade: draft.secondhand_grade,
        secondhandCondition: draft.secondhand_condition,
        secondhandNotes: draft.secondhand_notes,
        // A9 item 2: 依IP自動匹配 resolution. On this very first pass the IP
        // isn't known yet (detection happens in this same call), so this is
        // only non-null on a later full regeneration of an already-classified
        // draft; the initial pass falls back to the default tone.
        // Manual tones never consult ipToneMap (resolveCopyTone gate).
        detectedIpName: draft.ip_name,
        ipToneMap,
      });
      const resolvedIp = resolveIpName(raw.detectedIpName, ipCatalogEntries);
      // P2-79: character → dictionary canonical (Miffy), not surface alias (米飛)
      const resolvedCharacter =
        resolveCanonicalCharacterName(raw.detectedCharacterName, {
          ipName: resolvedIp,
          ipCharacters: displayContext.ipCharacters ?? [],
          ipCatalog: ipCatalogEntries,
        }) ?? (raw.detectedCharacterName || "");
      detected = {
        ip: resolvedIp,
        character: resolvedCharacter,
        productType: raw.detectedProductType,
        category: raw.detectedCategory || (raw.detectedProductType ? `型態_${raw.detectedProductType}` : ""),
        sku: raw.sku,
      };
      providerOutput = raw;

      const matchedCatalog = ipCatalogEntries.some((entry) => entry.ip_name === resolvedIp);
      if (raw.detectedIpName && !matchedCatalog) {
        extraWarnings.push(
          `AI 判斷 IP「${raw.detectedIpName}」不在建檔清單中，tag 可能不完整；請在卡片確認 IP／類型後按「重新生成」。`
        );
      }
    } catch (providerError) {
      // Q7-A: park failure light on copy_review without changing legacy status.
      await serviceSupabase
        .from("product_drafts")
        .update({
          generation_status: "failed",
          pipeline_stage: mapStatusToPipelineStage("failed"),
          generation_error: providerError instanceof Error ? providerError.message : "Copy provider failed",
        })
        .eq("id", draftId);

      return Response.json(
        { error: providerError instanceof Error ? providerError.message : "Copy provider failed" },
        { status: 502 }
      );
    }
  }

  // A10: template ALT text, keyed off the classification just finalised above.
  // Best-effort -- alt_text is supplementary, so a failure here must not fail
  // the whole generate call.
  try {
    await writeImageAltTexts(serviceSupabase, draftId, detected, displayContext, draft.image_description);
  } catch {
    extraWarnings.push("圖片 ALT 文字寫入失敗，不影響文案結果，可稍後重新生成。");
  }

  // A16: scenario terms picked once off the just-finalised detected product
  // type, reused for seo_title/meta (both the rule-engine path via
  // applyTagsV2 and the LLM's own output below) and A17's D段 bullet.
  const scenarioTerms = pickScenarioKeywords(
    [normalizeProductTypeForDisplay(detected.productType)],
    scenarioKeywordMap,
  );

  // A21-1 + P0-73: romanized handle slug off classification, with draft-id
  // short suffix so two same-IP/character/type drafts never share a Handle
  // (Matrixify would merge them). Written to shopify_handle for publish + CSV.
  const handleSlug = generateShopifyHandleSlug(
    {
      ip: detected.ip,
      character: detected.character,
      productType: normalizeProductTypeForDisplay(detected.productType),
      draftId,
    },
    displayContext,
  );

  // P1-75a: brand three-piece — normalize LLM brand; empty must not wipe existing.
  const detectedBrand = providerOutput
    ? normalizeDetectedProductBrand(providerOutput.detectedProductBrand)
    : null;
  const effectiveProductBrand = detectedBrand ?? draft.product_brand ?? null;

  // P1-66: concrete resolved tone for this generation (not meta 依IP自動匹配).
  const generationTone = resolvedGenerationTone(tone, detected.ip || draft.ip_name, ipToneMap);

  const listingInput = toListingDraftInput(draft, detected, variantSummary, effectiveProductBrand);
  const ruleOutput = applyTagsV2(
    generateListingContent(listingInput, tagRules, displayContext),
    listingInput,
    displayContext,
    scenarioTerms,
  );

  if (!providerOutput) {
    providerOutput = buildTestModeOutput(ruleOutput, detected);
    extraWarnings.push("測試模式：未呼叫 AI、未自動偵測 IP；文案為規則引擎產出，tags 依草稿現有資料。");
  }

  const localizedOutput = localizeGeneratedListingContent({
    ...ruleOutput,
    display_title: providerOutput.enrichedTitle || ruleOutput.display_title,
    // A17: rule-engine-picked scenario terms appended as a deterministic
    // "➼ 適用情境" bullet inside the model's own D段, never left to the LLM
    // to invent. No-op when the model omitted D段 (nothing to attach to) or
    // when falling back to ruleOutput's own (structurally different) HTML.
    generated_description_html: appendScenarioBulletToDescription(
      providerOutput.generatedDescriptionHtml || ruleOutput.generated_description_html,
      scenarioTerms,
    ),
    generated_faq_html: providerOutput.generatedFaqHtml || ruleOutput.generated_faq_html,
    // A9 item 6: the model no longer writes "｜潮巢 Nestory" itself -- appended
    // here uniformly. ruleOutput.seo_title (the test-mode/fallback path)
    // already carries the suffix (and scenario terms) via seoGenerator's
    // buildSeoTitle. A16: scenario terms are injected into the LLM's own
    // seo_title/meta_description the same way, since that's what actually
    // ships in real (non-test-mode) generation.
    seo_title: providerOutput.seoTitle
      ? appendNestoryBrandSuffix(injectScenarioKeywordsIntoSeoTitle(providerOutput.seoTitle, scenarioTerms))
      : ruleOutput.seo_title,
    meta_description: providerOutput.metaDescription
      ? injectScenarioKeywordsIntoMetaDescription(providerOutput.metaDescription, scenarioTerms)
      : ruleOutput.meta_description,
  });

  // A11: warn (never block) when generated copy leaks a 叫賣/禁忌詞. The rule
  // engine's own validation stays authoritative for blocking; this only adds a
  // yellow flag for the reviewer.
  const forbiddenWarning = buildForbiddenTermWarning([
    localizedOutput.display_title,
    localizedOutput.generated_description_html,
    localizedOutput.generated_faq_html,
    localizedOutput.seo_title,
    localizedOutput.meta_description,
    providerOutput.whyWeChoseIt,
    ...providerOutput.productHighlights,
  ]);
  if (forbiddenWarning) extraWarnings.push(forbiddenWarning);

  // P1-76 fix: soft-warn when 小編聊天口吻 still has zero emoji after generate
  // (post-process does not strip emoji — this catches model non-compliance).
  if (generationTone === "小編聊天口吻") {
    const emojiWarn = buildXiaobianMissingEmojiWarning(
      localizedOutput.generated_description_html,
      localizedOutput.generated_faq_html,
    );
    if (emojiWarn) extraWarnings.push(emojiWarn);
  }

  // A21-5: Meta Description uniqueness guard, warn-only (same posture as
  // A11's forbiddenWarning above). Content-gap check is local; the
  // cross-product duplicate check needs a DB read of sibling drafts under
  // the same IP, so it only runs when the IP was actually resolved.
  const metaFeatureTerms = extractFeatureTerms(
    draft.image_description,
    [listingInput.intro, listingInput.product_name].filter(Boolean).join(" "),
  );
  const metaContentGapWarning = buildMetaContentGapWarning(
    localizedOutput.meta_description,
    detected.character,
    detected.ip,
    metaFeatureTerms,
    displayContext,
  );
  if (metaContentGapWarning) extraWarnings.push(metaContentGapWarning);

  if (detected.ip) {
    const { data: siblingRows } = await serviceSupabase
      .from("product_drafts")
      .select("id,title_zh,seo_description")
      .eq("ip_name", detected.ip)
      .neq("id", draftId)
      .not("seo_description", "is", null)
      .limit(30);
    const metaDuplicateWarning = buildMetaDuplicateWarning(
      localizedOutput.meta_description,
      (siblingRows ?? []).map((row) => ({
        id: row.id,
        title: row.title_zh,
        metaDescription: row.seo_description,
      })),
    );
    if (metaDuplicateWarning) extraWarnings.push(metaDuplicateWarning);
  }

  // 規格自動化 (Mockup差異備忘 差異2, 老闆 2026-07-11): when the operator left
  // spec_text empty, adopt the model's [[spec]] synthesis and flag it for a
  // review glance. A non-empty spec_text (operator 補充/修正) is authoritative and
  // never overwritten. Empty spec never blocks generation -- it just stays null.
  const existingSpec = (draft.spec_text ?? "").trim();
  const autoSpec = localizeToTaiwanTraditionalText(providerOutput.spec ?? "").trim();
  const autoSpecIsBlank = !autoSpec || autoSpec === "（無）" || autoSpec === "(無)";
  let finalSpecText: string | null = draft.spec_text ?? null;
  if (!existingSpec && !autoSpecIsBlank) {
    finalSpecText = autoSpec;
    extraWarnings.push(
      webSearchSummary
        ? "商品規格為系統自動整理（來自款式／標題／圖片文字／網路搜尋），發布前請審核瞄一眼確認無誤、必要時修正。"
        : "商品規格為系統自動整理（來自款式／標題／圖片文字），發布前請審核瞄一眼確認無誤、必要時修正。",
    );
  }

  // P0-62: single source for status / pipeline_stage / generation_status so a
  // previously-failed draft cannot keep showing ✗ after a successful regen.
  const successStatus = buildGenerateSuccessStatusPatch(
    localizedOutput.draft_state,
    localizedOutput.validation_errors ?? [],
  );

  // B4 3A: after detect, three-dimension (IP+角色+類型) duplicate check → yellow only.
  try {
    if (detected.ip && detected.productType) {
      const dup = await queryDuplicateMatches(serviceSupabase, {
        ip: detected.ip,
        character: detected.character || undefined,
        productType: detected.productType,
        excludeDraftId: draftId,
      });
      const classificationWarning = buildClassificationDuplicateWarning(dup.classificationMatches);
      if (classificationWarning) extraWarnings.push(classificationWarning);
    }
  } catch {
    // Duplicate check must never fail generation; skip on query errors.
  }

  const allWarnings = uniqueMessages(
    [...localizedOutput.validation_warnings, ...extraWarnings].filter(
      (message) => !isLegacyTagRuleMappingMessage(message),
    ),
  );

  const draftUpdate: Record<string, unknown> = {
    title_zh: localizedOutput.display_title,
    // fix(B10): description_html storage contract = plain text (A23);
    // rule/test path used to write HTML — normalize at write boundary.
    description_html: normalizeDescriptionToPlainText(localizedOutput.generated_description_html),
    seo_title: localizedOutput.seo_title,
    seo_description: localizedOutput.meta_description,
    shopify_handle: handleSlug,
    tags: localizedOutput.shopify_tags,
    shopify_tags: localizedOutput.shopify_tags,
    generated_faq_html: localizedOutput.generated_faq_html,
    spec_text: finalSpecText,
    why_we_chose_it: providerOutput.whyWeChoseIt,
    product_highlights: providerOutput.productHighlights,
    ip_name: detected.ip || null,
    character_name: detected.character || null,
    product_type: detected.productType || null,
    detected_category: detected.category || null,
    sku: detected.sku || null,
    warnings: allWarnings,
    // P0-62: successStatus already maps blocked vs ok for the three queue fields.
    status: successStatus.status,
    pipeline_stage: successStatus.pipeline_stage,
    generation_mode: "api_llm",
    generation_provider: PROVIDER_TO_GENERATION_PROVIDER[providerKey],
    generation_status: successStatus.generation_status,
    generation_model: providerOutput.model,
    // A13: per-draft AI spend + raw tokens (null in test mode) and the copy
    // stage timestamp for the dashboard funnel/budget.
    generation_cost_estimate: providerOutput.usage?.costUsd ?? null,
    generation_input_tokens: providerOutput.usage?.inputTokens ?? null,
    generation_output_tokens: providerOutput.usage?.outputTokens ?? null,
    copy_generated_at: new Date().toISOString(),
    generation_error: successStatus.generation_error,
  };

  // P1-75a: only overwrite product_brand when detection produced a clean brand.
  if (detectedBrand) {
    draftUpdate.product_brand = detectedBrand;
  }

  const { error: updateError } = await serviceSupabase
    .from("product_drafts")
    .update(draftUpdate)
    .eq("id", draftId);

  if (updateError) {
    return Response.json({ error: updateError.message }, { status: 500 });
  }

  // P1-66: generation_tone (migration 034) — separate write so missing column
  // never fails the whole generate (soft warn only).
  {
    const { error: toneError } = await serviceSupabase
      .from("product_drafts")
      .update({ generation_tone: generationTone })
      .eq("id", draftId);
    if (toneError) {
      extraWarnings.push("generation_tone 寫入略過（請確認已執行 migration 034）。");
      // Best-effort refresh warnings list (ignore second failure).
      await serviceSupabase
        .from("product_drafts")
        .update({ warnings: uniqueMessages([...allWarnings, ...extraWarnings]) })
        .eq("id", draftId);
    }
  }

  // B8/B19: persist search cache separately so missing migration 023 never
  // fails the whole generation (column absent → soft warn only).
  if (webSearchCacheToPersist) {
    const { error: cacheError } = await serviceSupabase
      .from("product_drafts")
      .update({ web_search_cache: webSearchCacheToPersist })
      .eq("id", draftId);
    if (cacheError) {
      // Re-read warnings already written; append via a second soft update is optional.
      // Surface in response path by best-effort merge into warnings column.
      await serviceSupabase
        .from("product_drafts")
        .update({
          warnings: uniqueMessages([
            ...allWarnings,
            "Web Search 結果未能快取（可能尚未執行 migration 023），下次同標題可能重複搜尋。",
          ]),
        })
        .eq("id", draftId);
    }
  }

  // B10: all 7 regenerable fields get a history row (was missing product_highlights).
  const highlightsContent = (providerOutput.productHighlights ?? [])
    .map((line) => localizeToTaiwanTraditionalText(line).trim())
    .filter(Boolean)
    .join("\n");
  const historyRows = [
    { field_name: "enriched_title", content: localizedOutput.display_title },
    { field_name: "generated_description_html", content: localizedOutput.generated_description_html },
    { field_name: "generated_faq_html", content: localizedOutput.generated_faq_html },
    { field_name: "seo_title", content: localizedOutput.seo_title },
    { field_name: "meta_description", content: localizedOutput.meta_description },
    { field_name: "why_we_chose_it", content: providerOutput.whyWeChoseIt },
    { field_name: "product_highlights", content: highlightsContent },
  ]
    .filter((row) => row.content)
    .map((row) => ({
      draft_id: draftId,
      field_name: row.field_name,
      content: row.content as string,
      provider: providerOutput.provider,
      model: providerOutput.model,
      created_by: user.id,
    }));

  if (historyRows.length > 0) {
    await serviceSupabase.from("generation_history").insert(historyRows);
  }

  return Response.json({
    ok: true,
    draftState: localizedOutput.draft_state,
    validationErrors: localizedOutput.validation_errors,
    validationWarnings: allWarnings,
    result: {
      title: localizedOutput.display_title,
      descriptionHtml: localizedOutput.generated_description_html,
      faqHtml: localizedOutput.generated_faq_html,
      seoTitle: localizedOutput.seo_title,
      metaDescription: localizedOutput.meta_description,
      tags: localizedOutput.shopify_tags,
      whyWeChoseIt: providerOutput.whyWeChoseIt,
      productHighlights: providerOutput.productHighlights,
      provider: providerOutput.provider,
      model: providerOutput.model,
    },
  });
}
