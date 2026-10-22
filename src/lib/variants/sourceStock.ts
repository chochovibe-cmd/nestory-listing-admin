import type { ShopifyStockMark, SourceStockStatus, VariantSourceOptions, VariantSourceStock } from "./types";

/**
 * CAPTURE-FIX: client-safe helpers for the source (Taobao / Tmall) stock state kept in
 * product_variants.source_options.stock. Pure functions, no I/O.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

export function normalizeSourceStockStatus(value: unknown): SourceStockStatus | null {
  return value === "in_stock" || value === "sold_out" || value === "unknown" ? value : null;
}

/** Reads the extension's `variants_flat` row; a missing / invalid status means "not captured". */
export function parseFlatSourceStock(
  flat: { source_stock_status?: unknown; source_quantity?: unknown } | null | undefined,
  checkedAt: string
): VariantSourceStock | null {
  const status = normalizeSourceStockStatus(flat?.source_stock_status);
  if (!status) return null;
  return { status, quantity: nonNegativeInteger(flat?.source_quantity), checked_at: checkedAt };
}

export function readSourceStock(sourceOptions: unknown): VariantSourceStock | null {
  if (!isPlainObject(sourceOptions)) return null;
  const stock = sourceOptions.stock;
  if (!isPlainObject(stock)) return null;
  const status = normalizeSourceStockStatus(stock.status);
  if (!status) return null;
  return {
    status,
    quantity: nonNegativeInteger(stock.quantity),
    checked_at: typeof stock.checked_at === "string" ? stock.checked_at : ""
  };
}

export function isSourceSoldOut(row: { sourceOptions?: unknown } | null | undefined): boolean {
  return readSourceStock(row?.sourceOptions)?.status === "sold_out";
}

function readPreviousShopifyStock(value: unknown): ShopifyStockMark["prev"] | null {
  if (!isPlainObject(value)) return null;
  const policy = value.policy === "CONTINUE" || value.policy === "DENY" ? value.policy : null;
  const tracked = typeof value.tracked === "boolean" ? value.tracked : null;
  const available =
    value.available === null
      ? null
      : typeof value.available === "number" && Number.isInteger(value.available)
        ? value.available
        : undefined;
  if (!policy || tracked === null || available === undefined) return null;
  return { policy, tracked, available };
}

export function readShopifyStockMark(sourceOptions: unknown): ShopifyStockMark | null {
  if (!isPlainObject(sourceOptions) || !isPlainObject(sourceOptions.shopify_stock)) return null;
  const value = sourceOptions.shopify_stock;
  const applied = value.applied;
  if (applied !== "sold_out" && applied !== "restored") return null;
  if (typeof value.at !== "string") return null;
  if (applied === "restored") {
    return value.prev === null ? { applied, at: value.at, prev: null } : null;
  }
  const prev = readPreviousShopifyStock(value.prev);
  return prev ? { applied, at: value.at, prev } : null;
}

export function isSourceLowStock(sourceOptions: unknown): boolean {
  const stock = readSourceStock(sourceOptions);
  return Boolean(
    stock?.status === "in_stock" &&
      Number.isInteger(stock.quantity) &&
      (stock.quantity as number) >= 1 &&
      (stock.quantity as number) <= 5
  );
}

export function summarizeSourceStockForShopify(
  rows: { shopify_variant_id?: string | null; source_options?: unknown }[]
): { soldOut: number; restorable: number; low: number } {
  let soldOut = 0;
  let restorable = 0;
  let low = 0;
  for (const row of rows) {
    const stock = readSourceStock(row.source_options);
    const mark = readShopifyStockMark(row.source_options);
    if (isSourceLowStock(row.source_options)) low += 1;
    if (stock?.status === "sold_out" && row.shopify_variant_id && mark?.applied !== "sold_out") {
      soldOut += 1;
    }
    if (stock?.status === "in_stock" && mark?.applied === "sold_out") {
      restorable += 1;
    }
  }
  return { soldOut, restorable, low };
}

export function withSourceStock(
  sourceOptions: unknown,
  stock: VariantSourceStock,
  fallbackNames?: Array<string | null>,
  fallbackValues?: Array<string | null>
): VariantSourceOptions {
  if (isPlainObject(sourceOptions)) {
    return {
      ...sourceOptions,
      names: Array.isArray(sourceOptions.names)
        ? (sourceOptions.names as Array<string | null>)
        : (fallbackNames ?? [null, null, null]),
      values: Array.isArray(sourceOptions.values)
        ? (sourceOptions.values as Array<string | null>)
        : (fallbackValues ?? [null, null, null]),
      stock
    };
  }
  return {
    names: fallbackNames ?? [null, null, null],
    values: fallbackValues ?? [null, null, null],
    stock
  };
}
