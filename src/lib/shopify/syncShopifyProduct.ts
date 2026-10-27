import { createHash } from "node:crypto";
import { mergeInternalLinkMap, type InternalLinkMap } from "@/lib/contentGenerator/internalLinks";
import { buildShopifyProductPayload, isShopifyProductMediaImage } from "@/lib/shopify/payload";
import { callShopifyAdminGraphQL } from "@/lib/shopify/adminGraphQL";
import { describeHtmlDifference, normalizeShopifyHtml } from "@/lib/shopify/htmlNormalize";
import {
  ADD_PRODUCT_MEDIA_MUTATION,
  CREATE_PRODUCT_VARIANTS_MUTATION,
  DELETE_PRODUCT_VARIANTS_MUTATION,
  DELETE_PRODUCT_METAFIELDS_MUTATION,
  PRODUCT_SYNC_INVENTORY_QUERY,
  PRODUCT_SYNC_SNAPSHOT_QUERY,
  SYNC_PRODUCT_CORE_MUTATION,
  SYNC_PRODUCT_VARIANTS_MUTATION,
  UPDATE_PRODUCT_FILES_MUTATION,
  type ShopifySyncSnapshot
} from "@/lib/shopify/fullSyncGraphQL";
import {
  blockingRows,
  buildBaselineFromSnapshot,
  computeReconcileRows,
  shopifyValuesFromSnapshot,
  toolValuesFromDesired
} from "@/lib/shopify/reconcileFields";
import { checkLiveTestGuard } from "@/lib/shopify/liveTestGuard";
import { isDescriptionEmbedEnabled } from "@/lib/contentGenerator/descriptionEmbed";
import { firstShopifyImageUrl } from "@/lib/contentGenerator/descriptionDetailImages";
import { isDescriptionDetailImagesEnabled } from "@/lib/images/detailCompose/flags";
import {
  applyDescriptionImageCdnUrls,
  uploadDescriptionImagesToShopifyFiles
} from "@/lib/images/uploadDescriptionImages";
import { videoIdentityKey } from "@/lib/media/videoUrls";
import {
  isRealShopifyProductId,
  type ShopifyAdminGraphQLCaller
} from "@/lib/shopify/productLifecycle";
import {
  buildVariantPublishPlan,
  findDuplicateProductVariantRows,
  toBulkVariantInput,
  type MultiVariantPublishPlan,
  type VariantPublishPlan
} from "@/lib/variants/shopifyVariants";
import type { ShopifyVariantSeed } from "@/lib/variants/types";
import type { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { ProductImage, ProductVariantRow, ShopifySyncBaseline } from "@/types/domain";

export const ...[truncated]eq("id", draftId);
  return error?.message ?? null;
}

async function createSyncJob(
  serviceSupabase: ServiceSupabase,
  input: {
    draftId: string;
    productId: string;
    createdBy: string | null;
    requestHash: string;
    requestPayload: unknown;
  }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await serviceSupabase
    .from("shopify_sync_jobs")
    .insert({
      draft_id: input.draftId,
      operation: "update",
      status: "processing",
      shopify_product_id: input.productId,
      request_hash: input.requestHash,
      request_payload: input.requestPayload,
      response_payload: {},
      created_by: input.createdBy,
      started_at: nowIso()
    })
    .select("id")
    .maybeSingle();
  if (error || !data?.id) {
    return { ok: false, error: error?.message ?? "Unable to create Shopify sync audit job" };
  }
  return { ok: true, id: data.id as string };
}

async function claimSyncing(
  serviceSupabase: ServiceSupabase,
  draftId: string
): Promise<{ ok: true } | { ok: false; error: string; busy: boolean }> {
  const { data, error } = await serviceSupabase
    .from("product_drafts")
    .update({ shopify_sync_status: "syncing", shopify_sync_error: null })
    .eq("id", draftId)
    .neq("shopify_sync_status", "syncing")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message, busy: false };
  if (!data?.id) {
    return { ok: false, error: "Another Shopify sync is already running", busy: true };
  }
  return { ok: true };
}

async function finishSyncJob(
  serviceSupabase: ServiceSupabase,
  jobId: string | null,
  status: "completed" | "failed" | "skipped",
  responsePayload: unknown,
  errorCode?: string,
  errorMessage?: string
): Promise<void> {
  if (!jobId) return;
  await serviceSupabase
    .from("shopify_sync_jobs")
    .update({
      status,
      response_payload: responsePayload,
      error_code: errorCode ?? null,
      error_message: ...[truncated]