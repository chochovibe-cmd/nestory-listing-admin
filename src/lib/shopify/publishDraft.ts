import { notifyMake } from "@/lib/notifications/make";
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import { prepareImagesForPublish } from "@/lib/images/prepareImagesForPublish";
import { buildShopifyProductPayload, shopifyAdminUrl } from "@/lib/shopify/payload";
import { hasShopifyAdminCredentials } from "@/lib/shopify/adminToken";
import { callShopifyAdminGraphQL } from "@/lib/shopify/adminGraphQL";
import { mergeInternalLinkMap } from "@/lib/contentGenerator/internalLinks";
import {
  findDuplicateProductVariantRows,
  toBulkVariantInput,
  type MultiVariantPublishPlan
} from "@/lib/variants/shopifyVariants";
import type { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { ProductVariantRow, PublishMode } from "@/types/domain";

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

  // R3: station③ ready (status usually approved) + legacy paths.
  const publishableStatuses = ["approved", "ready_for_review", "api_failed", "publishing"];
  const allowed =
    publishableStatuses.includes(draft.status) || draft.pipeline_stage === "ready";
  if (!allowed) {
    return { ok: false, status: 409, error: `Draft status ${draft.status} cannot be published` };
  }

  // R3: sharp → finalize at publish time (no longer at station② all-keep).
  const prep = await prepareImagesForPublish({ serviceSupabase, draftId: id });
  if (prep.warnings.length) {
    const merged = [
      ...(Array.isArray(draft.warnings) ? draft.warnings : []),
      ...prep.warnings.map((w) => `發布前圖處理：${w}`)
    ].slice(-30);
    await serviceSupabase
      .from("product_drafts")
      .update({ warnings: merged })
      .eq("id", id);
  }

  // Re-load images after prepare so payload uses CDN URLs when available.
  const { data: draftFresh } = await serviceSupabase
    .from("product_drafts")
    .select("*, product_images(*)")
    .eq("id", id)
    .single();
  const draftForPayload = draftFresh ?? draft;

  // B7: load product_variants (publish previously ignored this table).
  const { data: variantRows } = await serviceSupabase
    .from("product_variants")
    .select("*")
    .eq("draft_id", id)
    .order("sort_order", { ascending: true });
  const typedVariantRows = (variantRows ?? []) as ProductVariantRow[];

  // P0-2: hard server-side guard for legacy/manual duplicate combinations.
  // This runs before payload creation and before status changes to publishing,
  // so mock/live publish can never report success for an invalid duplicate set.
  const duplicateVariantRows = findDuplicateProductVariantRows(typedVariantRows);
  if (duplicateVariantRows.length > 0) {
    return {
      ok: false,
      status: 409,
      error: `款式組合重複（${duplicateVariantRows.length} 列）— 請回到商品卡修正重複規格後再發布`
    };
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

  const payload = buildShopifyProductPayload(
    {
      ...draftForPayload,
      product_variants: typedVariantRows
    },
    publishMode,
    internalLinkMap
  );
  await serviceSupabase
    .from("product_drafts")
    .update({
      status: "publishing",
      pipeline_stage: mapStatusToPipelineStage("publishing"),
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

  // UX-B4-P05: only exact "false" is live; anything else (unset / true) = safe mock.
  const mockMode = process.env.SHOPIFY_PUBLISH_MOCK !== "false";

  // D10: non-YouTube video_urls skipped at payload build → yellow warnings (do not block publish).
  const videoWarnings = Array.isArray(
    (payload as { videoWarnings?: string[] }).videoWarnings
  )
    ? ((payload as { videoWarnings?: string[] }).videoWarnings as string[])
    : [];

  // Live mode without credentials must fail honestly — never pretend success
  // with mock-product-id and a null admin URL (boss would think it went live).
  if (!mockMode && !hasShopifyAdminCredentials()) {
    const message =
      "已關閉模擬發布（SHOPIFY_PUBLISH_MOCK=false），但缺少 Shopify 憑證。請設定 SHOPIFY_STORE_DOMAIN、SHOPIFY_CLIENT_ID、SHOPIFY_CLIENT_SECRET 後重試。";
    await serviceSupabase.from("publish_jobs").insert({
      ...publishJobBase,
      publish_status: "api_failed",
      response_payload: { error: message, mock: false },
      error_message: message,
      completed_at: new Date().toISOString()
    });
    await serviceSupabase
      .from("product_drafts")
      .update({
        status: "api_failed",
        pipeline_stage: mapStatusToPipelineStage("api_failed"),
        publish_status: "api_failed",
        error_message: message
      })
      .eq("id", id);
    await notifyMake("api_failed", { draftId: id, error: message });
    return { ok: false, status: 503, error: message };
  }

  if (mockMode) {
    await serviceSupabase.from("publish_jobs").insert({
      ...publishJobBase,
      publish_status: publishMode === "active" ? "active_published" : "draft_created",
      response_payload: {
        mock: true,
        note: "SHOPIFY_PUBLISH_MOCK is enabled (safe simulation; no real Shopify product)",
        ...(videoWarnings.length ? { videoWarnings } : {})
      },
      completed_at: new Date().toISOString()
    });
    const mockStatus = publishMode === "active" ? "active_published" : "draft_created";
    await serviceSupabase
      .from("product_drafts")
      .update({
        status: mockStatus,
        pipeline_stage: mapStatusToPipelineStage(mockStatus),
        publish_status: mockStatus,
        shopify_product_id: "mock-product-id",
        shopify_admin_url: null,
        error_message: null,
        published_at: new Date().toISOString(), // A13: publish-stage timestamp
        ...(videoWarnings.length
          ? { warnings: [...(draft.warnings ?? []), ...videoWarnings] }
          : {})
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
          variants(first: 10) {
            nodes {
              id
              selectedOptions { name value }
            }
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
        product?: {
          id: string;
          variants?: {
            nodes?: {
              id: string;
              selectedOptions?: { name: string; value: string }[];
            }[];
          } | null;
        } | null;
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
      .update({
        status: "api_failed",
        pipeline_stage: mapStatusToPipelineStage("api_failed"),
        publish_status: "api_failed",
        error_message: message
      })
      .eq("id", id);
    await notifyMake("api_failed", { draftId: id, error: message });
    return { ok: false, status: 502, error: message };
  }

  const errors = result?.data?.productCreate?.userErrors ?? result.errors;
  const productId = result?.data?.productCreate?.product?.id ?? "";
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
      .update({
        status: "api_failed",
        pipeline_stage: mapStatusToPipelineStage("api_failed"),
        publish_status: "api_failed",
        error_message: message
      })
      .eq("id", id);
    await notifyMake("api_failed", { draftId: id, error: message });
    return { ok: false, status: 502, error: message };
  }

  // A14 follow-up (2026-07-10): missing defaultVariantId used to fall through
  // this whole block silently -- product created, price left at $0, publish
  // still reported success with no trace of why. Now recorded as a visible
  // warning instead of disappearing.
  let priceSyncWarning: string | null = null;

  const variantPlan = (
    payload as { variantPlan?: { mode: string } & Partial<MultiVariantPublishPlan> }
  ).variantPlan;
  const isMulti = variantPlan?.mode === "multi" && variantPlan.initial && variantPlan.all;

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

  async function failVariantSync(
    message: string,
    variantResult: unknown
  ): Promise<PublishDraftResult> {
    await serviceSupabase.from("publish_jobs").insert({
      ...publishJobBase,
      publish_status: "api_failed",
      response_payload: variantResult ?? { error: message },
      error_message: message,
      completed_at: new Date().toISOString()
    });
    await serviceSupabase
      .from("product_drafts")
      .update({
        status: "api_failed",
        pipeline_stage: mapStatusToPipelineStage("api_failed"),
        publish_status: "api_failed",
        shopify_product_id: productId,
        shopify_admin_url: shopifyAdminUrl(productId),
        error_message: message
      })
      .eq("id", id);
    await notifyMake("api_failed", { draftId: id, error: message, shopifyProductId: productId });
    return { ok: false, status: 502, error: message };
  }

  if (isMulti) {
    // B7 multi-variant path (official 2026-07):
    // 1) productCreate already ran with productOptions → one initial variant
    //    (first value of each option = our sort_order 0 row).
    // 2) productVariantsBulkUpdate that initial variant with price/inventory.
    // 3) productVariantsBulkCreate remaining rows with optionValues.optionName.
    const multi = variantPlan as MultiVariantPublishPlan;
    const needsLocation = multi.all.some(
      (s) => s.inventoryPolicy === "DENY" && Number.isInteger(s.inventoryQuantity)
    );
    const inventoryLocationId = needsLocation ? await getShopifyInventoryLocationId() : null;

    if (needsLocation && !inventoryLocationId) {
      return failVariantSync(
        "有限庫存發布需要 Shopify location ID；請設定 SHOPIFY_LOCATION_ID，或確認 Shopify Admin API 可讀取 locations。",
        null
      );
    }

    if (!defaultVariantId) {
      return failVariantSync(
        "商品已建立但 Shopify 未回傳初始款式 ID，多款式價格無法同步。",
        result
      );
    }

    const updateMutation = `
      mutation ProductVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id price compareAtPrice }
          userErrors { field message }
        }
      }
    `;
    const createMutation = `
      mutation ProductVariantsBulkCreate(
        $productId: ID!,
        $variants: [ProductVariantsBulkInput!]!,
        $strategy: ProductVariantsBulkCreateStrategy
      ) {
        productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: $strategy) {
          productVariants { id title }
          userErrors { field message }
        }
      }
    `;

    try {
      const { response: updateRes, result: updateResult } =
        await callShopifyAdminGraphQL<VariantMutationResult>(updateMutation, {
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
      const updateErrors =
        updateResult?.data?.productVariantsBulkUpdate?.userErrors ?? updateResult?.errors;
      if (!updateRes.ok || updateErrors?.length) {
        return failVariantSync(
          `商品已建立但初始款式價格同步失敗：${JSON.stringify(updateErrors?.length ? updateErrors : updateResult)}`,
          updateResult
        );
      }

      if (multi.additional.length > 0) {
        const { response: createRes, result: createResult } =
          await callShopifyAdminGraphQL<VariantMutationResult>(createMutation, {
            productId,
            // strategy default is fine; we already have a real option combo, not Default Title.
            // Documented enum kept explicit for auditability.
            strategy: "DEFAULT",
            variants: multi.additional.map((seed) =>
              toBulkVariantInput(seed, {
                includeOptionValues: true,
                locationId: inventoryLocationId,
                inventoryMode: "create"
              })
            )
          });
        const createErrors =
          createResult?.data?.productVariantsBulkCreate?.userErrors ?? createResult?.errors;
        if (!createRes.ok || createErrors?.length) {
          return failVariantSync(
            `商品已建立且第一個款式已更新，但其餘款式 productVariantsBulkCreate 失敗：${JSON.stringify(
              createErrors?.length ? createErrors : createResult
            )}`,
            createResult
          );
        }
      }
    } catch (variantNetworkError) {
      const msg =
        variantNetworkError instanceof Error
          ? variantNetworkError.message
          : String(variantNetworkError);
      return failVariantSync(`商品已建立但多款式同步失敗：${msg}`, null);
    }
  } else if (defaultVariantId) {
    // Single-SKU path (unchanged from A14 / B2).
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
    const hasFiniteInventory =
      seed.inventoryPolicy === "DENY" && Number.isInteger(seed.inventoryQuantity);
    const inventoryLocationId = hasFiniteInventory
      ? await getShopifyInventoryLocationId()
      : null;

    let variantResult: VariantMutationResult | null = null;
    let variantError: string | null = null;

    try {
      if (hasFiniteInventory && !inventoryLocationId) {
        throw new Error(
          "有限庫存發布需要 Shopify location ID；請設定 SHOPIFY_LOCATION_ID，或確認 Shopify Admin API 可讀取 locations。"
        );
      }

      const { response: variantResponse, result: vr } =
        await callShopifyAdminGraphQL<VariantMutationResult>(variantMutation, {
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
      variantResult = vr;
      const variantErrors =
        variantResult?.data?.productVariantsBulkUpdate?.userErrors ?? variantResult?.errors;
      if (!variantResponse.ok || variantErrors?.length) {
        variantError = JSON.stringify(variantErrors?.length ? variantErrors : variantResult);
      }
    } catch (variantNetworkError) {
      variantError =
        variantNetworkError instanceof Error
          ? variantNetworkError.message
          : String(variantNetworkError);
    }

    if (variantError) {
      return failVariantSync(
        `商品已建立但價格同步失敗，請至 Shopify 後台手動確認價格：${variantError}`,
        variantResult
      );
    }
  } else {
    priceSyncWarning =
      "Shopify 未回傳預設款式 ID，價格／成本未同步，請至 Shopify 後台手動確認並設定價格。";
  }

  const publishWarnings = [
    ...(priceSyncWarning ? [priceSyncWarning] : []),
    ...videoWarnings
  ];

  await serviceSupabase.from("publish_jobs").insert({
    ...publishJobBase,
    publish_status: publishMode === "active" ? "active_published" : "draft_created",
    response_payload: publishWarnings.length
      ? { ...result, warning: priceSyncWarning ?? undefined, videoWarnings: videoWarnings.length ? videoWarnings : undefined }
      : result,
    completed_at: new Date().toISOString()
  });
  const publishedStatus = publishMode === "active" ? "active_published" : "draft_created";
  await serviceSupabase
    .from("product_drafts")
    .update({
      status: publishedStatus,
      pipeline_stage: mapStatusToPipelineStage(publishedStatus),
      publish_status: publishedStatus,
      shopify_product_id: productId,
      shopify_admin_url: shopifyAdminUrl(productId),
      error_message: null,
      published_at: new Date().toISOString(), // A13: publish-stage timestamp
      ...(publishWarnings.length
        ? { warnings: [...(draft.warnings ?? []), ...publishWarnings] }
        : {})
    })
    .eq("id", id);

  await notifyMake(publishMode === "active" ? "active_published" : "draft_created", {
    draftId: id,
    shopifyProductId: productId,
    shopifyAdminUrl: shopifyAdminUrl(productId)
  });

  return { ok: true, productId, adminUrl: shopifyAdminUrl(productId) };
}
