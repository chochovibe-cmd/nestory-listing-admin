import { NextRequest } from "next/server";
import { jsonError } from "@/lib/api/auth";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { runSharpBatchForDraft } from "@/lib/images/runSharpBatch";
import { runFinalizeForDraft } from "@/lib/images/runFinalize";
import { runPublishBatch } from "@/lib/shopify/runPublishBatch";

export const runtime = "nodejs";
export const maxDuration = 60;

const TEST_DRAFT_ID = "6d2892a1-02ba-4f50-8d36-249e12809a39";
const CONFIRM_NONCE = "fresh-e2e-9c4d7a2f";

export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview") {
    return jsonError("Fresh Shopify E2E harness is preview-only", 403);
  }
  if (request.nextUrl.searchParams.get("confirm") !== CONFIRM_NONCE) {
    return jsonError("Missing E2E confirmation", 403);
  }

  const step = request.nextUrl.searchParams.get("step");
  const serviceSupabase = createServiceSupabaseClient();

  if (step === "sharp") {
    const result = await runSharpBatchForDraft({
      serviceSupabase,
      draftId: TEST_DRAFT_ID
    });
    return Response.json({ step, ...result });
  }

  if (step === "finalize") {
    const result = await runFinalizeForDraft({
      serviceSupabase,
      draftId: TEST_DRAFT_ID
    });
    return Response.json({ step, ...result });
  }

  if (step === "publish") {
    if (process.env.SHOPIFY_PUBLISH_MOCK !== "false") {
      return jsonError("Publish step requires SHOPIFY_PUBLISH_MOCK=false", 409);
    }
    const result = await runPublishBatch({
      serviceSupabase,
      draftIds: [TEST_DRAFT_ID],
      publishMode: "draft",
      createdBy: null
    });
    if (!result.ok) {
      return Response.json(
        { step, ok: false, error: result.error, hint: result.hint ?? null, batchId: result.batchId ?? null },
        { status: result.status }
      );
    }
    return Response.json({ step, ...result });
  }

  return jsonError("Unknown E2E step", 400);
}
