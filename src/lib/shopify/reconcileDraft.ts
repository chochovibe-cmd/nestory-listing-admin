/**
 * PUBLISH-BATCH: reconcile a draft whose DB row says "failed" while Shopify
 * already has the product live (e.g. the boss activated it by hand, or a killed
 * run finished its Shopify work but never wrote the local result).
 *
 * Shopify side is READ-ONLY except one thing: when the product is ACTIVE this
 * may ADD missing sales-channel publications (Online Store / Google & YouTube required, POS optional).
 * It never removes a publication, never changes the status and never touches
 * product content. The local draft is then marked exactly like a successful
 * ACTIVE publish (see finishLocalSuccess in publishDraftSafe.ts).
 */
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import { shopifyAdminUrl } from "@/lib/shopify/payload";
import {
  ensureShopifyProductChannels,
  getShopifyProductStatus,
  isRealShopifyProductId,
  type ShopifyAdminGraphQLCaller
} from "@/lib/shopify/productLifecycle";
import type { createServiceSupabaseClient } from "@/lib/supabase/server";

type ServiceSupabase = ReturnType<typeof createServiceSupabaseClient>;

export const RECONCILED_CODE = "RECONCILED" as const;
export const RECONCILED_MESSAGE = "Shopify 已上架，已對帳（未重新同步內容）";

export type ReconcileOutcome =
  | "active_published"
  | "remote_draft"
  | "remote_missing"
  | "remote_other"
  | "no_product"
  | "not_applicable"
  | "error";

export type ReconcileResult = {
  reconciled: boolean;
  outcome: ReconcileOutcome;
  message: string;
  productId?: string | null;
  adminUrl?: string | null;
  remoteStatus?: string | null;
  /** Non-fatal notes (e.g. optional 銷售點 POS channel skipped). */
  warnings?: string[];
};

/** Draft statuses a reconcile may move to active_published. */
const RECONCILABLE_STATUSES = ["api_failed", "publishing"];

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function reconcileDraftWithShopify(
  serviceSupabase: ServiceSupabase,
  draftId: string,
  caller?: ShopifyAdminGraphQLCaller
): Promise<ReconcileResult> {
  const { data: draft, error } = await serviceSupabase
    .from("product_drafts")
    .select("id, status, shopify_product_id, shopify_admin_url, warnings")
    .eq("id", draftId)
    .maybeSingle();
  if (error || !draft) {
    return {
      reconciled: false,
      outcome: "error",
      message: error ? `讀取草稿失敗：${error.message}` : "找不到草稿"
    };
  }

  const productId = draft.shopify_product_id as string | null;
  if (!isRealShopifyProductId(productId)) {
    return {
      reconciled: false,
      outcome: "no_product",
      message: "此草稿沒有 Shopify 商品編號，無須對帳（可直接重試發布）",
      productId: null
    };
  }
  const adminUrl = (draft.shopify_admin_url as string | null) ?? shopifyAdminUrl(productId);

  if (draft.status === "active_published") {
    return {
      reconciled: true,
      outcome: "active_published",
      message: "草稿已是上架狀態，無須對帳",
      productId,
      adminUrl
    };
  }
  if (!RECONCILABLE_STATUSES.includes(draft.status as string)) {
    return {
      reconciled: false,
      outcome: "not_applicable",
      message: `草稿目前狀態 ${String(draft.status)}，不需要對帳`,
      productId,
      adminUrl
    };
  }

  let remote: Awaited<ReturnType<typeof getShopifyProductStatus>>;
  try {
    remote = await getShopifyProductStatus(productId, caller);
  } catch (e) {
    return {
      reconciled: false,
      outcome: "error",
      message: `查詢 Shopify 商品失敗：${errText(e)}`,
      productId,
      adminUrl
    };
  }

  if (!remote) {
    return {
      reconciled: false,
      outcome: "remote_missing",
      message: "Shopify 上找不到這個商品，重試會重新建立",
      productId,
      adminUrl,
      remoteStatus: null
    };
  }
  if (remote.status === "DRAFT") {
    return {
      reconciled: false,
      outcome: "remote_draft",
      message: "Shopify 上是草稿狀態，可按重試續傳",
      productId,
      adminUrl,
      remoteStatus: "DRAFT"
    };
  }
  if (remote.status !== "ACTIVE") {
    return {
      reconciled: false,
      outcome: "remote_other",
      message: `Shopify 商品狀態為 ${remote.status}，未做任何變更，請到 Shopify 後台處理`,
      productId,
      adminUrl,
      remoteStatus: remote.status
    };
  }

  // Remote ACTIVE: the only Shopify write allowed here is ADDING missing channels.
  let channels: Awaited<ReturnType<typeof ensureShopifyProductChannels>>;
  try {
    channels = await ensureShopifyProductChannels(productId, caller);
  } catch (e) {
    return {
      reconciled: false,
      outcome: "error",
      message: `Shopify 商品已是 ACTIVE，但無法確認必要通路（線上商店／Google & YouTube）：${errText(e)}`,
      productId,
      adminUrl,
      remoteStatus: "ACTIVE"
    };
  }

  const warnings = channels.warnings;
  const noteWarnings = [RECONCILED_MESSAGE, ...warnings];
  const existingWarnings = Array.isArray(draft.warnings) ? (draft.warnings as unknown[]) : [];
  const { data: updated, error: updateError } = await serviceSupabase
    .from("product_drafts")
    .update({
      status: "active_published",
      pipeline_stage: mapStatusToPipelineStage("active_published"),
      publish_status: "active_published",
      publish_mode: "active",
      shopify_product_id: productId,
      shopify_admin_url: shopifyAdminUrl(productId),
      error_message: null,
      published_at: channels.publishedAt ?? new Date().toISOString(),
      warnings: [...existingWarnings, ...noteWarnings].slice(-30)
    })
    .eq("id", draftId)
    // Never overwrite a state that moved on while the Shopify calls were running.
    .in("status", RECONCILABLE_STATUSES)
    .select("id")
    .maybeSingle();
  if (updateError || !updated) {
    return {
      reconciled: false,
      outcome: "error",
      message: updateError
        ? `Shopify 已上架，但寫回本地狀態失敗：${updateError.message}`
        : "草稿狀態在對帳期間被改動，已停止寫回，請重新整理後再試",
      productId,
      adminUrl,
      remoteStatus: "ACTIVE",
      warnings
    };
  }

  return {
    reconciled: true,
    outcome: "active_published",
    message: RECONCILED_MESSAGE,
    productId,
    adminUrl: shopifyAdminUrl(productId),
    remoteStatus: "ACTIVE",
    warnings
  };
}
