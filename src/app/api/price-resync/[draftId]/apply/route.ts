/**
 * VARIANT-CLEAN: push price / compareAtPrice / variant image of ONE live product.
 * Never calls syncShopifyProduct (see lib/shopify/variantResync.ts). The browser computed the
 * prices from this device's settings; this route only sanity-checks them.
 */
import { NextRequest } from "next/server";
import { canPublish } from "@/lib/auth/roles";
import { checkLiveTestGuard } from "@/lib/shopify/liveTestGuard";
import { callShopifyAdminGraphQL } from "@/lib/shopify/adminGraphQL";
import { applyVariantResync, type ResyncApplyRequest } from "@/lib/shopify/variantResync";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest, { params }: { params: Promise<{ draftId: string }> }) {
  const startedAt = Date.now();
  const { draftId } = await params;
  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await authSupabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { data: profile } = await authSupabase.from("profiles").select("role").eq("id", user.id).single();
  if (!canPublish(profile?.role as UserRole | undefined)) {
    return Response.json({ error: "Reviewer role is required" }, { status: 403 });
  }
  const guardError = checkLiveTestGuard({ draftIds: [draftId], operation: "sync" });
  if (guardError) return Response.json({ error: guardError }, { status: 403 });

  const body = (await request.json().catch(() => null)) as Partial<ResyncApplyRequest> | null;
  const result = await applyVariantResync({
    serviceSupabase: createServiceSupabaseClient(),
    caller: (query, variables) => callShopifyAdminGraphQL(query, variables),
    draftId,
    request: {
      variants: Array.isArray(body?.variants) ? body.variants : [],
      bindImages: body?.bindImages === true
    },
    mockMode: process.env.SHOPIFY_PUBLISH_MOCK !== "false",
    actorId: user.id,
    deadlineAt: startedAt + 45_000
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result);
}
