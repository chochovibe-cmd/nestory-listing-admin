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
      draftId: TEST_DRAFT_ID,
      imageIds: [
      "5fdca9c8-5c48-45fc-85b5-3e6d9ad29949",
      "bbf56ebf-0325-4b7e-9b97-6689de6ad403",
      "b76e01ad-8fa5-4df3-b6b4-8adc72c19896",
      "78e1ce45-c225-4071-b859-fb190a5b4fe4",
      "2eafacf9-ad0f-4344-865a-d6069983f58f",
      "0b0fc8ba-f7e2-464a-8148-0d81fb471006",
      "da3c91e3-a795-4e72-8e85-26cd5dcec259",
      "3db20513-b703-494c-8bd7-e7d765a96590",
      "2d1c457f-292a-449c-845d-f3688aa6e529"
]
    });
    return Response.json({ step, ...result });
  }

  if (step === "finalize") {
    const result = await runFinalizeForDraft({
      serviceSupabase,
      draftId: TEST_DRAFT_ID,
      imageIds: [
      "5fdca9c8-5c48-45fc-85b5-3e6d9ad29949",
      "bbf56ebf-0325-4b7e-9b97-6689de6ad403",
      "b76e01ad-8fa5-4df3-b6b4-8adc72c19896",
      "78e1ce45-c225-4071-b859-fb190a5b4fe4",
      "2eafacf9-ad0f-4344-865a-d6069983f58f",
      "0b0fc8ba-f7e2-464a-8148-0d81fb471006",
      "da3c91e3-a795-4e72-8e85-26cd5dcec259",
      "3db20513-b703-494c-8bd7-e7d765a96590",
      "2d1c457f-292a-449c-845d-f3688aa6e529"
]
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
