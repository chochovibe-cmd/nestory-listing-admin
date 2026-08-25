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
import { matchSectionHeader } from "@/lib/contentGenerator/sectionHeaders";
import { generateShopifyHandleSlug } from "@/lib/contentGenerator/handleGenerator";
import {
  clampOfficialTitle,
  ENRICHED_TITLE_MAX_LENGTH,
  normalizeEnrichedTitleContract,
} from "@/lib/contentGenerator/titleGenerator";
import { buildGenerateSuccessStatusPatch } from "@/lib/drafts/generateSuccessStatus";
import { extractFeatureTerms } from "@/lib/contentGenerator/featureTerms";
import { buildMetaContentGapWarning, buildMetaDuplicateWarning } from "@/lib/contentGenerator/metaUniqueness";
import { normalizeProductTypeForDisplay } from "@/lib/productTypeLabels";
import { buildNestoryTagsV2Result } from "@/lib/nestoryTagsV2";
import {
  localizeGeneratedListingContent,
  localizeProductVariantOptionFields,
  localizeToTaiwanTraditionalText,
  localizeVariantDimensions,
} from "@/lib/zhTwLocalizer";
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
import {
  buildIpBackgroundSearchPromptBlock,
  buildIpKnowledgePromptBlock,
  guessIpNameFromTitle,
  IP_BACKGROUND_NEUTRAL_INSTRUCTION,
  lookupKnowledgePack,
  mergeKnowledgePackMap,
} from "@/lib/providers/ipKnowledgePack";
import { buildXiaobianMissingEmojiWarning } from "@/lib/providers/emojiPolicy";
import { normalizeDetectedProductBrand } from "@/lib/providers/productBrand";
import {
  stripCustomerSourceMarkers,
} from "@/lib/providers/stripCustomerSourceMarkers";
import {
  finalizeCustomerSpecText,
  finalizeCustomerText,
  finalizeCustomerTextList,
} from "@/lib/providers/customerFacingFinalizer";
import { resolveCopyTone } from "@/lib/providers/systemPrompt";
import { resolveCanonicalCharacterName } from "@/lib/characters/resolveCanonicalCharacter";
import {
  mergeWebSearchCacheLayers,
  resolveIpBackgroundSearchForGenerate,
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

type DetectedClassification = {
  ip: string;
  character: string;
  productType: string;
  category: string;
  sku: string;
};

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
  productBrand?: string | null,
): ListingDraftInput {
  return {
    source_url: draft.source_url,
    product_status: draft.is_secondhand ? "secondhand" : "general",
    ip: detected.ip,
    characters: detected.character ? [detected.character] : [],
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

/** P2-82: true when plain-text description has a non-empty 「商品資訊」/ D 段. */
function descriptionHasProductInfoSection(description: string | null | undefined): boolean {
  const text = (description ?? "").trim();
  if (!text) return false;
  const lines = text.split(/\r?\n/);
  let dStart = -1;
  let dEnd = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    const match = matchSectionHeader(lines[i]);
    if (!match) continue;
    if (match.letter === "D" && dStart === -1) {
      dStart = i;
      continue;
    }
    if (dStart !== -1 && match.letter && match.letter !== "D") {
      dEnd = i;
      break;
    }
  }
  if (dStart === -1) return false;
  const body = lines
    .slice(dStart + 1, dEnd)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("");
  return body.length >= 4;
}

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

const REGEN_FIELD_TO_COLUMN: Record<CopyRegenField, string> = {
  enriched_title: "title_zh",
  generated_description_html: "description_html",
  generated_faq_html: "generated_faq_html",
  seo_title: "seo_title",
  meta_description: "seo_description",
  why_we_chose_it: "why_we_chose_it",
  product_highlights: "product_highlights",
};

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
  clientCurrentValues?: unknown;
}): Promise<Response> {
  const {
    regenField,
    providerKey,
    draft,
    draftId,
    userId,
    serviceSupabase,
    source,
    variantSummary,
    tone,
    copyLength,
    scenarioKeywordMap,
    ipToneMap,
    clientCurrentValues,
  } = params;
  const currentValues = mergeRegenCurrentValues(draft, clientCurrentValues);
  const scenarioTerms = pickScenarioKeywords(
    [normalizeProductTypeForDisplay(draft.product_type ?? "")],
    scenarioKeywordMap,
  );

  let knowledgePackMap = mergeKnowledgePackMap(null);
  const packQuery = await serviceSupabase
    .from("ip_catalog")
    .select("ip_name, knowledge_pack")
    .eq("is_active", true);
  if (!packQuery.error && packQuery.data) {
    knowledgePackMap = mergeKnowledgePackMap(packQuery.data);
  }
  const regenPack = lookupKnowledgePack(draft.ip_name, knowledgePackMap);
  const regenPackBlock = buildIpKnowledgePromptBlock(regenPack);
  const regenIpKnowledgePromptBlock =
    regenPackBlock?.block ??
    (draft.ip_name ? IP_BACKGROUND_NEUTRAL_INSTRUCTION : undefined);

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
      webSearchSummary: parseCachedWebSearchSummary(draft.web_search_cache),
      ipKnowledgePromptBlock: regenIpKnowledgePromptBlock,
      tone,
      copyLength,
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
    const localized = finalizeCustomerTextList(raw.productHighlights);
    update.product_highlights = localized;
    responseHighlights = localized;
    historyContent = localized.join("\n");
  } else {
    let value = localizeToTaiwanTraditionalText(getCopyFieldValue(raw, regenField));
    if (regenField === "enriched_title") {
      const full = normalizeEnrichedTitleContract(
        value.split("包包吊飾").join("包包掛件"),
        localizeToTaiwanTraditionalText(draft.product_type ?? ""),
        ENRICHED_TITLE_MAX_LENGTH,
      );
      historyContent = finalizeCustomerText(full);
      value = clampOfficialTitle(historyContent);
      update[REGEN_FIELD_TO_COLUMN[regenField]] = value;
    } else {
      if (regenField === "seo_title") {
        value = appendNestoryBrandSuffix(injectScenarioKeywordsIntoSeoTitle(value, scenarioTerms));
      }
      if (regenField === "meta_description") {
        value = injectScenarioKeywordsIntoMetaDescription(value, scenarioTerms);
      }
      if (regenField === "generated_description_html") {
        value = tone === "潮巢導購版"
          ? normalizeDescriptionToPlainText(value)
          : normalizeDescriptionToPlainText(appendScenarioBulletToDescription(value, scenarioTerms));
      }
      value = finalizeCustomerText(value);
      update[REGEN_FIELD_TO_COLUMN[regenField]] = value;
      historyContent = value;
    }
  }

  // COPY C1.1 safety: this single-field path has no spec_text mapping/write.
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
  const useWebSearch = body.useWebSearch !== false;
  const source = typeof body.source === "string" ? body.source : undefined;
  const variantSummary = typeof body.variantSummary === "string" ? body.variantSummary : undefined;
  const tone: CopyTone = (COPY_TONES as readonly string[]).includes(body.tone)
    ? body.tone
    : "黑膠文藝收藏感";
  const copyLength: CopyLength = ["精簡", "標準", "詳細"].includes(body.copyLength) ? body.copyLength : "標準";
  const regenNotes =
    typeof body.regenNotes === "string" && body.regenNotes.trim()
      ? body.regenNotes.trim().slice(0, 2000)
      : "";
  const imageWarnings: string[] = Array.isArray(body.imageWarnings)
    ? body.imageWarnings.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
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
      clientCurrentValues: body.currentValues,
    });
  }

  const ipCatalogWithPack = await serviceSupabase
    .from("ip_catalog")
    .select("id,ip_name,aliases,sort_order,is_active,created_at,updated_at,knowledge_pack")
    .eq("is_active", true);
  const ipCatalogFallback = ipCatalogWithPack.error
    ? await serviceSupabase
        .from("ip_catalog")
        .select("id,ip_name,aliases,sort_order,is_active,created_at,updated_at")
        .eq("is_active", true)
    : null;
  const ipCatalogResult = ipCatalogFallback ?? ipCatalogWithPack;

  const [tagRulesResult, ipCharactersResult] = await Promise.allSettled([
    listActiveListingTagRules(serviceSupabase),
    serviceSupabase.from("ip_characters").select("id,ip_name,character_name,aliases,sort_order,is_active,created_at,updated_at").eq("is_active", true),
  ]);

  if (tagRulesResult.status === "rejected") {
    return Response.json(
      { error: `Failed to load tag_rules: ${tagRulesResult.reason?.message ?? tagRulesResult.reason}` },
      { status: 500 }
    );
  }

  if (ipCatalogResult.error) {
    return Response.json({ error: `Failed to load ip_catalog: ${ipCatalogResult.error.message}` }, { status: 500 });
  }

  if (ipCharactersResult.status === "rejected" || ipCharactersResult.value.error) {
    const message = ipCharactersResult.status === "rejected" ? ipCharactersResult.reason?.message : ipCharactersResult.value.error?.message;
    return Response.json({ error: `Failed to load ip_characters: ${message}` }, { status: 500 });
  }

  const tagRules = tagRulesResult.value;
  const ipCatalogRows = ipCatalogResult.data ?? [];
  const displayContext: DisplayLabelContext = {
    ipCatalog: ipCatalogRows,
    ipCharacters: ipCharactersResult.value.data ?? [],
  };

  const knownIpNames = (displayContext.ipCatalog ?? []).map((entry) => entry.ip_name).filter(Boolean);
  const ipCatalogEntries = (displayContext.ipCatalog ?? []).map((entry) => ({
    ip_name: entry.ip_name,
    aliases: entry.aliases ?? [],
  }));
  const knowledgePackMap = mergeKnowledgePackMap(
    ipCatalogRows.map((row) => ({
      ip_name: row.ip_name,
      knowledge_pack: (row as { knowledge_pack?: unknown }).knowledge_pack,
    })),
  );

  const extraWarnings: string[] = [];
  if (imageWarnings.length > 0) extraWarnings.push(...imageWarnings);

  const rawTitleForSearch = draft.taobao_title ?? draft.original_title ?? "";
  let webSearchSummary: string | undefined;
  let productCacheToPersist: WebSearchCache | null = null;
  let ipBackgroundCacheToPersist: WebSearchCache | null = null;
  let ipKnowledgePromptBlock: string | undefined;

  const candidateIpForPack =
    (draft.ip_name ?? "").trim() ||
    guessIpNameFromTitle(rawTitleForSearch, ipCatalogEntries) ||
    null;
  const knowledgePack = lookupKnowledgePack(candidateIpForPack, knowledgePackMap);
  const packBlock = buildIpKnowledgePromptBlock(knowledgePack);
  if (packBlock) {
    ipKnowledgePromptBlock = packBlock.block;
    if (packBlock.truncated) {
      extraWarnings.push("IP 背景資料包過長已截斷（上限 600 字），僅保留前段供語感參考。");
    }
  }

  if (runMode !== "test") {
    const searchOutcome = await resolveWebSearchForGenerate({
      useWebSearch,
      rawTitle: rawTitleForSearch,
      ipName: draft.ip_name ?? candidateIpForPack,
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
      productCacheToPersist = searchOutcome.cacheToPersist;
    }

    if (!knowledgePack) {
      const ipBg = await resolveIpBackgroundSearchForGenerate({
        useWebSearch,
        ipName: candidateIpForPack,
        hasKnowledgePack: false,
        existingCache: draft.web_search_cache,
      });
      if (ipBg.warnings.length > 0) extraWarnings.push(...ipBg.warnings);
      if (ipBg.summary) {
        ipKnowledgePromptBlock = buildIpBackgroundSearchPromptBlock(ipBg.summary);
        extraWarnings.push("🔍 含冷門 IP 背景網搜，請核實（不得當規格數字來源）。");
      } else if (ipBg.useNeutralFallback) {
        ipKnowledgePromptBlock = IP_BACKGROUND_NEUTRAL_INSTRUCTION;
      }
      if (ipBg.cacheToPersist) {
        ipBackgroundCacheToPersist = ipBg.cacheToPersist;
      }
    }
  } else if (useWebSearch) {
    extraWarnings.push("測試模式未呼叫 Web Search。");
  }

  const webSearchCacheToPersist = mergeWebSearchCacheLayers({
    existing: draft.web_search_cache,
    productCache: productCacheToPersist,
    ipBackground: ipBackgroundCacheToPersist?.ipBackground ?? null,
  });

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
        specText: draft.spec_text ?? undefined,
        webSearchSummary,
        ipKnowledgePromptBlock,
        knownIpNames,
        tone,
        copyLength,
        isSecondhand: draft.is_secondhand,
        secondhandGrade: draft.secondhand_grade,
        secondhandCondition: draft.secondhand_condition,
        secondhandNotes: draft.secondhand_notes,
        detectedIpName: draft.ip_name ?? candidateIpForPack,
        ipToneMap,
      });
      const resolvedIp = resolveIpName(raw.detectedIpName, ipCatalogEntries);
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

  try {
    await writeImageAltTexts(serviceSupabase, draftId, detected, displayContext, draft.image_description);
  } catch {
    extraWarnings.push("圖片 ALT 文字寫入失敗，不影響文案結果，可稍後重新生成。");
  }

  const scenarioTerms = pickScenarioKeywords(
    [normalizeProductTypeForDisplay(detected.productType)],
    scenarioKeywordMap,
  );

  const handleSlug = generateShopifyHandleSlug(
    {
      ip: detected.ip,
      character: detected.character,
      productType: normalizeProductTypeForDisplay(detected.productType),
      draftId,
    },
    displayContext,
  );

  const detectedBrand = providerOutput
    ? normalizeDetectedProductBrand(providerOutput.detectedProductBrand)
    : null;
  const effectiveProductBrand = detectedBrand ?? draft.product_brand ?? null;
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

  // COPY C1.1: deterministic backend title normalization owns separator + segment-2 type.
  const enrichedTitleFull = normalizeEnrichedTitleContract(
    localizeToTaiwanTraditionalText(
      (providerOutput.enrichedTitle || ruleOutput.display_title || "")
        .trim()
        .split("包包吊飾")
        .join("包包掛件"),
    ),
    localizeToTaiwanTraditionalText(detected.productType),
    ENRICHED_TITLE_MAX_LENGTH,
  );
  const officialTitleZh = clampOfficialTitle(enrichedTitleFull);

  const descriptionSource = providerOutput.generatedDescriptionHtml || ruleOutput.generated_description_html;
  const descriptionForOutput = generationTone === "潮巢導購版"
    ? descriptionSource
    : appendScenarioBulletToDescription(descriptionSource, scenarioTerms);

  const localizedOutput = localizeGeneratedListingContent({
    ...ruleOutput,
    display_title: officialTitleZh,
    generated_description_html: descriptionForOutput,
    generated_faq_html: providerOutput.generatedFaqHtml || ruleOutput.generated_faq_html,
    seo_title: providerOutput.seoTitle
      ? appendNestoryBrandSuffix(injectScenarioKeywordsIntoSeoTitle(providerOutput.seoTitle, scenarioTerms))
      : ruleOutput.seo_title,
    meta_description: providerOutput.metaDescription
      ? injectScenarioKeywordsIntoMetaDescription(providerOutput.metaDescription, scenarioTerms)
      : ruleOutput.meta_description,
  });

  localizedOutput.generated_description_html = finalizeCustomerText(
    localizedOutput.generated_description_html,
  );
  localizedOutput.generated_faq_html = finalizeCustomerText(
    localizedOutput.generated_faq_html,
  );
  localizedOutput.seo_title = finalizeCustomerText(localizedOutput.seo_title);
  localizedOutput.meta_description = finalizeCustomerText(
    localizedOutput.meta_description,
  );
  const cleanedWhyWeChoseIt = finalizeCustomerText(providerOutput.whyWeChoseIt);
  const cleanedProductHighlights = finalizeCustomerTextList(providerOutput.productHighlights);

  const forbiddenWarning = buildForbiddenTermWarning([
    localizedOutput.display_title,
    localizedOutput.generated_description_html,
    localizedOutput.generated_faq_html,
    localizedOutput.seo_title,
    localizedOutput.meta_description,
    cleanedWhyWeChoseIt,
    ...cleanedProductHighlights,
  ]);
  if (forbiddenWarning) extraWarnings.push(forbiddenWarning);

  if (generationTone === "小編聊天口吻") {
    const emojiWarn = buildXiaobianMissingEmojiWarning(
      localizedOutput.generated_description_html,
      localizedOutput.generated_faq_html,
    );
    if (emojiWarn) extraWarnings.push(emojiWarn);
  }

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

  // COPY C1.1: provider clean spec is canonical on full generation; existing OCR/manual text is fallback only.
  const providerSpecRaw = (providerOutput.spec ?? "").trim();
  const providerSpecHasContent =
    Boolean(providerSpecRaw) && providerSpecRaw !== "（無）" && providerSpecRaw !== "(無)";
  const finalSpecText = finalizeCustomerSpecText(providerOutput.spec, draft.spec_text);
  if (providerSpecHasContent && finalSpecText) {
    extraWarnings.push(
      webSearchSummary
        ? "商品規格為系統自動整理（來自款式／標題／圖片文字／網路搜尋），已轉台灣繁中並移除平台後台欄位；發布前請審核確認。"
        : "商品規格為系統自動整理（來自款式／標題／圖片文字），已轉台灣繁中並移除平台後台欄位；發布前請審核確認。",
    );
  }

  {
    const specEmpty = !(finalSpecText ?? "").trim() || (finalSpecText ?? "").trim() === "（無）";
    if (specEmpty && descriptionHasProductInfoSection(localizedOutput.generated_description_html)) {
      extraWarnings.push(
        "規格中繼是空的，但描述的商品資訊段有內容——要進 Shopify 規格請補規格欄。",
      );
    }
  }

  const successStatus = buildGenerateSuccessStatusPatch(
    localizedOutput.draft_state,
    localizedOutput.validation_errors ?? [],
  );

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
    description_html: normalizeDescriptionToPlainText(localizedOutput.generated_description_html),
    seo_title: localizedOutput.seo_title,
    seo_description: localizedOutput.meta_description,
    shopify_handle: handleSlug,
    tags: localizedOutput.shopify_tags,
    shopify_tags: localizedOutput.shopify_tags,
    generated_faq_html: localizedOutput.generated_faq_html,
    spec_text: finalSpecText,
    why_we_chose_it: cleanedWhyWeChoseIt || null,
    product_highlights: cleanedProductHighlights,
    ip_name: detected.ip || null,
    character_name: detected.character || null,
    product_type: detected.productType || null,
    detected_category: detected.category || null,
    sku: detected.sku || null,
    warnings: allWarnings,
    status: successStatus.status,
    pipeline_stage: successStatus.pipeline_stage,
    generation_mode: "api_llm",
    generation_provider: PROVIDER_TO_GENERATION_PROVIDER[providerKey],
    generation_status: successStatus.generation_status,
    generation_model: providerOutput.model,
    generation_cost_estimate: providerOutput.usage?.costUsd ?? null,
    generation_input_tokens: providerOutput.usage?.inputTokens ?? null,
    generation_output_tokens: providerOutput.usage?.outputTokens ?? null,
    copy_generated_at: new Date().toISOString(),
    generation_error: successStatus.generation_error,
  };

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

  // PKG2A / 回饋 84：全文 generate 成功路徑才轉款式軸名／值（冪等、不標記）。
  // 欄位重生（handleFieldRegen）不走此段；表單手填當下不動。
  try {
    const dimsRaw = Array.isArray(draft.variant_dimensions)
      ? (draft.variant_dimensions as Array<{ name?: string | null }>)
      : null;
    if (dimsRaw && dimsRaw.length > 0) {
      const localizedDims = localizeVariantDimensions(dimsRaw);
      const dimsChanged =
        localizedDims &&
        dimsRaw.some((d, i) => (d.name ?? "") !== (localizedDims[i]?.name ?? ""));
      if (dimsChanged && localizedDims) {
        await serviceSupabase
          .from("product_drafts")
          .update({ variant_dimensions: localizedDims })
          .eq("id", draftId);
      }
    }

    const { data: variantRows } = await serviceSupabase
      .from("product_variants")
      .select(
        "id, option1_name, option1_value, option2_name, option2_value, option3_name, option3_value",
      )
      .eq("draft_id", draftId);

    for (const row of variantRows ?? []) {
      const localized = localizeProductVariantOptionFields(row);
      if (localized === row) continue;
      await serviceSupabase
        .from("product_variants")
        .update({
          option1_name: localized.option1_name,
          option1_value: localized.option1_value,
          option2_name: localized.option2_name,
          option2_value: localized.option2_value,
          option3_name: localized.option3_name,
          option3_value: localized.option3_value,
        })
        .eq("id", row.id);
    }
  } catch {
    extraWarnings.push("款式簡轉繁寫入略過，不影響文案結果；可稍後重新生成。");
    await serviceSupabase
      .from("product_drafts")
      .update({ warnings: uniqueMessages([...allWarnings, ...extraWarnings]) })
      .eq("id", draftId);
  }

  {
    const { error: toneError } = await serviceSupabase
      .from("product_drafts")
      .update({ generation_tone: generationTone })
      .eq("id", draftId);
    if (toneError) {
      extraWarnings.push("generation_tone 寫入略過（請確認已執行 migration 034）。");
      await serviceSupabase
        .from("product_drafts")
        .update({ warnings: uniqueMessages([...allWarnings, ...extraWarnings]) })
        .eq("id", draftId);
    }
  }

  if (webSearchCacheToPersist) {
    const { error: cacheError } = await serviceSupabase
      .from("product_drafts")
      .update({ web_search_cache: webSearchCacheToPersist })
      .eq("id", draftId);
    if (cacheError) {
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

  const highlightsContent = cleanedProductHighlights.join("\n");
  const historyRows = [
    {
      field_name: "enriched_title",
      content: enrichedTitleFull || localizedOutput.display_title,
    },
    { field_name: "generated_description_html", content: localizedOutput.generated_description_html },
    { field_name: "generated_faq_html", content: localizedOutput.generated_faq_html },
    { field_name: "seo_title", content: localizedOutput.seo_title },
    { field_name: "meta_description", content: localizedOutput.meta_description },
    { field_name: "why_we_chose_it", content: cleanedWhyWeChoseIt },
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
    detectedIpName: detected.ip || draft.ip_name || null,
    result: {
      title: localizedOutput.display_title,
      descriptionHtml: localizedOutput.generated_description_html,
      faqHtml: localizedOutput.generated_faq_html,
      seoTitle: localizedOutput.seo_title,
      metaDescription: localizedOutput.meta_description,
      tags: localizedOutput.shopify_tags,
      whyWeChoseIt: cleanedWhyWeChoseIt,
      productHighlights: cleanedProductHighlights,
      provider: providerOutput.provider,
      model: providerOutput.model,
    },
  });
}
