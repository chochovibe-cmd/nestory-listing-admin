/**
 * SYN-1 E: AI image cost → generation_cost_estimate (additive).
 * Only call when a real AI image API ran. null ≠ $0 (E4 honesty).
 */

/** Loose client so service-role Supabase types pass without friction. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CostServiceClient = { from: (table: string) => any };

/**
 * Add a finite positive costUsd to product_drafts.generation_cost_estimate.
 * No-op when cost is null/NaN/≤0. Never writes 0 to invent a bill.
 */
export async function appendGenerationCostUsd(
  serviceSupabase: CostServiceClient,
  draftId: string,
  costUsd: number | null | undefined
): Promise<{ ok: boolean; nextTotal: number | null; reason?: string }> {
  const id = draftId?.trim();
  if (!id) return { ok: false, nextTotal: null, reason: "draftId empty" };

  if (costUsd == null || !Number.isFinite(costUsd) || costUsd <= 0) {
    return { ok: true, nextTotal: null, reason: "no_positive_cost" };
  }

  const add = Math.round(costUsd * 1e6) / 1e6;

  try {
    const { data, error } = await serviceSupabase
      .from("product_drafts")
      .select("generation_cost_estimate")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return { ok: false, nextTotal: null, reason: error.message };
    }

    const prevRaw = data?.generation_cost_estimate as number | null | undefined;
    const prev =
      prevRaw != null && Number.isFinite(Number(prevRaw))
        ? Number(prevRaw)
        : 0;
    const nextTotal = Math.round((prev + add) * 1e6) / 1e6;

    const { error: upErr } = await serviceSupabase
      .from("product_drafts")
      .update({ generation_cost_estimate: nextTotal })
      .eq("id", id);

    if (upErr) {
      return { ok: false, nextTotal: null, reason: upErr.message };
    }

    return { ok: true, nextTotal };
  } catch (e) {
    return {
      ok: false,
      nextTotal: null,
      reason: e instanceof Error ? e.message : String(e)
    };
  }
}

/** Pure helper for tests: next estimate given prior + add. */
export function nextGenerationCostEstimate(
  prior: number | null | undefined,
  addUsd: number | null | undefined
): number | null {
  if (addUsd == null || !Number.isFinite(addUsd) || addUsd <= 0) {
    return prior != null && Number.isFinite(Number(prior))
      ? Number(prior)
      : null;
  }
  const prev =
    prior != null && Number.isFinite(Number(prior)) ? Number(prior) : 0;
  return Math.round((prev + addUsd) * 1e6) / 1e6;
}
