/** Shopify 商品圖＝main＋variant（詳情圖、spec 類型不送）。從 payload.ts 搬來，行為不變。 */
export function isShopifyProductMediaImage(image: { image_type: string }): boolean {
  return image.image_type === "main" || image.image_type === "variant";
}

/** 與 payload.ts buildShopifyProductPayload 相同：篩 isShopifyProductMediaImage、依 sort_order 由小到大（穩定排序）。 */
export function sortShopifyMediaImages<T extends { image_type: string; sort_order: number }>(images: T[]): T[] {
  return images
    .filter(isShopifyProductMediaImage)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** Shopify 主圖＝sortShopifyMediaImages 的第一張；沒有就 null。 */
export function pickShopifyMainImage<T extends { image_type: string; sort_order: number }>(images: T[]): T | null {
  return sortShopifyMediaImages(images)[0] ?? null;
}
