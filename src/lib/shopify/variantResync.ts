/**
 * VARIANT-CLEAN: 價格／款式圖重同步 for products that are already live.
 *
 * Deliberately NOT syncShopifyProduct: a full sync rewrites inventory tracking / policy, title,
 * description and media order. This path sends exactly three things per variant —
 * price, compareAtPrice, mediaId — through productVariantsBulkUpdate, one product per request.
 * Names and SKUs of live products are never touched; variants Shopify has under a different
 * name than Nestory are skipped with a visible reason instead of guessed.
 *
 *   previewVariantResync   read-only: Shopify's current prices, which variants need an image bound
 *   applyVariantResync     write: prices (one mutation), images (bindVariantMedia), local mirror,
 *                          audit row in shopify_sync_jobs, shopify_sync_status restored
 */
import {
  bindVariantMedia,
  matchImagesToMedia,
  PRODUCT_MEDIA_BIND_QUERY,
  toRemoteBindVariants,
  type LocalImageRef,
  type RemoteBindVariant,
  type RemoteMediaNode
} from "@/lib/shopify/variantMediaBind";
import { isRealShopifyProductId, type ShopifyAdminGraphQLCaller } from "@/lib/shopify/productLifecycle";
import { isFakeVariantRow } from "@/lib/shopify/publishReadiness";
import { buildVariantPublishPlan, planResumeVariantSync } from "@/lib/variants/shopifyVariants";
import { checkResyncPrice, type ResyncPriceRequest } from "@/lib/variants/priceResyncPlan";
import type { ProductVariantRow } from "@/types/domain";

type Db = { from: (table: string) => any };

export const RESYNC_PRICE_MUTATION = `
  mutation ResyncVariantPrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price compareAtPrice }
      userErrors { field message }
    }
  }
`;

export type ResyncVariantLine = {
  /** product_variants.id; null for a single-variant product */
  rowId: string | null;
  label: string;
  shopifyVariantId: string;
  oldPrice: string | null;
  oldCompareAt: string | null;
  /** an image still has to be bound to this variant */
  needsImage: boolean;
};

export type VariantResyncPreview =
  | {
      ok: true;
      mock: false;
      draftId: string;
      title: string;
      productId: string;
      lines: ResyncVariantLine[];
      /** Nestory rows Shopify no longer has (deleted there): informational, left alone */
      localOnly: string[];
      /** Shopify variants Nestory has no row for: informational, never touched */
      remoteOnly: string[];
      /** why this product cannot be resynced safely, else null */
      skipReason: string | null;
    }
  | { ok: true; mock: true; draftId: string; title: string; note: string }
  | { ok: false; status: number; error: string };

export type MatchedVariant = { row: ProductVariantRow; remote: RemoteBindVariant };

