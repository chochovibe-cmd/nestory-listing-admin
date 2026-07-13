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
import { requireWorkerToken, jsonError } from "@/lib/api/auth";
import { canOperate } from "@/lib/auth/roles";
import { runFinalizeForDraft } from "@/lib/images/runFinalize";
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

  let serviceSupabase: ReturnType<typeof createServiceSupabaseClient>;
  try {
    serviceSupabase = createServiceSupabaseClient();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Supabase service client unavailable";
    return jsonError(message, 500);
  }

  const result = await runFinalizeForDraft({
    serviceSupabase,
    draftId,
    imageIds
  });

  if (!result.ok && result.httpStatus && result.httpStatus >= 400) {
    return jsonError(result.error, result.httpStatus);
  }

  return Response.json({
    ok: result.ok,
    draftId: result.draftId,
    auth: auth.via,
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
