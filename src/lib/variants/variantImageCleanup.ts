/**
 * VARIANT-CLEAN fixbatch: removing a variant may also remove an image row
 * belonging ONLY to that variant. This is draft-only cleanup: Storage files stay.
 *
 * The UI only proposes an image deletion. The actual delete happens AFTER the
 * variant rows have been saved, with fresh DB binding + image-type checks.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteProductImages, findVariantBindings } from "@/lib/images/deleteProductImages";

export type VariantImageReference = { imageId?: string | null };
export type VariantImageKind = { id: string; imageType?: string | null };

export function imageIdsOrphanedByRemovingVariant(
  removed: VariantImageReference,
  remaining: readonly VariantImageReference[],
  images: readonly VariantImageKind[]
): string[] {
  const id = removed.imageId;
  if (!id || remaining.some((row) => row.imageId === id)) return [];
  return images.some((image) => image.id === id && image.imageType === "variant") ? [id] : [];
}

export type DraftVariantImageCleanupResult = {
  deletedIds: string[];
  skippedIds: string[];
  warnings: string[];
};

/**
 * Call only after a successful variant save. The database, not the browser
 * image picker, is the final authority for type and remaining references.
 * Refuse to delete when a read fails or a surviving variant is still bound.
 */
export async function removeUnusedVariantImagesFromDraft(
  client: SupabaseClient,
  draftId: string,
  queuedIds: readonly string[]
): Promise<DraftVariantImageCleanupResult> {
  const ids = [...new Set(queuedIds.filter(Boolean))];
  const result: DraftVariantImageCleanupResult = { deletedIds: [], skippedIds: [], warnings: [] };
  if (!draftId || ids.length === 0) return result;

  try {
  const { data: imageRows, error: imageError } = await client
    .from("product_images")
    .select("id, draft_id, image_type")
    .eq("draft_id", draftId)
    .in("id", ids);
  if (imageError) {
    result.skippedIds = ids;
    result.warnings.push(`無法確認款式圖類型：${imageError.message}`);
    return result;
  }

  const candidates = (imageRows ?? [])
    .filter((row) => row.image_type === "variant" && row.draft_id === draftId)
    .map((row) => row.id as string);
  const bindings = await findVariantBindings(client, candidates);
  if (!bindings.ok) {
    result.skippedIds = ids;
    result.warnings.push(`無法確認款式圖是否共用：${bindings.error}`);
    return result;
  }

  const deletable = candidates.filter((id) => (bindings.byImageId[id] ?? []).length === 0);
  result.skippedIds = ids.filter((id) => !deletable.includes(id));
  if (deletable.length === 0) return result;

  // IMAGE-INTEGRITY helper rechecks bindings and deletes DB rows safely.
  // keepStorageFiles is mandatory here: deleting a variant NEVER permanently
  // deletes its underlying image files in Storage.
  const removed = await deleteProductImages(client, deletable, {
    unbindVariants: false,
    keepStorageFiles: true
  });
  result.deletedIds = removed.deletedIds;
  result.skippedIds.push(...deletable.filter((id) => !removed.deletedIds.includes(id)));
  if (!removed.ok) result.warnings.push(removed.error ?? "部分款式圖無法從草稿移除");
  return result;
  } catch (error) {
    // Saving the variant rows succeeded; never turn optional image cleanup
    // into an exception that makes the already-saved form look unsaved.
    result.skippedIds = ids;
    result.warnings.push(`款式已儲存，但款式圖清理失敗：${error instanceof Error ? error.message : String(error)}`);
    return result;
  }
}
