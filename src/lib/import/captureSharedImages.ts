import { extractUrlMatchKey } from "@/lib/drafts/checkDuplicate";

export const SHARED_IMAGE_MIN_OTHER_ITEMS = 2;
/** Newest drafts scanned for shared images (raw_capture.payload.detail_image_urls only). */
export const SHARED_IMAGE_HISTORY_LIMIT = 300;

export type ExcludedDetailImage = { url: string; key: string; reason: "shop_shared"; other_items: number };
export type DetailImageHistoryRow = { source_url: string | null; detail_image_urls: unknown };

export function detailImageKey(url: string): string | null {
  const id = String(url || "").match(/O1CN[0-9A-Za-z]+/);
  if (id) return id[0];
  try {
    const u = new URL(url);
    const path = u.pathname
      .replace(/\.(jpg|jpeg|png|webp)_\.webp$/i, ".$1")
      .replace(/_\.webp$/i, "")
      .replace(/_\d+x\d+(?:q\d+)?(\.\w+)?$/i, "$1")
      .replace(/_q\d+(\.\w+)?$/i, "$1");
    return u.hostname.toLowerCase() + path;
  } catch {
    return null;
  }
}

export function pickSharedDetailImages(input: {
  detailImageUrls: string[];
  sourceUrl: string;
  history: DetailImageHistoryRow[];
}): { kept: string[]; excluded: ExcludedDetailImage[]; skipped: "too_many" | null } {
  const current = extractUrlMatchKey(input.sourceUrl || "");
  const itemsByKey = new Map<string, Set<string>>();
  for (const row of input.history) {
    if (!row.source_url || !Array.isArray(row.detail_image_urls)) continue;
    const item = extractUrlMatchKey(row.source_url);
    if (!item || item === current) continue;
    for (const url of row.detail_image_urls) {
      const key = typeof url === "string" ? detailImageKey(url) : null;
      if (!key) continue;
      if (!itemsByKey.has(key)) itemsByKey.set(key, new Set());
      itemsByKey.get(key)!.add(item);
    }
  }
  const kept: string[] = [];
  const excluded: ExcludedDetailImage[] = [];
  for (const url of input.detailImageUrls) {
    const key = detailImageKey(url);
    const otherItems = key ? itemsByKey.get(key)?.size ?? 0 : 0;
    if (key && otherItems >= SHARED_IMAGE_MIN_OTHER_ITEMS) {
      excluded.push({ url, key, reason: "shop_shared", other_items: otherItems });
    } else {
      kept.push(url);
    }
  }
  if (excluded.length * 2 > input.detailImageUrls.length) {
    return { kept: [...input.detailImageUrls], excluded: [], skipped: "too_many" };
  }
  return { kept, excluded, skipped: null };
}

export function formatSharedImagesExcludedWarning(count: number): string {
  return `已排除 ${count} 張店家共用宣傳圖（可在圖片頁籤加回）`;
}

/** Never throws: a failed read returns null and the caller imports every image as before. */
export async function loadDetailImageHistory(db: any): Promise<DetailImageHistoryRow[] | null> {
  try {
    const { data, error } = await db
      .from("product_drafts")
      .select("source_url, detail_image_urls:raw_capture->payload->detail_image_urls")
      .not("raw_capture", "is", null)
      .order("created_at", { ascending: false })
      .limit(SHARED_IMAGE_HISTORY_LIMIT);
    if (error || !Array.isArray(data)) return null;
    return data as DetailImageHistoryRow[];
  } catch {
    return null;
  }
}
