import { NextRequest } from "next/server";
import { buildMatrixifyCsv } from "@/lib/csv/matrixify";
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import { notifyMake } from "@/lib/notifications/make";
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
    return Response.json({ error: "Reviewer role is required to export fallback CSV" }, { status: 403 });
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

  const csv = buildMatrixifyCsv(data ?? []);
  const exportedIds = (data ?? []).map((draft) => draft.id);

  if (exportedIds.length) {
    await serviceSupabase
      .from("product_drafts")
      .update({
        status: "csv_ready",
        pipeline_stage: mapStatusToPipelineStage("csv_ready"),
        publish_method: "matrixify_csv",
        publish_status: "csv_ready"
      })
      .in("id", exportedIds);

    await serviceSupabase.from("publish_jobs").insert(
      (data ?? []).map((draft) => ({
        draft_id: draft.id,
        publish_mode: draft.publish_mode,
        publish_method: "matrixify_csv",
        publish_status: "csv_ready",
        request_payload: { draftIds: exportedIds },
        response_payload: { generatedAt: new Date().toISOString() },
        completed_at: new Date().toISOString()
      }))
    );

    await notifyMake("csv_ready", { draftIds: exportedIds });
  }

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="nestory-matrixify-${Date.now()}.csv"`
    }
  });
}
