import type { ImageProcessIntent, ImageType, ProductImage } from "@/types/domain";

/** Images that go through the send-to-process pipeline (not detail/Vision-only refs). */
export function isPipelineImage(image: Pick<ProductImage, "image_type">): boolean {
  return image.image_type === "main" || image.image_type === "spec" || image.image_type === "variant";
}

export function isImageMarked(image: Pick<ProductImage, "process_intent">): boolean {
  return image.process_intent != null;
}

export function sortPipelineImages<T extends Pick<ProductImage, "sort_order" | "created_at">>(images: T[]): T[] {
  return [...images].sort((a, b) => {
    // B12 hotfix: queue-page rows may lack sort_order/created_at (narrower
    // select) — sort defensively instead of crashing stage counts.
    const orderA = a.sort_order ?? 0;
    const orderB = b.sort_order ?? 0;
    if (orderA !== orderB) return orderA - orderB;
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });
}

export function listPipelineImages(images: ProductImage[]): ProductImage[] {
  return sortPipelineImages(images.filter(isPipelineImage));
}

/** Human label for toast / warn text, e.g.「第1張主圖」「第3張商品圖（規格圖）」. */
export function imageSlotLabel(
  image: Pick<ProductImage, "image_type" | "is_spec_process">,
  position1Based: number
): string {
  let base: string;
  if (image.image_type === "variant") {
    base = `第${position1Based}張款式圖`;
  } else if (image.image_type === "main" && position1Based === 1) {
    base = `第${position1Based}張主圖`;
  } else {
    base = `第${position1Based}張商品圖`;
  }
  if (image.is_spec_process || image.image_type === "spec") {
    return `${base}（規格圖）`;
  }
  return base;
}

export function listUnmarkedPipelineImages(images: ProductImage[]): ProductImage[] {
  return listPipelineImages(images).filter((image) => !isImageMarked(image));
}

/**
 * Specific block message for 送圖: how many + which slots are still blank.
 * Returns null when every pipeline image is marked.
 */
export function formatUnmarkedBlockMessage(images: ProductImage[]): string | null {
  const pipeline = listPipelineImages(images);
  if (pipeline.length === 0) {
    return "沒有可送出的商品圖。請先上傳主圖（詳情圖不上架、不用標記），再送圖。";
  }

  const unmarked = pipeline.filter((image) => !isImageMarked(image));
  if (unmarked.length === 0) return null;

  const labels = unmarked.map((image) => {
    const position = pipeline.findIndex((row) => row.id === image.id) + 1;
    return imageSlotLabel(image, position);
  });

  return `還有 ${unmarked.length} 張沒標記：${labels.join("、")}。請先為每張選「保留原圖／簡轉繁／去字／重生」後再審核。`;
}

/**
 * @deprecated B14: prefer formatImageBatchCreatedMessage after API succeeds.
 * Kept for offline/client-only fallback when create-batch is unavailable.
 */
export function formatReadyButPipelinePendingMessage(images: ProductImage[]): string {
  const count = listPipelineImages(images).length;
  return `已標記完成（${count} 張）。圖片處理管線尚未接通（Phase D），目前無法真正送出處理。`;
}

/** B14 client fallback when batch create API is not used yet. */
export function formatReadyBatchQueuedHint(images: ProductImage[]): string {
  const count = listPipelineImages(images).length;
  return `已標記完成（${count} 張）。將建立送圖批次；處理管線 Phase D 接通後自動執行。`;
}

/** R2 §5 labels. to_trad requires migration 030 before write. */
export const PROCESS_INTENT_LABELS: Record<ImageProcessIntent, string> = {
  keep: "保留原圖",
  to_trad: "簡轉繁",
  de_text: "去字",
  regenerate: "重生",
};

/** Full station② mark options (order for UI). */
export const PROCESS_INTENT_OPTIONS: ImageProcessIntent[] = [
  "keep",
  "to_trad",
  "de_text",
  "regenerate",
];

/**
 * Spec toggle: still maps to de_text when on (pipeline hint).
 * Turning off returns unmarked null (approve will write keep).
 */
export function intentForSpecToggle(on: boolean): {
  is_spec_process: boolean;
  process_intent: ImageProcessIntent | null;
} {
  if (on) {
    return { is_spec_process: true, process_intent: "de_text" };
  }
  return { is_spec_process: false, process_intent: null };
}

/**
 * Apply a full process-intent pick from the result card.
 * If operator picks de_text/to_trad while already 規格圖, keep is_spec_process.
 * Other intents always clear the 規格圖 flag.
 */
export function patchForProcessIntentPick(
  intent: ImageProcessIntent,
  currentlySpec: boolean
): { process_intent: ImageProcessIntent; is_spec_process: boolean } {
  if (intent === "de_text" || intent === "to_trad") {
    return { process_intent: intent, is_spec_process: currentlySpec };
  }
  return { process_intent: intent, is_spec_process: false };
}

/** Pipeline image ids that still need default keep (null process_intent). */
export function unmarkedPipelineImageIds(
  images: Array<Pick<ProductImage, "id" | "image_type" | "process_intent">>
): string[] {
  return images
    .filter((img) => isPipelineImage(img) && img.process_intent == null)
    .map((img) => img.id);
}
