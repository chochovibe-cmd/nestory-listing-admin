/**
 * 4e DETAIL-LISTING: which detail rows go into the product description, in order
 * (generated_detail first, then detail; each by sort_order). Client-safe — no server imports;
 * the card's 圖片 tab and the Shopify payload both use this order.
 */

export function isDescriptionDetailImageType(imageType: string | null | undefined): boolean {
  return imageType === "detail" || imageType === "generated_detail";
}

export function pickDescriptionDetailRows<T extends { image_type: string; sort_order: number }>(
  images: T[] | null | undefined
): T[] {
  const rows = images ?? [];
  const bySortOrder = (a: T, b: T) => (a.sort_order ?? 0) - (b.sort_order ?? 0);
  const generated = rows.filter((row) => row.image_type === "generated_detail").sort(bySortOrder);
  const detail = rows.filter((row) => row.image_type === "detail").sort(bySortOrder);
  return [...generated, ...detail];
}

