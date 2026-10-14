/**
 * PUBLISH-BATCH: 對帳 — the draft is api_failed locally but Shopify may already be live.
 *
 * Reads the remote product; only when it is ACTIVE does it change anything: it adds any
 * missing sales-channel publication (never removes one, never edits content) and marks the
 * draft like a successful ACTIVE publish. Remote DRAFT / missing / other: no change.
 */
import { NextRequest } from "next/server";
import { canPublish } from "@/lib/auth/roles";
import { checkLiveTestGuard } from "@/lib/shopify/liveTestGuard";
import { reconcileDraftWithShopify } from "@/lib/shopify/reconcileDraft";
import { syncReconciledBatchItems } from "@/lib/shopify/syncReconciledBatchItems";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await authSupabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await authSupabase.from("profiles").select("role").eq("id", user.id).single();
  if (!canPublish(profile?.role as UserRole | undefined)) {
    return Response.json({ error: "Reviewer role is required to publish" }, { status: 403 });
  }

  if (process.env.SHOPIFY_PUBLISH_MOCK !== "false") {
    return Response.json(
      { ok: false, outcome: "error", reconciled: false, message: "【模擬】目前是模擬模式，不會查詢或寫入 Shopify" },
      { status: 409 }
    );
  }

  // Reconcile can mark a draft active_published and add channels: same gate as an ACTIVE publish.
  const guardError = checkLiveTestGuard({ draftIds: [id], publishMode: "active" });
  if (guardError) return Response.json({ error: guardError }, { status: 403 });

  const serviceSupabase = createServiceSupabaseClient();
  const result = await reconcileDraftWithShopify(serviceSupabase, id);
  if (result.reconciled && result.productId) {
    // Best-effort: the failed row in the draft's latest batch is no longer true.
    try {
      await syncReconciledBatchItems(serviceSupabase, id, result.productId, result.adminUrl ?? null);
    } catch {
      // the draft itself is already repaired; records history can lag
    }
  }
  return Response.json(
    { ok: result.outcome !== "error", ...result },
    { status: result.outcome === "error" ? 502 : 200 }
  );
}
