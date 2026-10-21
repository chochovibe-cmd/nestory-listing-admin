import type {
  CaptureImportBody,
  CaptureImportRefreshed,
  CaptureVariantFlat
} from "@/lib/import/captureTypes";
import { isPricePlaceholderCny } from "@/lib/import/captureTypes";
import {
  WARNING_HIDDEN_VARIANT_PRICES,
  WARNING_INTERACT_NEEDS_CONFIRMATION
} from "@/lib/import/captureHiddenPrices";
import { isVariantPriceConfirmed } from "@/lib/shopify/publishReadiness";
import {
  parseFlatSourceStock,
  readSourceStock,
  withSourceStock
} from "@/lib/variants/sourceStock";

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
  message: string;
};

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizedSku(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const sku = value.trim();
  return sku || null;
}

function cleanWarningList(value: unknown): { next: string[] | null; changed: boolean } {
  if (!Array.isArray(value)) return { next: null, changed: false };
  const next = value.filter((item) => {
    if (typeof item !== "string") return true;
    return item !== WARNING_HIDDEN_VARIANT_PRICES &&
      item !== WARNING_INTERACT_NEEDS_CONFIRMATION &&
      !item.startsWith("逐款讀價：") &&
      !item.startsWith("sku: 個別未優惠價");
  });
  return { next: next as string[], changed: next.length !== value.length };
}

export function formatRefreshMessage(input: {
  prices: number;
  stock: number;
  skipped: "published" | "confirmed" | null;
}): string {
  if (input.prices > 0 && input.stock > 0) {
    return `已更新 ${input.prices} 款價格、${input.stock} 款庫存狀態`;
  }
  if (input.prices > 0) return `已更新 ${input.prices} 款價格`;
  if (input.stock > 0) {
    const suffix = input.skipped === "published"
      ? "（已上架，價格沒動）"
      : input.skipped === "confirmed"
        ? "（成本已確認，價格沒動）"
        : "";
    return `已更新 ${input.stock} 款庫存狀態${suffix}`;
  }
  return "";
}

export function readPriceRefreshSkuIds(rawCapture: unknown): string[] {
  const raw = recordOf(rawCapture);
  const server = recordOf(raw.server);
  const refresh = recordOf(server.price_refresh);
  if (!Array.isArray(refresh.source_sku_ids)) return [];
  return refresh.source_sku_ids.filter((value): value is string => typeof value === "string");
}

