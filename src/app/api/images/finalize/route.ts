/**
 * D1: Finalize processed images → Shopify Files CDN.
 *
 * Thin shell: auth + body parse → runFinalizeForDraft (in-process).
 * Auth: WORKER_API_TOKEN Bearer OR session + canOperate (same as sharp-batch).
 * Body: { draftId, imageIds? } — single draft, ≤12 images, no multipart, no client URLs.
 *
 * Q1-A: does NOT run sharp.
 * Q5-A: only main + variant; spec/detail skipped.
 */

import { NextRequest } from "next/server";
import {
  resolveAuthorizedDraftId,
  resolveRequestPrincipal
} from "@/lib/api/requestPrincipal";
import { jsonError } from "@/lib/api/auth";
import { runFinalizeForDraft } from "@/lib/images/runFinalize";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const principalResult = await resolveRequestPrincipal(request, { allowWorker: true });
  if (!principalResult.ok) return principalResult.response;
  const principal = principalResult.principal;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return jsonError("Invalid JSON body", 400);
  }

  const draftId =
    typeof (body as { draftId?: unknown }).draftId === "string"
      ? (body as { draftId: string }).draftId.trim()
      : "";
  if (!draftId) {
    return jsonError("draftId is required", 400);
  }

  const authorizedDraft = await resolveAuthorizedDraftId(principal, draftId);
  if (!authorizedDraft.ok) return authorizedDraft.response;
  const canonicalDraftId = authorizedDraft.id;

  const rawImageIds = (body as { imageIds?: unknown }).imageIds;
  let imageIds: string[] | undefined;
  if (rawImageIds !== undefined && rawImageIds !== null) {
    if (!Array.isArray(rawImageIds) || !rawImageIds.every((id) => typeof id === "string")) {
      return jsonError("imageIds must be a string array when provided", 400);
    }
    imageIds = rawImageIds;
  }

  let serviceSupabase: ReturnType<typeof createServiceSupabaseClient>;
  try {
    serviceSupabase = createServiceSupabaseClient();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Supabase service client unavailable";
    return jsonError(message, 500);
  }

  const result = await runFinalizeForDraft({
    serviceSupabase,
    draftId: canonicalDraftId,
    imageIds
  });

  if (!result.ok && result.httpStatus && result.httpStatus >= 400) {
    return jsonError(result.error, result.httpStatus);
  }

  return Response.json({
    ok: result.ok,
    draftId: result.draftId,
    auth: principal.via,
    uploaded: result.uploaded ?? 0,
    skipped: result.skipped ?? 0,
    failed: result.failed ?? 0,
    results: result.results ?? [],
    storage: result.storage ?? "none",
    operations: result.operations,
    message: result.message,
    note:
      "Success overwrites processed_file_url with Shopify CDN. Failures keep prior URL. Originals not deleted. D5 UI label unchanged. Uses runFinalizeForDraft + uploadProcessedImageToShopifyFilesWithRetry."
  });
}
