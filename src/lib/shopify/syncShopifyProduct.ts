import { createHash } from "node:crypto";
import { mergeInternalLinkMap } from "@/lib/contentGenerator/internalLinks";
import { buildShopifyProductPayload } from "@/lib/shopify/payload";
import { callShopifyAdminGraphQL } from "@/lib/shopify/adminGraphQL";
import {
  ADD_PRODUCT_MEDIA_MUTATION,
  CREATE_PRODUCT_VARIANTS_MUTATION,
  DELETE_PRODUCT_VARIANTS_MUTATION,
  PRODUCT_SYNC_SNAPSHOT_QUERY,
  SYNC_PRODUCT_CORE_MUTATION,
  SYNC_PRODUCT_VARIANTS_MUTATION,
  UPDATE_PRODUCT_FILES_MUTATION,
  type ShopifySyncSnapshot
} from "@/lib/shopify/fullSyncGraphQL";
import { checkLiveTestGuard } from "@/lib/shopify/liveTestGuard";
import {
  isRealShopifyProductId,
  type ShopifyAdminGraphQLCaller
} from "@/lib/shopify/productLifecycle";
import {
  buildVariantPublishPlan,
  findDuplicateProductVariantRows,
  toBulkVariantInput,
  type MultiVariantPublishPlan
} from "@/lib/variants/shopifyVariants";
import type { ShopifyVariantSeed } from "@/lib/variants/types";
import type { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { ProductImage, ProductVariantRow } from "@/types/domain";

type ServiceSupabase = ReturnType<typeof createServiceSupabaseClient>;

type SyncDeps = {
  callGraphQL?: ShopifyAdminGraphQLCaller;
};

export type SyncShopifyProductInput = {
  serviceSupabase: ServiceSupabase;
  draftId: string;
  createdBy: string | null;
  forceRemoteOverwrite?: boolean;
  confirmRemovals?: boolean;
  confirmActiveUpdate?: boolean;
  deps?: SyncDeps;
};

export type SyncShopifyProductResult =
  | {
      ok: true;
      mock?: boolean;
      productId: string;
      remoteUpdatedAt: string;
      warnings: string[];
    }
  | {
      ok: false;
      status: number;
      error: string;
      code?: string;
      removals?: { variants: number; media: number };
    };

type DesiredVariant = {
  row: ProductVariantRow | null;
  seed: ShopifyVariantSeed;
  remote: ShopifySyncSnapshot["variants"]["nodes"][number] | null;
};

type DesiredImage = {
  row: ProductImage;
  media: { originalSource: string; alt: string; mediaContentType: "IMAGE" };
  sourceHash: string;
  remote: ShopifySyncSnapshot["media"]["nodes"][number] | null;
  replace: boolean;
};

function nowIso(): string {
  return new Date().toISOString();
}

function message(value: unknown): string {
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function hashSource(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function optionKey(options: Array<{ name: string; value: string }>): string {
  return options
    .map((option) => `${option.name.trim().toLocaleLowerCase()}:${option.value.trim().toLocaleLowerCase()}`)
    .join("\u0001");
}

function seedOptionKey(seed: ShopifyVariantSeed): string {
  return optionKey(seed.optionValues.map((option) => ({ name: option.optionName, value: option.name })));
}

function numberEqual(left: unknown, right: unknown): boolean {
  const a = Number(left ?? 0);
  const b = Number(right ?? 0);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.001;
}

function userErrors(result: any, path: string): unknown[] {
  const parts = path.split(".");
  let value = result?.data;
  for (const part of parts) value = value?.[part];
  const errors = value?.userErrors ?? value?.mediaUserErrors ?? result?.errors;
  return Array.isArray(errors) ? errors : [];
}

async function loadSnapshot(
  productId: string,
  caller: ShopifyAdminGraphQLCaller
): Promise<ShopifySyncSnapshot | null> {
  const { response, result } = await caller(PRODUCT_SYNC_SNAPSHOT_QUERY, { id: productId });
  if (!response.ok) throw new Error(`Shopify readback failed: HTTP ${response.status}`);
  if (Array.isArray(result?.errors) && result.errors.length > 0) {
    throw new Error(`Shopify readback failed: ${message(result.errors)}`);
  }
  const product = result?.data?.product as ShopifySyncSnapshot | null | undefined;
  if (!product) return null;
  if (product.id !== productId) throw new Error("Shopify readback returned a different product ID");
  return product;
}

function currentAvailable(
  variant: ShopifySyncSnapshot["variants"]["nodes"][number],
  locationId: string
): number | null {
  const level = variant.inventoryItem.inventoryLevels.nodes.find(
    (item) => item.location.id === locationId
  );
  const quantity = level?.quantities.find((item) => item.name === "available")?.quantity;
  return Number.isInteger(quantity) ? (quantity as number) : null;
}

function localVariantRows(rows: ProductVariantRow[]): ProductVariantRow[] {
  return [...rows]
    .filter((row) =>
      Boolean(row.option1_value?.trim() || row.option2_value?.trim() || row.option3_value?.trim())
    )
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

function matchVariants(
  rows: ProductVariantRow[],
  seeds: ShopifyVariantSeed[],
  remoteVariants: ShopifySyncSnapshot["variants"]["nodes"]
): DesiredVariant[] {
  const used = new Set<string>();
  return seeds.map((seed, index) => {
    const row = rows[index] ?? null;
    let remote = row?.shopify_variant_id
      ? remoteVariants.find((variant) => variant.id === row.shopify_variant_id) ?? null
      : null;
    if (!remote) {
      const key = seedOptionKey(seed);
      remote = remoteVariants.find(
        (variant) => !used.has(variant.id) && optionKey(variant.selectedOptions) === key
      ) ?? null;
    }
    if (!remote && seed.sku) {
      const skuMatches = remoteVariants.filter(
        (variant) => !used.has(variant.id) && variant.sku === seed.sku
      );
      if (skuMatches.length === 1) remote = skuMatches[0];
    }
    if (!remote && seeds.length === 1 && remoteVariants.length === 1) remote = remoteVariants[0];
    if (remote) used.add(remote.id);
    return { row, seed, remote };
  });
}

function buildVariantUpdateInput(
  desired: DesiredVariant,
  locationId: string | null
): Record<string, unknown> {
  const remote = desired.remote;
  if (!remote) throw new Error("Cannot update a variant without a remote ID");
  const seed = desired.seed;
  const finite = seed.inventoryPolicy === "DENY" && Number.isInteger(seed.inventoryQuantity);
  const input: Record<string, unknown> = {
    id: remote.id,
    optionValues: seed.optionValues.map((option) => ({
      optionName: option.optionName,
      name: option.name
    })),
    price: String(seed.price),
    compareAtPrice:
      seed.compareAtPrice != null && seed.compareAtPrice > 0
        ? String(seed.compareAtPrice)
        : null,
    inventoryPolicy: seed.inventoryPolicy,
    inventoryItem: {
      sku: seed.sku ?? "",
      cost: String(seed.cost),
      tracked: finite
    }
  };
  if (finite) {
    if (!locationId) throw new Error("有限庫存同步需要已確認的 SHOPIFY_LOCATION_ID");
    const current = currentAvailable(remote, locationId);
    if (current == null) {
      throw new Error(
        `Shopify 款式 ${remote.id} 在指定 location 沒有 available 庫存層級；已停止避免寫錯庫存`
      );
    }
    const desiredQuantity = seed.inventoryQuantity as number;
    if (desiredQuantity !== current) {
      input.quantityAdjustments = [
        {
          locationId,
          adjustment: desiredQuantity - current,
          changeFromQuantity: current
        }
      ];
    }
  }
  return input;
}

function matchImages(
  rows: ProductImage[],
  mediaInputs: Array<{ originalSource: string; alt: string; mediaContentType: "IMAGE" }>,
  remoteMedia: ShopifySyncSnapshot["media"]["nodes"],
  hasBaseline: boolean
): { desired: DesiredImage[]; identityError: string | null } {
  const remoteImages = remoteMedia.filter((media) => media.mediaContentType === "IMAGE");
  const used = new Set<string>();
  const desired: DesiredImage[] = rows.map((row, index) => {
    const media = mediaInputs[index];
    const sourceHash = hashSource(media.originalSource);
    let remote = row.shopify_media_id
      ? remoteImages.find((item) => item.id === row.shopify_media_id) ?? null
      : null;
    if (remote) used.add(remote.id);
    return {
      row,
      media,
      sourceHash,
      remote,
      replace: Boolean(remote && row.shopify_source_hash && row.shopify_source_hash !== sourceHash)
    };
  });

  const unlinked = desired.filter((item) => !item.remote);
  const availableRemote = remoteImages.filter((item) => !used.has(item.id));
  for (const item of unlinked) {
    const sameAlt = availableRemote.filter(
      (remote) => !used.has(remote.id) && (remote.alt ?? "") === item.media.alt
    );
    if (sameAlt.length === 1) {
      item.remote = sameAlt[0];
      used.add(sameAlt[0].id);
    }
  }

  const stillUnlinked = desired.filter((item) => !item.remote);
  const stillAvailable = remoteImages.filter((item) => !used.has(item.id));
  if (!hasBaseline && stillUnlinked.length === stillAvailable.length) {
    stillUnlinked.forEach((item, index) => {
      item.remote = stillAvailable[index] ?? null;
      if (item.remote) used.add(item.remote.id);
    });
  }

  if (!hasBaseline && desired.some((item) => !item.remote) && remoteImages.length > 0) {
    return {
      desired,
      identityError:
        "首次 Shopify 圖片 identity 對帳數量不一致；已停止自動刪圖，需先人工核對圖片對應"
    };
  }
  return { desired, identityError: null };
}

function desiredCore(productId: string, product: Record<string, any>, status: string) {
  return {
    id: productId,
    title: product.title,
    descriptionHtml: product.descriptionHtml,
    vendor: product.vendor,
    productType: product.productType,
    tags: product.tags,
    status,
    seo: product.seo,
    ...(product.handle ? { handle: product.handle, redirectNewHandle: true } : {}),
    ...(Array.isArray(product.metafields) ? { metafields: product.metafields } : {})
  };
}

function verifyReadback(
  remote: ShopifySyncSnapshot,
  core: Record<string, any>,
  desiredVariants: DesiredVariant[],
  desiredImages: DesiredImage[],
  desiredVideoUrls: string[],
  locationId: string | null
): string[] {
  const mismatches: string[] = [];
  const scalarFields = ["title", "descriptionHtml", "vendor", "productType"] as const;
  for (const field of scalarFields) {
    if ((remote[field] ?? "") !== (core[field] ?? "")) mismatches.push(`product.${field}`);
  }
  const localTags = [...(core.tags ?? [])].sort().join("\u0001");
  const remoteTags = [...(remote.tags ?? [])].sort().join("\u0001");
  if (localTags !== remoteTags) mismatches.push("product.tags");

  for (const desired of desiredVariants) {
    const match = remote.variants.nodes.find((variant) => {
      if (desired.row?.shopify_variant_id === variant.id) return true;
      return optionKey(variant.selectedOptions) === seedOptionKey(desired.seed);
    });
    if (!match) {
      mismatches.push(`variant.missing:${seedOptionKey(desired.seed) || desired.seed.sku || "default"}`);
      continue;
    }
    if (!numberEqual(match.price, desired.seed.price)) mismatches.push(`variant.price:${match.id}`);
    if (!numberEqual(match.compareAtPrice, desired.seed.compareAtPrice)) {
      mismatches.push(`variant.compareAtPrice:${match.id}`);
    }
    if ((match.sku ?? "") !== (desired.seed.sku ?? "")) mismatches.push(`variant.sku:${match.id}`);
    if (match.inventoryPolicy !== desired.seed.inventoryPolicy) {
      mismatches.push(`variant.inventoryPolicy:${match.id}`);
    }
    if (
      desired.seed.inventoryPolicy === "DENY" &&
      locationId &&
      currentAvailable(match, locationId) !== desired.seed.inventoryQuantity
    ) {
      mismatches.push(`variant.inventoryQuantity:${match.id}`);
    }
  }

  const remoteImages = remote.media.nodes.filter((media) => media.mediaContentType === "IMAGE");
  for (const desired of desiredImages) {
    const match = desired.remote
      ? remoteImages.find((media) => media.id === desired.remote?.id)
      : remoteImages.find((media) => (media.alt ?? "") === desired.media.alt);
    if (!match) mismatches.push(`media.image:${desired.row.id}`);
    else if ((match.alt ?? "") !== desired.media.alt) mismatches.push(`media.alt:${match.id}`);
  }
  const remoteVideos = new Set(
    remote.media.nodes
      .filter((media) => media.mediaContentType === "EXTERNAL_VIDEO")
      .map((media) => media.originUrl)
      .filter((value): value is string => Boolean(value))
  );
  for (const url of desiredVideoUrls) {
    if (!remoteVideos.has(url)) mismatches.push(`media.externalVideo:${url}`);
  }

  const remoteMetafields = new Map(
    remote.metafields.nodes.map((item) => [`${item.namespace}.${item.key}`, item.value])
  );
  for (const metafield of core.metafields ?? []) {
    if (remoteMetafields.get(`${metafield.namespace}.${metafield.key}`) !== metafield.value) {
      mismatches.push(`metafield.${metafield.namespace}.${metafield.key}`);
    }
  }
  return mismatches;
}

async function markSyncState(
  serviceSupabase: ServiceSupabase,
  draftId: string,
  patch: Record<string, unknown>
): Promise<string | null> {
  const { error } = await serviceSupabase.from("product_drafts").update(patch).eq("id", draftId);
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
      error_message: errorMessage ?? null,
      completed_at: nowIso()
    })
    .eq("id", jobId);
}

export async function syncShopifyProduct(
  input: SyncShopifyProductInput
): Promise<SyncShopifyProductResult> {
  const {
    serviceSupabase,
    draftId,
    createdBy,
    forceRemoteOverwrite = false,
    confirmRemovals = false,
    confirmActiveUpdate = false,
    deps = {}
  } = input;
  const guardError = checkLiveTestGuard({ draftIds: [draftId], operation: "sync" });
  if (guardError) return { ok: false, status: 403, error: guardError, code: "live_test_guard" };

  const { data: draft, error: draftError } = await serviceSupabase
    .from("product_drafts")
    .select("*, product_images(*)")
    .eq("id", draftId)
    .single();
  if (draftError || !draft) {
    return { ok: false, status: 404, error: draftError?.message ?? "Draft not found" };
  }
  const productId = draft.shopify_product_id as string | null;
  if (!isRealShopifyProductId(productId)) {
    return {
      ok: false,
      status: 409,
      error: "Draft has no real Shopify product ID; create the Shopify DRAFT first",
      code: "missing_product_id"
    };
  }
  if (process.env.SHOPIFY_PUBLISH_MOCK !== "false" && !deps.callGraphQL) {
    return {
      ok: true,
      mock: true,
      productId,
      remoteUpdatedAt: draft.shopify_remote_updated_at ?? nowIso(),
      warnings: ["SHOPIFY_PUBLISH_MOCK is enabled; no Shopify update was sent"]
    };
  }

  const { data: variantData, error: variantError } = await serviceSupabase
    .from("product_variants")
    .select("*")
    .eq("draft_id", draftId)
    .order("sort_order", { ascending: true });
  if (variantError) return { ok: false, status: 500, error: variantError.message };
  const variantRows = (variantData ?? []) as ProductVariantRow[];
  const duplicateRows = findDuplicateProductVariantRows(variantRows);
  if (duplicateRows.length > 0) {
    return { ok: false, status: 409, error: "款式組合重複，Shopify 同步已停止", code: "duplicate_variants" };
  }

  const caller: ShopifyAdminGraphQLCaller =
    deps.callGraphQL ?? ((query, variables) => callShopifyAdminGraphQL(query, variables));
  let before: ShopifySyncSnapshot | null;
  try {
    before = await loadSnapshot(productId, caller);
  } catch (error) {
    return { ok: false, status: 502, error: message(error), code: "readback_failed" };
  }
  if (!before) {
    await markSyncState(serviceSupabase, draftId, {
      shopify_sync_status: "remote_deleted",
      shopify_sync_error: "Shopify product no longer exists"
    });
    return { ok: false, status: 410, error: "Shopify product no longer exists", code: "remote_deleted" };
  }
  if (process.env.SHOPIFY_LIVE_TEST_DRAFT_ID?.trim() && before.status !== "DRAFT") {
    return {
      ok: false,
      status: 409,
      error: `G4 live test only permits a remote DRAFT; Shopify returned ${before.status}`,
      code: "unsafe_remote_status"
    };
  }
  if (before.status === "ACTIVE" && !confirmActiveUpdate) {
    return {
      ok: false,
      status: 409,
      error: "Shopify 商品目前是 ACTIVE；更新公開商品需要明確 confirmActiveUpdate=true",
      code: "active_update_confirmation_required"
    };
  }

  const previousRemoteUpdatedAt = draft.shopify_remote_updated_at as string | null;
  if (
    !forceRemoteOverwrite &&
    previousRemoteUpdatedAt &&
    Date.parse(before.updatedAt) > Date.parse(previousRemoteUpdatedAt) + 1000
  ) {
    await markSyncState(serviceSupabase, draftId, {
      shopify_sync_status: "conflict",
      shopify_sync_error: "Shopify was updated after the last successful sync"
    });
    return {
      ok: false,
      status: 409,
      error: "Shopify 後台在上次同步後有新修改；已停止覆蓋，請先查看差異",
      code: "remote_conflict"
    };
  }

  const { data: linkSettingsRow } = await serviceSupabase
    .from("team_settings")
    .select("value")
    .eq("key", "internal_link_urls_by_ip")
    .maybeSingle();
  const internalLinkMap = mergeInternalLinkMap(
    (linkSettingsRow?.value as Record<string, string> | null) ?? null
  );
  const images = ((draft.product_images ?? []) as ProductImage[])
    .filter((image) => image.image_type !== "spec")
    .sort((a, b) => a.sort_order - b.sort_order);
  const built = buildShopifyProductPayload(
    { ...draft, product_images: draft.product_images ?? [], product_variants: variantRows },
    "draft",
    internalLinkMap
  ) as any;
  const core = desiredCore(productId, built.product as Record<string, any>, before.status);

  const rows = localVariantRows(variantRows);
  const plan = buildVariantPublishPlan(rows, {
    cny_price: draft.cny_price,
    twd_cost: draft.twd_cost,
    price_mode: draft.price_mode
  });
  const seeds =
    plan.mode === "multi"
      ? (plan as MultiVariantPublishPlan).all
      : [
          {
            optionValues:
              before.variants.nodes[0]?.selectedOptions?.map((option) => ({
                optionName: option.name,
                name: option.value
              })) ?? [{ optionName: "Title", name: "Default Title" }],
            price: Number(built.variantSeed.price ?? 0),
            compareAtPrice:
              built.variantSeed.compareAtPrice == null
                ? null
                : Number(built.variantSeed.compareAtPrice),
            cost: Number(built.variantSeed.cost ?? 0),
            sku: built.variantSeed.sku ? String(built.variantSeed.sku) : null,
            inventoryQuantity: Number.isInteger(built.variantSeed.inventoryQuantity)
              ? Number(built.variantSeed.inventoryQuantity)
              : null,
            inventoryPolicy: built.variantSeed.inventoryPolicy === "DENY" ? "DENY" : "CONTINUE",
            imageId: null
          } satisfies ShopifyVariantSeed
        ];
  const desiredVariants = matchVariants(rows, seeds, before.variants.nodes);
  const matchedVariantIds = new Set(
    desiredVariants.flatMap((item) => (item.remote ? [item.remote.id] : []))
  );
  const variantRemovals = before.variants.nodes.filter((item) => !matchedVariantIds.has(item.id));

  const imageMediaInputs = (built.media as Array<Record<string, unknown>>)
    .filter((item) => item.mediaContentType === "IMAGE")
    .map((item) => ({
      originalSource: String(item.originalSource),
      alt: String(item.alt ?? ""),
      mediaContentType: "IMAGE" as const
    }));
  if (imageMediaInputs.length !== images.length) {
    return {
      ok: false,
      status: 409,
      error: "Local image rows and Shopify image payload are not aligned",
      code: "image_payload_mismatch"
    };
  }
  const imageMatch = matchImages(
    images,
    imageMediaInputs,
    before.media.nodes,
    images.some((image) => Boolean(image.shopify_media_id))
  );
  if (imageMatch.identityError) {
    return { ok: false, status: 409, error: imageMatch.identityError, code: "media_identity_conflict" };
  }
  const desiredImages = imageMatch.desired;
  const matchedMediaIds = new Set(
    desiredImages.flatMap((item) => (item.remote && !item.replace ? [item.remote.id] : []))
  );
  const desiredVideoInputs = (built.media as Array<Record<string, unknown>>)
    .filter((item) => item.mediaContentType === "EXTERNAL_VIDEO")
    .map((item) => ({
      originalSource: String(item.originalSource),
      alt: String(item.alt ?? ""),
      mediaContentType: "EXTERNAL_VIDEO" as const
    }));
  const desiredVideoUrls = desiredVideoInputs.map((item) => item.originalSource);
  for (const remote of before.media.nodes) {
    if (remote.mediaContentType === "EXTERNAL_VIDEO" && remote.originUrl && desiredVideoUrls.includes(remote.originUrl)) {
      matchedMediaIds.add(remote.id);
    }
  }
  const mediaRemovals = before.media.nodes.filter(
    (item) =>
      (item.mediaContentType === "IMAGE" || item.mediaContentType === "EXTERNAL_VIDEO") &&
      !matchedMediaIds.has(item.id)
  );
  if (!confirmRemovals && (variantRemovals.length > 0 || mediaRemovals.length > 0)) {
    return {
      ok: false,
      status: 409,
      error: "同步會移除 Shopify 款式或媒體；請先確認移除清單",
      code: "removal_confirmation_required",
      removals: { variants: variantRemovals.length, media: mediaRemovals.length }
    };
  }

  const requestHash = hashJson({ core, seeds, imageMediaInputs, desiredVideoInputs });
  const requestSummary = {
    productId,
    title: core.title,
    variantCount: seeds.length,
    imageCount: imageMediaInputs.length,
    videoCount: desiredVideoInputs.length,
    variantRemovals: variantRemovals.map((item) => item.id),
    mediaRemovals: mediaRemovals.map((item) => item.id),
    forceRemoteOverwrite
  };
  const claim = await claimSyncing(serviceSupabase, draftId);
  if (!claim.ok) {
    return {
      ok: false,
      status: claim.busy ? 409 : 503,
      error: claim.busy
        ? claim.error
        : `Shopify full-sync migration is required before sync: ${claim.error}`,
      code: claim.busy ? "sync_already_running" : "sync_migration_required"
    };
  }

  const job = await createSyncJob(serviceSupabase, {
    draftId,
    productId,
    createdBy,
    requestHash,
    requestPayload: requestSummary
  });
  if (!job.ok) {
    await markSyncState(serviceSupabase, draftId, {
      shopify_sync_status: "error",
      shopify_sync_error: job.error
    });
    return {
      ok: false,
      status: 503,
      error: `Shopify sync audit ledger is unavailable; no remote mutation was sent: ${job.error}`,
      code: "sync_ledger_unavailable"
    };
  }

  let remoteWriteCount = 0;
  const fail = async (code: string, error: unknown, responsePayload: unknown = {}) => {
    const rawErrorMessage = message(error);
    const partial = remoteWriteCount > 0;
    let partialRemoteUpdatedAt: string | null = null;
    if (partial) {
      try {
        partialRemoteUpdatedAt = (await loadSnapshot(productId, caller))?.updatedAt ?? null;
      } catch {
        // Preserve the original failure. Missing readback is reported in the ledger payload.
      }
    }
    const errorMessage = partial
      ? `Shopify 已完成 ${remoteWriteCount} 個步驟後中斷，屬於部分同步：${rawErrorMessage}`
      : rawErrorMessage;
    await markSyncState(serviceSupabase, draftId, {
      shopify_sync_status: partial ? "partial" : "error",
      shopify_sync_error: errorMessage,
      ...(partialRemoteUpdatedAt
        ? { shopify_remote_updated_at: partialRemoteUpdatedAt }
        : {})
    });
    await finishSyncJob(
      serviceSupabase,
      job.id,
      "failed",
      {
        ...((responsePayload && typeof responsePayload === "object") ? responsePayload as object : {}),
        partial,
        remoteWriteCount,
        partialRemoteUpdatedAt
      },
      code,
      errorMessage
    );
    return { ok: false, status: 502, error: errorMessage, code } as SyncShopifyProductResult;
  };

  try {
    const { response, result } = await caller(SYNC_PRODUCT_CORE_MUTATION, { product: core });
    const errors = userErrors(result, "productUpdate");
    if (!response.ok || errors.length > 0) {
      return fail("product_update_failed", errors.length ? errors : result, result);
    }
    remoteWriteCount += 1;

    const locationId = process.env.SHOPIFY_LOCATION_ID?.trim() || null;
    const existingVariantInputs = desiredVariants
      .filter((item) => item.remote)
      .map((item) => buildVariantUpdateInput(item, locationId));
    if (existingVariantInputs.length > 0) {
      const variantUpdate = await caller(SYNC_PRODUCT_VARIANTS_MUTATION, {
        productId,
        variants: existingVariantInputs
      });
      const errors = userErrors(variantUpdate.result, "productVariantsBulkUpdate");
      if (!variantUpdate.response.ok || errors.length > 0) {
        return fail("variant_update_failed", errors.length ? errors : variantUpdate.result, variantUpdate.result);
      }
      remoteWriteCount += 1;
    }

    const newVariants = desiredVariants.filter((item) => !item.remote);
    if (newVariants.length > 0) {
      const needsLocation = newVariants.some(
        (item) => item.seed.inventoryPolicy === "DENY" && Number.isInteger(item.seed.inventoryQuantity)
      );
      if (needsLocation && !locationId) {
        return fail("location_required", "有限庫存新款式需要已確認的 SHOPIFY_LOCATION_ID");
      }
      const createResult = await caller(CREATE_PRODUCT_VARIANTS_MUTATION, {
        productId,
        variants: newVariants.map((item) =>
          toBulkVariantInput(item.seed, {
            includeOptionValues: true,
            locationId,
            inventoryMode: "create"
          })
        )
      });
      const errors = userErrors(createResult.result, "productVariantsBulkCreate");
      if (!createResult.response.ok || errors.length > 0) {
        return fail("variant_create_failed", errors.length ? errors : createResult.result, createResult.result);
      }
      remoteWriteCount += 1;
    }

    if (variantRemovals.length > 0) {
      const deleteResult = await caller(DELETE_PRODUCT_VARIANTS_MUTATION, {
        productId,
        variantsIds: variantRemovals.map((item) => item.id)
      });
      const errors = userErrors(deleteResult.result, "productVariantsBulkDelete");
      if (!deleteResult.response.ok || errors.length > 0) {
        return fail("variant_delete_failed", errors.length ? errors : deleteResult.result, deleteResult.result);
      }
      remoteWriteCount += 1;
    }

    const altUpdates: Array<Record<string, unknown>> = [];
    for (const item of desiredImages) {
      if (item.remote && !item.replace && (item.remote.alt ?? "") !== item.media.alt) {
        altUpdates.push({ id: item.remote.id, alt: item.media.alt });
      }
    }
    if (altUpdates.length > 0) {
      const fileResult = await caller(UPDATE_PRODUCT_FILES_MUTATION, { files: altUpdates });
      const errors = userErrors(fileResult.result, "fileUpdate");
      if (!fileResult.response.ok || errors.length > 0) {
        return fail("media_update_failed", errors.length ? errors : fileResult.result, fileResult.result);
      }
      remoteWriteCount += 1;
    }

    const newImageItems = desiredImages.filter((item) => !item.remote || item.replace);
    const newMedia = [
      ...newImageItems.map((item) => item.media),
      ...desiredVideoInputs.filter(
        (item) =>
          !before?.media.nodes.some(
            (remote) =>
              remote.mediaContentType === "EXTERNAL_VIDEO" && remote.originUrl === item.originalSource
          )
      )
    ];
    if (newMedia.length > 0) {
      const mediaResult = await caller(ADD_PRODUCT_MEDIA_MUTATION, {
        product: { id: productId },
        media: newMedia
      });
      const errors = userErrors(mediaResult.result, "productUpdate");
      if (!mediaResult.response.ok || errors.length > 0) {
        return fail("media_create_failed", errors.length ? errors : mediaResult.result, mediaResult.result);
      }
      remoteWriteCount += 1;
      if (newImageItems.length > 0) {
        const beforeMediaIds = new Set(before.media.nodes.map((item) => item.id));
        const returnedNodes =
          mediaResult.result?.data?.productUpdate?.product?.media?.nodes ?? [];
        const createdImages = returnedNodes.filter(
          (item: any) => item?.mediaContentType === "IMAGE" && !beforeMediaIds.has(item.id)
        );
        if (createdImages.length < newImageItems.length) {
          return fail(
            "media_identity_capture_failed",
            "Shopify 已新增媒體，但回應未提供足夠的新媒體 ID；已停止移除舊媒體",
            { expected: newImageItems.length, received: createdImages.length }
          );
        }
        for (let index = 0; index < newImageItems.length; index += 1) {
          const local = newImageItems[index];
          const created = createdImages[index];
          const { error: identityError } = await serviceSupabase
            .from("product_images")
            .update({
              shopify_media_id: created.id,
              shopify_file_id: created.id,
              shopify_source_hash: local.sourceHash
            })
            .eq("id", local.row.id);
          if (identityError) {
            return fail(
              "media_identity_persistence_failed",
              `Shopify 已新增圖片但本機 identity 保存失敗：${identityError.message}`,
              { mediaId: created.id, imageId: local.row.id }
            );
          }
          local.row.shopify_media_id = created.id;
          local.row.shopify_file_id = created.id;
          local.row.shopify_source_hash = local.sourceHash;
          local.remote = created;
          local.replace = false;
        }
      }
    }

    // Remove product references only after every replacement/new media item was
    // accepted, so a failed add never leaves the product without its old media.
    if (mediaRemovals.length > 0) {
      const removeResult = await caller(UPDATE_PRODUCT_FILES_MUTATION, {
        files: mediaRemovals.map((item) => ({
          id: item.id,
          referencesToRemove: [productId]
        }))
      });
      const errors = userErrors(removeResult.result, "fileUpdate");
      if (!removeResult.response.ok || errors.length > 0) {
        return fail("media_remove_failed", errors.length ? errors : removeResult.result, removeResult.result);
      }
      remoteWriteCount += 1;
    }

    const after = await loadSnapshot(productId, caller);
    if (!after) return fail("remote_deleted_after_sync", "Shopify product disappeared during sync");

    const rematchedVariants = matchVariants(rows, seeds, after.variants.nodes);
    const rematchedImages = matchImages(images, imageMediaInputs, after.media.nodes, false).desired;
    const mismatches = verifyReadback(
      after,
      core,
      rematchedVariants,
      rematchedImages,
      desiredVideoUrls,
      locationId
    );
    if (mismatches.length > 0) {
      return fail(
        "readback_mismatch",
        `Shopify 回讀與工具不一致：${mismatches.join(", ")}`,
        { mismatches, remoteUpdatedAt: after.updatedAt }
      );
    }

    const linkageErrors: string[] = [];
    for (const item of rematchedVariants) {
      if (!item.row || !item.remote) continue;
      const { error } = await serviceSupabase
        .from("product_variants")
        .update({
          shopify_variant_id: item.remote.id,
          shopify_inventory_item_id: item.remote.inventoryItem.id
        })
        .eq("id", item.row.id);
      if (error) linkageErrors.push(`variant ${item.row.id}: ${error.message}`);
    }
    for (const item of rematchedImages) {
      if (!item.remote) continue;
      const { error } = await serviceSupabase
        .from("product_images")
        .update({
          shopify_media_id: item.remote.id,
          shopify_file_id: item.remote.id,
          shopify_source_hash: item.sourceHash
        })
        .eq("id", item.row.id);
      if (error) linkageErrors.push(`image ${item.row.id}: ${error.message}`);
    }
    if (linkageErrors.length > 0) {
      return fail(
        "identity_persistence_failed",
        `Shopify 已同步，但遠端 identity 保存失敗：${linkageErrors.join("; ")}`,
        { remoteUpdatedAt: after.updatedAt, linkageErrors }
      );
    }

    const finalPersistError = await markSyncState(serviceSupabase, draftId, {
      shopify_sync_status: "synced",
      shopify_synced_at: nowIso(),
      shopify_remote_updated_at: after.updatedAt,
      shopify_sync_hash: requestHash,
      shopify_sync_error: null
    });
    if (finalPersistError) {
      return fail(
        "local_persistence_failed",
        `Shopify 已同步但本機狀態保存失敗：${finalPersistError}`,
        { remoteUpdatedAt: after.updatedAt }
      );
    }
    await finishSyncJob(serviceSupabase, job.id, "completed", {
      remoteUpdatedAt: after.updatedAt,
      variantCount: after.variants.nodes.length,
      mediaCount: after.media.nodes.length,
      verified: true
    });
    return { ok: true, productId, remoteUpdatedAt: after.updatedAt, warnings: [] };
  } catch (error) {
    return fail("sync_exception", error);
  }
}
