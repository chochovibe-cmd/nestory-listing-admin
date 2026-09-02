/**
 * D4: AI de_text / regenerate for ONE draft.
 *
 * Thin shell: auth + body parse → runAiProcessForDraft (in-process).
 * Auth: WORKER_API_TOKEN Bearer OR session + canOperate (same as sharp-batch / finalize).
 * Body: { draftId, imageIds?, autoSharp?, autoFinalize? }
 * Defaults: autoSharp=true, autoFinalize=true (Q3-A).
 * Only processes pipeline images with process_intent de_text | regenerate | to_trad.
 */

import { NextRequest } from "next/server";
import {
  resolveAuthorizedDraftId,
  resolveRequestPrincipal
} from "@/lib/api/requestPrincipal";
import { jsonError } from "@/lib/api/auth";
import { runAiProcessForDraft } from "@/lib/images/runAiProcess";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

function parseBool(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return defaultValue;
}

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

  const autoSharp = parseBool((body as { autoSharp?: unknown }).autoSharp, true);
  const autoFinalize = parseBool((body as { autoFinalize?: unknown }).autoFinalize, true);

  let serviceSupabase: ReturnType<typeof createServiceSupabaseClient>;
  try {
    serviceSupabase = createServiceSupabaseClient();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Supabase service client unavailable";
    return jsonError(message, 500);
  }

  const result = await runAiProcessForDraft({
    serviceSupabase,
    draftId: canonicalDraftId,
    imageIds,
    autoSharp,
    autoFinalize,
    updateBatchStatus: true
  });

  if (!result.ok && result.httpStatus && result.httpStatus >= 400) {
    return jsonError(result.error, result.httpStatus);
  }

  return Response.json({
    ok: result.ok,
    draftId: result.draftId,
    processed: result.processed ?? 0,
    skipped: result.skipped ?? 0,
    failed: result.failed ?? 0,
    timeBudget: result.timeBudget ?? 0,
    results: result.results ?? [],
    batchUpdated: result.batchUpdated ?? false,
    autoSharp,
    autoFinalize,
    authVia: principal.via,
    message: result.message,
    error: result.ok ? undefined : result.error
  });
}
