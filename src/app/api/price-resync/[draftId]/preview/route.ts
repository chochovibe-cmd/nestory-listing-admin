/**
 * VARIANT-CLEAN: read-only Shopify look at ONE live product (current prices, which variants
 * still need an image). One product per request, same as the stepwise publish batch.
 */
import { NextRequest } from "next/server";
import { canPublish } from "@/lib/auth/roles";
import { checkLiveTestGuard } from "@/lib/shopify/liveTestGuard";
import { callShopifyAdminGraphQL } from "@/lib/shopify/adminGraphQL";
import { previewVariantResync } from "@/lib/shopify/variantResync";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_request: NextRequest, { params }: { params: Promise<{ draftId: string }> }) {
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

  const result = await previewVariantResync({
    serviceSupabase: createServiceSupabaseClient(),
    caller: (query, variables) => callShopifyAdminGraphQL(query, variables),
    draftId,
    mockMode: process.env.SHOPIFY_PUBLISH_MOCK !== "false"
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result);
}
