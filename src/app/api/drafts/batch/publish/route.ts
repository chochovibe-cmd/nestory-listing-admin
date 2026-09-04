/**
 * D7-open: batch publish with rate limit + publish_batches ledger.
 * Auth: admin | reviewer (Q6 unchanged). Thin shell → runPublishBatch.
 */
import { NextRequest } from "next/server";
import { canPublish } from "@/lib/auth/roles";
import { runPublishBatch } from "@/lib/shopify/runPublishBatch";
import { checkLiveTestGuard } from "@/lib/shopify/liveTestGuard";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import type { PublishMode, UserRole } from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const draftIds: unknown = body.draftIds;
  const publishMode = (body.publishMode ?? "draft") as PublishMode;

  if (!Array.isArray(draftIds) || draftIds.length === 0 || !draftIds.every((id) => typeof id === "string")) {
    return Response.json({ error: "draftIds must be a non-empty string array" }, { status: 400 });
  }

  if (!["active", "draft"].includes(publishMode)) {
    return Response.json({ error: "Invalid publishMode" }, { status: 400 });
  }

  if (publishMode === "active" && body.confirmActive !== true) {
    return Response.json({ error: "ACTIVE publish requires explicit confirmActive=true" }, { status: 400 });
  }

  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await authSupabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await authSupabase.from("profiles").select("role").eq("id", user.id).single();

  if (!canPublish(profile?.role as UserRole | undefined)) {
    return Response.json({ error: "Reviewer role is required to publish" }, { status: 403 });
  }

  const guardError = checkLiveTestGuard({ draftIds: draftIds as string[], publishMode });
  if (guardError) return Response.json({ error: guardError }, { status: 403 });

  const serviceSupabase = createServiceSupabaseClient();
  const result = await runPublishBatch({
    serviceSupabase,
    draftIds: draftIds as string[],
    publishMode,
    createdBy: user.id
  });

  if (!result.ok) {
    return Response.json(
      {
        error: result.error,
        hint: result.hint,
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
    results: result.results.map((r) => ({
      id: r.draftId,
      ok: r.ok,
      error: r.error,
      mock: r.mock,
      productId: r.productId,
      adminUrl: r.adminUrl,
      itemStatus: r.itemStatus
    })),
    message: result.message,
    stoppedEarly: result.stoppedEarly,
    elapsedMs: result.elapsedMs,
    makeWebhook: result.makeWebhook
  });
}
