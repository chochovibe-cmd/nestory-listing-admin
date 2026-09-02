/**
 * R3: station② all-keep → pipeline_stage=ready only (no sharp/finalize/Shopify).
 */
import { NextRequest } from "next/server";
import {
  loadAuthorizedDraftIds,
  resolveRequestPrincipal
} from "@/lib/api/requestPrincipal";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const draftIds: unknown = body.draftIds;

  if (!Array.isArray(draftIds) || draftIds.length === 0 || !draftIds.every((id) => typeof id === "string")) {
    return Response.json({ error: "draftIds must be a non-empty string array" }, { status: 400 });
  }

  const uniqueIds = [...new Set(draftIds as string[])];

  const principalResult = await resolveRequestPrincipal(request);
  if (!principalResult.ok) return principalResult.response;
  if (principalResult.principal.kind !== "session") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const authorizedIdsResult = await loadAuthorizedDraftIds(principalResult.principal, uniqueIds);
  if (!authorizedIdsResult.ok) return authorizedIdsResult.response;
  const authorizedDraftIds = authorizedIdsResult.ids;

  const serviceSupabase = createServiceSupabaseClient();
  const { data: rows, error: loadError } = authorizedDraftIds.length
    ? await serviceSupabase
        .from("product_drafts")
        .select("id, title_zh, taobao_title, original_title, status, pipeline_stage")
        .in("id", authorizedDraftIds)
    : { data: [], error: null };

  if (loadError) {
    return Response.json({ error: loadError.message }, { status: 500 });
  }

  const found = new Map((rows ?? []).map((r) => [r.id as string, r]));
  const advanced: string[] = [];
  const skipped: Array<{ draftId: string; reason: string }> = [];

  for (const id of uniqueIds) {
    const row = found.get(id);
    if (!row) {
      skipped.push({ draftId: id, reason: "找不到草稿" });
      continue;
    }
    if (row.pipeline_stage === "ready") {
      advanced.push(id);
      continue;
    }
    if (row.pipeline_stage !== "image_review" && row.status !== "approved") {
      skipped.push({
        draftId: id,
        reason: `目前不在圖片審核站（stage=${row.pipeline_stage ?? "?"}）`
      });
      continue;
    }
    const { error: updError } = await serviceSupabase
      .from("product_drafts")
      .update({
        pipeline_stage: "ready",
        // keep status=approved (copy locked); do not touch image pipeline
        updated_at: new Date().toISOString()
      })
      .eq("id", id);

    if (updError) {
      skipped.push({ draftId: id, reason: updError.message });
      continue;
    }
    advanced.push(id);
  }

  const message =
    advanced.length === 0
      ? `0 件進入完成待發布。${skipped.map((s) => s.reason).join("；")}`
      : skipped.length
        ? `已 ${advanced.length} 件進入完成待發布；${skipped.length} 件略過。`
        : `已 ${advanced.length} 件進入完成待發布（全保留原圖，轉檔改到發布時）。`;

  return Response.json({
    ok: advanced.length > 0,
    advancedCount: advanced.length,
    advancedIds: advanced,
    skipped,
    message
  });
}
