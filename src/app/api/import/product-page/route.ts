import { NextRequest } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { verifyCaptureToken } from "@/lib/import/captureAuth";
import { createCaptureDraft } from "@/lib/import/createCaptureDraft";
import type { CaptureImportBody } from "@/lib/import/captureTypes";

/**
 * CAP-1: receive capture payload from Chrome extension / curl.
 * Auth: personal capture token (Bearer ncap_…).
 * route.ts exports only HTTP methods (AGENTS / P0-63).
 */
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let body: CaptureImportBody;
  try {
    body = (await request.json()) as CaptureImportBody;
  } catch {
    return Response.json(
      { ok: false, error: "invalid_json", message: "請求 body 必須是 JSON" },
      { status: 400 }
    );
  }

  let serviceSupabase;
  try {
    serviceSupabase = createServiceSupabaseClient();
  } catch {
    return Response.json(
      {
        ok: false,
        error: "server_misconfigured",
        message: "伺服器未設定 SUPABASE_SERVICE_ROLE_KEY"
      },
      { status: 503 }
    );
  }

  const auth = await verifyCaptureToken(
    serviceSupabase,
    request.headers.get("authorization")
  );
  if (!auth.ok) {
    return Response.json(
      { ok: false, error: auth.error, message: auth.message },
      { status: auth.status }
    );
  }

  const result = await createCaptureDraft({
    serviceSupabase,
    userId: auth.userId,
    body: body ?? {}
  });

  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.error, message: result.message },
      { status: result.status }
    );
  }

  if (result.status === "exists") {
    return Response.json(result, { status: 200 });
  }

  return Response.json(result, { status: 201 });
}
