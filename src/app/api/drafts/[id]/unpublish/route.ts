import { NextRequest } from "next/server";
import { canPublish } from "@/lib/auth/roles";
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import {
  isRealShopifyProductId,
  setShopifyProductStatus
} from "@/lib/shopify/productLifecycle";
import {
  createServerSupabaseClient,
  createServiceSupabaseClient
} from "@/lib/supabase/server";
import type { UserRole } from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (body.confirmUnpublish !== true) {
    return Response.json(
      { error: "Unpublish requires explicit confirmUnpublish=true" },
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
      { error: "Reviewer role is required to unpublish" },
      { status: 403 }
    );
  }

  const serviceSupabase = createServiceSupabaseClient();
  const { data: draft, error } = await serviceSupabase
    .from("product_drafts")
    .select(
      "id, status, publish_status, publish_mode, pipeline_stage, shopify_product_id, shopify_admin_url, published_at"
    )
    .eq("id", id)
    .single();
  if (error || !draft) {
    return Response.json(
      { error: error?.message ?? "Draft not found" },
      { status: 404 }
    );
  }

  const productId = draft.shopify_product_id as string | null;
  if (draft.status === "draft_created" || draft.publish_status === "draft_created") {
    return Response.json({
      ok: true,
      alreadyUnpublished: true,
      productId,
      status: "draft_created"
    });
  }

  if (!productId) {
    return Response.json(
      { error: "Draft has no Shopify product ID; unpublish cannot continue" },
      { status: 409 }
    );
  }

  const isActive =
    draft.status === "active_published" || draft.publish_status === "active_published";
  if (!isActive) {
    return Response.json(
      { error: `Draft state ${draft.status} is not an active Shopify publish state` },
      { status: 409 }
    );
  }

  const mockMode = process.env.SHOPIFY_PUBLISH_MOCK !== "false";
  if (productId === "mock-product-id") {
    if (!mockMode) {
      return Response.json(
        { error: "mock-product-id cannot be sent to live Shopify lifecycle mutations" },
        { status: 409 }
      );
    }
  } else if (!isRealShopifyProductId(productId)) {
    return Response.json({ error: "Invalid Shopify product ID" }, { status: 409 });
  } else {
    try {
      await setShopifyProductStatus(productId, "DRAFT");
    } catch (lifecycleError) {
      return Response.json(
        {
          error: `Shopify unpublish failed for ${productId}: ${
            lifecycleError instanceof Error ? lifecycleError.message : String(lifecycleError)
          }`
        },
        { status: 502 }
      );
    }
  }

  const { error: updateError } = await serviceSupabase
    .from("product_drafts")
    .update({
      status: "draft_created",
      publish_status: "draft_created",
      publish_mode: "draft",
      pipeline_stage: mapStatusToPipelineStage("draft_created"),
      error_message: null
      // published_at intentionally preserved as lifecycle history.
      // shopify_product_id / shopify_admin_url intentionally preserved for re-publish.
    })
    .eq("id", id);

  if (updateError) {
    return Response.json(
      {
        error: `Shopify product ${productId} is DRAFT but local unpublish persistence failed: ${updateError.message}; manual reconciliation required.`,
        productId
      },
      { status: 500 }
    );
  }

  return Response.json({
    ok: true,
    productId,
    status: "draft_created",
    shopifyAdminUrl: draft.shopify_admin_url ?? null
  });
}
