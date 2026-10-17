/**
 * VARIANT-CLEAN: list live (active_published) products for the 價格／款式圖重同步 panel.
 * Local data only; Shopify is queried per product by the preview route. The browser computes
 * the new prices from this device's pricing settings, so the cost/lock columns come along.
 */
import { canPublish } from "@/lib/auth/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAllRows";
import type { UserRole } from "@/types/domain";

export const runtime = "nodejs";

const LIMIT = 200;

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!canPublish(profile?.role as UserRole | undefined)) {
    return Response.json({ error: "Reviewer role is required" }, { status: 403 });
  }

  const { data: drafts, error } = await supabase
    .from("product_drafts")
    .select("id, title_zh, taobao_title, status, shopify_product_id, price_mode, cny_price, twd_price, compare_at_price, pricing_formula, variant_dimensions")
    .eq("status", "active_published")
    .not("shopify_product_id", "is", null)
    .order("published_at", { ascending: false })
    .limit(LIMIT);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const ids = (drafts ?? []).map((d) => d.id as string);
  const { data: variants, error: variantError } = ids.length
    ? await fetchAllRows((from, to) =>
        supabase
          .from("product_variants")
          .select("*")
          .in("draft_id", ids)
          .order("sort_order", { ascending: true })
          .order("id")
          .range(from, to)
      )
    : { data: [], error: null };
  if (variantError) return Response.json({ error: variantError.message }, { status: 500 });

  const byDraft = new Map<string, unknown[]>();
  for (const row of variants ?? []) {
    byDraft.set(row.draft_id, [...(byDraft.get(row.draft_id) ?? []), row]);
  }
  return Response.json({
    ok: true,
    drafts: (drafts ?? []).map((d) => ({ ...d, variants: byDraft.get(d.id as string) ?? [] }))
  });
}
