/**
 * D1 thin finalize shell — Shopify Files permanent CDN.
 *
 * Intended future flow (圖床架構):
 *   sharp/AI output → stagedUploadsCreate → direct upload to Shopify bucket
 *   → fileCreate → cdn.shopify.com URL → product_images.processed_file_url
 *
 * D-open: always NOT_IMPLEMENTED. Never returns a fake CDN success.
 */

import { NextRequest } from "next/server";
import { requireWorkerToken, jsonError } from "@/lib/api/auth";
import { canOperate } from "@/lib/auth/roles";
import { uploadProcessedImageToShopifyFiles, SHOPIFY_FILES_OPERATIONS } from "@/lib/shopify/filesUpload";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/domain";

export const runtime = "nodejs";

async function authorize(request: NextRequest): Promise<
  { ok: true } | { ok: false; response: Response }
> {
  const worker = requireWorkerToken(request);
  if (worker.ok) return { ok: true };

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
    if (!user) return { ok: false, response: jsonError("Unauthorized", 401) };
    const { data: profile } = await authSupabase.from("profiles").select("role").eq("id", user.id).single();
    if (!canOperate(profile?.role as UserRole | undefined)) {
      return { ok: false, response: jsonError("Operator role is required", 403) };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auth failed";
    return { ok: false, response: jsonError(message, 500) };
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;

  // Accept body for forward-compat but do not process.
  await request.json().catch(() => ({}));

  const stub = await uploadProcessedImageToShopifyFiles({
    filename: "unused.webp",
    mimeType: "image/webp",
    fileSize: 0
  });

  if (stub.ok) {
    // Defensive: real implementation must not land success without Files CDN.
    return Response.json(
      {
        ok: false,
        code: "NOT_IMPLEMENTED",
        error: "Unexpected success from filesUpload stub",
        operations: SHOPIFY_FILES_OPERATIONS
      },
      { status: 501 }
    );
  }

  return Response.json(
    {
      ok: false,
      code: stub.code,
      error: stub.error,
      operations: SHOPIFY_FILES_OPERATIONS,
      note:
        "D-open finalize stub only. Do not treat any URL as shopify_cdn until real stagedUploadsCreate/fileCreate lands."
    },
    { status: 501 }
  );
}
