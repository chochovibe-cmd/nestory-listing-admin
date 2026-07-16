import { NextRequest } from "next/server";
import {
  runExportPreflight,
  type ExportKind,
  type PreflightDraftInput
} from "@/lib/csv/exportPreflight";
import { normalizeShowmoreMarkupPercent } from "@/lib/csv/showmorePricing";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

/**
 * D9-open: field preflight without generating CSV or marking csv_ready.
 * Used by queue list (light row props) and optional clients.
 */
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
    return Response.json(
      { error: "Reviewer role is required to preview export" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.draftIds)
    ? body.draftIds.filter((id: unknown) => typeof id === "string")
    : [];
  const kind: ExportKind = body.kind === "matrixify" ? "matrixify" : "showmore";
  const showmoreMarkupPercent = normalizeShowmoreMarkupPercent(body.showmoreMarkupPercent);

  if (!ids.length) {
    const report = runExportPreflight([], { kind, showmoreMarkupPercent });
    return Response.json(report);
  }

  const serviceSupabase = createServiceSupabaseClient();
  const { data, error } = await serviceSupabase
    .from("product_drafts")
    .select(
      "id, title_zh, taobao_title, original_title, status, pipeline_stage, sku, twd_price, twd_cost, compare_at_price, price_mode, description_html, description_plain, variant_dimensions, product_images(image_type, processed_file_url, original_file_url, sort_order)"
    )
    .in("id", ids);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const { data: variantRows } = await serviceSupabase
    .from("product_variants")
    .select("draft_id, option1_value, option2_value, option3_value, twd_price, sku, sort_order")
    .in("draft_id", ids as string[])
    .order("sort_order", { ascending: true });

  const variantsByDraft = new Map<string, PreflightDraftInput["product_variants"]>();
  for (const row of variantRows ?? []) {
    const draftId = row.draft_id as string;
    const list = variantsByDraft.get(draftId) ?? [];
    list.push({
      option1_value: row.option1_value,
      option2_value: row.option2_value,
      option3_value: row.option3_value,
      twd_price: row.twd_price,
      sku: row.sku,
      sort_order: row.sort_order ?? 0
    });
    variantsByDraft.set(draftId, list);
  }

  // Preserve client selection order when possible
  const byId = new Map<string, PreflightDraftInput>();
  for (const row of data ?? []) {
    const r = row as PreflightDraftInput;
    byId.set(r.id, {
      id: r.id,
      title_zh: r.title_zh,
      taobao_title: r.taobao_title,
      original_title: r.original_title,
      status: r.status,
      pipeline_stage: r.pipeline_stage,
      sku: r.sku,
      twd_price: r.twd_price,
      twd_cost: r.twd_cost,
      compare_at_price: r.compare_at_price,
      price_mode: r.price_mode,
      description_html: r.description_html,
      description_plain: r.description_plain,
      variant_dimensions: r.variant_dimensions,
      product_images: r.product_images ?? [],
      product_variants: variantsByDraft.get(r.id) ?? []
    });
  }

  const ordered: PreflightDraftInput[] = [];
  for (const id of ids as string[]) {
    const found = byId.get(id);
    if (found) {
      ordered.push(found);
      continue;
    }
    // Selected id missing from DB — surface as non-exportable stub
    ordered.push({
      id,
      title_zh: null,
      taobao_title: null,
      original_title: null,
      status: "missing",
      pipeline_stage: null,
      sku: null,
      twd_price: null,
      twd_cost: null,
      compare_at_price: null,
      price_mode: null,
      description_html: null,
      description_plain: null,
      variant_dimensions: null,
      product_images: [],
      product_variants: []
    });
  }

  const report = runExportPreflight(ordered, { kind, showmoreMarkupPercent });
  return Response.json(report);
}
