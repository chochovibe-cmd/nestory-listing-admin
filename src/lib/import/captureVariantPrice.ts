/**
 * CAPTURE-TRUTH-A r6: decide whether a captured SKU cost is stored explicitly
 * or collapsed to "inherit product cost" (NULL + cost_is_inherited).
 *
 * - A price the adapter read from the SKU's own source (skuCore.price,
 *   dom.selected_sku, ...) is evidence and stays explicit even when it equals
 *   the product baseline (2026-10-11: six Pokémon SKUs at 18.9, Hollybox combos
 *   at 79.8 were lost to NULL by the old C1 rule).
 * - Legacy/unsourced rows that merely repeat the product price still collapse,
 *   preserving CAP-2.6 / 87 C1 behaviour for older extension builds.
 *
 * Dependency-free so scripts/verify-cap1.mjs can import it directly.
 */
export function keepOrInheritVariantCny(
  cny: number | null,
  product: number | null,
  ownPriceSource: string | null
): number | null {
  if (cny == null || product == null) return cny;
  if (ownPriceSource) return cny;
  return Math.abs(cny - product) < 0.001 ? null : cny;
}
