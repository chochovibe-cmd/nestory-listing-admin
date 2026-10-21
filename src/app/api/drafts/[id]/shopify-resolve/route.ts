import { NextRequest } from "next/server";
import { canPublish } from "@/lib/auth/roles";
import { resolveShopifyDiff } from "@/lib/shopify/shopifyDiff";
import {
  createServerSupabaseClient,
  createServiceSupabaseClient
} from "@/lib/supabase/server";
import type { UserRole } from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

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

  const result = await resolveShopifyDiff({
    serviceSupabase: createServiceSupabaseClient(),
    draftId: id,
    createdBy: user.id,
    body
  });
  if (!result.ok) {
    return Response.json(
      {
        ok: false,
        error: result.error,
        code: result.code ?? null,
        removals: result.removals ?? null,
        pulledCount: result.pulledCount
      },
      { status: result.status }
    );
  }
  return Response.json(result);
}
