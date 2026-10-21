import { canPublish } from "@/lib/auth/roles";
import { loadShopifyDiff } from "@/lib/shopify/shopifyDiff";
import {
  createServerSupabaseClient,
  createServiceSupabaseClient
} from "@/lib/supabase/server";
import type { UserRole } from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await authSupabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await authSupabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!canPublish(profile?.role as UserRole | undefined)) {
    return Response.json(
      { error: "Reviewer role is required to sync Shopify" },
      { status: 403 }
    );
  }

  const result = await loadShopifyDiff({
    serviceSupabase: createServiceSupabaseClient(),
    draftId: id
  });
  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.error, code: result.code },
      { status: result.status }
    );
  }
  return Response.json(result);
}
