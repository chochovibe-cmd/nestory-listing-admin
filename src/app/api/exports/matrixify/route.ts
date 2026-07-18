import { NextRequest } from "next/server";
import { buildMatrixifyCsv, type MatrixifyDraft } from "@/lib/csv/matrixify";
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import {
  csvExportDraftTitle,
  recordCsvExportBatch,
} from "@/lib/drafts/recordCsvExportBatch";
import { notifyMake } from "@/lib/notifications/make";
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
    return Response.json({ error: "Reviewer role is required to export fallback CSV" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.draftIds) ? body.draftIds : null;
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

  const drafts = (data ?? []) as MatrixifyDraft[];
  const draftIds = drafts.map((d) => d.id);

  // PKG2A / 回饋 55: multi-variant Matrixify rows need product_variants (same as Showmore).
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

  const csv = buildMatrixifyCsv(withVariants);
  const rows = withVariants;
  const exportedIds = rows.map((draft) => draft.id);

  let exportBatchId: string | null = null;

  if (exportedIds.length && markLeaveQueue) {
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
      rows.map((draft) => ({
        draft_id: draft.id,
        publish_mode: draft.publish_mode,
        publish_method: "matrixify_csv",
        publish_status: "csv_ready",
        request_payload: { draftIds: exportedIds },
        response_payload: { generatedAt: new Date().toISOString() },
        completed_at: new Date().toISOString()
      }))
    );

    // P1-69: also ledger into publish_batches (best-effort, never block CSV).
    try {
      const recorded = await recordCsvExportBatch({
        serviceSupabase,
        kind: "matrixify",
        drafts: rows.map((d) => ({
          draftId: d.id,
          title: csvExportDraftTitle(d),
        })),
        createdBy: user.id,
      });
      exportBatchId = recorded.batchId;
    } catch {
      exportBatchId = null;
    }

    await notifyMake("csv_ready", { draftIds: exportedIds });
  }

  const headers: Record<string, string> = {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="nestory-matrixify-${Date.now()}.csv"`,
    "X-Nestory-Left-Queue": markLeaveQueue ? "1" : "0",
  };
  if (exportBatchId) headers["X-Nestory-Publish-Batch-Id"] = exportBatchId;

  return new Response(csv, { headers });
}
