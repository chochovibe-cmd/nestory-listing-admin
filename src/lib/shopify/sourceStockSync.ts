import { callShopifyAdminGraphQL } from "@/lib/shopify/adminGraphQL";
import type { ShopifyAdminGraphQLCaller } from "@/lib/shopify/productLifecycle";
import type { createServiceSupabaseClient } from "@/lib/supabase/server";
import {
  readShopifyStockMark,
  readSourceStock
} from "@/lib/variants/sourceStock";
import type { ShopifyStockMark } from "@/lib/variants/types";

type ServiceSupabase = ReturnType<typeof createServiceSupabaseClient>;

export const SOURCE_STOCK_QUERY = `
  query ProductSourceStock($id: ID!) {
    product(id: $id) {
      id
      variants(first: 100) {
        nodes {
          id inventoryPolicy
          inventoryItem {
            id tracked
            inventoryLevels(first: 20) {
              nodes { location { id name } quantities(names: ["available"]) { name quantity } }
            }
          }
        }
      }
    }
  }
`;

export const SOURCE_STOCK_MUTATION = `
  mutation SourceStockVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id inventoryPolicy inventoryItem { id tracked } }
      userErrors { field message }
    }
  }
`;

type LocalVariant = {
  id: string;
  shopify_variant_id?: string | null;
  option1_value?: string | null;
  option2_value?: string | null;
  option3_value?: string | null;
  source_options?: unknown;
};

type RemoteVariant = {
  id: string;
  inventoryPolicy: "CONTINUE" | "DENY";
  tracked: boolean;
  available: number | null;
};

type SoldOutAction = {
  variantId: string;
  shopifyVariantId: string;
  label: string;
  prev: NonNullable<ShopifyStockMark["prev"]> & { available: number };
};

type RestoreAction = {
  variantId: string;
  shopifyVariantId: string;
  label: string;
  to: NonNullable<ShopifyStockMark["prev"]>;
};

type SkippedAction = {
  variantId: string;
  shopifyVariantId: string | null;
  label: string;
  reason: "already_sold_out" | "no_level" | "not_on_shopify" | "manual_change";
};

export type SourceStockSyncPlan = {
  soldOut: SoldOutAction[];
  restore: RestoreAction[];
  skipped: SkippedAction[];
};

export type SourceStockSyncResult =
  | { ok: true; mode: "preview"; plan: SourceStockSyncPlan }
  | {
      ok: true;
      mode: "apply";
      plan: SourceStockSyncPlan;
      applied: {
        soldOut: number;
        restore: number;
        failed: Array<{ variantId: string; label: string; message: string }>;
      };
    }
  | { ok: false; status: number; code: string; error: string };

