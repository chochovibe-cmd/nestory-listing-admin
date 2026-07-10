import { notifyMake } from "@/lib/notifications/make";
import { buildShopifyProductPayload, shopifyAdminUrl } from "@/lib/shopify/payload";
import { hasShopifyAdminCredentials } from "@/lib/shopify/adminToken";
import { callShopifyAdminGraphQL } from "@/lib/shopify/adminGraphQL";
import type { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { PublishMode } from "@/types/domain";

export type PublishDraftResult =
  | { ok: true; mock: true; payload: unknown }
  | { ok: true; mock?: false; productId: string; adminUrl: string | null }
  | { ok: false; status: number; error: string };

// Shared by the single-draft publish route and the batch publish route so the
// Shopify GraphQL call / mock-safe fallback / publish_jobs bookkeeping only
// lives in one place. Callers are expected to have already done auth + role
// checks and publishMode/confirmActive validation.
export async function publishDraft(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  id: string,
  publishMode: PublishMode
): Promise<PublishDraftResult> {
  const { data: draft, error } = await serviceSupabase
    .from("product_drafts")
    .select("*, product_images(*)")
    .eq("id", id)
    .single();

  if (error || !draft) {
    return { ok: false, status: 404, error: error?.message ?? "Draft not found" };
  }

  if (!["approved", "ready_for_review", "api_failed"].includes(draft.status)) {
    return { ok: false, status: 409, error: `Draft status ${draft.status} cannot be published` };
  }

  const payload = buildShopifyProductPayload(draft, publishMode);
  await serviceSupabase
    .from("product_drafts")
    .update({
      status: "publishing",
      publish_status: "publishing",
      publish_mode: publishMode,
      shopify_payload_preview: payload
    })
    .eq("id", id);

  const publishJobBase = {
    draft_id: id,
    publish_mode: publishMode,
    publish_method: "shopify_api",
    publish_status: "publishing",
    request_payload: payload
  };

  const mockMode = process.env.SHOPIFY_PUBLISH_MOCK !== "false";

  if (mockMode || !hasShopifyAdminCredentials()) {
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
        error_message: null,
        published_at: new Date().toISOString() // A13: publish-stage timestamp
      })
      .eq("id", id);

    await notifyMake(publishMode === "active" ? "active_published" : "draft_created", { draftId: id, mock: true });
    return { ok: true, mock: true, payload };
  }

  const mutation = `
    mutation ProductCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
      productCreate(product: $product, media: $media) {
        product { id title status }
        userErrors { field message }
      }
    }
  `;

  // A1: token acquisition (the client_credentials exchange) can itself fail
  // (bad/expired credentials, network error) -- that needs the same
  // api_failed bookkeeping as a GraphQL-level error, not an unhandled throw.
  let response: Response;
  let result: {
    data?: { productCreate?: { product?: { id: string } | null; userErrors?: { field: string; message: string }[] } };
    errors?: unknown[];
  };
  try {
    ({ response, result } = await callShopifyAdminGraphQL(mutation, {
      product: payload.product,
      media: payload.media,
    }));
  } catch (tokenOrNetworkError) {
    const message = tokenOrNetworkError instanceof Error ? tokenOrNetworkError.message : String(tokenOrNetworkError);
    await serviceSupabase.from("publish_jobs").insert({
      ...publishJobBase,
      publish_status: "api_failed",
      response_payload: { error: message },
      error_message: message,
      completed_at: new Date().toISOString()
    });
    await serviceSupabase
      .from("product_drafts")
      .update({ status: "api_failed", publish_status: "api_failed", error_message: message })
      .eq("id", id);
    await notifyMake("api_failed", { draftId: id, error: message });
    return { ok: false, status: 502, error: message };
  }

  const errors = result?.data?.productCreate?.userErrors ?? result.errors;
  const productId = result?.data?.productCreate?.product?.id;

  if (!response.ok || errors?.length || !productId) {
    const message = JSON.stringify(errors?.length ? errors : result);
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
    return { ok: false, status: 502, error: message };
  }

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
      error_message: null,
      published_at: new Date().toISOString() // A13: publish-stage timestamp
    })
    .eq("id", id);

  await notifyMake(publishMode === "active" ? "active_published" : "draft_created", {
    draftId: id,
    shopifyProductId: productId,
    shopifyAdminUrl: shopifyAdminUrl(productId)
  });

  return { ok: true, productId, adminUrl: shopifyAdminUrl(productId) };
}
