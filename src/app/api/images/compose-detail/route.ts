/**
 * SYN-1: compose generated_detail for ONE draft (awaiting_compose retry).
 *
 * Thin shell: auth + body parse → runComposeDetailForDraft (in-process).
 * Auth: WORKER_API_TOKEN Bearer OR session + canOperate.
 * Body: { draftId, force? }
 * Never HTTP self-fetch.
 */

import { NextRequest } from "next/server";
import {
  resolveAuthorizedDraftId,
  resolveRequestPrincipal
} from "@/lib/api/requestPrincipal";
import { jsonError } from "@/lib/api/auth";
import { runComposeDetailForDraft } from "@/lib/images/detailCompose/runComposeDetail";
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

  const force = parseBool((body as { force?: unknown }).force, false);

  let serviceSupabase: ReturnType<typeof createServiceSupabaseClient>;
  try {
    serviceSupabase = createServiceSupabaseClient();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Supabase service client unavailable";
    return jsonError(message, 500);
  }

  const result = await runComposeDetailForDraft({
    serviceSupabase,
    draftId: canonicalDraftId,
    force
  });

  if (!result.ok) {
    return Response.json(result, { status: result.httpStatus || 500 });
  }

  return Response.json({ ...result, via: principal.via });
}
