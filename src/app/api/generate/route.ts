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

function toListingDraftInput(draft: ProductDraft): ListingDraftInput {
  return {
    source_url: draft.source_url,
    product_status: draft.is_secondhand ? "secondhand" : "general",
    ip: draft.ip_name ?? "",
    // TODO: product_drafts only stores one character/type today; the boss's
    // tool schema supports multiple (characters/product_types are jsonb
    // arrays). Wrapping single values keeps the ported generators working,
    // but multi-select input is a Phase 2+ UI gap, not implemented here.
    characters: draft.character_name ? [draft.character_name] : [],
    product_types: draft.product_type ? [draft.product_type] : [],
    use_cases: [],
    sale_status: draft.sale_status,
    recommend_tags: [],
    product_name: draft.title_zh ?? draft.taobao_title ?? draft.original_title ?? "",
    variant_feature: null,
    usage_scene: null,
    intro: draft.note,
    notes: draft.note,
    price: draft.twd_price,
    compare_at_price: null,
    image_description: draft.image_description,
    sku: null,
    secondhand_grade: draft.secondhand_grade,
    secondhand_condition: draft.secondhand_condition,
    secondhand_notes: draft.secondhand_notes,
  };
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
function buildTestModeOutput(ruleOutput: GeneratedListingContent): CopyProviderOutput {
  return {
    enrichedTitle: ruleOutput.display_title ?? "",
    generatedDescriptionHtml: ruleOutput.generated_description_html,
    generatedFaqHtml: ruleOutput.generated_faq_html,
    seoTitle: ruleOutput.seo_title,
    metaDescription: ruleOutput.meta_description,
    whyWeChoseIt: "",
    productHighlights: [],
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

  const listingInput = toListingDraftInput(draft);
  const ruleOutput = applyTagsV2(
    generateListingContent(listingInput, tagRules, displayContext),
    listingInput,
    displayContext,
  );

  const extraWarnings: string[] = [];

  // No search provider is wired up yet. Rather than silently ignore the toggle
  // or fabricate results, record that the request was made but not fulfilled.
  if (useWebSearch) {
    extraWarnings.push("已要求 Web Search 補充資訊，但伺服器尚未設定搜尋服務，本次生成未使用網路搜尋結果。");
  }

  let providerOutput;

  if (runMode === "test") {
    providerOutput = buildTestModeOutput(ruleOutput);
    extraWarnings.push("測試模式：未呼叫 AI，文案為規則引擎產出（未經 AI 潤稿），tags 與標題為正式結果。");
  } else {
    try {
      providerOutput = await COPY_PROVIDERS[providerKey].generate({
        ruleOutput,
        draft: listingInput,
        imageDescription: draft.image_description ?? undefined,
        tone,
        copyLength,
      });
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
