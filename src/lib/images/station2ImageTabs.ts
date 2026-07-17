/**
 * UX-F T30: station② image subtab filters (main | spec | detail).
 * Spec = mark semantics (is_spec_process / image_type=spec), not OCR upload.
 */

import type { ProductImage } from "@/types/domain";

export type Station2ImageSubtab = "main" | "spec" | "detail";

export const STATION2_IMAGE_SUBTABS: {
  id: Station2ImageSubtab;
  label: string;
}[] = [
  { id: "main", label: "主圖" },
  { id: "spec", label: "規格圖" },
  { id: "detail", label: "詳情圖" },
];

export function isSpecImage(
  image: Pick<ProductImage, "image_type" | "is_spec_process">
): boolean {
  return Boolean(image.is_spec_process) || image.image_type === "spec";
}

/** Main / variant product shots that are not marked as 規格圖. */
export function isMainSubtabImage(
  image: Pick<ProductImage, "image_type" | "is_spec_process">
): boolean {
  if (isSpecImage(image)) return false;
  return image.image_type === "main" || image.image_type === "variant";
}

export function isDetailSubtabImage(image: Pick<ProductImage, "image_type">): boolean {
  return image.image_type === "detail";
}

export function filterStation2SubtabImages<
  T extends Pick<ProductImage, "image_type" | "is_spec_process" | "sort_order" | "created_at">
>(images: T[], tab: Station2ImageSubtab): T[] {
  const filtered = images.filter((img) => {
    if (tab === "main") return isMainSubtabImage(img);
    if (tab === "spec") return isSpecImage(img);
    return isDetailSubtabImage(img);
  });
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
  return images.filter((img) => {
    if (tab === "main") return isMainSubtabImage(img);
    if (tab === "spec") return isSpecImage(img);
    return isDetailSubtabImage(img);
  }).length;
}

/** Insert image_type for 補圖 on this subtab (spec has no upload). */
export function station2UploadImageType(
  tab: Station2ImageSubtab
): "main" | "detail" | null {
  if (tab === "main") return "main";
  if (tab === "detail") return "detail";
  return null;
}
