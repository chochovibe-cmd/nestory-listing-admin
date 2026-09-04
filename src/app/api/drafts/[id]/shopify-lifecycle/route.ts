import { NextRequest } from "next/server";
import { canPublish } from "@/lib/auth/roles";
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import {
  createServerSupabaseClient,
  createServiceSupabaseClient
} from "@/lib/supabase/server";
import { checkLiveTestGuard } from "@/lib/shopify/liveTestGuard";
import {
  deleteShopifyProduct,
  isRealShopifyProductId,
  setShopifyProductStatus
} from "@/lib/shopify/productLifecycle";
import type { DraftStatus, ShopifySyncOperation, UserRole } from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 60;

type LifecycleAction = "archive" | "restore" | "delete";

function isLifecycleAction(value: unknown): value is LifecycleAction {
  return value === "archive" || value === "restore" || value === "delete";
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (!isLifecycleAction(body.action)) {
    return Response.json({ error: "Invalid Shopify lifecycle action" }, { status: 400 });
  }
  const action = body.action;
  if (body.confirmAction !== true) {
    return Response.json(
      { error: `Shopify ${action} requires explicit confirmAction=true` },
      { status: 400 }
    );
  }

  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await authSupabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { data: profile } = await authSupabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!canPublish(profile?.role as UserRole | undefined)) {
    return Response.json(
      { error: "Reviewer role is required for Shopify lifecycle actions" },
      { status: 403 }
    );
  }

  const guardError = checkLiveTestGuard({ draftIds: [id], operation: action });
  if (guardError) return Response.json({ error: guardError }, { status: 403 });

  const serviceSupabase = createServiceSupabaseClient();
  const { data: draft, error: draftError } = await serviceSupabase
    .from("product_drafts")
    .select(
      "id, title_zh, taobao_title, original_title, status, publish_status, shopify_product_id, shopify_admin_url, status_before_archive, shopify_sync_status"
    )
    .eq("id", id)
    .single();
  if (draftError || !draft) {
    return Response.json(
      { error: draftError?.message ?? "Draft not found" },
      { status: 404 }
    );
  }

  const productId = draft.shopify_product_id as string | null;
  const mockMode = process.env.SHOPIFY_PUBLISH_MOCK !== "false";
  const mockProduct = productId === "mock-product-id" && mockMode;
  if (!mockProduct && !isRealShopifyProductId(productId)) {
    return Response.json(
      { error: "Draft has no real Shopify product ID" },
      { status: 409 }
    );
  }

  const title = String(
    draft.title_zh || draft.taobao_title || draft.original_title || "未命名草稿"
  ).trim();
  if (action === "delete") {
    if (body.confirmPermanentDelete !== true || String(body.confirmTitle ?? "").trim() !== title) {
      return Response.json(
        {
          error:
            "Permanent Shopify delete requires confirmPermanentDelete=true and an exact product title"
        },
        { status: 400 }
      );
    }
    if (draft.shopify_sync_status === "remote_deleted") {
      return Response.json({
        ok: true,
        alreadyDeleted: true,
        action,
        productId,
        remoteStatus: "DELETED"
      });
    }
  }

  const { data: claimed, error: claimError } = await serviceSupabase
    .from("product_drafts")
    .update({ shopify_sync_status: "syncing", shopify_sync_error: null })
    .eq("id", id)
    .neq("shopify_sync_status", "syncing")
    .select("id")
    .maybeSingle();
  if (claimError) {
    return Response.json(
      {
        error: `Shopify full-sync migration is required before lifecycle actions: ${claimError.message}`
      },
      { status: 503 }
    );
  }
  if (!claimed?.id) {
    return Response.json(
      { error: "Another Shopify sync or lifecycle action is already running" },
      { status: 409 }
    );
  }

  const operation = action as ShopifySyncOperation;
  const startedAt = nowIso();
  const { data: job, error: jobError } = await serviceSupabase
    .from("shopify_sync_jobs")
    .insert({
      draft_id: id,
      operation,
      status: "processing",
      shopify_product_id: productId,
      request_payload: { action, productId },
      response_payload: {},
      created_by: user.id,
      started_at: startedAt
    })
    .select("id")
    .maybeSingle();
  if (jobError || !job?.id) {
    const errorMessage = jobError?.message ?? "Unable to create Shopify lifecycle audit job";
    await serviceSupabase
      .from("product_drafts")
      .update({ shopify_sync_status: "error", shopify_sync_error: errorMessage })
      .eq("id", id);
    return Response.json(
      {
        error: `Shopify lifecycle audit ledger is unavailable; no remote mutation was sent: ${errorMessage}`
      },
      { status: 503 }
    );
  }

  const fail = async (status: number, error: unknown, remoteCompleted = false) => {
    const rawErrorMessage = error instanceof Error ? error.message : String(error);
    const errorMessage = remoteCompleted
      ? `Shopify 遠端動作已完成，但本機保存失敗，需人工對帳：${rawErrorMessage}`
      : rawErrorMessage;
    await serviceSupabase
      .from("product_drafts")
      .update({
        shopify_sync_status: remoteCompleted ? "partial" : "error",
        shopify_sync_error: errorMessage
      })
      .eq("id", id);
    await serviceSupabase
      .from("shopify_sync_jobs")
      .update({
        status: "failed",
        error_message: errorMessage,
        response_payload: { error: errorMessage, remoteCompleted },
        completed_at: nowIso()
      })
      .eq("id", job.id);
    return Response.json(
      {
        error: errorMessage,
        code: remoteCompleted ? "manual_reconciliation_required" : "lifecycle_failed",
        remoteCompleted,
        productId
      },
      { status }
    );
  };

  try {
    let lifecycleUpdatedAt: string | null = null;
    if (!mockProduct) {
      if (action === "archive") {
        lifecycleUpdatedAt = (await setShopifyProductStatus(productId, "ARCHIVED")).updatedAt;
      } else if (action === "restore") {
        lifecycleUpdatedAt = (await setShopifyProductStatus(productId, "DRAFT")).updatedAt;
      }
      else await deleteShopifyProduct(productId);
    }

    let localPatch: Record<string, unknown>;
    if (action === "archive") {
      localPatch = {
        status: "archived",
        pipeline_stage: mapStatusToPipelineStage("archived"),
        status_before_archive: draft.status,
        archived_at: nowIso(),
        shopify_sync_status: "synced",
        shopify_synced_at: nowIso(),
        ...(lifecycleUpdatedAt ? { shopify_remote_updated_at: lifecycleUpdatedAt } : {}),
        shopify_sync_error: null
      };
    } else if (action === "restore") {
      const restoredStatus: DraftStatus = "draft_created";
      localPatch = {
        status: restoredStatus,
        pipeline_stage: mapStatusToPipelineStage(restoredStatus),
        publish_status: "draft_created",
        publish_mode: "draft",
        status_before_archive: null,
        archived_at: null,
        shopify_sync_status: "synced",
        shopify_synced_at: nowIso(),
        ...(lifecycleUpdatedAt ? { shopify_remote_updated_at: lifecycleUpdatedAt } : {}),
        shopify_sync_error: null
      };
    } else {
      localPatch = {
        status: "archived",
        pipeline_stage: mapStatusToPipelineStage("archived"),
        status_before_archive: draft.status,
        archived_at: nowIso(),
        shopify_sync_status: "remote_deleted",
        shopify_synced_at: nowIso(),
        shopify_sync_error: null
        // Keep shopify_product_id/admin URL as immutable audit evidence.
      };
    }
    const { error: persistError } = await serviceSupabase
      .from("product_drafts")
      .update(localPatch)
      .eq("id", id);
    if (persistError) {
      return fail(
        500,
        `Shopify ${action} completed, but local persistence failed: ${persistError.message}`,
        true
      );
    }
    await serviceSupabase
      .from("shopify_sync_jobs")
      .update({
        status: "completed",
        response_payload: {
          productId,
          remoteStatus:
            action === "archive" ? "ARCHIVED" : action === "restore" ? "DRAFT" : "DELETED",
          mock: mockProduct
        },
        completed_at: nowIso()
      })
      .eq("id", job.id);
    return Response.json({
      ok: true,
      action,
      productId,
      remoteStatus:
        action === "archive" ? "ARCHIVED" : action === "restore" ? "DRAFT" : "DELETED",
      mock: mockProduct
    });
  } catch (error) {
    return fail(502, error);
  }
}
