import { NextRequest } from "next/server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { canOperate } from "@/lib/auth/roles";
import { generateListingContent } from "@/lib/contentGenerator/generateListingContent";
import { generateSeoContent } from "@/lib/contentGenerator/seoGenerator";
import { ListingDraftInput, GeneratedListingContent } from "@/lib/contentGenerator/types";
import { DisplayLabelContext } from "@/lib/contentGenerator/displayLabels";
import { buildNestoryTagsV2Result } from "@/lib/nestoryTagsV2";
import { localizeGeneratedListingContent } from "@/lib/zhTwLocalizer";
import { listActiveListingTagRules } from "@/lib/tagRules";
import { ClaudeCopyProvider } from "@/lib/providers/claude-copy-provider";
import { OpenAICopyProvider } from "@/lib/providers/openai-copy-provider";
import { CopyLength, CopyProvider, CopyProviderOutput, CopyTone } from "@/lib/providers/copy";
import type { GenerationProvider, ProductDraft } from "@/types/domain";

const COPY_PROVIDERS: Record<"openai" | "claude", CopyProvider> = {
  openai: new OpenAICopyProvider(),
  claude: new ClaudeCopyProvider(),
};

const PROVIDER_TO_GENERATION_PROVIDER: Record<"openai" | "claude", GenerationProvider> = {
  openai: "openai",
  claude: "anthropic",
};

// tag_rules-sourced errors are meaningless once Tags V2 (a hardcoded dictionary,
// no DB lookups) takes over shopify_tags -- mirrors listingGeneration.ts's
// isLegacyTagRuleMappingError() from the boss's tool.
function isLegacyTagRuleMappingError(message: string): boolean {
  return message.includes("tag_rules") || message.includes("找不到二手商品屬性標籤");
}

