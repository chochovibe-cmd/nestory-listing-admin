import { NextRequest } from "next/server";
import { buildShowmoreCsv, type ShowmoreDraft } from "@/lib/csv/showmore";
import { normalizeShowmoreMarkupPercent } from "@/lib/csv/showmorePricing";
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import type { ProductVariantRow } from "@/types/domain";

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
  // R3 Q3: when API failed but still downloading CSV, do not leave queue.
  const markLeaveQueue = body.markLeaveQueue !== false;

  const serviceSupabase = createServiceSupabaseClient();

  let query = serviceSupabase
    .from("product_drafts")
    .select("*, product_images(*)")
    .or("pipeline_stage.eq.ready,status.in.(approved,api_failed,csv_ready)");

  if (ids?.length) {
    query = query.in("id", ids);
  }

  const { data, error } = await query.order("updated_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const drafts = (data ?? []) as ShowmoreDraft[];
  const draftIds = drafts.map((d) => d.id);

  let variantsByDraft = new Map<string, ProductVariantRow[]>();
  if (draftIds.length) {
    const { data: variantRows } = await serviceSupabase
      .from("product_variants")
      .select("*")
      .in("draft_id", draftIds)
      .order("sort_order", { ascending: true });
    variantsByDraft = new Map();
    for (const row of (variantRows ?? []) as ProductVariantRow[]) {
      const list = variantsByDraft.get(row.draft_id) ?? [];
      list.push(row);
      variantsByDraft.set(row.draft_id, list);
    }
  }

  const withVariants = drafts.map((d) => ({
    ...d,
    product_variants: variantsByDraft.get(d.id) ?? []
  }));

  const csv = buildShowmoreCsv(withVariants, { showmoreMarkupPercent });
  const exportedIds = withVariants.map((draft) => draft.id);

  // Q4-A / R3 Q2: mark csv_ready when leave-queue allowed (CSV-only or full success).
  if (exportedIds.length && markLeaveQueue) {
    await serviceSupabase
      .from("product_drafts")
      .update({
        status: "csv_ready",
        pipeline_stage: mapStatusToPipelineStage("csv_ready"),
        publish_status: "csv_ready"
      })
      .in("id", exportedIds);

    await serviceSupabase.from("publish_jobs").insert(
      withVariants.map((draft) => ({
        draft_id: draft.id,
        publish_mode: draft.publish_mode,
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
      "X-Nestory-Showmore-Markup-Percent": String(showmoreMarkupPercent),
      "X-Nestory-Left-Queue": markLeaveQueue ? "1" : "0"
    }
  });
}
