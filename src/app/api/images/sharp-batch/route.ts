/**
 * D3: sharp batch for ONE draft (≤12 images).
 * Aligns with docs/自動化流程設計 Scenario 1 path /api/images/sharp-batch.
 *
 * Thin shell: auth + body parse → runSharpBatchForDraft (in-process).
 * - Auth: WORKER_API_TOKEN Bearer OR cookie session + canOperate
 * - Body: { draftId, imageIds? } — no multipart, no arbitrary external URLs
 * - storage label: supabase_temp (NOT shopify CDN)
 */

import { NextRequest } from "next/server";
import {
  resolveAuthorizedDraftId,
  resolveRequestPrincipal
} from "@/lib/api/requestPrincipal";
import { jsonError } from "@/lib/api/auth";
import { runSharpBatchForDraft } from "@/lib/images/runSharpBatch";
import { SHARP_BATCH_MAX_IMAGES } from "@/lib/images/sharpProcess";
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

  const result = await runSharpBatchForDraft({
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
    processed: result.processed ?? 0,
    skipped: result.skipped ?? 0,
    failed: result.failed ?? 0,
    results: result.results ?? [],
    imageStatus: result.imageStatus,
    storageDefault: result.storageDefault ?? "supabase_temp",
    message: result.message,
    note:
      "processed_file_url is Supabase temp WebP (supabase_temp), NOT Shopify CDN until finalize.",
    finalize: {
      status: "not_run",
      note: "Call POST /api/images/finalize → stagedUploadsCreate → fileCreate → shopify_cdn (D1)."
    },
    maxImages: SHARP_BATCH_MAX_IMAGES
  });
}
