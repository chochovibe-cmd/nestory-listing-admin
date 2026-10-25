import type { ExcludedDetailImage } from "@/lib/import/captureSharedImages";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** 4a: detail images the capture import kept out as shop-shared promos (raw_capture.server.excluded_detail_images). */
export function readExcludedDetailImages(rawCapture: unknown): ExcludedDetailImage[] {
  if (!isPlainObject(rawCapture) || !isPlainObject(rawCapture.server)) return [];
  const list = rawCapture.server.excluded_detail_images;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (e): e is ExcludedDetailImage => isPlainObject(e) && typeof e.url === "string" && typeof e.key === "string"
  );
}

export function planRestoreExcludedDetailImage(
  rawCapture: unknown,
  input: { index: number; url: string; published: boolean }
):
  | { ok: true; entry: ExcludedDetailImage; nextServer: Record<string, unknown> }
  | { ok: false; status: 404 | 409; error: string } {
  if (input.published) return { ok: false, status: 409, error: "已上架的商品請到 Shopify 後台加圖" };
  const list = readExcludedDetailImages(rawCapture);
  const entry = list[input.index];
  if (!entry || entry.url !== input.url) {
    return { ok: false, status: 404, error: "找不到這張已排除的圖（可能已經加回）" };
  }
  const server = isPlainObject(rawCapture) && isPlainObject(rawCapture.server) ? rawCapture.server : {};
  return { ok: true, entry, nextServer: { ...server, excluded_detail_images: list.filter((_, i) => i !== input.index) } };
}