type RunDeps = {
  callGraphQL?: ShopifyAdminGraphQLCaller;
  locationId?: string | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function labelFor(variant: LocalVariant): string {
  return [variant.option1_value, variant.option2_value, variant.option3_value]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join("／");
}

function isRemoteSoldOut(variant: RemoteVariant): boolean {
  return variant.inventoryPolicy === "DENY" && variant.tracked && variant.available !== null && variant.available <= 0;
}

export function planSourceStockSync({
  variants,
  remote
}: {
  variants: LocalVariant[];
  remote: RemoteVariant[];
}): SourceStockSyncPlan {
  const soldOut: SoldOutAction[] = [];
  const restore: RestoreAction[] = [];
  const skipped: SkippedAction[] = [];
  const byId = new Map(remote.map((variant) => [variant.id, variant]));

  for (const variant of variants) {
    const stock = readSourceStock(variant.source_options);
    const mark = readShopifyStockMark(variant.source_options);
    const label = labelFor(variant);
    const shopifyVariantId = variant.shopify_variant_id?.trim() || null;
    const remoteVariant = shopifyVariantId ? byId.get(shopifyVariantId) ?? null : null;

    if (!shopifyVariantId || !remoteVariant) {
      if (stock?.status === "sold_out" || mark?.applied === "sold_out") {
        skipped.push({ variantId: variant.id, shopifyVariantId, label, reason: "not_on_shopify" });
      }
      continue;
    }

    if (stock?.status === "sold_out") {
      if (isRemoteSoldOut(remoteVariant)) {
        skipped.push({ variantId: variant.id, shopifyVariantId, label, reason: "already_sold_out" });
        continue;
      }
      if (remoteVariant.available === null) {
        skipped.push({ variantId: variant.id, shopifyVariantId, label, reason: "no_level" });
        continue;
      }
      soldOut.push({
        variantId: variant.id,
        shopifyVariantId,
        label,
        prev: {
          policy: remoteVariant.inventoryPolicy,
          tracked: remoteVariant.tracked,
          available: remoteVariant.available
        }
      });
      continue;
    }

    if (stock?.status === "in_stock" && mark?.applied === "sold_out" && mark.prev) {
      if (isRemoteSoldOut(remoteVariant)) {
        restore.push({ variantId: variant.id, shopifyVariantId, label, to: mark.prev });
      } else {
        skipped.push({ variantId: variant.id, shopifyVariantId, label, reason: "manual_change" });
      }
    }
  }

  return { soldOut, restore, skipped };
}

function flattenRemote(product: any, locationId: string): RemoteVariant[] {
  const nodes = Array.isArray(product?.variants?.nodes) ? product.variants.nodes : [];
  return nodes.map((variant: any) => {
    const levels = Array.isArray(variant?.inventoryItem?.inventoryLevels?.nodes)
      ? variant.inventoryItem.inventoryLevels.nodes
      : [];
    const level = levels.find((item: any) => item?.location?.id === locationId);
    const quantities = Array.isArray(level?.quantities) ? level.quantities : [];
    const available = quantities.find((item: any) => item?.name === "available")?.quantity;
    return {
      id: String(variant?.id ?? ""),
      inventoryPolicy: variant?.inventoryPolicy === "DENY" ? "DENY" : "CONTINUE",
      tracked: variant?.inventoryItem?.tracked === true,
      available: Number.isInteger(available) ? available : null
    };
  });
}

async function readRemoteProduct(
  callGraphQL: ShopifyAdminGraphQLCaller,
  productId: string,
  locationId: string
): Promise<{ ok: true; remote: RemoteVariant[] } | { ok: false; deleted?: boolean }> {
  try {
    const { response, result } = await callGraphQL(SOURCE_STOCK_QUERY, { id: productId });
    if (!response.ok || (Array.isArray(result?.errors) && result.errors.length > 0)) {
      return { ok: false };
    }
    if (result?.data?.product === null) return { ok: false, deleted: true };
    if (!result?.data?.product) return { ok: false };
    return { ok: true, remote: flattenRemote(result.data.product, locationId) };
  } catch {
    return { ok: false };
  }
}

function sameIds(a: string[] | undefined, b: string[]): boolean {
  if (!Array.isArray(a)) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function soldOutInput(action: SoldOutAction, locationId: string): Record<string, unknown> {
  const input: Record<string, unknown> = {
    id: action.shopifyVariantId,
    inventoryPolicy: "DENY",
    inventoryItem: { tracked: true }
  };
  if (action.prev.available !== 0) {
    input.quantityAdjustments = [
      {
        locationId,
        adjustment: -action.prev.available,
        changeFromQuantity: action.prev.available
      }
    ];
  }
  return input;
}

function restoreInput(action: RestoreAction, locationId: string): Record<string, unknown> {
  const input: Record<string, unknown> = {
    id: action.shopifyVariantId,
    inventoryPolicy: action.to.policy,
    inventoryItem: { tracked: action.to.tracked }
  };
  if (action.to.tracked && action.to.available !== null && action.to.available > 0) {
    input.quantityAdjustments = [
      {
        locationId,
        adjustment: action.to.available,
        changeFromQuantity: 0
      }
    ];
  }
  return input;
}

function firstMutationError(result: any, responseOk: boolean): string | null {
  const userError = result?.data?.productVariantsBulkUpdate?.userErrors?.[0]?.message;
  if (typeof userError === "string" && userError) return userError;
  const graphError = result?.errors?.[0]?.message;
  if (typeof graphError === "string" && graphError) return graphError;
  return responseOk ? null : "Shopify 沒有改成功";
}

export async function runSourceStockSync({
  serviceSupabase,
  draftId,
  mode,
  expectedVariantIds,
  now,
  deps = {}
}: {
  serviceSupabase: ServiceSupabase;
  draftId: string;
  mode: "preview" | "apply";
  expectedVariantIds?: string[];
  now?: string;
  deps?: RunDeps;
}): Promise<SourceStockSyncResult> {
  const injectedCaller = deps.callGraphQL;
  if (!injectedCaller && process.env.SHOPIFY_PUBLISH_MOCK !== "false") {
    return { ok: false, status: 409, code: "mock_mode", error: "安全模式：不會寫入 Shopify" };
  }
  const callGraphQL = injectedCaller ?? callShopifyAdminGraphQL;

  const { data: draft } = await serviceSupabase
    .from("product_drafts")
    .select("id, shopify_product_id, shopify_sync_status")
    .eq("id", draftId)
    .single();

  const productId = typeof draft?.shopify_product_id === "string" ? draft.shopify_product_id.trim() : "";
  if (!productId || productId === "mock-product-id") {
    return { ok: false, status: 409, code: "not_published", error: "這件還沒上架到 Shopify" };
  }
  if (draft?.shopify_sync_status === "remote_deleted") {
    return { ok: false, status: 409, code: "remote_deleted", error: "Shopify 上找不到這件商品" };
  }

  const locationId =
    "locationId" in deps ? deps.locationId ?? null : process.env.SHOPIFY_LOCATION_ID?.trim() || null;
  if (!locationId) {
    return {
      ok: false,
      status: 409,
      code: "location_required",
      error: "缺少 SHOPIFY_LOCATION_ID，請先在 Vercel 設定出貨地點；Shopify 沒有被改動"
    };
  }

  const { data: variantData } = await serviceSupabase
    .from("product_variants")
    .select("id, shopify_variant_id, option1_value, option2_value, option3_value, source_options")
    .eq("draft_id", draftId);
  const variants = (variantData ?? []) as LocalVariant[];

  const firstRead = await readRemoteProduct(callGraphQL, productId, locationId);
  if (!firstRead.ok) {
    if (firstRead.deleted) {
      return { ok: false, status: 409, code: "remote_deleted", error: "Shopify 上找不到這件商品" };
    }
    return {
      ok: false,
      status: 502,
      code: "inventory_read_failed",
      error: "讀不到 Shopify 庫存：Shopify App 需要 read_inventory 權限；Shopify 沒有被改動"
    };
  }

  const plan = planSourceStockSync({ variants, remote: firstRead.remote });
  if (mode === "preview") return { ok: true, mode, plan };

  const plannedIds = [...plan.soldOut, ...plan.restore].map((item) => item.variantId);
  if (!sameIds(expectedVariantIds, plannedIds)) {
    return {
      ok: false,
      status: 409,
      code: "plan_changed",
      error: "Shopify 庫存剛剛有變，請按「重新檢查」"
    };
  }
  if (plannedIds.length === 0) {
    return {
      ok: true,
      mode: "apply",
      plan,
      applied: { soldOut: 0, restore: 0, failed: [] }
    };
  }

  const inputs = [
    ...plan.soldOut.map((action) => soldOutInput(action, locationId)),
    ...plan.restore.map((action) => restoreInput(action, locationId))
  ];

  let mutationResult: any = null;
  let mutationResponseOk = false;
  try {
    const mutation = await callGraphQL(SOURCE_STOCK_MUTATION, { productId, variants: inputs });
    mutationResult = mutation.result;
    mutationResponseOk = mutation.response.ok;
  } catch {
    mutationResult = null;
    mutationResponseOk = false;
  }

  const secondRead = await readRemoteProduct(callGraphQL, productId, locationId);
  if (!secondRead.ok) {
    return {
      ok: false,
      status: 502,
      code: "inventory_read_failed",
      error: "Shopify 可能已部分改動，請按「重新檢查」確認"
    };
  }

  const byRemoteId = new Map(secondRead.remote.map((variant) => [variant.id, variant]));
  const mutationError = firstMutationError(mutationResult, mutationResponseOk);
  const failed: Array<{ variantId: string; label: string; message: string }> = [];
  let soldOutCount = 0;
  let restoreCount = 0;
  const appliedAt = now ?? new Date().toISOString();

  for (const action of plan.soldOut) {
    const actual = byRemoteId.get(action.shopifyVariantId);
    const success = actual?.inventoryPolicy === "DENY" && actual.tracked === true && actual.available === 0;
    if (!success) {
      failed.push({ variantId: action.variantId, label: action.label, message: mutationError ?? "Shopify 沒有改成功" });
      continue;
    }
    const local = variants.find((variant) => variant.id === action.variantId);
    const sourceOptions = isPlainObject(local?.source_options) ? local.source_options : {};
    const shopifyStock: ShopifyStockMark = { applied: "sold_out", at: appliedAt, prev: action.prev };
    await serviceSupabase
      .from("product_variants")
      .update({ source_options: { ...sourceOptions, shopify_stock: shopifyStock } })
      .eq("id", action.variantId);
    soldOutCount += 1;
  }

  for (const action of plan.restore) {
    const actual = byRemoteId.get(action.shopifyVariantId);
    const success =
      actual?.inventoryPolicy === action.to.policy &&
      actual.tracked === action.to.tracked &&
      (!action.to.tracked || actual.available === action.to.available);
    if (!success) {
      failed.push({ variantId: action.variantId, label: action.label, message: mutationError ?? "Shopify 沒有改成功" });
      continue;
    }
    const local = variants.find((variant) => variant.id === action.variantId);
    const sourceOptions = isPlainObject(local?.source_options) ? local.source_options : {};
    const shopifyStock: ShopifyStockMark = { applied: "restored", at: appliedAt, prev: null };
    await serviceSupabase
      .from("product_variants")
      .update({ source_options: { ...sourceOptions, shopify_stock: shopifyStock } })
      .eq("id", action.variantId);
    restoreCount += 1;
  }

  return {
    ok: true,
    mode: "apply",
    plan,
    applied: { soldOut: soldOutCount, restore: restoreCount, failed }
  };
}
