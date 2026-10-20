import { callShopifyAdminGraphQL } from "@/lib/shopify/adminGraphQL";
import { checkLiveTestGuard } from "@/lib/shopify/liveTestGuard";
import type { ShopifyAdminGraphQLCaller } from "@/lib/shopify/productLifecycle";
import {
  computeReconcileRows,
  isBlockedAutoSku,
  localPatchForChoice,
  shopifyValuesFromSnapshot,
  toolValuesFromDesired,
  type ReconcileRow,
  type ShopifyDiffPayload
} from "@/lib/shopify/reconcileFields";
import {
  buildSyncDesiredState,
  loadSnapshot,
  loadSyncInputs,
  syncShopifyProduct,
  type SyncShopifyProductResult
} from "@/lib/shopify/syncShopifyProduct";
import type { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { ProductVariantRow, ShopifySyncBaseline } from "@/types/domain";

type ServiceSupabase = ReturnType<typeof createServiceSupabaseClient>;
type DiffDeps = { callGraphQL?: ShopifyAdminGraphQLCaller };

type PreparedDiff = {
  payload: ShopifyDiffPayload;
  before: Awaited<ReturnType<typeof loadSnapshot>> & {};
  draft: any;
  variantRows: ProductVariantRow[];
  internalLinkMap: Record<string, string>;
  desired: ReturnType<typeof buildSyncDesiredState>;
};

type DiffError = { ok: false; status: number; code: string; error: string };

export type ShopifyDiffResult = ShopifyDiffPayload | DiffError;
export type ShopifyResolveResult =
  | (SyncShopifyProductResult & { pulledCount: number })
  | {
      ok: false;
      status: number;
      code: string;
      error: string;
      removals?: { variants: number; media: number };
      pulledCount: number;
    };

function nowIso(): string {
  return new Date().toISOString();
}

function labelForDesired(item: ReturnType<typeof buildSyncDesiredState>["desiredVariants"][number]): string {
  const label = item.seed.optionValues
    .map((option) => option.name.trim())
    .filter(Boolean)
    .join(" / ");
  return label || "單一款式";
}

function legacyUnchanged(draft: any, remoteUpdatedAt: string, baseline: ShopifySyncBaseline | null): boolean {
  const previousRemoteUpdatedAt = draft.shopify_remote_updated_at as string | null;
  const legacyFullSync =
    !baseline && Boolean(draft.shopify_sync_hash) && Boolean(previousRemoteUpdatedAt);
  return Boolean(
    legacyFullSync &&
      Date.parse(remoteUpdatedAt) <= Date.parse(previousRemoteUpdatedAt!) + 1000
  );
}

function valueForRow(
  row: ReconcileRow,
  values: ReturnType<typeof toolValuesFromDesired>
): string | undefined {
  if (row.group === "product") {
    return values.product[row.field as keyof typeof values.product];
  }
  const variant = row.variantId ? values.variants[row.variantId] : undefined;
  return variant?.[row.field as "price" | "compareAtPrice" | "sku"];
}

export function computePullability(input: {
  draft: any;
  variantRows: ProductVariantRow[];
  internalLinkMap: Record<string, string>;
  before: NonNullable<Awaited<ReturnType<typeof loadSnapshot>>>;
  productId: string;
  rows: ReconcileRow[];
}): Record<string, { pullable: boolean; reason: string | null }> {
  const output: Record<string, { pullable: boolean; reason: string | null }> = {};
  const baseDesired = buildSyncDesiredState({
    draft: input.draft,
    variantRows: input.variantRows,
    internalLinkMap: input.internalLinkMap,
    before: input.before,
    productId: input.productId
  });
  const variantRowIds = new Map<string, string>();
  for (const item of baseDesired.desiredVariants) {
    if (item.remote?.id && item.row?.id) variantRowIds.set(item.remote.id, item.row.id);
  }

  for (const row of input.rows) {
    if (row.field === "sku" && isBlockedAutoSku(row.shopify, input.draft.id)) {
      output[row.key] = {
        pullable: false,
        reason: "這是淘寶／系統編號，工具固定使用 NS 編號"
      };
      continue;
    }

    try {
      const local = localPatchForChoice({
        row,
        snapshot: input.before,
        draftId: input.draft.id,
        planMode: baseDesired.plan.mode,
        variantRowId: row.variantId ? variantRowIds.get(row.variantId) ?? null : null
      });
      const draftCopy = { ...input.draft };
      const variantsCopy = input.variantRows.map((variant) => ({ ...variant }));
      if (local.table === "product_drafts") {
        Object.assign(draftCopy, local.patch);
      } else {
        const target = variantsCopy.find((variant) => variant.id === local.id);
        if (!target) throw new Error("找不到工具內對應款式");
        Object.assign(target, local.patch);
      }
      const rebuilt = buildSyncDesiredState({
        draft: draftCopy,
        variantRows: variantsCopy,
        internalLinkMap: input.internalLinkMap,
        before: input.before,
        productId: input.productId
      });
      const simulated = valueForRow(row, toolValuesFromDesired(rebuilt));
      const pullable = simulated === row.shopify;
      output[row.key] = {
        pullable,
        reason: pullable
          ? null
          : row.field === "description"
            ? "這件的描述拉回後格式會跑掉，請用工具版本，或之後到工具裡手動改"
            : "工具的規則會改寫這一欄，存回去也留不住，只能用工具版本"
      };
    } catch {
      output[row.key] = {
        pullable: false,
        reason:
          row.field === "description"
            ? "這件的描述拉回後格式會跑掉，請用工具版本，或之後到工具裡手動改"
            : "工具的規則會改寫這一欄，存回去也留不住，只能用工具版本"
      };
    }
  }
  return output;
}

function displayValue(row: ReconcileRow, value: string): string {
  if (!value) return "（空白）";
  if (row.field === "price" || row.field === "compareAtPrice") {
    return `NT$${Number(value).toLocaleString("en-US")}`;
  }
  if (row.field === "tags") return value.split("\u0001").join("、");
  return value;
}

async function prepareShopifyDiff(input: {
  serviceSupabase: ServiceSupabase;
  draftId: string;
  deps?: DiffDeps;
}): Promise<{ ok: true; prepared: PreparedDiff } | DiffError> {
  const { serviceSupabase, draftId, deps = {} } = input;
  const guardError = checkLiveTestGuard({ draftIds: [draftId], operation: "sync" });
  if (guardError) return { ok: false, status: 403, code: "live_test_guard", error: guardError };

  const loaded = await loadSyncInputs(serviceSupabase, draftId);
  if (!loaded.ok) {
    if (loaded.code === "missing_product_id") {
      return {
        ok: false,
        status: 409,
        code: "missing_product_id",
        error: "這件商品還沒有建立到 Shopify"
      };
    }
    return {
      ok: false,
      status: loaded.status,
      code: loaded.code ?? "load_failed",
      error: loaded.error
    };
  }
  const { draft, variantRows, internalLinkMap } = loaded;
  const productId = draft.shopify_product_id as string;

  if (process.env.SHOPIFY_PUBLISH_MOCK !== "false" && !deps.callGraphQL) {
    return {
      ok: false,
      status: 409,
      code: "mock_mode",
      error: "安全模式不會讀取 Shopify，無法比對"
    };
  }

  const caller: ShopifyAdminGraphQLCaller =
    deps.callGraphQL ?? ((query, variables) => callShopifyAdminGraphQL(query, variables));
  let before: NonNullable<Awaited<ReturnType<typeof loadSnapshot>>> | null;
  try {
    before = await loadSnapshot(productId, caller);
  } catch (error) {
    return {
      ok: false,
      status: 502,
      code: "readback_failed",
      error: error instanceof Error ? error.message : String(error)
    };
  }
  if (!before) {
    return {
      ok: false,
      status: 410,
      code: "remote_deleted",
      error: "Shopify 上已經找不到這件商品"
    };
  }

  const desired = buildSyncDesiredState({
    draft,
    variantRows,
    internalLinkMap,
    before,
    productId
  });
  const baseline = (draft.shopify_sync_baseline ?? null) as ShopifySyncBaseline | null;
  const unchanged = legacyUnchanged(draft, before.updatedAt, baseline);
  const variantLabels: Record<string, string> = {};
  for (const item of desired.desiredVariants) {
    if (item.remote) variantLabels[item.remote.id] = labelForDesired(item);
  }
  const initialRows = computeReconcileRows({
    tool: toolValuesFromDesired(desired),
    shopify: shopifyValuesFromSnapshot(before),
    baseline,
    legacyUnchanged: unchanged,
    variantLabels,
    pullability: {}
  });
  const pullability = computePullability({
    draft,
    variantRows,
    internalLinkMap,
    before,
    productId,
    rows: initialRows
  });
  const rows = computeReconcileRows({
    tool: toolValuesFromDesired(desired),
    shopify: shopifyValuesFromSnapshot(before),
    baseline,
    legacyUnchanged: unchanged,
    variantLabels,
    pullability
  }).map((row) => ({
    ...row,
    toolDisplay: displayValue(row, row.tool),
    shopifyDisplay: displayValue(row, row.shopify)
  }));

  const toolOnlyVariants = desired.desiredVariants
    .filter((item) => !item.remote)
    .map(labelForDesired);
  const shopifyOnlyVariants = desired.variantRemovals.map(
    (item) => item.title?.trim() || "單一款式"
  );
  const payload: ShopifyDiffPayload = {
    ok: true,
    productStatus: before.status,
    remoteUpdatedAt: before.updatedAt,
    draftUpdatedAt: String(draft.updated_at),
    hasBaseline: Boolean(baseline),
    rows,
    variantTotal:
      desired.desiredVariants.filter((item) => Boolean(item.remote)).length +
      toolOnlyVariants.length,
    toolOnlyVariants,
    shopifyOnlyVariants
  };
  return {
    ok: true,
    prepared: {
      payload,
      before,
      draft,
      variantRows,
      internalLinkMap,
      desired
    }
  };
}

export async function loadShopifyDiff(input: {
  serviceSupabase: ServiceSupabase;
  draftId: string;
  deps?: DiffDeps;
}): Promise<ShopifyDiffResult> {
  const prepared = await prepareShopifyDiff(input);
  return prepared.ok ? prepared.prepared.payload : prepared;
}

function validBody(body: unknown): body is {
  remoteUpdatedAt: string;
  draftUpdatedAt: string;
  choices: Record<string, "tool" | "shopify">;
  confirmActiveUpdate: boolean;
  confirmRemovals: boolean;
} {
  return Boolean(body) && typeof body === "object";
}

function sameKeys(left: string[], right: string[]): boolean {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

export async function resolveShopifyDiff(input: {
  serviceSupabase: ServiceSupabase;
  draftId: string;
  createdBy: string | null;
  body: unknown;
  deps?: DiffDeps;
}): Promise<ShopifyResolveResult> {
  const preparedResult = await prepareShopifyDiff({
    serviceSupabase: input.serviceSupabase,
    draftId: input.draftId,
    deps: input.deps
  });
  if (!preparedResult.ok) return { ...preparedResult, pulledCount: 0 };
  const prepared = preparedResult.prepared;
  const body = input.body;
  if (!validBody(body)) {
    return {
      ok: false,
      status: 400,
      code: "invalid_choice",
      error: "有欄位的選擇不合法，請重新比對",
      pulledCount: 0
    };
  }
  if (
    prepared.before.updatedAt !== body.remoteUpdatedAt ||
    String(prepared.draft.updated_at) !== body.draftUpdatedAt
  ) {
    return {
      ok: false,
      status: 409,
      code: "diff_stale",
      error: "比對後 Shopify 或工具又有變動，請重新比對",
      pulledCount: 0
    };
  }

  const rowKeys = prepared.payload.rows.map((row) => row.key);
  const choiceKeys = Object.keys(body.choices ?? {});
  if (!sameKeys(rowKeys, choiceKeys)) {
    return {
      ok: false,
      status: 409,
      code: "diff_changed",
      error: "差異清單已經變了，請重新比對",
      pulledCount: 0
    };
  }
  for (const row of prepared.payload.rows) {
    const choice = body.choices[row.key];
    if (
      (choice !== "tool" && choice !== "shopify") ||
      (choice === "shopify" && !row.pullable)
    ) {
      return {
        ok: false,
        status: 400,
        code: "invalid_choice",
        error: "有欄位的選擇不合法，請重新比對",
        pulledCount: 0
      };
    }
  }

  const variantRowIds = new Map<string, string>();
  for (const item of prepared.desired.desiredVariants) {
    if (item.remote?.id && item.row?.id) variantRowIds.set(item.remote.id, item.row.id);
  }
  const productPatch: Record<string, unknown> = {};
  const variantPatches = new Map<string, Record<string, unknown>>();
  const pulledKeys = prepared.payload.rows
    .filter((row) => body.choices[row.key] === "shopify")
    .map((row) => row.key);

  try {
    for (const row of prepared.payload.rows) {
      if (body.choices[row.key] !== "shopify") continue;
      const local = localPatchForChoice({
        row,
        snapshot: prepared.before,
        draftId: input.draftId,
        planMode: prepared.desired.plan.mode,
        variantRowId: row.variantId ? variantRowIds.get(row.variantId) ?? null : null
      });
      if (local.table === "product_drafts") {
        Object.assign(productPatch, local.patch);
      } else {
        variantPatches.set(local.id, {
          ...(variantPatches.get(local.id) ?? {}),
          ...local.patch
        });
      }
    }

    if (Object.keys(productPatch).length > 0) {
      const { error } = await input.serviceSupabase
        .from("product_drafts")
        .update(productPatch)
        .eq("id", input.draftId);
      if (error) throw new Error(error.message);
    }
    for (const [id, patch] of variantPatches) {
      const { error } = await input.serviceSupabase
        .from("product_variants")
        .update(patch)
        .eq("id", id);
      if (error) throw new Error(error.message);
    }
  } catch (error) {
    return {
      ok: false,
      status: 500,
      code: "local_write_failed",
      error:
        "存回工具失敗，Shopify 沒有被改動：" +
        (error instanceof Error ? error.message : String(error)),
      pulledCount: pulledKeys.length
    };
  }

  const syncResult = await syncShopifyProduct({
    serviceSupabase: input.serviceSupabase,
    draftId: input.draftId,
    createdBy: input.createdBy,
    forceRemoteOverwrite: true,
    confirmActiveUpdate: body.confirmActiveUpdate === true,
    confirmRemovals: body.confirmRemovals === true,
    reconcileAudit: { choices: body.choices, pulledKeys },
    deps: input.deps
  });
  return { ...syncResult, pulledCount: pulledKeys.length };
}

export async function captureShopifySyncBaseline(
  serviceSupabase: ServiceSupabase,
  draftId: string,
  productId: string,
  caller: ShopifyAdminGraphQLCaller
): Promise<void> {
  const snapshot = await loadSnapshot(productId, caller);
  if (!snapshot) return;
  const capturedAt = nowIso();
  const { error } = await serviceSupabase
    .from("product_drafts")
    .update({
      shopify_sync_baseline: (
        await import("@/lib/shopify/reconcileFields")
      ).buildBaselineFromSnapshot(snapshot, capturedAt),
      shopify_remote_updated_at: snapshot.updatedAt,
      shopify_sync_status: "synced",
      shopify_synced_at: capturedAt,
      shopify_sync_error: null
    })
    .eq("id", draftId);
  if (error) throw new Error(error.message);
}
