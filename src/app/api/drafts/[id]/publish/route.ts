/**
 * D7-open Q4-A: single-draft publish also creates a 1-item publish_batches row
 * via the same runPublishBatch path (rate ledger + records).
 *
 * PUBLISH-GUARD: in mock mode this is a dry run (no batch row, no DB writes, no
 * Shopify). Readiness blockers answer HTTP 409 { ok:false, error, code, blockers };
 * body.confirmVariantPrices === true is the operator's "I checked the costs" tick.
 */
import { NextRequest } from "next/server";
import { canPublish } from "@/lib/auth/roles";
import { recoverStalePublishBatchesBestEffort } from "@/lib/shopify/recoverStalePublishBatches";
import { RECONCILED_MESSAGE } from "@/lib/shopify/reconcileDraft";
import { runPublishBatch } from "@/lib/shopify/runPublishBatch";
import { checkLiveTestGuard } from "@/lib/shopify/liveTestGuard";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import type { PublishMode, UserRole } from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const publishMode = (body.publishMode ?? "active") as PublishMode;

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

  const guardError = checkLiveTestGuard({ draftIds: [id], publishMode });
  if (guardError) return Response.json({ error: guardError }, { status: 403 });

  const serviceSupabase = createServiceSupabaseClient();
  // Close batches an earlier killed function left in "processing" (live mode only).
  await recoverStalePublishBatchesBestEffort(serviceSupabase);
  const result = await runPublishBatch({
    serviceSupabase,
    draftIds: [id],
    publishMode,
    createdBy: user.id,
    confirmVariantPrices: body.confirmVariantPrices === true
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

  const first = result.results[0];
  if (!first?.ok) {
    return Response.json(
      {
        // Readiness blockers (PUBLISH_NEEDS_PRICE_CONFIRM / PUBLISH_BLOCKED) carry
        // ok:false + code + blockers so the card can open the confirm modal.
        ...(first?.code ? { ok: false, code: first.code, blockers: first.blockers ?? [] } : {}),
        ...(result.mock === true ? { mock: true } : {}),
        error: first?.error ?? "發布失敗",
        batchId: result.batchId,
        batchStatus: result.batchStatus,
        results: result.results
      },
      { status: 409 }
    );
  }

  // Backward-compatible single-publish shape + batchId for records.
  return Response.json({
    ok: true,
    batchId: result.batchId,
    batchStatus: result.batchStatus,
    mock: first.mock === true,
    productId: first.productId,
    adminUrl: first.adminUrl ?? null,
    // PUBLISH-BATCH: Shopify was already live; only the local state was repaired.
    message: first.reconciled ? RECONCILED_MESSAGE : result.message,
    ...(first.reconciled ? { reconciled: true } : {}),
    ...(first.warnings?.length ? { warnings: first.warnings } : {}),
    ...(first.mock === true ? { mockNotes: first.mockNotes ?? [] } : {})
  });
}
