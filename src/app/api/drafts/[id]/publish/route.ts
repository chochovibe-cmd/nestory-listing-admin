import { NextRequest } from "next/server";
import { notifyMake } from "@/lib/notifications/make";
import { buildShopifyProductPayload, shopifyAdminUrl } from "@/lib/shopify/payload";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import type { PublishMode } from "@/types/domain";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const publishMode = (body.publishMode ?? "active") as PublishMode;

  if (!["active", "draft"].includes(publishMode)) {
    return Response.json({ error: "Invalid publishMode" }, { status: 400 });
  }

  if (publishMode === "active" && body.confirmActive !== true) {
    return Response.json({ error: "ACTIVE publish requires explicit confirmActive=true" }, { status: 400 });
  }

  const authSupabase = await createServerSupabaseClient();
  const { data: { user } } = await authSupabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await authSupabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["admin", "reviewer"].includes(profile.role)) {
    return Response.json({ error: "Reviewer role is required to publish" }, { status: 403 });
  }

  const serviceSupabase = createServiceSupabaseClient();
  const { data: draft, error } = await serviceSupabase
    .from("product_drafts")
    .select("*, product_images(*)")
    .eq("id", id)
    .single();

  if (error || !draft) {
    return Response.json({ error: error?.message ?? "Draft not found" }, { status: 404 });
  }

  if (!["approved", "ready_for_review", "api_failed"].includes(draft.status)) {
    return Response.json({ error: `Draft status ${draft.status} cannot be published` }, { status: 409 });
  }

  const payload = buildShopifyProductPayload(draft, publishMode);
  await serviceSupabase
    .from("product_drafts")
    .update({ status: "publishing", publish_status: "publishing", publish_mode: publishMode })
    .eq("id", id);

  const publishJobBase = {
    draft_id: id,
    publish_mode: publishMode,
    publish_method: "shopify_api",
    publish_status: "publishing",
    request_payload: payload
  };

  const mockMode = process.env.SHOPIFY_PUBLISH_MOCK !== "false";
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const apiVersion = process.env.SHOPIFY_API_VERSION || "2026-04";

  if (mockMode || !token || !domain) {
    await serviceSupabase.from("publish_jobs").insert({
      ...publishJobBase,
      publish_status: publishMode === "active" ? "active_published" : "draft_created",
      response_payload: {
        mock: true,
        note: "SHOPIFY_PUBLISH_MOCK is enabled or Shopify credentials are missing"
      },
      completed_at: new Date().toISOString()
    });
    await serviceSupabase
      .from("product_drafts")
      .update({
        status: publishMode === "active" ? "active_published" : "draft_created",
        publish_status: publishMode === "active" ? "active_published" : "draft_created",
        shopify_product_id: "mock-product-id",
        shopify_admin_url: null,
        error_message: null
      })
      .eq("id", id);

    await notifyMake(publishMode === "active" ? "active_published" : "draft_created", { draftId: id, mock: true });
    return Response.json({ ok: true, mock: true, payload });
  }

  const mutation = `
    mutation ProductCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
      productCreate(product: $product, media: $media) {
        product { id title status }
        userErrors { field message }
      }
    }
  `;

  const response = await fetch(`https://${domain}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({
      query: mutation,
      variables: {
        product: payload.product,
        media: payload.media
      }
    })
  });

  const result = await response.json();
  const errors = result?.data?.productCreate?.userErrors ?? result.errors;

  if (!response.ok || errors?.length) {
    const message = JSON.stringify(errors ?? result);
    await serviceSupabase.from("publish_jobs").insert({
      ...publishJobBase,
      publish_status: "api_failed",
      response_payload: result,
      error_message: message,
      completed_at: new Date().toISOString()
    });
    await serviceSupabase
      .from("product_drafts")
      .update({ status: "api_failed", publish_status: "api_failed", error_message: message })
      .eq("id", id);
    await notifyMake("api_failed", { draftId: id, error: message });
    return Response.json({ error: message, payload }, { status: 502 });
  }

  const productId = result.data.productCreate.product.id;
  await serviceSupabase.from("publish_jobs").insert({
    ...publishJobBase,
    publish_status: publishMode === "active" ? "active_published" : "draft_created",
    response_payload: result,
    completed_at: new Date().toISOString()
  });
  await serviceSupabase
    .from("product_drafts")
    .update({
      status: publishMode === "active" ? "active_published" : "draft_created",
      publish_status: publishMode === "active" ? "active_published" : "draft_created",
      shopify_product_id: productId,
      shopify_admin_url: shopifyAdminUrl(productId),
      error_message: null
    })
    .eq("id", id);

  await notifyMake(publishMode === "active" ? "active_published" : "draft_created", {
    draftId: id,
    shopifyProductId: productId,
    shopifyAdminUrl: shopifyAdminUrl(productId)
  });

  return Response.json({ ok: true, productId, adminUrl: shopifyAdminUrl(productId) });
}
