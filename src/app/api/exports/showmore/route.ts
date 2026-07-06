import { NextRequest } from "next/server";
import { buildShowmoreCsv } from "@/lib/csv/showmore";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["admin", "reviewer"].includes(profile.role)) {
    return Response.json({ error: "Reviewer role is required to export Showmore CSV" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.draftIds) ? body.draftIds : null;

  const serviceSupabase = createServiceSupabaseClient();

  let query = serviceSupabase
    .from("product_drafts")
    .select("*, product_images(*)")
    .in("status", ["approved", "api_failed", "csv_ready"]);

  if (ids?.length) {
    query = query.in("id", ids);
  }

  const { data, error } = await query.order("updated_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const csv = buildShowmoreCsv(data ?? []);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="nestory-showmore-${Date.now()}.csv"`
    }
  });
}
