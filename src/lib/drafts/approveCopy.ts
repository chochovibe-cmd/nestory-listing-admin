/**
 * R2 station① 核准 helpers: default keep marks (Q2-A) + pure checks.
 */

import { unmarkedPipelineImageIds } from "@/lib/images/processMarks";
import type { ProductImage } from "@/types/domain";

/**
 * Returns ids to patch process_intent=keep (unmarked pipeline only).
 * Spec-process rows with null intent still get keep; is_spec_process unchanged.
 */
export function pipelineImageIdsNeedingDefaultKeep(
  images: Array<Pick<ProductImage, "id" | "image_type" | "process_intent">>
): string[] {
  return unmarkedPipelineImageIds(images);
}

export type ApplyDefaultKeepResult = {
  updatedCount: number;
  imageIds: string[];
  error?: string;
};

/**
 * Service-role patch: set process_intent=keep where still null on pipeline images.
 */
export async function applyDefaultKeepMarks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serviceSupabase: { from: (table: string) => any },
  draftIds: string[]
): Promise<ApplyDefaultKeepResult> {
  if (draftIds.length === 0) {
    return { updatedCount: 0, imageIds: [] };
  }

  const { data: images, error: loadError } = await serviceSupabase
    .from("product_images")
    .select("id, draft_id, image_type, process_intent")
    .in("draft_id", draftIds);

  if (loadError) {
    return { updatedCount: 0, imageIds: [], error: loadError.message };
  }

  const ids = pipelineImageIdsNeedingDefaultKeep(images ?? []);
  if (ids.length === 0) {
    return { updatedCount: 0, imageIds: [] };
  }

  const { error: updateError } = await serviceSupabase
    .from("product_images")
    .update({ process_intent: "keep" })
    .in("id", ids)
    .is("process_intent", null);

  if (updateError) {
    return { updatedCount: 0, imageIds: ids, error: updateError.message };
  }

  return { updatedCount: ids.length, imageIds: ids };
}
