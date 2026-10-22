import { NextRequest } from "next/server";
import { canPublish } from "@/lib/auth/roles";
import {
  createServerSupabaseClient,
  createServiceSupabaseClient
} from "@/lib/supabase/server";
import { runSourceStockSync } from "@/lib/shopify/sourceStockSync";
import type { UserRole } from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 60;

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
    return Response.json({ error: "需要審核者權限" }, { status: 403 });
  }

  const result = await runSourceStockSync({
    serviceSupabase: createServiceSupabaseClient(),
    draftId: id,
    mode: body.mode === "apply" ? "apply" : "preview",
    expectedVariantIds: Array.isArray(body.expectedVariantIds)
      ? body.expectedVariantIds.filter((s: unknown): s is string => typeof s === "string")
      : undefined
  });

  if (!result.ok) {
    return Response.json({ error: result.error, code: result.code }, { status: result.status });
  }
  return Response.json(result);
}
