import { NextRequest } from "next/server";
import { jsonError } from "@/lib/api/auth";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { runPublishBatch } from "@/lib/shopify/runPublishBatch";

export const runtime = "nodejs";
export const maxDuration = 60;

const CONFIRM_NONCE = "resume-8f7a2c1d";

export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview") {
    return jsonError("Shopify live-test harness is preview-only", 403);
  }

  if (process.env.SHOPIFY_PUBLISH_MOCK !== "false") {
    return jsonError("Shopify live-test harness requires SHOPIFY_PUBLISH_MOCK=false", 409);
  }

  const allowedDraftId = process.env.SHOPIFY_LIVE_TEST_DRAFT_ID?.trim();
  if (!allowedDraftId) {
    return jsonError("SHOPIFY_LIVE_TEST_DRAFT_ID is not configured", 500);
  }

  if (request.nextUrl.searchParams.get("confirm") !== CONFIRM_NONCE) {
    return jsonError("Missing live-test confirmation", 403);
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
      { ok: false, error: result.error, hint: result.hint ?? null, batchId: result.batchId ?? null },
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
