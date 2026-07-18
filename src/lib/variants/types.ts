/** B7 form / pure-helper types (client-safe). */

export const MAX_VARIANT_DIMENSIONS = 3;
/** Soft cap: yellow warning + block adding more rows. */
export const MAX_VARIANT_ROWS = 50;

/**
 * One product option axis.
 * `values` = axis order / UI assist only (jsonb on draft.variant_dimensions; no migration).
 * Actual combos = product_variants rows (source of truth). On conflict, rebuild values from rows.
 */
export type VariantDimension = { name: string; values?: string[] };

export type VariantFormRow = {
  /** Values aligned to dimensions[0..2]; unused slots "". */
  optionValues: [string, string, string];
  /** Cost in the same currency as the product-level cost field. */
  cost: string;
  /** NT$ sell price (formula or manual). */
  sellPrice: string;
  /** NT$ compare-at; empty when single mode. */
  compareAt: string;
  /** ✎ manual lock — formula recalc skips this row. */
  priceLocked: boolean;
  /** Blank = unlimited (continue). */
  qty: string;
  sku: string;
  imageId: string | null;
  sortOrder: number;
};

export type VariantDbInsert = {
  option1_name: string;
  option1_value: string;
  option2_name: string | null;
  option2_value: string | null;
  option3_name: string | null;
  option3_value: string | null;
  sku: string | null;
  cny_price: number | null;
  twd_price: number | null;
  compare_at_price: number | null;
  price_locked: boolean;
  sort_order: number;
  inventory_quantity: number;
  inventory_policy: "deny" | "continue";
  image_id: string | null;
};

/** Shopify productOptions shape for productCreate (names + values). */
export type ShopifyProductOptionInput = {
  name: string;
  values: { name: string }[];
};

/** One variant for publish payload / bulkCreate. */
export type ShopifyVariantSeed = {
  optionValues: { optionName: string; name: string }[];
  price: number;
  compareAtPrice: number | null;
  cost: number;
  sku: string | null;
  inventoryQuantity: number | null;
  inventoryPolicy: "DENY" | "CONTINUE";
  imageId: string | null;
};

export function emptyVariantRow(sortOrder = 0): VariantFormRow {
  return {
    optionValues: ["", "", ""],
    cost: "",
    sellPrice: "",
    compareAt: "",
    priceLocked: false,
    qty: "",
    sku: "",
    imageId: null,
    sortOrder
  };
}

export function isVariantRowFilled(row: VariantFormRow): boolean {
  return row.optionValues.some((v) => v.trim().length > 0);
}
