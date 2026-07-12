import { NextRequest } from "next/server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { canOperate } from "@/lib/auth/roles";
import { queryDuplicateMatches } from "@/lib/drafts/checkDuplicate";

// A12: pre-listing duplicate check. Two independent signals:
//   1) URL match  -- the same 淘寶/來源網址 (or same item id) already in the catalog
//   2) classification match -- same IP + 角色 + 類型 three-dimension combo
// Read-only and warn-only: it never blocks; the operator decides. Runs against
// the whole team catalog (service client) because the point is to catch a
// product a *different* member already listed; only minimal fields are returned.
// B4: classification path is also invoked from /api/generate after detect (3A).

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl : "";
  const ip = typeof body.ip === "string" ? body.ip.trim() : "";
  const character = typeof body.character === "string" ? body.character.trim() : "";
  const productType = typeof body.productType === "string" ? body.productType.trim() : "";
  const excludeDraftId = typeof body.excludeDraftId === "string" ? body.excludeDraftId : null;

  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await authSupabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await authSupabase.from("profiles").select("role").eq("id", user.id).single();
  if (!canOperate(profile?.role)) {
    return Response.json({ error: "Operator role is required" }, { status: 403 });
  }

  const serviceSupabase = createServiceSupabaseClient();

  try {
    const result = await queryDuplicateMatches(serviceSupabase, {
      sourceUrl,
      ip,
      character,
      productType,
      excludeDraftId,
    });
    return Response.json({
      ok: true,
      urlKey: result.urlKey,
      urlMatches: result.urlMatches,
      classificationMatches: result.classificationMatches,
      hasDuplicates: result.hasDuplicates,
    });
  } catch (queryError) {
    return Response.json(
      { error: queryError instanceof Error ? queryError.message : "Duplicate check failed" },
      { status: 500 },
    );
  }
}
