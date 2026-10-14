import { notifyMake } from "@/lib/notifications/make";
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import { prepareImagesForPublish } from "@/lib/images/prepareImagesForPublish";
import {
  hasUnconfirmedPlaceholderCny,
  MISSING_COST_BLOCK_MESSAGE,
} from "@/lib/import/captureTypes";
import { buildShopifyProductPayload, shopifyAdminUrl } from "@/lib/shopify/payload";
import { hasShopifyAdminCredentials } from "@/lib/shopify/adminToken";
import { callShopifyAdminGraphQL } from "@/lib/shopify/adminGraphQL";
import {
  getShopifyProductStatus,
  isRealShopifyProductId,
  publishShopifyProductToOnlineStore,
  setShopifyProductStatus,
  type ShopifyAdminGraphQLCaller
} from "@/lib/shopify/productLifecycle";
import { checkLiveTestGuard } from "@/lib/shopify/liveTestGuard";
import {
  RECONCILED_CODE,
  RECONCILED_MESSAGE,
  reconcileDraftWithShopify
} from "@/lib/shopify/reconcileDraft";
import {
  checkPublishReadiness,
  formatPublishBlockMessage,
  isVariantPriceConfirmed,
  type PublishBlockCode,
  type PublishBlocker
} from "@/lib/shopify/publishReadiness";
import { mergeInternalLinkMap } from "@/lib/contentGenerator/internalLinks";
import {
  findDuplicateProductVariantRows,
  planResumeVariantSync,
  toBulkVariantInput,
  type MultiVariantPublishPlan,
  type ResumeRemoteVariant
} from "@/lib/variants/shopifyVariants";
import type { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { ProductVariantRow, PublishMode } from "@/types/domain";

export type PublishDraftResult =
  // Mock mode is a dry run: checks + payload only, nothing written, no Shopify product.
  | { ok: true; mock: true; payload: unknown; productId: null; adminUrl: null; mockNotes: string[] }
  | {
      ok: true;
      mock?: false;
      productId: string;
      adminUrl: string | null;
      /** PUBLISH-BATCH: "RECONCILED" = Shopify was already live, only the local state was repaired. */
      code?: "RECONCILED";
      message?: string;
      /** Non-fatal notes (e.g. optional Google & YouTube channel skipped). */
      warnings?: string[];
    }
  | { ok: false; status: number; error: string; code?: PublishBlockCode; blockers?: PublishBlocker[] };

type PublishDraftDeps = {
  callGraphQL?: ShopifyAdminGraphQLCaller;
  /** Inject for tests; default = SHOPIFY_PUBLISH_MOCK is anything but exactly "false". */
  mockMode?: boolean;
  /** Operator ticked "I checked every variant cost" (single-card publish only). */
  confirmVariantPrices?: boolean;
  /** Who confirmed; stored next to variant_price_confirmed_at. */
  confirmedBy?: string | null;
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

/**
 * PUBLISH-GUARD: remember that an operator confirmed the variant costs so the
 * next publish of this draft does not ask again. Merge-only (other raw_capture /
 * server keys stay), live mode only, and skipped when raw_capture has no
 * `server` object. Best-effort: a failed write never blocks the publish.
 */
async function persistVariantPriceConfirmation(
  serviceSupabase: ServiceSupabase,
  id: string,
  rawCapture: unknown,
  confirmedBy: string | null
): Promise<void> {
  if (!rawCapture || typeof rawCapture !== "object" || Array.isArray(rawCapture)) return;
  const raw = rawCapture as Record<string, unknown>;
  const server = raw.server;
  if (!server || typeof server !== "object" || Array.isArray(server)) return;
  await serviceSupabase
    .from("product_drafts")
    .update({
      raw_capture: {
        ...raw,
        server: {
          ...(server as Record<string, unknown>),
          variant_price_confirmed_at: nowIso(),
          variant_price_confirmed_by: confirmedBy
        }
      }
    })
    .eq("id", id);
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
    await publishShopifyProductToOnlineStore(productId, caller);
  } catch (error) {
    let rollbackNote = "";
    try {
      await setShopifyProductStatus(productId, "DRAFT", caller);
    } catch (rollbackError) {
      rollbackNote = `; DRAFT rollback could not be confirmed: ${stringifyError(rollbackError)}; manual reconciliation required`;
    }
    const message =
      `Shopify re-publish failed for existing product ${productId}: ${stringifyError(error)}${rollbackNote}`;
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

  if (hasUnconfirmedPlaceholderCny(draft)) {
    return { ok: false, status: 409, error: MISSING_COST_BLOCK_MESSAGE };
  }

  const guardError = checkLiveTestGuard({ draftIds: [id], publishMode });
  if (guardError) return { ok: false, status: 403, error: guardError };

  if (draft.status === "publishing" || draft.publish_status === "publishing") {
    return { ok: false, status: 409, error: "Draft is already publishing; duplicate publish request blocked" };
  }

  // Mock mode is a dry run: read-only guards + payload build, zero writes, no Shopify.
  const mockMode = deps.mockMode ?? process.env.SHOPIFY_PUBLISH_MOCK !== "false";
  const existingProductId = draft.shopify_product_id as string | null;

  // Mock IDs never cross the live Shopify boundary.
  if (!mockMode && existingProductId === "mock-product-id") {
    return {
      ok: false,
      status: 409,
      error: "Draft contains mock-product-id; refusing to send mock linkage to live Shopify. Reconcile the draft first."
    };
  }

  // PUBLISH-GUARD: variant rows are loaded once (before image prep) and reused for
  // readiness, the duplicate-variant check and the payload. A transient read error
  // must not turn into "no variants, so nothing to block".
  const { data: variantRows, error: variantRowsError } = await serviceSupabase
    .from("product_variants")
    .select("*")
    .eq("draft_id", id)
    .order("sort_order", { ascending: true });
  if (variantRowsError) {
    return { ok: false, status: 500, error: `讀取款式資料失敗，已停止發布：${variantRowsError.message}` };
  }
  const typedVariantRows = (variantRows ?? []) as ProductVariantRow[];

  // Runs before the republish path, status gate, image prep and claimPublishing,
  // so a blocked draft is never moved to another status.
  const readiness = checkPublishReadiness(draft, typedVariantRows, {
    confirmVariantPrices: deps.confirmVariantPrices === true
  });
  if (readiness.blocked) {
    return {
      ok: false,
      status: 409,
      error: formatPublishBlockMessage(readiness.blockers),
      code: readiness.needsPriceConfirm ? "PUBLISH_NEEDS_PRICE_CONFIRM" : "PUBLISH_BLOCKED",
      blockers: readiness.blockers
    };
  }
  // Persist the operator's confirmation only when the request flag actually waived
  // a blocker (not when it was already persisted), never in mock mode.
  const persistConfirmationIfNeeded = async () => {
    if (
      mockMode ||
      deps.confirmVariantPrices !== true ||
      readiness.bypassed.length === 0 ||
      isVariantPriceConfirmed(draft.raw_capture)
    ) {
      return;
    }
    await persistVariantPriceConfirmation(
      serviceSupabase,
      id,
      draft.raw_capture,
      deps.confirmedBy ?? null
    );
  };

  // Normal re-publish after an intentional unpublish reuses the same Shopify product.
  if (!mockMode && draft.status === "draft_created" && isRealShopifyProductId(existingProductId)) {
    await persistConfirmationIfNeeded();
    return republishExistingDraft(serviceSupabase, id, draft, publishMode, caller);
  }

  // Dry run: live would take the republish path for this draft, so the status gate
  // (which only knows about first-time publishes) must not reject it.
  const mockWouldRepublish =
    mockMode && draft.status === "draft_created" && isRealShopifyProductId(existingProductId);
  const publishableStatuses = ["approved", "ready_for_review", "api_failed"];
  const allowed = publishableStatuses.includes(draft.status) || draft.pipeline_stage === "ready";
  if (!allowed && !mockWouldRepublish) {
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
      // PUBLISH-BATCH: Shopify is already live. In active mode that is the outcome the
      // operator wanted, so repair the local state (no content re-sync). A draft-mode
      // publish must never silently turn into an active listing.
      if (publishMode === "active") {
        const reconciled = await reconcileDraftWithShopify(serviceSupabase, id, caller);
        if (reconciled.reconciled) {
          return {
            ok: true,
            productId: existingProductId,
            adminUrl: reconciled.adminUrl ?? shopifyAdminUrl(existingProductId),
            code: RECONCILED_CODE,
            message: RECONCILED_MESSAGE,
            ...(reconciled.warnings?.length ? { warnings: reconciled.warnings } : {})
          };
        }
        return {
          ok: false,
          status: 502,
          error: `Existing Shopify product ${existingProductId} is ACTIVE but reconciliation failed: ${reconciled.message}`
        };
      }
      return {
        ok: false,
        status: 409,
        error: `Existing Shopify product ${existingProductId} is ACTIVE while local state is api_failed; a draft-mode publish will not change it. Use 正式上架 or 對帳 in the publish records. Manual reconciliation required.`
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
  } else if (
    isRealShopifyProductId(existingProductId) &&
    // Dry run cannot reconcile with Shopify; republish / api_failed linkage only gets a note.
    !(mockMode && (draft.status === "draft_created" || draft.status === "api_failed"))
  ) {
    // Any other real linkage is not a create candidate.
    return {
      ok: false,
      status: 409,
      error: `Draft already has Shopify product ${existingProductId}; direct productCreate is blocked for idempotency.`
    };
  }

  // R3: publish-time image preparation stays in the existing lifecycle.
  // Mock mode skips it entirely: it can upload to Shopify Files and writes image rows.
  let draftForPayload = draft;
  if (!mockMode) {
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
    draftForPayload = draftFresh ?? draft;
  }

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

  if (mockMode) {
    const mockNotes = ["模擬模式：未執行發布前圖片處理（不上傳 Shopify Files）"];
    if (isRealShopifyProductId(existingProductId)) {
      mockNotes.push(
        draft.status === "draft_created"
          ? `此草稿已有 Shopify 商品 ${existingProductId}：正式站會直接重新上架這個商品，不會另外建立新商品`
          : `此草稿已有 Shopify 商品 ${existingProductId}：正式站會先與 Shopify 對帳並沿用這個商品，不會另外建立新商品`
      );
    }
    if (readiness.bypassed.length > 0) {
      mockNotes.push("款式價確認已通過；模擬模式不會把確認記錄寫入草稿");
    }
    mockNotes.push("模擬模式：沒有寫入 Shopify、沒有改變草稿狀態、沒有送出通知");
    return { ok: true, mock: true, payload, productId: null, adminUrl: null, mockNotes };
  }

  await persistConfirmationIfNeeded();
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

  if (!hasShopifyAdminCredentials() && !deps.callGraphQL) {
    const message =
      "已關閉模擬發布（SHOPIFY_PUBLISH_MOCK=false），但缺少 Shopify 憑證。請設定 SHOPIFY_STORE_DOMAIN、SHOPIFY_CLIENT_ID、SHOPIFY_CLIENT_SECRET 後重試。";
    await insertPublishJob(serviceSupabase, publishJobBase, "api_failed", { error: message, mock: false }, message);
    await markDraftFailed(serviceSupabase, id, message);
    await notifyMake("api_failed", { draftId: id, error: message });
    return { ok: false, status: 503, error: message };
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
  // PUBLISH-RETRY: variants already on the resumed Shopify DRAFT (null on a fresh create).
  let resumeRemoteVariants: ResumeRemoteVariant[] | null = null;

  if (resumeExistingDraftId) {
    const resumeQuery = `
      query ResumeShopifyDraftVariant($id: ID!) {
        product(id: $id) {
          id status
          variants(first: 100) {
            pageInfo { hasNextPage }
            nodes { id title sku selectedOptions { name value } }
          }
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
    const remoteVariantConnection = remoteProduct?.variants;
    if (remoteVariantConnection?.pageInfo?.hasNextPage === true) {
      const message =
        "Shopify 草稿上的款式超過 100 個，無法安全對帳，已停止重試（沒有修改任何款式）。請到 Shopify 後台確認款式後再處理。";
      await markDraftFailed(serviceSupabase, id, message, resumeExistingDraftId);
      return { ok: false, status: 409, error: message };
    }
    if (!Array.isArray(remoteVariantConnection?.nodes)) {
      const message = "Shopify 草稿的款式清單無法讀取，已停止重試（沒有修改任何款式）。";
      await markDraftFailed(serviceSupabase, id, message, resumeExistingDraftId);
      return { ok: false, status: 409, error: message };
    }
    productId = resumeExistingDraftId;
    resumeRemoteVariants = (remoteVariantConnection.nodes as any[]).map((node) => ({
      id: String(node?.id),
      title: typeof node?.title === "string" ? node.title : null,
      sku: typeof node?.sku === "string" ? node.sku : null,
      selectedOptions: Array.isArray(node?.selectedOptions)
        ? (node.selectedOptions as any[]).map((option) => ({
            name: String(option?.name ?? ""),
            value: String(option?.value ?? "")
          }))
        : []
    }));
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
  const resumeWarnings: string[] = [];
  const RESUME_INVENTORY_WARNING = "重試沿用 Shopify 草稿上既有的庫存數量，請到 Shopify 後台確認庫存。";
  const variantPlan = payload.variantPlan as ({ mode: string } & Partial<MultiVariantPublishPlan>) | undefined;
  const isMulti = variantPlan?.mode === "multi" && variantPlan.initial && variantPlan.all;

  if (isMulti) {
    const multi = variantPlan as MultiVariantPublishPlan;
    // PUBLISH-RETRY: on resume the variants may already exist on Shopify, so only
    // the missing ones are created and existing ones never get a quantity adjustment.
    const resumePlan = resumeRemoteVariants ? planResumeVariantSync(multi.all, resumeRemoteVariants) : null;
    if (resumePlan) {
      if (resumePlan.extraRemote.length > 0) {
        const titles = resumePlan.extraRemote
          .map(
            (variant) =>
              variant.title?.trim() ||
              variant.selectedOptions.map((option) => option.value).join("／") ||
              variant.id
          )
          .join("、");
        return failAfterCreate(
          `Shopify 草稿上有 Nestory 沒有的款式：${titles}。為避免誤刪，請到 Shopify 後台刪除這些款式（或刪除整個草稿）後再重試。`,
          { productId, extraRemoteVariantIds: resumePlan.extraRemote.map((variant) => variant.id) }
        );
      }
      if (resumePlan.matched.length === 0) {
        return failAfterCreate("Shopify 草稿上沒有任何款式可供對帳，請到 Shopify 後台確認商品後再重試。", {
          productId
        });
      }
      if (
        resumePlan.matched.some(
          ({ seed }) => seed.inventoryPolicy === "DENY" && Number.isInteger(seed.inventoryQuantity)
        )
      ) {
        resumeWarnings.push(RESUME_INVENTORY_WARNING);
      }
    }
    const needsLocation = (resumePlan ? resumePlan.missing : multi.all).some(
      (seed) => seed.inventoryPolicy === "DENY" && Number.isInteger(seed.inventoryQuantity)
    );
    const inventoryLocationId = needsLocation ? await getShopifyInventoryLocationId(caller) : null;
    if (needsLocation && !inventoryLocationId) {
      return failAfterCreate(
        "有限庫存發布需要 Shopify location ID；請設定 SHOPIFY_LOCATION_ID，或確認 Shopify Admin API 可讀取 locations。",
        null
      );
    }
    if (!resumePlan && !defaultVariantId) {
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
        variants: resumePlan
          ? resumePlan.matched.map(({ seed, variantId }) =>
              toBulkVariantInput(seed, {
                includeOptionValues: false,
                locationId: null,
                inventoryMode: "update",
                variantId
              })
            )
          : [
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
          `商品已建立但${resumePlan ? "既有" : "初始"}款式價格同步失敗：${stringifyError(updateErrors?.length ? updateErrors : updateResult)}`,
          updateResult
        );
      }

      const seedsToCreate = resumePlan ? resumePlan.missing : multi.additional;
      if (seedsToCreate.length > 0) {
        const { response: bulkCreateResponse, result: bulkCreateResult } = await caller(bulkCreateMutation, {
          productId,
          strategy: "DEFAULT",
          variants: seedsToCreate.map((seed) =>
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
            `商品已建立且${resumePlan ? "既有" : "第一個"}款式已更新，但${resumePlan ? "缺少" : "其餘"}款式 productVariantsBulkCreate 失敗：${stringifyError(
              bulkErrors?.length ? bulkErrors : bulkCreateResult
            )}`,
            bulkCreateResult
          );
        }
      }
    } catch (variantError) {
      return failAfterCreate(`商品已建立但多款式同步失敗：${stringifyError(variantError)}`, null);
    }
  } else if (defaultVariantId || resumeRemoteVariants) {
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

    // PUBLISH-RETRY: on resume the single variant already exists on Shopify and its
    // quantity may already be applied, so it is updated without quantityAdjustments.
    if (resumeRemoteVariants) {
      if (resumeRemoteVariants.length > 1) {
        return failAfterCreate(
          `Shopify 草稿上有 ${resumeRemoteVariants.length} 個款式，但 Nestory 目前是單一款式商品。為避免誤刪，請到 Shopify 後台刪除多餘款式（或刪除整個草稿）後再重試。`,
          { productId, remoteVariantIds: resumeRemoteVariants.map((variant) => variant.id) }
        );
      }
      const singlePlan = planResumeVariantSync(
        [
          {
            optionValues: [],
            price: seed.price,
            compareAtPrice: seed.compareAtPrice ?? null,
            cost: seed.cost,
            sku: seed.sku ?? null,
            inventoryQuantity: seed.inventoryQuantity,
            inventoryPolicy: seed.inventoryPolicy,
            imageId: null
          }
        ],
        resumeRemoteVariants
      );
      if (singlePlan.matched.length === 0) {
        return failAfterCreate("Shopify 草稿上找不到可更新的款式，請到 Shopify 後台確認商品後再重試。", {
          productId
        });
      }
      defaultVariantId = singlePlan.matched[0].variantId;
      if (hasFiniteInventory) resumeWarnings.push(RESUME_INVENTORY_WARNING);
    }
    const writesInventory = hasFiniteInventory && !resumeRemoteVariants;
    const inventoryLocationId = writesInventory ? await getShopifyInventoryLocationId(caller) : null;

    try {
      if (writesInventory && !inventoryLocationId) {
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
            ...(writesInventory && inventoryLocationId
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

  // ACTIVE is successful only after both Admin status promotion and
  // Online Store publication have been independently confirmed.
  const channelWarnings: string[] = [];
  if (publishMode === "active") {
    try {
      await setShopifyProductStatus(productId, "ACTIVE", caller);
      const channels = await publishShopifyProductToOnlineStore(productId, caller);
      channelWarnings.push(...channels.warnings);
    } catch (activateError) {
      let rollbackNote = "";
      try {
        await setShopifyProductStatus(productId, "DRAFT", caller);
      } catch (rollbackError) {
        rollbackNote = `; DRAFT rollback could not be confirmed: ${stringifyError(rollbackError)}; manual reconciliation required`;
      }
      return failAfterCreate(
        `Shopify ACTIVE/Online Store publication failed after staged sync for ${productId}: ${stringifyError(activateError)}${rollbackNote}`,
        { activationError: stringifyError(activateError), rollbackNote }
      );
    }
  }

  const publishWarnings = [
    ...(priceSyncWarning ? [priceSyncWarning] : []),
    ...resumeWarnings,
    ...videoWarnings,
    ...channelWarnings
  ];
  const finalStatus = publishMode === "active" ? "active_published" : "draft_created";
  await insertPublishJob(
    serviceSupabase,
    publishJobBase,
    finalStatus,
    publishWarnings.length
      ? {
          ...createResult,
          warning: priceSyncWarning ?? undefined,
          resumeWarnings: resumeWarnings.length ? resumeWarnings : undefined,
          videoWarnings: videoWarnings.length ? videoWarnings : undefined
        }
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
  return {
    ok: true,
    productId,
    adminUrl: shopifyAdminUrl(productId),
    ...(channelWarnings.length ? { warnings: channelWarnings } : {})
  };
}