export function planCaptureRefresh(input: {
  draft: RefreshDraftInput;
  variants: RefreshVariantInput[];
  flats: CaptureVariantFlat[];
  now: string;
}): RefreshPlan {
  const priceAllowed =
    !input.draft.shopify_product_id &&
    !isVariantPriceConfirmed(input.draft.raw_capture);
  const bySku = new Map<string, RefreshVariantInput>();
  for (const variant of input.variants) {
    const sku = normalizedSku(variant.source_sku_id);
    if (sku && !bySku.has(sku)) bySku.set(sku, variant);
  }

  const updates = new Map<string, Record<string, unknown>>();
  const touchedSkuIds: string[] = [];
  const seenFlats = new Set<string>();
  let prices = 0;
  let stock = 0;
  let wouldUpdate = 0;

  for (const flat of input.flats) {
    const sku = normalizedSku(flat.sku);
    if (!sku || seenFlats.has(sku)) continue;
    seenFlats.add(sku);
    const variant = bySku.get(sku);
    if (!variant) continue;

    const patch = updates.get(variant.id) ?? {};
    const sourceStock = parseFlatSourceStock(flat, input.now);
    if (sourceStock && sourceStock.status !== "unknown") {
      const old = readSourceStock(variant.source_options);
      if (!old || old.status !== sourceStock.status || old.quantity !== sourceStock.quantity) {
        patch.source_options = withSourceStock(
          variant.source_options,
          sourceStock,
          [variant.option1_name, variant.option2_name, variant.option3_name],
          [variant.option1_value, variant.option2_value, variant.option3_value]
        );
        stock += 1;
      }
    }

    const priceSource = typeof flat.price_source === "string" ? flat.price_source.trim() : "";
    const cny = typeof flat.cny_price === "number" && Number.isFinite(flat.cny_price) && flat.cny_price > 0
      ? flat.cny_price
      : null;
    const priceCandidate =
      variant.cost_is_inherited === true &&
      cny != null &&
      priceSource.length > 0 &&
      !priceSource.startsWith("dom.");
    if (priceCandidate) {
      wouldUpdate += 1;
      if (priceAllowed) {
        patch.cny_price = cny;
        patch.cost_is_inherited = false;
        const sellLocked = variant.sell_price_locked ?? variant.price_locked ?? false;
        const compareLocked = variant.compare_at_locked ?? variant.price_locked ?? false;
        if (!sellLocked) patch.twd_price = null;
        if (!compareLocked) patch.compare_at_price = null;
        prices += 1;
        touchedSkuIds.push(sku);
      }
    }

    if (Object.keys(patch).length > 0) updates.set(variant.id, patch);
  }

  const priceSkippedReason: "published" | "confirmed" | null =
    !priceAllowed && wouldUpdate > 0
      ? input.draft.shopify_product_id ? "published" : "confirmed"
      : null;

  const raw = { ...recordOf(input.draft.raw_capture) };
  const originalServer = recordOf(raw.server);
  const server: Record<string, unknown> = { ...originalServer };
  let draftWarnings: string[] | undefined;

  if (prices > 0) {
    const projected = input.variants.map((variant) => {
      const patch = updates.get(variant.id) ?? {};
      return {
        ...variant,
        ...patch,
        source_options: Object.prototype.hasOwnProperty.call(patch, "source_options")
          ? patch.source_options
          : variant.source_options
      };
    });
    const unresolved = projected.filter(
      (variant) =>
        variant.cost_is_inherited !== false &&
        readSourceStock(variant.source_options)?.status !== "sold_out"
    ).length;
    if (
      server.price_requires_confirmation === true &&
      unresolved === 0 &&
      !isPricePlaceholderCny(input.draft.cny_price) &&
      server.price_confidence !== "conflict"
    ) {
      server.price_requires_confirmation = false;
      const draftClean = cleanWarningList(input.draft.warnings);
      if (draftClean.changed && draftClean.next) draftWarnings = draftClean.next;
      const serverClean = cleanWarningList(server.warnings);
      if (serverClean.changed && serverClean.next) server.warnings = serverClean.next;
    }
  }

  let draftPatch: RefreshPlan["draftPatch"] = null;
  if (prices > 0 || stock > 0) {
    server.last_refresh = {
      at: input.now,
      prices,
      stock,
      price_skipped: priceSkippedReason
    };
    if (prices > 0) {
      server.price_refresh = {
        at: input.now,
        count: prices,
        source_sku_ids: touchedSkuIds
      };
    }
    raw.server = server;
    draftPatch = {
      raw_capture: raw,
      ...(draftWarnings ? { warnings: draftWarnings } : {}),
      updated_at: input.now
    };
  }

  return {
    priceAllowed,
    priceSkippedReason,
    variantUpdates: input.variants
      .filter((variant) => updates.has(variant.id))
      .map((variant) => ({ id: variant.id, patch: updates.get(variant.id) as Record<string, unknown> })),
    prices,
    stock,
    draftPatch,
    message: formatRefreshMessage({ prices, stock, skipped: priceSkippedReason })
  };
}

export async function refreshExistingCaptureDraft(input: {
  serviceSupabase: any;
  draftId: string;
  body: CaptureImportBody;
  now?: string;
}): Promise<{
  draft_id: string;
  message: string;
  refreshed: CaptureImportRefreshed["refreshed"];
} | null> {
  try {
    const db = input.serviceSupabase;
    const { data: draft, error: draftError } = await db
      .from("product_drafts")
      .select("id, shopify_product_id, cny_price, warnings, raw_capture")
      .eq("id", input.draftId)
      .maybeSingle();
    if (draftError || !draft) return null;

    const { data: variants, error: variantError } = await db
      .from("product_variants")
      .select("id, source_sku_id, option1_name, option1_value, option2_name, option2_value, option3_name, option3_value, cny_price, twd_price, compare_at_price, cost_is_inherited, sell_price_locked, compare_at_locked, price_locked, source_options")
      .eq("draft_id", input.draftId);
    if (variantError || !Array.isArray(variants)) return null;

    const plan = planCaptureRefresh({
      draft,
      variants,
      flats: input.body.variants_flat ?? [],
      now: input.now ?? new Date().toISOString()
    });
    if (plan.prices === 0 && plan.stock === 0) return null;

    for (const item of plan.variantUpdates) {
      const { error } = await db.from("product_variants").update(item.patch).eq("id", item.id);
      if (error) return null;
    }
    if (!plan.draftPatch) return null;
    const { error: patchError } = await db.from("product_drafts").update(plan.draftPatch).eq("id", input.draftId);
    if (patchError) return null;

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
