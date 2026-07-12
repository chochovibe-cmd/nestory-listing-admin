import { notifyMake } from "@/lib/notifications/make";
import { buildShopifyProductPayload, shopifyAdminUrl } from "@/lib/shopify/payload";
import { hasShopifyAdminCredentials } from "@/lib/shopify/adminToken";
import { callShopifyAdminGraphQL } from "@/lib/shopify/adminGraphQL";
import { mergeInternalLinkMap } from "@/lib/contentGenerator/internalLinks";
import type { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { PublishMode } from "@/types/domain";

export type PublishDraftResult =
  | { ok: true; mock: true; payload: unknown }
  | { ok: true; mock?: false; productId: string; adminUrl: string | null }
  | { ok: false; status: number; error: string };

async function getShopifyInventoryLocationId(): Promise<string | null> {
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
    const { response, result } = await callShopifyAdminGraphQL<{
      data?: { locations?: { nodes?: { id: string; name?: string }[] } };
      errors?: unknown[];
    }>(locationQuery, {});

    if (!response.ok || result.errors?.length) return null;

    return result.data?.locations?.nodes?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

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

  // A21-3: team_settings-editable IP -> collection URL map (migration 017).
  // Fetched fresh at publish time (not generate time) so filling in the map
  // later still takes effect on drafts generated before it existed.
  const { data: linkSettingsRow } = await serviceSupabase
    .from("team_settings")
    .select("value")
    .eq("key", "internal_link_urls_by_ip")
    .maybeSingle();
  const internalLinkMap = mergeInternalLinkMap(
    (linkSettingsRow?.value as Record<string, string> | null) ?? null
  );

  const payload = buildShopifyProductPayload(draft, publishMode, internalLinkMap);
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
        product {
          id
          title
          status
          variants(first: 1) {
            nodes { id }
          }
        }
        userErrors { field message }
      }
    }
  `;

  // A1: token acquisition (the client_credentials exchange) can itself fail
  // (bad/expired credentials, network error) -- that needs the same
  // api_failed bookkeeping as a GraphQL-level error, not an unhandled throw.
  let response: Response;
  let result: {
    data?: {
      productCreate?: {
        product?: { id: string; variants?: { nodes?: { id: string }[] } } | null;
        userErrors?: { field: string; message: string }[];
      };
    };
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
  const defaultVariantId = result?.data?.productCreate?.product?.variants?.nodes?.[0]?.id;

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

  // A14 follow-up (2026-07-10): missing defaultVariantId used to fall through
  // this whole block silently -- product created, price left at $0, publish
  // still reported success with no trace of why. Now recorded as a visible
  // warning instead of disappearing.
  let priceSyncWarning: string | null = null;

  // A14 fix: productCreate's ProductInput has no price/cost/sku fields in
  // current Shopify API versions -- the auto-created default variant starts
  // at $0 until a separate mutation sets it. This was previously never
  // called at all, so every published draft silently kept its $0 price.
  if (defaultVariantId) {
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
    const inventoryLocationId = hasFiniteInventory ? await getShopifyInventoryLocationId() : null;

    type VariantUpdateResult = {
      data?: { productVariantsBulkUpdate?: { userErrors?: { field: string; message: string }[] } };
      errors?: unknown[];
    };

    let variantResult: VariantUpdateResult | null = null;
    let variantError: string | null = null;

    try {
      if (hasFiniteInventory && !inventoryLocationId) {
        throw new Error(
          "有限庫存發布需要 Shopify location ID；請設定 SHOPIFY_LOCATION_ID，或確認 Shopify Admin API 可讀取 locations。"
        );
      }

      const { response: variantResponse, result: vr } = await callShopifyAdminGraphQL<VariantUpdateResult>(
        variantMutation,
        {
          productId,
          variants: [
            {
              id: defaultVariantId,
              price: String(seed.price),
              ...(seed.compareAtPrice ? { compareAtPrice: String(seed.compareAtPrice) } : {}),
              inventoryPolicy: seed.inventoryPolicy,
              inventoryItem: { sku: seed.sku, cost: String(seed.cost), tracked: hasFiniteInventory },
              ...(hasFiniteInventory && inventoryLocationId
                ? { quantityAdjustments: [{ locationId: inventoryLocationId, adjustment: seed.inventoryQuantity, changeFromQuantity: 0 }] }
                : {}),
            },
          ],
        },
      );
      variantResult = vr;
      const variantErrors = variantResult?.data?.productVariantsBulkUpdate?.userErrors ?? variantResult?.errors;
      if (!variantResponse.ok || variantErrors?.length) {
        variantError = JSON.stringify(variantErrors?.length ? variantErrors : variantResult);
      }
    } catch (variantNetworkError) {
      variantError = variantNetworkError instanceof Error ? variantNetworkError.message : String(variantNetworkError);
    }

    if (variantError) {
      // The product genuinely exists in Shopify at this point (with a $0
      // variant) -- backfill the GID/admin link so a human can fix the price
      // by hand instead of losing track of the product entirely. Retrying
      // this publish would create a SECOND duplicate product (no
      // resume-only-the-variant path yet), so this is deliberately still
      // surfaced as api_failed rather than silently downgraded to a warning.
      const message = `商品已建立但價格同步失敗，請至 Shopify 後台手動確認價格：${variantError}`;
      await serviceSupabase.from("publish_jobs").insert({
        ...publishJobBase,
        publish_status: "api_failed",
        response_payload: variantResult ?? { error: variantError },
        error_message: message,
        completed_at: new Date().toISOString()
      });
      await serviceSupabase
        .from("product_drafts")
        .update({
          status: "api_failed",
          publish_status: "api_failed",
          shopify_product_id: productId,
          shopify_admin_url: shopifyAdminUrl(productId),
          error_message: message
        })
        .eq("id", id);
      await notifyMake("api_failed", { draftId: id, error: message, shopifyProductId: productId });
      return { ok: false, status: 502, error: message };
    }
  } else {
    priceSyncWarning = "Shopify 未回傳預設款式 ID，價格／成本未同步，請至 Shopify 後台手動確認並設定價格。";
  }

  await serviceSupabase.from("publish_jobs").insert({
    ...publishJobBase,
    publish_status: publishMode === "active" ? "active_published" : "draft_created",
    response_payload: priceSyncWarning ? { ...result, warning: priceSyncWarning } : result,
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
      published_at: new Date().toISOString(), // A13: publish-stage timestamp
      ...(priceSyncWarning ? { warnings: [...(draft.warnings ?? []), priceSyncWarning] } : {})
    })
    .eq("id", id);

  await notifyMake(publishMode === "active" ? "active_published" : "draft_created", {
    draftId: id,
    shopifyProductId: productId,
    shopifyAdminUrl: shopifyAdminUrl(productId)
  });

  return { ok: true, productId, adminUrl: shopifyAdminUrl(productId) };
}
