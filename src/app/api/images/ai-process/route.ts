/**
 * D4: AI de_text / regenerate for ONE draft.
 *
 * Thin shell: auth + body parse → runAiProcessForDraft (in-process).
 * Auth: WORKER_API_TOKEN Bearer OR session + canOperate (same as sharp-batch / finalize).
 * Body: { draftId, imageIds?, autoSharp?, autoFinalize? }
 * Defaults: autoSharp=true, autoFinalize=true (Q3-A).
 * Only processes pipeline images with process_intent de_text | regenerate.
 */

import { NextRequest } from "next/server";
import { requireWorkerToken, jsonError } from "@/lib/api/auth";
import { canOperate } from "@/lib/auth/roles";
import { runAiProcessForDraft } from "@/lib/images/runAiProcess";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 60;

async function authorize(request: NextRequest): Promise<
  { ok: true; via: "worker" | "session" } | { ok: false; response: Response }
> {
  const worker = requireWorkerToken(request);
  if (worker.ok) return { ok: true, via: "worker" };

  const authHeader = request.headers.get("authorization");
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    const status = worker.error.includes("configured") ? 500 : 401;
    return { ok: false, response: jsonError(worker.error, status) };
  }

  try {
    const authSupabase = await createServerSupabaseClient();
    const {
      data: { user }
    } = await authSupabase.auth.getUser();
    if (!user) {
      return { ok: false, response: jsonError("Unauthorized", 401) };
    }
    const { data: profile } = await authSupabase.from("profiles").select("role").eq("id", user.id).single();
    if (!canOperate(profile?.role as UserRole | undefined)) {
      return { ok: false, response: jsonError("Operator role is required", 403) };
    }
    return { ok: true, via: "session" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auth failed";
    return { ok: false, response: jsonError(message, 500) };
  }
}

function parseBool(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return defaultValue;
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;

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
    draftId,
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
    authVia: auth.via,
    message: result.message,
    error: result.ok ? undefined : result.error
  });
}
