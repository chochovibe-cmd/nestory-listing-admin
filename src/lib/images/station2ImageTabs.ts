/**
 * UX-F T30: station② image subtab filters (main | detail).
 * 4f: the 規格圖 tab is gone (its badge became 文案參考). Rows still marked is_spec_process /
 * image_type=spec show under 主圖 so nothing disappears.
 */

import type { ProductImage } from "@/types/domain";

export type Station2ImageSubtab = "main" | "detail";

export const STATION2_IMAGE_SUBTABS: {
  id: Station2ImageSubtab;
  label: string;
}[] = [
  { id: "main", label: "主圖" },
  { id: "detail", label: "詳情圖" },
];

/** Main / variant product shots (incl. legacy 規格圖-marked rows and image_type=spec). */
export function isMainSubtabImage(
  image: Pick<ProductImage, "image_type" | "is_spec_process">
): boolean {
  return image.image_type === "main" || image.image_type === "variant" || image.image_type === "spec";
}

export function isDetailSubtabImage(image: Pick<ProductImage, "image_type">): boolean {
  return image.image_type === "detail";
}

export function filterStation2SubtabImages<
  T extends Pick<ProductImage, "image_type" | "is_spec_process" | "sort_order" | "created_at">
>(images: T[], tab: Station2ImageSubtab): T[] {
  const filtered = images.filter((img) =>
    tab === "main" ? isMainSubtabImage(img) : isDetailSubtabImage(img)
  );
  return filtered.slice().sort((a, b) => {
    const orderA = a.sort_order ?? 0;
    const orderB = b.sort_order ?? 0;
    if (orderA !== orderB) return orderA - orderB;
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });
}

export function station2SubtabCount(
  images: Array<Pick<ProductImage, "image_type" | "is_spec_process">>,
  tab: Station2ImageSubtab
): number {
  return images.filter((img) =>
    tab === "main" ? isMainSubtabImage(img) : isDetailSubtabImage(img)
  ).length;
}

/** Insert image_type for 補圖 on this subtab. */
export function station2UploadImageType(tab: Station2ImageSubtab): "main" | "detail" {
  return tab === "main" ? "main" : "detail";
}
