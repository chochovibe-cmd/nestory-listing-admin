import type { SourceStockStatus, VariantSourceOptions, VariantSourceStock } from "./types";

export function normalizeSourceStockStatus(value: unknown): SourceStockStatus | null {
  return value === "in_stock" || value === "sold_out" || value === "unknown" ? value : null;
}

export function parseFlatSourceStock(
  flat: { source_stock_status?: unknown; source_quantity?: unknown } | null | undefined,
  checkedAt: string
): VariantSourceStock | null {
  const status = normalizeSourceStockStatus(flat?.source_stock_status);
  if (status == null) return null;
  const quantity =
    typeof flat?.source_quantity === "number" &&
    Number.isInteger(flat.source_quantity) &&
    flat.source_quantity >= 0
      ? flat.source_quantity
      : null;
  return { status, quantity, checked_at: checkedAt };
}

export function readSourceStock(sourceOptions: unknown): VariantSourceStock | null {
  if (!sourceOptions || typeof sourceOptions !== "object" || Array.isArray(sourceOptions)) return null;
  const stock = (sourceOptions as { stock?: unknown }).stock;
  if (!stock || typeof stock !== "object" || Array.isArray(stock)) return null;
  const raw = stock as { status?: unknown; quantity?: unknown; checked_at?: unknown };
  const status = normalizeSourceStockStatus(raw.status);
  if (status == null) return null;
  const quantity =
    typeof raw.quantity === "number" && Number.isInteger(raw.quantity) && raw.quantity >= 0
      ? raw.quantity
      : null;
  return {
    status,
    quantity,
    checked_at: typeof raw.checked_at === "string" ? raw.checked_at : ""
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
  if (sourceOptions && typeof sourceOptions === "object" && !Array.isArray(sourceOptions)) {
    const current = sourceOptions as Record<string, unknown>;
    return {
      ...current,
      names: Array.isArray(current.names)
        ? current.names as Array<string | null>
        : (fallbackNames ?? [null, null, null]),
      values: Array.isArray(current.values)
        ? current.values as Array<string | null>
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
