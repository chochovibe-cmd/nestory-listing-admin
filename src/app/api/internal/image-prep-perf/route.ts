import { performance } from "node:perf_hooks";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { prepareImagesForPublish } from "@/lib/images/prepareImagesForPublish";
import { jsonError } from "@/lib/api/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const TEST_DRAFT_ID = "b9400278-3811-4c5a-94ec-a1ff9b372d6f";

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return jsonError("Image prep perf harness is preview-only", 403);
  }

  const serviceSupabase = createServiceSupabaseClient();

  const { data: before, error: beforeError } = await serviceSupabase
    .from("product_images")
    .select("id, processed_file_url, processing_status")
    .eq("draft_id", TEST_DRAFT_ID)
    .order("sort_order", { ascending: true });

  if (beforeError) return jsonError(beforeError.message, 500);

  const started = performance.now();
  const result = await prepareImagesForPublish({
    serviceSupabase,
    draftId: TEST_DRAFT_ID
  });
  const elapsedMs = Math.round(performance.now() - started);

  const { data: after, error: afterError } = await serviceSupabase
    .from("product_images")
    .select("id, processed_file_url, processing_status")
    .eq("draft_id", TEST_DRAFT_ID)
    .order("sort_order", { ascending: true });

  if (afterError) return jsonError(afterError.message, 500);

  const beforeById = new Map((before ?? []).map((row) => [row.id, row]));
  const changedRows = (after ?? []).filter((row) => {
    const prev = beforeById.get(row.id);
    return (
      !prev ||
      prev.processed_file_url !== row.processed_file_url ||
      prev.processing_status !== row.processing_status
    );
  }).length;

  return Response.json({
    ok: result.ok,
    elapsedMs,
    sharp: result.sharp,
    finalize: result.finalize,
    sharpProcessed: result.sharpProcessed,
    finalizeUploaded: result.finalizeUploaded,
    changedRows,
    warnings: result.warnings
  });
}