function uniqueMessages(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
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

function toListingDraftInput(draft: ProductDraft, detected: DetectedClassification): ListingDraftInput {
  return {
    source_url: draft.source_url,
    product_status: draft.is_secondhand ? "secondhand" : "general",
    ip: detected.ip,
    characters: detected.character ? [detected.character] : [],
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
): GeneratedListingContent {
  const tagResult = buildNestoryTagsV2Result(payload, displayContext);
  const seoContent = generateSeoContent(payload, displayContext);
  const validationErrors = uniqueMessages([
    ...generatedContent.validation_errors.filter((message) => !isLegacyTagRuleMappingError(message)),
    ...tagResult.missing,
  ]);

  return {
    ...generatedContent,
    draft_state: validationErrors.length > 0 ? "blocked" : "ready",
    meta_description: seoContent.meta_description,
    seo_title: seoContent.seo_title,
    shopify_tags: tagResult.tags,
    validation_errors: validationErrors,
    validation_warnings: uniqueMessages([...generatedContent.validation_warnings, ...tagResult.warnings]),
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
    detectedCategory: detected.category,
    sku: detected.sku,
    provider: "test",
    model: "test-mode",
  };
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const draftId = typeof body.draftId === "string" ? body.draftId : null;
  const providerKey: "openai" | "claude" = body.provider === "claude" ? "claude" : "openai";
  const runMode: "test" | "llm" = body.mode === "test" ? "test" : "llm";
  const useWebSearch = body.useWebSearch === true;
  const source = typeof body.source === "string" ? body.source : undefined;
  const variantSummary = typeof body.variantSummary === "string" ? body.variantSummary : undefined;
  const tone: CopyTone = ["黑膠文藝收藏感", "日系選物店溫柔感", "可愛周邊輕鬆感"].includes(body.tone)
    ? body.tone
    : "黑膠文藝收藏感";
  const copyLength: CopyLength = ["精簡", "標準", "詳細"].includes(body.copyLength) ? body.copyLength : "標準";

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

  // No search provider is wired up yet. Rather than silently ignore the toggle
  // or fabricate results, record that the request was made but not fulfilled.
  if (useWebSearch) {
    extraWarnings.push("已要求 Web Search 補充資訊，但伺服器尚未設定搜尋服務，本次生成未使用網路搜尋結果。");
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
      const raw = await COPY_PROVIDERS[providerKey].generate({
        rawTitle: draft.taobao_title ?? draft.original_title ?? "",
        saleStatus: draft.sale_status,
        source,
        variantSummary,
        price: draft.twd_price,
        compareAtPrice: draft.compare_at_price,
        note: draft.note,
        imageDescription: draft.image_description ?? undefined,
        knownIpNames,
        tone,
        copyLength,
      });
      const resolvedIp = resolveIpName(raw.detectedIpName, ipCatalogEntries);
      detected = {
        ip: resolvedIp,
        character: raw.detectedCharacterName,
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
          generation_error: providerError instanceof Error ? providerError.message : "Copy provider failed",
        })
        .eq("id", draftId);

      return Response.json(
        { error: providerError instanceof Error ? providerError.message : "Copy provider failed" },
        { status: 502 }
      );
    }
  }

  const listingInput = toListingDraftInput(draft, detected);
  const ruleOutput = applyTagsV2(
    generateListingContent(listingInput, tagRules, displayContext),
    listingInput,
    displayContext,
  );

  if (!providerOutput) {
    providerOutput = buildTestModeOutput(ruleOutput, detected);
    extraWarnings.push("測試模式：未呼叫 AI、未自動偵測 IP；文案為規則引擎產出，tags 依草稿現有資料。");
  }

  const localizedOutput = localizeGeneratedListingContent({
    ...ruleOutput,
    display_title: providerOutput.enrichedTitle || ruleOutput.display_title,
    generated_description_html: providerOutput.generatedDescriptionHtml || ruleOutput.generated_description_html,
    generated_faq_html: providerOutput.generatedFaqHtml || ruleOutput.generated_faq_html,
    seo_title: providerOutput.seoTitle || ruleOutput.seo_title,
    meta_description: providerOutput.metaDescription || ruleOutput.meta_description,
  });

  const nextStatus = localizedOutput.draft_state === "blocked" ? "needs_revision" : "ready_for_review";
  const allWarnings = uniqueMessages([...localizedOutput.validation_warnings, ...extraWarnings]);

  const { error: updateError } = await serviceSupabase
    .from("product_drafts")
    .update({
      title_zh: localizedOutput.display_title,
      description_html: localizedOutput.generated_description_html,
      seo_title: localizedOutput.seo_title,
      seo_description: localizedOutput.meta_description,
      tags: localizedOutput.shopify_tags,
      shopify_tags: localizedOutput.shopify_tags,
      generated_faq_html: localizedOutput.generated_faq_html,
      why_we_chose_it: providerOutput.whyWeChoseIt,
      product_highlights: providerOutput.productHighlights,
      ip_name: detected.ip || null,
      character_name: detected.character || null,
      product_type: detected.productType || null,
      detected_category: detected.category || null,
      sku: detected.sku || null,
      warnings: allWarnings,
      status: nextStatus,
      generation_mode: "api_llm",
      generation_provider: PROVIDER_TO_GENERATION_PROVIDER[providerKey],
      generation_status: localizedOutput.draft_state === "blocked" ? "failed" : "completed",
      generation_model: providerOutput.model,
      generation_error:
        localizedOutput.draft_state === "blocked" ? localizedOutput.validation_errors.join("; ") : null,
    })
    .eq("id", draftId);

  if (updateError) {
    return Response.json({ error: updateError.message }, { status: 500 });
  }

  const historyRows = [
    { field_name: "enriched_title", content: localizedOutput.display_title },
    { field_name: "generated_description_html", content: localizedOutput.generated_description_html },
    { field_name: "generated_faq_html", content: localizedOutput.generated_faq_html },
    { field_name: "seo_title", content: localizedOutput.seo_title },
    { field_name: "meta_description", content: localizedOutput.meta_description },
    { field_name: "why_we_chose_it", content: providerOutput.whyWeChoseIt },
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
