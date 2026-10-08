import { NextRequest } from "next/server";
import { requireWorkerToken, jsonError } from "@/lib/api/auth";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { runPublishBatch } from "@/lib/shopify/runPublishBatch";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview") {
    return jsonError("Shopify live-test harness is preview-only", 403);
  }

  const auth = requireWorkerToken(request);
  if (!auth.ok) {
    return jsonError(auth.error, auth.error.includes("configured") ? 500 : 401);
  }

  if (process.env.SHOPIFY_PUBLISH_MOCK !== "false") {
    return jsonError("Shopify live-test harness requires SHOPIFY_PUBLISH_MOCK=false", 409);
  }

  const allowedDraftId = process.env.SHOPIFY_LIVE_TEST_DRAFT_ID?.trim();
  if (!allowedDraftId) {
    return jsonError("SHOPIFY_LIVE_TEST_DRAFT_ID is not configured", 500);
  }

  const body = await request.json().catch(() => ({}));
  if (body.draftId !== allowedDraftId) {
    return jsonError("Draft is not on the live test allowlist", 403);
  }

  const serviceSupabase = createServiceSupabaseClient();
  const result = await runPublishBatch({
    serviceSupabase,
    draftIds: [allowedDraftId],
    publishMode: "draft",
    createdBy: null
  });

  if (!result.ok) {
    return Response.json(
      {
        ok: false,
        error: result.error,
        hint: result.hint ?? null,
        batchId: result.batchId ?? null
      },
      { status: result.status }
    );
  }

  return Response.json({
    ok: true,
    batchId: result.batchId,
    batchStatus: result.batchStatus,
    succeeded: result.succeeded,
    failed: result.failed,
    skipped: result.skipped,
    results: result.results,
    message: result.message,
    stoppedEarly: result.stoppedEarly,
    elapsedMs: result.elapsedMs
  });
}
