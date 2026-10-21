import type { SourceStockStatus, VariantSourceOptions, VariantSourceStock } from "./types";

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
