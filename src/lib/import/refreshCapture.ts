/**
 * CAPTURE-FIX: capturing a URL that already has a draft = refresh it.
 *
 * - Source stock status (source_options.stock) is refreshed on EVERY matching draft.
 * - Per-variant COST is only filled in for unpublished, unconfirmed variants that still follow the
 *   product cost. The server never recomputes the selling price (rates live in each browser), so a
 *   refreshed cost clears the unlocked selling price and the card recalculates it.
 *
 * Pure planning + one write helper. Must stay client-safe (the card imports readPriceRefreshSkuIds):
 * no Shopify code, no image code, never adds or removes variants.
 */
import type { CaptureImportBody, CaptureImportRefreshed, CaptureVariantFlat } from "@/lib/import/captureTypes";
import { isPricePlaceholderCny } from "@/lib/import/captureTypes";
import {
  WARNING_HIDDEN_VARIANT_PRICES,
  WARNING_INTERACT_NEEDS_CONFIRMATION
} from "@/lib/import/captureHiddenPrices";
import { isVariantPriceConfirmed } from "@/lib/shopify/publishReadiness";
import { parseFlatSourceStock, readSourceStock, withSourceStock } from "@/lib/variants/sourceStock";

export type RefreshDraftInput = {
  id: string;
  shopify_product_id: string | null;
  cny_price: number | null;
  warnings: string[] | null;
  raw_capture: unknown;
};

export type RefreshVariantInput = {
  id: string;
  source_sku_id: string | null;
  option1_name: string | null;
  option1_value: string | null;
  option2_name: string | null;
  option2_value: string | null;
  option3_name: string | null;
  option3_value: string | null;
  cny_price: number | null;
  twd_price: number | null;
  compare_at_price: number | null;
  cost_is_inherited: boolean | null;
  sell_price_locked: boolean | null;
  compare_at_locked: boolean | null;
  price_locked: boolean | null;
  source_options: unknown;
};

export type RefreshPlan = {
  priceAllowed: boolean;
  priceSkippedReason: "published" | "confirmed" | null;
  variantUpdates: Array<{ id: string; patch: Record<string, unknown> }>;
  prices: number;
  stock: number;
  draftPatch: { raw_capture: Record<string, unknown>; warnings?: string[]; updated_at: string } | null;
  /** "" when prices === 0 && stock === 0. */
  message: string;
};