/** Rows that carry option values at all (fake options included). Empty = single-variant product. */
function optionRows(rows: ProductVariantRow[]): ProductVariantRow[] {
  return [...rows]
    .filter((r) => Boolean(r.option1_value?.trim() || r.option2_value?.trim() || r.option3_value?.trim()))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

/** Sellable rows only: non-product options (購買須知／勿拍…) are never priced nor counted as unmatched. */
function validRows(rows: ProductVariantRow[]): ProductVariantRow[] {
  return optionRows(rows).filter((r) => !isFakeVariantRow(r));
}

function rowLabel(row: ProductVariantRow): string {
  return [row.option1_value, row.option2_value, row.option3_value]
    .map((v) => (v ?? "").trim())
    .filter(Boolean)
    .join("／");
}

/**
 * Local variant row -> Shopify variant. Order: saved shopify_variant_id, then option name/value
 * pairs, then SKU (same engine as the publish retry). Strict: no positional guessing.
 * Fake (non-product) rows are left out entirely. Rows Shopify no longer has (deleted there) and
 * Shopify variants Nestory has no row for are NOT blockers; they are reported and left alone.
 */
export function matchRowsToRemote(
  rows: ProductVariantRow[],
  remote: RemoteBindVariant[],
  draft: { cny_price?: number | null; twd_cost?: number | null; price_mode?: string | null }
): { matched: MatchedVariant[]; unmatched: ProductVariantRow[]; remoteOnly: RemoteBindVariant[] } {
  const sorted = validRows(rows);
  const remoteIds = new Set(remote.map((v) => v.id));
  const matched: MatchedVariant[] = [];
  const claimed = new Set<string>();
  const rest: ProductVariantRow[] = [];

  for (const row of sorted) {
    const id = row.shopify_variant_id;
    if (id && remoteIds.has(id) && !claimed.has(id)) {
      claimed.add(id);
      matched.push({ row, remote: remote.find((v) => v.id === id)! });
    } else {
      rest.push(row);
    }
  }
  const remoteLeft = () => remote.filter((v) => !matched.some((m) => m.remote.id === v.id));
  if (rest.length === 0) return { matched, unmatched: [], remoteOnly: remoteLeft() };

  const plan = buildVariantPublishPlan(rest, draft);
  if (plan.mode !== "multi") return { matched, unmatched: rest, remoteOnly: remoteLeft() };
  const resume = planResumeVariantSync(
    plan.all,
    remote.filter((v) => !claimed.has(v.id))
  );
  const unmatched: ProductVariantRow[] = [];
  plan.all.forEach((seed, index) => {
    const hit = resume.matched.find((m) => m.seed === seed);
    if (hit) matched.push({ row: rest[index], remote: remote.find((v) => v.id === hit.variantId)! });
    else unmatched.push(rest[index]);
  });
  return { matched, unmatched, remoteOnly: remoteLeft() };
}

function imageRefs(images: any[]): LocalImageRef[] {
  return (images ?? []).map((image) => ({
    id: image.id as string,
    url: (image.processed_file_url || image.original_file_url || image.generated_file_url || null) as string | null,
    alt: (image.alt_text as string | null) ?? null,
    shopifyMediaId: (image.shopify_media_id as string | null) ?? null,
    inProductMedia: image.image_type === "main" || image.image_type === "variant"
  }));
}

async function loadResyncContext(db: Db, caller: ShopifyAdminGraphQLCaller, draftId: string) {
  const { data: draft, error } = await db
    .from("product_drafts")
    .select("*, product_images(*)")
    .eq("id", draftId)
    .maybeSingle();
  if (error || !draft) return { ok: false as const, status: 404, error: error?.message ?? "找不到草稿" };
  if (draft.status !== "active_published") {
    return { ok: false as const, status: 409, error: "只有已正式上架（active_published）的商品可以重同步價格" };
  }
  if (!isRealShopifyProductId(draft.shopify_product_id)) {
    return { ok: false as const, status: 409, error: "這個草稿沒有對應的 Shopify 商品" };
  }
  const { data: rows, error: rowsError } = await db
    .from("product_variants")
    .select("*")
    .eq("draft_id", draftId)
    .order("sort_order", { ascending: true });
  if (rowsError) return { ok: false as const, status: 500, error: `讀取款式失敗：${rowsError.message}` };

  const { response, result } = await caller(PRODUCT_MEDIA_BIND_QUERY, { id: draft.shopify_product_id });
  const product = result?.data?.product;
  if (!response.ok || product?.id !== draft.shopify_product_id || (Array.isArray(result?.errors) && result.errors.length > 0)) {
    return { ok: false as const, status: 502, error: "讀不到 Shopify 上的這個商品（可能已被刪除或權限不足）" };
  }
  if (product.variants?.pageInfo?.hasNextPage === true) {
    return { ok: false as const, status: 409, error: "Shopify 上的款式超過 100 個，無法安全對應" };
  }
  return {
    ok: true as const,
    draft,
    rows: (rows ?? []) as ProductVariantRow[],
    remoteVariants: toRemoteBindVariants(product.variants?.nodes),
    remoteMedia: (product.media?.nodes ?? []) as RemoteMediaNode[]
  };
}

export async function previewVariantResync(input: {
  serviceSupabase: Db;
  caller: ShopifyAdminGraphQLCaller;
  draftId: string;
  mockMode: boolean;
}): Promise<VariantResyncPreview> {
  if (input.mockMode) {
    const { data } = await input.serviceSupabase.from("product_drafts").select("title_zh").eq("id", input.draftId).maybeSingle();
    return {
      ok: true,
      mock: true,
      draftId: input.draftId,
      title: data?.title_zh ?? "",
      note: "模擬模式：不查詢 Shopify，也不會寫入任何東西"
    };
  }
  const ctx = await loadResyncContext(input.serviceSupabase, input.caller, input.draftId);
  if (!ctx.ok) return ctx;
  const title = ctx.draft.title_zh || ctx.draft.taobao_title || "未命名";
  const base = { ok: true as const, mock: false as const, draftId: input.draftId, title, productId: ctx.draft.shopify_product_id as string };
  const fmt = (v: unknown) => (v == null ? null : String(v));

  if (optionRows(ctx.rows).length === 0) {
    if (ctx.remoteVariants.length !== 1) {
      return { ...base, lines: [], localOnly: [], remoteOnly: [], skipReason: `Shopify 上有 ${ctx.remoteVariants.length} 個款式，但系統是單一款式，無法安全對應` };
    }
    const only = ctx.remoteVariants[0];
    return {
      ...base,
      lines: [{ rowId: null, label: "單一款式", shopifyVariantId: only.id, oldPrice: fmt(only.price), oldCompareAt: fmt(only.compareAtPrice), needsImage: false }],
      localOnly: [],
      remoteOnly: [],
      skipReason: null
    };
  }

  const { matched, unmatched, remoteOnly } = matchRowsToRemote(ctx.rows, ctx.remoteVariants, ctx.draft);
  const remoteOnlyLabels = remoteOnly.map((v) => v.title || v.selectedOptions.map((o) => o.value).join("／") || v.id);
  if (matched.length === 0) {
    return {
      ...base,
      lines: [],
      localOnly: unmatched.map(rowLabel),
      remoteOnly: remoteOnlyLabels,
      skipReason: "Shopify 上沒有任何款式能和系統的款式對應（名稱不同，不會亂猜）"
    };
  }

  const refs = imageRefs(ctx.draft.product_images);
  const wantedIds = new Set(matched.map((m) => m.row.image_id).filter((id): id is string => Boolean(id)));
  const match = matchImagesToMedia(refs.filter((r) => wantedIds.has(r.id)), ctx.remoteMedia);
  // Bind need per matched variant: a wanted image that is not (yet) what this variant shows.
  const needs = matched.map(({ row, remote }) => {
    if (!row.image_id) return false;
    const mediaId = match.byImageId.get(row.image_id);
    const current = remote.media?.nodes?.[0]?.id ?? null;
    return !mediaId || current !== mediaId;
  });

  return {
    ...base,
    lines: matched.map(({ row, remote }, index) => ({
      rowId: row.id,
      label: rowLabel(row),
      shopifyVariantId: remote.id,
      oldPrice: fmt(remote.price),
      oldCompareAt: fmt(remote.compareAtPrice),
      needsImage: needs[index]
    })),
    localOnly: unmatched.map(rowLabel),
    remoteOnly: remoteOnlyLabels,
    skipReason: null
  };
}

export type ResyncApplyRequest = {
  /** One entry per variant (rowId null = the single variant). */
  variants: Array<{ rowId: string | null } & ResyncPriceRequest>;
  /** also bind variant images that are not bound yet */
  bindImages: boolean;
};

export type VariantResyncResult =
  | {
      ok: true;
      mock: boolean;
      pricesUpdated: number;
      imagesBound: number;
      warnings: string[];
      /** exactly what was sent (mock: what would be sent) */
      sentVariants: Array<{ id: string; price: string; compareAtPrice: string | null }>;
    }
  | { ok: false; status: number; error: string };

/** Pure: the price mutation variables. Only id / price / compareAtPrice, only where Shopify differs. */
export function buildResyncPriceVariants(
  matched: Array<{ remote: RemoteBindVariant; price: number; compareAtPrice: number | null }>
): Array<{ id: string; price: string; compareAtPrice: string | null }> {
  const same = (a: unknown, b: string | null) =>
    (a == null || a === "" ? null : Number(a)) === (b == null ? null : Number(b));
  return matched
    .map((m) => ({
      id: m.remote.id,
      price: String(m.price),
      compareAtPrice: m.compareAtPrice != null ? String(m.compareAtPrice) : null,
      differs: !same(m.remote.price, String(m.price)) || !same(m.remote.compareAtPrice, m.compareAtPrice != null ? String(m.compareAtPrice) : null)
    }))
    .filter((v) => v.differs)
    .map(({ id, price, compareAtPrice }) => ({ id, price, compareAtPrice }));
}

export async function applyVariantResync(input: {
  serviceSupabase: Db;
  caller: ShopifyAdminGraphQLCaller;
  draftId: string;
  request: ResyncApplyRequest;
  mockMode: boolean;
  actorId: string | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** ms epoch after which no new media wait starts (60s request budget) */
  deadlineAt?: number;
}): Promise<VariantResyncResult> {
  const { serviceSupabase: db, caller, draftId, request } = input;
  const clock = input.now ?? (() => Date.now());
  const deadlineAt = input.deadlineAt ?? clock() + 45_000;

  if (!Array.isArray(request?.variants) || request.variants.length === 0) {
    return { ok: false, status: 400, error: "沒有要同步的價格" };
  }
  for (const v of request.variants) {
    const problem = checkResyncPrice(v);
    if (problem) return { ok: false, status: 400, error: problem };
  }

  if (input.mockMode) {
    return {
      ok: true,
      mock: true,
      pricesUpdated: 0,
      imagesBound: 0,
      warnings: ["模擬模式：沒有寫入 Shopify，也沒有改本地資料"],
      sentVariants: []
    };
  }

  const ctx = await loadResyncContext(db, caller, draftId);
  if (!ctx.ok) return ctx;
  if (ctx.draft.shopify_sync_status === "syncing") {
    return { ok: false, status: 409, error: "這個商品正在進行 Shopify 同步，請稍後再試" };
  }
  const priorSyncStatus = (ctx.draft.shopify_sync_status as string | null) ?? null;
  const startedAt = new Date(clock()).toISOString();

  // ---- map requested prices onto Shopify variants -------------------------------------------
  type Target = { row: ProductVariantRow | null; remote: RemoteBindVariant; price: number; compareAtPrice: number | null };
  const targets: Target[] = [];
  if (optionRows(ctx.rows).length === 0) {
    if (ctx.remoteVariants.length !== 1 || request.variants.length !== 1) {
      return { ok: false, status: 409, error: "Shopify 上的款式數量和系統不同，無法安全對應" };
    }
    targets.push({ row: null, remote: ctx.remoteVariants[0], price: request.variants[0].price, compareAtPrice: request.variants[0].compareAtPrice });
  } else {
    // Same rule as the preview: only strictly matched variants are touched. Rows Shopify no longer
    // has, and Shopify variants Nestory has no row for, are simply left alone.
    const { matched } = matchRowsToRemote(ctx.rows, ctx.remoteVariants, ctx.draft);
    if (matched.length === 0) {
      return { ok: false, status: 409, error: "Shopify 上沒有任何款式能和系統的款式對應，已略過" };
    }
    for (const req of request.variants) {
      const hit = matched.find((m) => m.row.id === req.rowId);
      if (!hit) continue;
      targets.push({ row: hit.row, remote: hit.remote, price: req.price, compareAtPrice: req.compareAtPrice });
    }
    if (targets.length === 0) {
      return { ok: false, status: 409, error: "要同步的款式已經被修改，請重新整理清單" };
    }
  }

  const priceVariants = buildResyncPriceVariants(
    targets.map((t) => ({ remote: t.remote, price: t.price, compareAtPrice: t.compareAtPrice }))
  );
  const warnings: string[] = [];
  const audit = async (status: "completed" | "failed", response: unknown, error?: string) => {
    try {
      await db.from("shopify_sync_jobs").insert({
        draft_id: draftId,
        operation: "update",
        status,
        shopify_product_id: ctx.draft.shopify_product_id,
        request_payload: { kind: "variant_price_resync", variants: priceVariants, bindImages: request.bindImages },
        response_payload: response ?? {},
        error_message: error ?? null,
        created_by: input.actorId,
        started_at: startedAt,
        completed_at: new Date(clock()).toISOString()
      });
    } catch {
      // The audit table is optional until its migration is applied; never block the sync on it.
    }
  };

  // ---- 1) prices (one mutation, three allowed fields) ---------------------------------------
  if (priceVariants.length > 0) {
    const { response, result } = await caller(RESYNC_PRICE_MUTATION, {
      productId: ctx.draft.shopify_product_id,
      variants: priceVariants
    });
    const errors = result?.data?.productVariantsBulkUpdate?.userErrors;
    const failed = !response.ok || (Array.isArray(errors) && errors.length > 0) || (Array.isArray(result?.errors) && result.errors.length > 0);
    if (failed) {
      const message = `Shopify 價格更新失敗：${JSON.stringify(errors?.length ? errors : result?.errors ?? result).slice(0, 240)}`;
      await audit("failed", result, message);
      return { ok: false, status: 502, error: message };
    }
  }

  // ---- 2) images (best effort, warning only) ------------------------------------------------
  let imagesBound = 0;
  if (request.bindImages) {
    // The publish seeds carry the real option pairs, so bindVariantMedia finds each variant again.
    const full = buildVariantPublishPlan(
      targets.map((t) => t.row).filter((row): row is ProductVariantRow => row != null),
      ctx.draft
    );
    if (full.mode === "multi" && targets.some((t) => t.row?.image_id)) {
      const bound = await bindVariantMedia({
        caller,
        productId: ctx.draft.shopify_product_id,
        seeds: full.all,
        localImages: imageRefs(ctx.draft.product_images),
        deadlineAt,
        now: clock,
        ...(input.sleep ? { sleep: input.sleep } : {})
      });
      imagesBound = bound.bound;
      warnings.push(...bound.warnings);
      for (const [imageId, mediaId] of bound.imageMediaIds) {
        await db.from("product_images").update({ shopify_media_id: mediaId }).eq("id", imageId);
      }
    }
  }

  // ---- 3) local mirror: twd_price / compare_at_price now equal Shopify -----------------------
  for (const t of targets) {
    if (t.row) {
      await db
        .from("product_variants")
        .update({ twd_price: t.price, compare_at_price: t.compareAtPrice })
        .eq("id", t.row.id);
    } else {
      await db.from("product_drafts").update({ twd_price: t.price, compare_at_price: t.compareAtPrice }).eq("id", draftId);
    }
  }
  // Those writes flip shopify_sync_status to 'dirty' (trigger). The data is in sync, so put the
  // status back — otherwise the card would invite a full sync, which this tool exists to avoid.
  if (priorSyncStatus && priorSyncStatus !== "syncing") {
    await db.from("product_drafts").update({ shopify_sync_status: priorSyncStatus }).eq("id", draftId);
  }

  await audit("completed", { pricesUpdated: priceVariants.length, imagesBound, warnings });
  return { ok: true, mock: false, pricesUpdated: priceVariants.length, imagesBound, warnings, sentVariants: priceVariants };
}

