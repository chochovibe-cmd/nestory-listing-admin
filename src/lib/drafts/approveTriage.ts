/**
 * REVIEW-FLOW B5: approve failure triage (single card + batch strip).
 *
 * Problem: the approve handlers wrapped the fetch AND the post-success UI callbacks in
 * one try/catch, so a throw in a callback (or a flaky network after the server already
 * wrote) showed "核准連線失敗" for an approve that actually landed.
 *
 * Now only fetch + parse decide the outcome (classifyApproveResponse). When the outcome
 * is "uncertain" (network error / 5xx / unparseable body) the UI re-reads the real
 * status + stage and reports what actually happened (verdictFromRecheck).
 *
 * Pure except recheckDraftStages (takes the browser Supabase client as a parameter).
 */

import { effectiveStage } from "@/lib/drafts/reviewTransitions";

// ---------------------------------------------------------------------------
// Response classification
// ---------------------------------------------------------------------------

export type ApproveOutcome =
  | { kind: "success"; alreadyApproved: boolean }
  /** HTTP 409 STAGE_MISMATCH: stale card, server says where the draft really is. */
  | { kind: "mismatch"; message: string }
  /** Definitive rejection with a server message (⛔ 422, 401/403/404, 400 …). */
  | { kind: "rejected"; message: string; code: string | null }
  /** Network error / 5xx / unparseable body: the write may or may not have landed. */
  | { kind: "uncertain" };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param input.networkError fetch itself threw
 * @param input.status       HTTP status (omit when networkError)
 * @param input.payload      parsed JSON body, or null/undefined when it did not parse
 */
export function classifyApproveResponse(input: {
  networkError?: boolean;
  status?: number;
  payload?: unknown;
}): ApproveOutcome {
  if (input.networkError) return { kind: "uncertain" };
  const status = input.status ?? 0;
  if (status >= 500 || status === 0) return { kind: "uncertain" };
  if (!isPlainObject(input.payload)) return { kind: "uncertain" };
  const payload = input.payload;
  const errorText =
    typeof payload.error === "string" && payload.error.trim() ? payload.error : "核准失敗";
  const code = typeof payload.code === "string" ? payload.code : null;

  if (status >= 200 && status < 300) {
    if (payload.ok === false) return { kind: "rejected", message: errorText, code };
    return { kind: "success", alreadyApproved: payload.alreadyApproved === true };
  }
  if (status === 409 && code === "STAGE_MISMATCH") {
    return { kind: "mismatch", message: errorText };
  }
  return { kind: "rejected", message: errorText, code };
}

// ---------------------------------------------------------------------------
// Re-read after an uncertain outcome
// ---------------------------------------------------------------------------

export type RecheckRow = {
  id?: string;
  status?: string | null;
  pipeline_stage?: string | null;
  shopify_product_id?: string | null;
};

export type RecheckVerdict = "approved" | "not_approved" | "unknown";

/** A draft that left 站① forward (image_review / ready / published) is approved. */
export function verdictFromRecheck(row: RecheckRow | null | undefined): RecheckVerdict {
  if (!row) return "unknown";
  const stage = effectiveStage(row);
  return stage === "image_review" || stage === "ready" || stage === "published"
    ? "approved"
    : "not_approved";
}

export const APPROVE_RECHECK_MESSAGE = {
  approved: "已核准（剛剛連線不穩，已重新確認）",
  notApproved: "核准沒有成功（連線失敗），請再按一次",
  unknown: "連線不穩，無法確認是否已核准，請重新整理頁面確認"
} as const;

/** Loose shape of the browser Supabase client (same convention as approveCopy.ts). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = { from: (table: string) => any };

/**
 * Re-read the real status + stage for these drafts. `null` = the re-check itself failed
 * (network / RLS error) → every verdict is "unknown".
 */
export async function recheckDraftStages(
  supabase: DbClient,
  ids: string[]
): Promise<Map<string, RecheckRow> | null> {
  if (ids.length === 0) return new Map();
  try {
    const { data, error } = await supabase
      .from("product_drafts")
      .select("id, status, pipeline_stage, shopify_product_id")
      .in("id", ids);
    if (error || !Array.isArray(data)) return null;
    const map = new Map<string, RecheckRow>();
    for (const row of data as RecheckRow[]) {
      if (row && typeof row.id === "string") map.set(row.id, row);
    }
    return map;
  } catch {
    return null;
  }
}

export type RecheckTriage = {
  approvedIds: string[];
  notApprovedIds: string[];
  unknownIds: string[];
};

export function triageRecheck(
  ids: string[],
  rows: Map<string, RecheckRow> | null
): RecheckTriage {
  const out: RecheckTriage = { approvedIds: [], notApprovedIds: [], unknownIds: [] };
  for (const id of ids) {
    const verdict = rows ? verdictFromRecheck(rows.get(id)) : "unknown";
    if (verdict === "approved") out.approvedIds.push(id);
    else if (verdict === "not_approved") out.notApprovedIds.push(id);
    else out.unknownIds.push(id);
  }
  return out;
}

/** Batch toast after an uncertain outcome: `N 件已核准、M 件未核准`. */
export function formatBatchRecheckMessage(triage: RecheckTriage): string {
  const approved = triage.approvedIds.length;
  const notApproved = triage.notApprovedIds.length;
  const unknown = triage.unknownIds.length;
  if (approved === 0 && notApproved === 0 && unknown > 0) {
    return APPROVE_RECHECK_MESSAGE.unknown;
  }
  const base = `${approved} 件已核准、${notApproved} 件未核准`;
  return unknown > 0 ? `${base}（${unknown} 件無法確認，請重新整理確認）` : base;
}

// ---------------------------------------------------------------------------
// Skipped-item wording (batch approve / batch return)
// ---------------------------------------------------------------------------

export type SkippedItem = { id: string; reason: string };

/** Shorten a server skip reason for a toast. */
export function shortSkipReason(reason: string): string {
  const where = reason.match(/^這筆目前在「([^」]+)」/);
  if (where) return `已在「${where[1]}」`;
  if (reason.startsWith("⛔")) return "有 ⛔ 必修項目";
  if (reason.includes("剛剛被其他操作移動")) return "剛被其他操作移動";
  const trimmed = reason.trim();
  return trimmed.length > 24 ? `${trimmed.slice(0, 24)}…` : trimmed;
}

/** `略過 M 件（原因A、原因B 等）`; empty string when nothing was skipped. */
export function formatSkippedSummary(skipped: SkippedItem[]): string {
  if (!skipped.length) return "";
  const reasons: string[] = [];
  for (const item of skipped) {
    const short = shortSkipReason(item.reason);
    if (short && !reasons.includes(short)) reasons.push(short);
  }
  const shown = reasons.slice(0, 2).join("、");
  const more = reasons.length > 2 ? " 等" : "";
  return `略過 ${skipped.length} 件${shown ? `（${shown}${more}）` : ""}`;
}
