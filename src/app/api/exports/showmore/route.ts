import { NextRequest } from "next/server";
import { buildShowmoreCsv } from "@/lib/csv/showmore";
import { normalizeShowmoreMarkupPercent } from "@/lib/csv/showmorePricing";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
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
  const showmoreMarkupPercent = normalizeShowmoreMarkupPercent(body.showmoreMarkupPercent);

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

  const drafts = data ?? [];
  const csv = buildShowmoreCsv(drafts, { showmoreMarkupPercent });
  const exportedIds = drafts.map((draft) => draft.id);

  // Q4-A: mark csv_ready like Matrixify so queue stage filter can show「CSV 已備妥」.
  // publish_method stays on existing enum (no showmore_csv without migration) —
  // job payload records export kind for honesty.
  if (exportedIds.length) {
    await serviceSupabase
      .from("product_drafts")
      .update({
        status: "csv_ready",
        publish_status: "csv_ready"
      })
      .in("id", exportedIds);

    await serviceSupabase.from("publish_jobs").insert(
      drafts.map((draft) => ({
        draft_id: draft.id,
        publish_mode: draft.publish_mode,
        // Enum has no showmore_csv yet (zero SQL this pack); manual + payload kind.
        publish_method: "manual",
        publish_status: "csv_ready",
        request_payload: {
          export: "showmore",
          draftIds: exportedIds,
          showmoreMarkupPercent
        },
        response_payload: { generatedAt: new Date().toISOString() },
        completed_at: new Date().toISOString()
      }))
    );
  }

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="nestory-showmore-${Date.now()}.csv"`,
      "X-Nestory-Showmore-Markup-Percent": String(showmoreMarkupPercent)
    }
  });
}
