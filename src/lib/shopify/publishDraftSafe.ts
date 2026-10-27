import { notifyMake } from "@/lib/notifications/make";
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import { prepareImagesForPublish } from "@/lib/images/prepareImagesForPublish";
import { isDescriptionEmbedEnabled } from "@/lib/contentGenerator/descriptionEmbed";
import { isDescriptionDetailImagesEnabled } from "@/lib/images/detailCompose/flags";
import { uploadDescriptionImagesToShopifyFiles } from "@/lib/images/uploadDescriptionImages";
import {
  hasUnconfirmedPlaceholderCny,
  MISSING_COST_BLOCK_MESSAGE,
} from "@/lib/import/captureTypes";
import {
  buildShopifyProductPayload,
  isShopifyProductMediaImage,
  shopifyAdminUrl
} from "@/lib/shopify/payload";
import { hashSource } from "@/lib/shopify/syncShopifyProduct";
import { captureShopifySyncBaseline } from "@/lib/shopify/shopifyDiff";
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
import { bindVariantMedia, type LocalImageRef } from "@/lib/shopify/variantMediaBind";
import { persistAssignedVariantSkus } from "@/lib/shopify/persistVariantSkus";
import { assignVariantSkus, deri...[truncated]  await persistVariantPriceConfirmation(
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
  let resumeExistingMediaNodes: Array<{ id?: unknown; mediaContentType?: unknown }> = [];

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
      // operator wanted, ...[truncated]n have been independently confirmed.
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
    ...mediaIdWarnings,
    ...mediaBindWarnings,
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
    const message = `Shopify lifecycle completed for ${productId}, but final local state persistence failed: ${finalPersistError}; ma...[truncated]