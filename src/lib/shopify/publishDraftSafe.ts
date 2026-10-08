import { notifyMake } from "@/lib/notifications/make";
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import { prepareImagesForPublish } from "@/lib/images/prepareImagesForPublish";
import { buildShopifyProductPayload, shopifyAdminUrl } from "@/lib/shopify/payload";
import { hasShopifyAdminCredentials } from "@/lib/shopify/adminToken";
import { callShopifyAdminGraphQL } from "@/lib/shopify/adminGraphQL";
import {
  getShopifyProductStatus,
  isRealShopifyProductId,
  setShopifyProductStatus,
  type ShopifyAdminGraphQLCaller
} from "@/lib/shopify/productLifecycle";
import { checkLiveTestGuard } from "@/lib/shopify/liveTestGuard";
import { mergeInternalLinkMap } from "@/lib/contentGenerator/internalLinks";
import {
  findDuplicateProductVariantRows,
  toBulkVariantInput,
  type MultiVariantPublishPlan
} from "@/lib/variants/shopifyVariants";
import type { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { ProductVariantRow, PublishMode } from "@/types/domain";

export type PublishDraftResult =
  | { ok: true; mock: true; payload: unknown; productId?: string; adminUrl?: string | null }
  | { ok: true; mock?: false; productId: string; adminUrl: string | null }
  | { ok: false; status: number; error: string };

type PublishDraftDeps = {
  callGraphQL?: ShopifyAdminGraphQLCaller;
};

type ServiceSupabase = ReturnType<typeof createServiceSupabaseClient>;

function nowIso(): string {
  return new Date().toISOString();
}

function stringifyError(value: unknown): string {
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function getShopifyInventoryLocationId(
  caller: ShopifyAdminGraphQLCaller
): Promise<string | null> {
  const configuredLocationId = process.env.SHOPIFY_LOCATION_ID?.trim();
  if (configuredLocationId) return configuredLocationId;

  const locationQuery = `
    query PrimaryInventoryLocation {
      locations(first: 1) {
        nodes { id name }
      }
    }
  `;
  try {
    const { response, result } = await caller(locationQuery, {});
    if (!response.ok || (Array.isArray(result?.errors) && result.errors.length > 0)) {
      return null;
    }
    return result?.data?.locations?.nodes?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function markDraftFailed(
  serviceSupabase: ServiceSupabase,
  id: string,
  message: string,
  productId?: string | null
): Promise<void> {
  await serviceSupabase
    .from("product_drafts")
    .update({
      status: "api_failed",
      pipeline_stage: mapStatusToPipelineStage("api_failed"),
      publish_status: "api_failed",
      ...(productId && isRealShopifyProductId(productId)
        ? {
            shopify_product_id: productId,
            shopify_admin_url: shopifyAdminUrl(productId)
          }
        : {}),
      error_message: message
    })
    .eq("id", id);
}

async function insertPublishJob(
  serviceSupabase: ServiceSupabase,
  base: Record<string, unknown>,
  status: "api_failed" | "active_published" | "draft_created",
  responsePayload: unknown,
  errorMessage?: string | null
): Promise<void> {
  await serviceSupabase.from("publish_jobs").insert({
    ...base,
    publish_status: status,
    response_payload: responsePayload,
    error_message: errorMessage ?? null,
    completed_at: nowIso()
  });
}

async function clearLocalShopifyLink(
  serviceSupabase: ServiceSupabase,
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await serviceSupabase
    .from("product_drafts")
    .update({ shopify_product_id: null, shopify_admin_url: null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function persistCreatedProductLink(
  serviceSupabase: ServiceSupabase,
  id: string,
  productId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await serviceSupabase
    .from("product_drafts")
    .update({
      shopify_product_id: productId,
      shopify_admin_url: shopifyAdminUrl(productId)
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function claimPublishing(
  serviceSupabase: ServiceSupabase,
  id: string,
  priorStatus: string,
  publishMode: PublishMode,
  payload: unknown
): Promise<boolean> {
  // CAS guard: two simultaneous requests cannot both transition the same draft
  // from the same prior state into publishing.
  const { data, error } = await serviceSupabase
    .from("product_drafts")
    .update({
      status: "publishing",
      pipeline_stage: mapStatusToPipelineStage("publishing"),
      publish_status: "publishing",
      publish_mode: publishMode,
      shopify_payload_preview: payload,
      error_message: null
    })
    .eq("id", id)
    .eq("status", priorStatus)
    .select("id")
    .maybeSingle();
  return !error && Boolean(data?.id);
}

async function finishLocalSuccess(
  serviceSupabase: ServiceSupabase,
  id: string,
  publishMode: PublishMode,
  productId: string,
  draftWarnings: unknown,
  publishWarnings: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const finalStatus = publishMode === "active" ? "active_published" : "draft_created";
  const { error } = await serviceSupabase
    .from("product_drafts")
    .update({
      status: finalStatus,
      pipeline_stage: mapStatusToPipelineStage(finalStatus),
      publish_status: finalStatus,
      publish_mode: publishMode,
      shopify_product_id: productId,
      shopify_admin_url: shopifyAdminUrl(productId),
      error_message: null,
      published_at: nowIso(),
      ...(publishWarnings.length
        ? {
            warnings: [
              ...(Array.isArray(draftWarnings) ? draftWarnings : []),
              ...publishWarnings
            ].slice(-30)
          }
        : {})
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function mockPublish(
  serviceSupabase: ServiceSupabase,
  id: string,
  draft: any,
  publishMode: PublishMode,
  payload: unknown,
  publishJobBase: Record<string, unknown>,
  videoWarnings: string[]
): Promise<PublishDraftResult> {
  const mockStatus = publishMode === "active" ? "active_published" : "draft_created";
  await insertPublishJob(serviceSupabase, publishJobBase, mockStatus, {
    mock: true,
    note: "SHOPIFY_PUBLISH_MOCK is enabled (safe simulation; no real Shopify product)",
    ...(videoWarnings.length ? { videoWarnings } : {})
  });
  const { error } = await serviceSupabase
    .from("product_drafts")
    .update({
      status: mockStatus,
      pipeline_stage: mapStatusToPipelineStage(mockStatus),
      publish_status: mockStatus,
      publish_mode: publishMode,
      shopify_product_id: "mock-product-id",
      shopify_admin_url: null,
      error_message: null,
      published_at: nowIso(),
      ...(videoWarnings.length
        ? { warnings: [...(Array.isArray(draft.warnings) ? draft.warnings : []), ...videoWarnings].slice(-30) }
        : {})
    })
    .eq("id", id);
  if (error) {
    return { ok: false, status: 500, error: `Mock publish local persistence failed: ${error.message}` };
  }
  await notifyMake(mockStatus, { draftId: id, mock: true });
  return { ok: true, mock: true, payload, productId: "mock-product-id", adminUrl: null };
}

async function republishExistingDraft(
  serviceSupabase: ServiceSupabase,
  id: string,
  draft: any,
  publishMode: PublishMode,
  caller: ShopifyAdminGraphQLCaller
): Promise<PublishDraftResult> {
  const productId = draft.shopify_product_id as string;
  if (publishMode !== "active") {
    return { ok: true, productId, adminUrl: draft.shopify_admin_url ?? shopifyAdminUrl(productId) };
  }

  try {
    await setShopifyProductStatus(productId, "ACTIVE", caller);
  } catch (error) {
    const message = `Shopify re-publish failed for existing product ${productId}: ${stringifyError(error)}`;
    await markDraftFailed(serviceSupabase, id, message, productId);
    await notifyMake("api_failed", { draftId: id, error: message, shopifyProductId: productId });
    return { ok: false, status: 502, error: message };
  }

  const { error } = await serviceSupabase
    .from("product_drafts")
    .update({
      status: "active_published",
      pipeline_stage: mapStatusToPipelineStage("active_published"),
      publish_status: "active_published",
      publish_mode: "active",
      error_message: null,
      published_at: nowIso()
    })
    .eq("id", id);
  if (error) {
    const message = `Shopify product ${productId} is ACTIVE but local re-publish persistence failed: ${error.message}; manual reconciliation required.`;
    return { ok: false, status: 500, error: message };
  }
  await notifyMake("active_published", {
    draftId: id,
    shopifyProductId: productId,
    shopifyAdminUrl: draft.shopify_admin_url ?? shopifyAdminUrl(productId)
  });
  return { ok: true, productId, adminUrl: draft.shopify_admin_url ?? shopifyAdminUrl(productId) };
}

export async function publishDraft(
  serviceSupabase: ServiceSupabase,
  id: string,
  publishMode: PublishMode,
  deps: PublishDraftDeps = {}
): Promise<PublishDraftResult> {
  const caller: ShopifyAdminGraphQLCaller = deps.callGraphQL ?? ((query, variables) =>
    callShopifyAdminGraphQL(query, variables));

  const { data: draft, error } = await serviceSupabase
    .from("product_drafts")
    .select("*, product_images(*)")
    .eq("id", id)
    .single();
  if (error || !draft) {
    return { ok: false, status: 404, error: error?.message ?? "Draft not found" };
  }

  const guardError = checkLiveTestGuard({ draftIds: [id], publishMode });
  if (guardError) return { ok: false, status: 403, error: guardError };

  if (draft.status === "publishing" || draft.publish_status === "publishing") {
    return { ok: false, status: 409, error: "Draft is already publishing; duplicate publish request blocked" };
  }

  const mockMode = process.env.SHOPIFY_PUBLISH_MOCK !== "false";
  const existingProductId = draft.shopify_product_id as string | null;

  // Mock IDs never cross the live Shopify boundary.
  if (!mockMode && existingProductId === "mock-product-id") {
    return {
      ok: false,
      status: 409,
      error: "Draft contains mock-product-id; refusing to send mock linkage to live Shopify. Reconcile the draft first."
    };
  }

  // Normal re-publish after an intentional unpublish reuses the same Shopify product.
  if (!mockMode && draft.status === "draft_created" && isRealShopifyProductId(existingProductId)) {
    return republishExistingDraft(serviceSupabase, id, draft, publishMode, caller);
  }

  const publishableStatuses = ["approved", "ready_for_review", "api_failed"];
  const allowed = publishableStatuses.includes(draft.status) || draft.pipeline_stage === "ready";
  if (!allowed) {
    return { ok: false, status: 409, error: `Draft status ${draft.status} cannot be published` };
  }

  let resumeExistingDraftId: string | null = null;
  let resumeExistingMediaCount = 0;

  // Retry idempotency: an api_failed row with a real Shopify DRAFT resumes the
  // same remote product. Never delete/recreate a recoverable DRAFT.
  if (!mockMode && draft.status === "api_failed" && isRealShopifyProductId(existingProductId)) {
    let remote: Awaited<ReturnType<typeof getShopifyProductStatus>>;
    try {
      remote = await getShopifyProductStatus(existingProductId, caller);
    } catch (queryError) {
      return {
        ok: false,
        status: 502,
        error: `Unable to reconcile existing Shopify product ${existingProductId}: ${stringifyError(queryError)}`
      };
    }

    if (remote?.status === "ACTIVE") {
      return {
        ok: false,
        status: 409,
        error: `Existing Shopify product ${existingProductId} is ACTIVE while local state is api_failed; automatic recovery is blocked. Manual reconciliation required.`
      };
    }

    if (remote && remote.status !== "DRAFT") {
      return {
        ok: false,
        status: 409,
        error: `Existing Shopify product ${existingProductId} is ${remote.status}; automatic recovery is blocked. Manual reconciliation required.`
      };
    }

    if (remote?.status === "DRAFT") {
      const resumeQuery = `
        query ResumeShopifyDraft($id: ID!) {
          product(id: $id) {
            id status
            media(first: 50) { nodes { id } }
            variants(first: 1) { nodes { id } }
          }
        }
      `;
      try {
        const { response: resumeResponse, result: resumeResult } = await caller(resumeQuery, {
          id: existingProductId
        });
        const remoteProduct = resumeResult?.data?.product;
        if (
          !resumeResponse.ok ||
          (Array.isArray(resumeResult?.errors) && resumeResult.errors.length > 0) ||
          remoteProduct?.id !== existingProductId ||
          remoteProduct?.status !== "DRAFT"
        ) {
          return {
            ok: false,
            status: 409,
            error: `Existing Shopify DRAFT ${existingProductId} could not be safely inspected for recovery.`
          };
        }
        resumeExistingDraftId = existingProductId;
        resumeExistingMediaCount = Array.isArray(remoteProduct?.media?.nodes)
          ? remoteProduct.media.nodes.length
          : 0;
      } catch (resumeError) {
        return {
          ok: false,
          status: 502,
          error: `Unable to inspect existing Shopify DRAFT ${existingProductId}: ${stringifyError(resumeError)}`
        };
      }
    } else {
      // Remote row disappeared: the local linkage is stale, so clear it before
      // creating a replacement. This is the only retry path that may create anew.
      const cleared = await clearLocalShopifyLink(serviceSupabase, id);
      if (!cleared.ok) {
        const clearError = "error" in cleared ? cleared.error : "unknown local linkage error";
        return {
          ok: false,
          status: 500,
          error: `Stale Shopify linkage could not be cleared: ${clearError}. productCreate was not attempted.`
        };
      }
    }
  } else if (!mockMode && isRealShopifyProductId(existingProductId)) {
    // Any other real linkage is not a create candidate.
    return {
      ok: false,
      status: 409,
      error: `Draft already has Shopify product ${existingProductId}; direct productCreate is blocked for idempotency.`
    };
  }

  // R3: publish-time image preparation stays in the existing lifecycle.
  const prep = await prepareImagesForPublish({ serviceSupabase, draftId: id });
  if (prep.warnings.length) {
    const merged = [
      ...(Array.isArray(draft.warnings) ? draft.warnings : []),
      ...prep.warnings.map((warning) => `發布前圖處理：${warning}`)
    ].slice(-30);
    await serviceSupabase.from("product_drafts").update({ warnings: merged }).eq("id", id);
  }

  const { data: draftFresh } = await serviceSupabase
    .from("product_drafts")
    .select("*, product_images(*)")
    .eq("id", id)
    .single();
  const draftForPayload = draftFresh ?? draft;

  const { data: variantRows } = await serviceSupabase
    .from("product_variants")
    .select("*")
    .eq("draft_id", id)
    .order("sort_order", { ascending: true });
  const typedVariantRows = (variantRows ?? []) as ProductVariantRow[];
  const duplicateVariantRows = findDuplicateProductVariantRows(typedVariantRows);
  if (duplicateVariantRows.length > 0) {
    return {
      ok: false,
      status: 409,
      error: `款式組合重複（${duplicateVariantRows.length} 列）— 請回到商品卡修正重複規格後再發布`
    };
  }

  const { data: linkSettingsRow } = await serviceSupabase
    .from("team_settings")
    .select("value")
    .eq("key", "internal_link_urls_by_ip")
    .maybeSingle();
  const internalLinkMap = mergeInternalLinkMap(
    (linkSettingsRow?.value as Record<string, string> | null) ?? null
  );

  // SAFE STAGING: the create payload is DRAFT for both requested modes.
  const builtPayload = buildShopifyProductPayload(
    { ...draftForPayload, product_variants: typedVariantRows },
    publishMode,
    internalLinkMap
  ) as any;
  const payload = {
    ...builtPayload,
    product: { ...builtPayload.product, status: "DRAFT" as const }
  };

  const claimed = await claimPublishing(serviceSupabase, id, draft.status, publishMode, payload);
  if (!claimed) {
    return { ok: false, status: 409, error: "Draft publish state changed concurrently; duplicate publish request blocked" };
  }

  const publishJobBase = {
    draft_id: id,
    publish_mode: publishMode,
    publish_method: "shopify_api",
    publish_status: "publishing",
    request_payload: payload
  };
  const videoWarnings = Array.isArray(payload.videoWarnings) ? (payload.videoWarnings as string[]) : [];

  if (!mockMode && !hasShopifyAdminCredentials() && !deps.callGraphQL) {
    const message =
      "已關閉模擬發布（SHOPIFY_PUBLISH_MOCK=false），但缺少 Shopify 憑證。請設定 SHOPIFY_STORE_DOMAIN、SHOPIFY_CLIENT_ID、SHOPIFY_CLIENT_SECRET 後重試。";
    await insertPublishJob(serviceSupabase, publishJobBase, "api_failed", { error: message, mock: false }, message);
    await markDraftFailed(serviceSupabase, id, message);
    await notifyMake("api_failed", { draftId: id, error: message });
    return { ok: false, status: 503, error: message };
  }

  if (mockMode) {
    return mockPublish(serviceSupabase, id, draft, publishMode, payload, publishJobBase, videoWarnings);
  }

  const createMutation = `
    mutation ProductCreate($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product {
          id title status
          variants(first: 10) {
            nodes { id selectedOptions { name value } }
          }
        }
        userErrors { field message }
      }
    }
  `;

  let createResult: any = null;
  let productId: string;
  let defaultVariantId: string | undefined;

  if (resumeExistingDraftId) {
    const resumeQuery = `
      query ResumeShopifyDraftVariant($id: ID!) {
        product(id: $id) {
          id status
          variants(first: 1) { nodes { id } }
        }
      }
    `;
    let resumeResponse: Response;
    let resumeResult: any;
    try {
      ({ response: resumeResponse, result: resumeResult } = await caller(resumeQuery, {
        id: resumeExistingDraftId
      }));
    } catch (resumeError) {
      const message = `Shopify DRAFT recovery lookup failed: ${stringifyError(resumeError)}`;
      await markDraftFailed(serviceSupabase, id, message, resumeExistingDraftId);
      return { ok: false, status: 502, error: message };
    }
    const remoteProduct = resumeResult?.data?.product;
    if (
      !resumeResponse.ok ||
      (Array.isArray(resumeResult?.errors) && resumeResult.errors.length > 0) ||
      remoteProduct?.id !== resumeExistingDraftId ||
      remoteProduct?.status !== "DRAFT"
    ) {
      const message = `Shopify DRAFT recovery changed remotely before resume; stopped before variant sync.`;
      await markDraftFailed(serviceSupabase, id, message, resumeExistingDraftId);
      return { ok: false, status: 409, error: message };
    }
    productId = resumeExistingDraftId;
    defaultVariantId = remoteProduct?.variants?.nodes?.[0]?.id as string | undefined;
    createResult = { recoveredExistingDraft: true, productId };
  } else {
    let createResponse: Response;
    try {
      ({ response: createResponse, result: createResult } = await caller(createMutation, {
        product: { ...payload.product, status: "DRAFT" }
      }));
    } catch (createError) {
      const message = stringifyError(createError);
      await insertPublishJob(serviceSupabase, publishJobBase, "api_failed", { error: message }, message);
      await markDraftFailed(serviceSupabase, id, message);
      await notifyMake("api_failed", { draftId: id, error: message });
      return { ok: false, status: 502, error: message };
    }

    const createUserErrors = createResult?.data?.productCreate?.userErrors;
    const createdProductId = createResult?.data?.productCreate?.product?.id as string | undefined;
    const createdStatus = createResult?.data?.productCreate?.product?.status;
    defaultVariantId = createResult?.data?.productCreate?.product?.variants?.nodes?.[0]?.id as string | undefined;
    if (
      !createResponse.ok ||
      (Array.isArray(createResult?.errors) && createResult.errors.length > 0) ||
      (Array.isArray(createUserErrors) && createUserErrors.length > 0) ||
      !createdProductId ||
      createdStatus !== "DRAFT"
    ) {
      const message = `Shopify productCreate(DRAFT) failed or returned an unsafe status: ${stringifyError(
        createUserErrors?.length ? createUserErrors : createResult
      )}`;
      await insertPublishJob(serviceSupabase, publishJobBase, "api_failed", createResult, message);
      await markDraftFailed(serviceSupabase, id, message);
      await notifyMake("api_failed", { draftId: id, error: message });
      return { ok: false, status: 502, error: message };
    }

    productId = createdProductId;

    // Persist linkage immediately after productCreate and before any variant or
    // media follow-up. A later timeout must never orphan a remote Shopify DRAFT.
    const linkPersist = await persistCreatedProductLink(serviceSupabase, id, productId);
    if (!linkPersist.ok) {
      const localLinkError = "error" in linkPersist ? linkPersist.error : "unknown local linkage error";
      const message =
        `Shopify product ${productId} was created as DRAFT but local linkage persistence failed; manual reconciliation required. localError=${localLinkError}`;
      await insertPublishJob(serviceSupabase, publishJobBase, "api_failed", { productId }, message);
      await markDraftFailed(serviceSupabase, id, message, productId);
      await notifyMake("api_failed", { draftId: id, error: message, shopifyProductId: productId });
      return { ok: false, status: 500, error: message };
    }
  }

  async function failAfterCreate(message: string, responsePayload: unknown): Promise<PublishDraftResult> {
    await insertPublishJob(serviceSupabase, publishJobBase, "api_failed", responsePayload ?? { error: message }, message);
    await markDraftFailed(serviceSupabase, id, message, productId);
    await notifyMake("api_failed", { draftId: id, error: message, shopifyProductId: productId });
    return { ok: false, status: 502, error: message };
  }

  type VariantMutationResult = {
    data?: {
      productVariantsBulkUpdate?: { userErrors?: { field: string; message: string }[] };
      productVariantsBulkCreate?: {
        userErrors?: { field: string; message: string }[];
        productVariants?: { id: string }[];
      };
    };
    errors?: unknown[];
  };

  let priceSyncWarning: string | null = null;
  const variantPlan = payload.variantPlan as ({ mode: string } & Partial<MultiVariantPublishPlan>) | undefined;
  const isMulti = variantPlan?.mode === "multi" && variantPlan.initial && variantPlan.all;

  if (isMulti) {
    const multi = variantPlan as MultiVariantPublishPlan;
    const needsLocation = multi.all.some(
      (seed) => seed.inventoryPolicy === "DENY" && Number.isInteger(seed.inventoryQuantity)
    );
    const inventoryLocationId = needsLocation ? await getShopifyInventoryLocationId(caller) : null;
    if (needsLocation && !inventoryLocationId) {
      return failAfterCreate(
        "有限庫存發布需要 Shopify location ID；請設定 SHOPIFY_LOCATION_ID，或確認 Shopify Admin API 可讀取 locations。",
        null
      );
    }
    if (!defaultVariantId) {
      return failAfterCreate("商品已建立但 Shopify 未回傳初始款式 ID，多款式價格無法同步。", createResult);
    }

    const updateMutation = `
      mutation ProductVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id price compareAtPrice }
          userErrors { field message }
        }
      }
    `;
    const bulkCreateMutation = `
      mutation ProductVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $strategy: ProductVariantsBulkCreateStrategy) {
        productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: $strategy) {
          productVariants { id title }
          userErrors { field message }
        }
      }
    `;

    try {
      const { response: updateResponse, result: updateResult } = await caller(updateMutation, {
        productId,
        variants: [
          toBulkVariantInput(multi.initial, {
            includeOptionValues: false,
            locationId: inventoryLocationId,
            inventoryMode: "update",
            variantId: defaultVariantId
          })
        ]
      });
      const updateErrors = updateResult?.data?.productVariantsBulkUpdate?.userErrors ?? updateResult?.errors;
      if (!updateResponse.ok || (Array.isArray(updateErrors) && updateErrors.length > 0)) {
        return failAfterCreate(
          `商品已建立但初始款式價格同步失敗：${stringifyError(updateErrors?.length ? updateErrors : updateResult)}`,
          updateResult
        );
      }

      if (multi.additional.length > 0) {
        const { response: bulkCreateResponse, result: bulkCreateResult } = await caller(bulkCreateMutation, {
          productId,
          strategy: "DEFAULT",
          variants: multi.additional.map((seed) =>
            toBulkVariantInput(seed, {
              includeOptionValues: true,
              locationId: inventoryLocationId,
              inventoryMode: "create"
            })
          )
        });
        const bulkErrors = bulkCreateResult?.data?.productVariantsBulkCreate?.userErrors ?? bulkCreateResult?.errors;
        if (!bulkCreateResponse.ok || (Array.isArray(bulkErrors) && bulkErrors.length > 0)) {
          return failAfterCreate(
            `商品已建立且第一個款式已更新，但其餘款式 productVariantsBulkCreate 失敗：${stringifyError(
              bulkErrors?.length ? bulkErrors : bulkCreateResult
            )}`,
            bulkCreateResult
          );
        }
      }
    } catch (variantError) {
      return failAfterCreate(`商品已建立但多款式同步失敗：${stringifyError(variantError)}`, null);
    }
  } else if (defaultVariantId) {
    const variantMutation = `
      mutation ProductVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id price compareAtPrice }
          userErrors { field message }
        }
      }
    `;
    const seed = payload.variantSeed as {
      sku: string;
      price: number;
      cost: number;
      compareAtPrice?: number | null;
      inventoryQuantity: number;
      inventoryPolicy: "DENY" | "CONTINUE";
    };
    const hasFiniteInventory = seed.inventoryPolicy === "DENY" && Number.isInteger(seed.inventoryQuantity);
    const inventoryLocationId = hasFiniteInventory ? await getShopifyInventoryLocationId(caller) : null;

    try {
      if (hasFiniteInventory && !inventoryLocationId) {
        throw new Error(
          "有限庫存發布需要 Shopify location ID；請設定 SHOPIFY_LOCATION_ID，或確認 Shopify Admin API 可讀取 locations。"
        );
      }
      const { response: variantResponse, result: variantResult } = await caller(variantMutation, {
        productId,
        variants: [
          {
            id: defaultVariantId,
            price: String(seed.price),
            ...(seed.compareAtPrice ? { compareAtPrice: String(seed.compareAtPrice) } : {}),
            inventoryPolicy: seed.inventoryPolicy,
            inventoryItem: {
              sku: seed.sku,
              cost: String(seed.cost),
              tracked: hasFiniteInventory
            },
            ...(hasFiniteInventory && inventoryLocationId
              ? {
                  quantityAdjustments: [
                    {
                      locationId: inventoryLocationId,
                      adjustment: seed.inventoryQuantity,
                      changeFromQuantity: 0
                    }
                  ]
                }
              : {})
          }
        ]
      });
      const variantErrors = variantResult?.data?.productVariantsBulkUpdate?.userErrors ?? variantResult?.errors;
      if (!variantResponse.ok || (Array.isArray(variantErrors) && variantErrors.length > 0)) {
        return failAfterCreate(
          `商品已建立但價格同步失敗，請至 Shopify 後台手動確認價格：${stringifyError(
            variantErrors?.length ? variantErrors : variantResult
          )}`,
          variantResult
        );
      }
    } catch (variantError) {
      return failAfterCreate(
        `商品已建立但價格同步失敗，請至 Shopify 後台手動確認價格：${stringifyError(variantError)}`,
        null
      );
    }
  } else {
    priceSyncWarning = "Shopify 未回傳預設款式 ID，價格／成本未同步，請至 Shopify 後台手動確認並設定價格。";
  }

  // Media is deliberately deferred until the product ID and variants are safe.
  // Before the potentially slow remote-media step, persist an api_failed
  // checkpoint with the real ID. If the serverless request is killed, retry can
  // resume this same DRAFT instead of creating a duplicate product.
  const mediaInputs = Array.isArray(payload.media) ? payload.media : [];
  if (mediaInputs.length > 0) {
    if (resumeExistingDraftId && resumeExistingMediaCount > 0 && resumeExistingMediaCount < mediaInputs.length) {
      return failAfterCreate(
        `Existing Shopify DRAFT has only ${resumeExistingMediaCount}/${mediaInputs.length} media items; automatic media retry is blocked to avoid duplicates.`,
        { productId, remoteMediaCount: resumeExistingMediaCount, expectedMediaCount: mediaInputs.length }
      );
    }

    if (!resumeExistingDraftId || resumeExistingMediaCount === 0) {
      await markDraftFailed(
        serviceSupabase,
        id,
        `Shopify DRAFT ${productId} and variants are linked; media sync is pending.`,
        productId
      );

      const mediaMutation = `
        mutation ProductAttachMedia($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
          productUpdate(product: $product, media: $media) {
            product { id status }
            userErrors { field message }
          }
        }
      `;
      try {
        const { response: mediaResponse, result: mediaResult } = await caller(mediaMutation, {
          product: { id: productId },
          media: mediaInputs
        });
        const mediaErrors = mediaResult?.data?.productUpdate?.userErrors ?? mediaResult?.errors;
        if (
          !mediaResponse.ok ||
          (Array.isArray(mediaErrors) && mediaErrors.length > 0) ||
          mediaResult?.data?.productUpdate?.product?.id !== productId
        ) {
          return failAfterCreate(
            `商品與價格已建立，但圖片同步失敗：${stringifyError(mediaErrors?.length ? mediaErrors : mediaResult)}`,
            mediaResult
          );
        }
      } catch (mediaError) {
        return failAfterCreate(
          `商品與價格已建立，但圖片同步失敗：${stringifyError(mediaError)}`,
          null
        );
      }
    }
  }

  // ACTIVE is a final promotion only after every follow-up above completed.
  if (publishMode === "active") {
    try {
      await setShopifyProductStatus(productId, "ACTIVE", caller);
    } catch (activateError) {
      let rollbackNote = "";
      try {
        await setShopifyProductStatus(productId, "DRAFT", caller);
      } catch (rollbackError) {
        rollbackNote = `; DRAFT rollback could not be confirmed: ${stringifyError(rollbackError)}; manual reconciliation required`;
      }
      return failAfterCreate(
        `Shopify ACTIVE promotion failed after staged sync for ${productId}: ${stringifyError(activateError)}${rollbackNote}`,
        { activationError: stringifyError(activateError), rollbackNote }
      );
    }
  }

  const publishWarnings = [...(priceSyncWarning ? [priceSyncWarning] : []), ...videoWarnings];
  const finalStatus = publishMode === "active" ? "active_published" : "draft_created";
  await insertPublishJob(
    serviceSupabase,
    publishJobBase,
    finalStatus,
    publishWarnings.length
      ? { ...createResult, warning: priceSyncWarning ?? undefined, videoWarnings: videoWarnings.length ? videoWarnings : undefined }
      : createResult
  );

  const finalPersist = await finishLocalSuccess(
    serviceSupabase,
    id,
    publishMode,
    productId,
    draft.warnings,
    publishWarnings
  );
  if (!finalPersist.ok) {
    const finalPersistError = "error" in finalPersist ? finalPersist.error : "unknown final persistence error";
    const message = `Shopify lifecycle completed for ${productId}, but final local state persistence failed: ${finalPersistError}; manual reconciliation required.`;
    await markDraftFailed(serviceSupabase, id, message, productId);
    return { ok: false, status: 500, error: message };
  }

  await notifyMake(finalStatus, {
    draftId: id,
    shopifyProductId: productId,
    shopifyAdminUrl: shopifyAdminUrl(productId)
  });
  return { ok: true, productId, adminUrl: shopifyAdminUrl(productId) };
}
