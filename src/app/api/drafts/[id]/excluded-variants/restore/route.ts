/**
 * VARIANT-CLEAN: restore one option the import excluded as a non-product 款式.
 * Inserts it as a normal variant row (SKU assigned, no image), removes it from
 * raw_capture.server.excluded_variants and adds its values to variant_dimensions.
 *
 * CAPTURE-FIX: `{ all: true, reason: "source_sold_out" }` restores every source-sold-out entry
 * in one go. A restored source-sold-out variant follows the product cost, so the draft goes back
 * to "needs price confirmation".
 */
import { NextRequest } from "next/server";
import { canOperate } from "@/lib/auth/roles";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import {
  planRestoreAllExcludedVariants,
  planRestoreExcludedVariant,
  readExcludedVariants
} from "@/lib/variants/restoreExcludedVariant";
import { isMissingVariantOverrideColumn, omitVariantOverrideColumns } from "@/lib/variants/variantPersist";
import type { UserRole } from "@/types/domain";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await authSupabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { data: profile } = await authSupabase.from("profiles").select("role").eq("id", user.id).single();
  if (!canOperate(profile?.role as UserRole | undefined)) {
    return Response.json({ error: "Operator role is required" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | { index?: unknown; all?: unknown; reason?: unknown }
    | null;
  const restoreAll = body?.all === true;
  if (restoreAll && body?.reason !== "source_sold_out") {
    return Response.json({ error: "不支援的加回類型" }, { status: 400 });
  }
  const index = typeof body?.index === "number" ? body.index : Number.NaN;

  const serviceSupabase = createServiceSupabaseClient();
  const { data: draft, error: draftError } = await serviceSupabase
    .from("product_drafts")
    .select("id, raw_capture, variant_dimensions")
    .eq("id", id)
    .maybeSingle();
  if (draftError || !draft) return Response.json({ error: "找不到草稿" }, { status: 404 });

  const { data: existing, error: existingError } = await serviceSupabase
    .from("product_variants")
    .select("id, sku, sort_order, option1_value, option2_value, option3_value")
    .eq("draft_id", id);
  if (existingError) return Response.json({ error: `讀取款式失敗：${existingError.message}` }, { status: 500 });

  const excluded = readExcludedVariants(draft.raw_capture);
  const dimensions = Array.isArray(draft.variant_dimensions) ? draft.variant_dimensions : [];

  let rows: Array<Record<string, unknown>>;
  let remaining: typeof excluded;
  let nextDimensions: typeof dimensions;
  let restoredSoldOut: boolean;
  if (restoreAll) {
    const plan = planRestoreAllExcludedVariants({
      draftId: id,
      excluded,
      reason: "source_sold_out",
      existing: existing ?? [],
      dimensions
    });
    if (!plan.ok) return Response.json({ error: plan.error }, { status: plan.status });
    rows = plan.rows;
    remaining = plan.remaining;
    nextDimensions = plan.dimensions;
    restoredSoldOut = true;
  } else {
    const plan = planRestoreExcludedVariant({
      draftId: id,
      excluded,
      index,
      existing: existing ?? [],
      dimensions
    });
    if (!plan.ok) return Response.json({ error: plan.error }, { status: plan.status });
    rows = [plan.row];
    remaining = plan.remaining;
    nextDimensions = plan.dimensions;
    restoredSoldOut = excluded[index]?.reason === "source_sold_out";
  }

  let { error: insertError } = await serviceSupabase.from("product_variants").insert(rows);
  if (insertError && isMissingVariantOverrideColumn(insertError.message)) {
    ({ error: insertError } = await serviceSupabase
      .from("product_variants")
      .insert(omitVariantOverrideColumns(rows, insertError.message)));
  }
  if (insertError && isMissingVariantOverrideColumn(insertError.message)) {
    ({ error: insertError } = await serviceSupabase
      .from("product_variants")
      .insert(omitVariantOverrideColumns(rows)));
  }
  if (insertError) return Response.json({ error: `恢復款式失敗：${insertError.message}` }, { status: 500 });

  const raw = (draft.raw_capture ?? {}) as Record<string, unknown>;
  const server = (raw.server ?? {}) as Record<string, unknown>;
  const nextServer: Record<string, unknown> = { ...server, excluded_variants: remaining };
  if (restoredSoldOut) {
    // The restored cost is inherited from the product, so it must be confirmed again.
    nextServer.price_requires_confirmation = true;
    nextServer.variant_price_confirmed_at = null;
    nextServer.variant_price_confirmed_by = null;
  }
  const { error: patchError } = await serviceSupabase
    .from("product_drafts")
    .update({
      variant_dimensions: nextDimensions,
      raw_capture: { ...raw, server: nextServer }
    })
    .eq("id", id);
  if (patchError) {
    return Response.json({ error: `款式已恢復，但更新排除清單失敗：${patchError.message}` }, { status: 500 });
  }
  return Response.json({
    ok: true,
    remaining: remaining.length,
    restored: rows.length,
    price_unconfirmed: restoredSoldOut
  });
}