const CLEARED_WARNING_PREFIXES = ["逐款讀價：", "sku: 個別未優惠價"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isClearedWarning(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return (
    value === WARNING_HIDDEN_VARIANT_PRICES ||
    value === WARNING_INTERACT_NEEDS_CONFIRMATION ||
    CLEARED_WARNING_PREFIXES.some((prefix) => value.startsWith(prefix))
  );
}

export function formatRefreshMessage(input: {
  prices: number;
  stock: number;
  skipped: "published" | "confirmed" | null;
}): string {
  const { prices, stock, skipped } = input;
  if (prices > 0 && stock > 0) return `已更新 ${prices} 款價格、${stock} 款庫存狀態`;
  if (prices > 0) return `已更新 ${prices} 款價格`;
  if (stock > 0) {
    const base = `已更新 ${stock} 款庫存狀態`;
    if (skipped === "published") return `${base}（已上架，價格沒動）`;
    if (skipped === "confirmed") return `${base}（成本已確認，價格沒動）`;
    return base;
  }
  return "";
}

export function readPriceRefreshSkuIds(rawCapture: unknown): string[] {
  if (!isPlainObject(rawCapture)) return [];
  const server = rawCapture.server;
  if (!isPlainObject(server)) return [];
  const refresh = server.price_refresh;
  if (!isPlainObject(refresh)) return [];
  const ids = refresh.source_sku_ids;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

export function planCaptureRefresh(input: {
  draft: RefreshDraftInput;
  variants: RefreshVariantInput[];
  flats: CaptureVariantFlat[];
  now: string;
}): RefreshPlan {
  const { draft, variants, flats, now } = input;
  const priceAllowed = !draft.shopify_product_id && !isVariantPriceConfirmed(draft.raw_capture);

  const variantBySku = new Map<string, RefreshVariantInput>();
  for (const variant of variants) {
    const key = trimmed(variant.source_sku_id);
    if (key && !variantBySku.has(key)) variantBySku.set(key, variant);
  }

  const variantUpdates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const touchedSkuIds: string[] = [];
  const seenSkus = new Set<string>();
  let prices = 0;
  let stock = 0;
  let wouldUpdate = 0;

  for (const flat of flats) {
    const sku = trimmed(flat?.sku);
    if (!sku || seenSkus.has(sku)) continue;
    seenSkus.add(sku);
    const variant = variantBySku.get(sku);
    if (!variant) continue;

    const patch: Record<string, unknown> = {};

    // 1) Source stock status: every draft, but "unknown" never overwrites a known state.
    const nextStock = parseFlatSourceStock(flat, now);
    if (nextStock && nextStock.status !== "unknown") {
      const prev = readSourceStock(variant.source_options);
      if (!prev || prev.status !== nextStock.status || prev.quantity !== nextStock.quantity) {
        patch.source_options = withSourceStock(
          variant.source_options,
          nextStock,
          [variant.option1_name, variant.option2_name, variant.option3_name],
          [variant.option1_value, variant.option2_value, variant.option3_value]
        );
        stock++;
      }
    }

    // 2) Cost: only variants that still follow the product cost, with a real (non-DOM) price.
    const cny = flat.cny_price;
    const priceSource = trimmed(flat.price_source);
    const costUpdatable =
      variant.cost_is_inherited === true &&
      typeof cny === "number" && Number.isFinite(cny) && cny > 0 &&
      priceSource !== "" && !priceSource.startsWith("dom.");
    if (costUpdatable) {
      wouldUpdate++;
      if (priceAllowed) {
        patch.cny_price = cny;
        patch.cost_is_inherited = false;
        const sellLocked = variant.sell_price_locked ?? variant.price_locked ?? false;
        if (!sellLocked) patch.twd_price = null; // the server has no device exchange rate
        const compareLocked = variant.compare_at_locked ?? variant.price_locked ?? false;
        if (!compareLocked) patch.compare_at_price = null;
        prices++;
        touchedSkuIds.push(sku);
      }
    }

    if (Object.keys(patch).length > 0) variantUpdates.push({ id: variant.id, patch });
  }

  const priceSkippedReason: RefreshPlan["priceSkippedReason"] =
    !priceAllowed && wouldUpdate > 0 ? (draft.shopify_product_id ? "published" : "confirmed") : null;
  const message = formatRefreshMessage({ prices, stock, skipped: priceSkippedReason });

  if (prices === 0 && stock === 0) {
    return { priceAllowed, priceSkippedReason, variantUpdates, prices, stock, draftPatch: null, message };
  }

  const prevRaw = isPlainObject(draft.raw_capture) ? draft.raw_capture : {};
  const prevServer = isPlainObject(prevRaw.server) ? prevRaw.server : {};
  const server: Record<string, unknown> = {
    ...prevServer,
    last_refresh: { at: now, prices, stock, price_skipped: priceSkippedReason }
  };
  if (prices > 0) {
    server.price_refresh = { at: now, count: prices, source_sku_ids: touchedSkuIds };
  }

  let nextWarnings: string[] | undefined;

  // 3) Confirmation flag: recomputed only when some cost changed, and it can only be cleared.
  if (prices > 0) {
    const patchById = new Map(variantUpdates.map((update) => [update.id, update.patch]));
    const unresolved = variants
      .map((variant) => ({ ...variant, ...(patchById.get(variant.id) ?? {}) }) as RefreshVariantInput)
      .filter(
        (variant) =>
          variant.cost_is_inherited !== false && readSourceStock(variant.source_options)?.status !== "sold_out"
      ).length;
    if (
      server.price_requires_confirmation === true &&
      unresolved === 0 &&
      !isPricePlaceholderCny(draft.cny_price) &&
      server.price_confidence !== "conflict"
    ) {
      server.price_requires_confirmation = false;
      let removed = false;
      if (Array.isArray(server.warnings)) {
        const kept = (server.warnings as unknown[]).filter((w) => !isClearedWarning(w));
        if (kept.length !== server.warnings.length) removed = true;
        server.warnings = kept;
      }
      if (Array.isArray(draft.warnings)) {
        const kept = draft.warnings.filter((w) => !isClearedWarning(w));
        if (kept.length !== draft.warnings.length) removed = true;
        if (removed) nextWarnings = kept;
      }
    }
  }

  return {
    priceAllowed,
    priceSkippedReason,
    variantUpdates,
    prices,
    stock,
    draftPatch: {
      raw_capture: { ...prevRaw, server },
      ...(nextWarnings ? { warnings: nextWarnings } : {}),
      updated_at: now
    },
    message
  };
}

/**
 * Applies planCaptureRefresh to an existing draft. Never throws: any failure returns null so the
 * capture request itself still succeeds (the caller then answers with the plain "exists" result).
 * A variant write that fails stops the run and skips the draft write (earlier writes are not rolled back).
 */
export async function refreshExistingCaptureDraft(input: {
  serviceSupabase: any;
  draftId: string;
  body: CaptureImportBody;
  now?: string;
}): Promise<{ draft_id: string; message: string; refreshed: CaptureImportRefreshed["refreshed"] } | null> {
  try {
    const db = input.serviceSupabase;
    const { data: draft, error: draftError } = await db
      .from("product_drafts")
      .select("id, shopify_product_id, cny_price, warnings, raw_capture")
      .eq("id", input.draftId)
      .maybeSingle();
    if (draftError || !draft) return null;

    const { data: variants, error: variantsError } = await db
      .from("product_variants")
      .select(
        "id, source_sku_id, option1_name, option1_value, option2_name, option2_value, option3_name, option3_value, cny_price, twd_price, compare_at_price, cost_is_inherited, sell_price_locked, compare_at_locked, price_locked, source_options"
      )
      .eq("draft_id", input.draftId);
    if (variantsError || !Array.isArray(variants)) return null;

    const plan = planCaptureRefresh({
      draft: draft as RefreshDraftInput,
      variants: variants as RefreshVariantInput[],
      flats: Array.isArray(input.body.variants_flat) ? input.body.variants_flat : [],
      now: input.now ?? new Date().toISOString()
    });
    if (plan.prices === 0 && plan.stock === 0) return null;

    for (const update of plan.variantUpdates) {
      const { error } = await db.from("product_variants").update(update.patch).eq("id", update.id);
      if (error) return null;
    }
    if (plan.draftPatch) {
      const { error } = await db.from("product_drafts").update(plan.draftPatch).eq("id", input.draftId);
      if (error) return null;
    }

    return {
      draft_id: input.draftId,
      message: plan.message,
      refreshed: {
        prices: plan.prices,
        stock: plan.stock,
        price_skipped_reason: plan.priceSkippedReason
      }
    };
  } catch {
    return null;
  }
}
