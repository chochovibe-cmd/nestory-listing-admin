/**
 * REVIEW-FLOW B6: one definition of "this draft has a ⛔ 必修 item, do not approve".
 *
 * The single card (ResultCard.warningSummary), the batch strip (DraftResultsPanel) and
 * the approve routes (server) all grade through this function, so the inputs can never
 * drift apart. Every input is a *saved* product_drafts column — no local card state —
 * which is what makes the server-side check possible.
 */

import { extractMissingCharacterNames } from "@/lib/characters/missingCharacterWarnings";
import {
  gradeDraftWarnings,
  hasBlockingWarnings,
  type WarningTierSummary
} from "@/lib/drafts/warningTiers";

export type ApproveGateDraft = {
  warnings?: string[] | null;
  ip_name?: string | null;
  character_name?: string | null;
  title_zh?: string | null;
  twd_price?: number | null;
  twd_cost?: number | null;
};

/** Exact same grading the card has always shown (field gaps + warning strings). */
export function gradeDraftForApprove(draft: ApproveGateDraft): WarningTierSummary {
  const missingCharacters = extractMissingCharacterNames(draft.warnings);
  return gradeDraftWarnings(draft.warnings, {
    ip_name: draft.ip_name,
    character_name: draft.character_name,
    title_zh: draft.title_zh,
    twd_price: draft.twd_price,
    twd_cost: draft.twd_cost,
    missingCharacterInDict: missingCharacters.length > 0,
    missingIp: !draft.ip_name?.trim()
  });
}

/** ⛔ texts that block approval; empty array = approvable. */
export function approveBlockerTexts(draft: ApproveGateDraft): string[] {
  const summary = gradeDraftForApprove(draft);
  return hasBlockingWarnings(summary) ? summary.block.map((w) => w.text) : [];
}

/** `⛔ 必修：a；b` — same wording the card prints. */
export function formatApproveBlockMessage(texts: string[]): string {
  return `⛔ 必修：${texts.join("；")}`;
}

export type ApproveBlockedEntry<T> = { draft: T; texts: string[] };

/** Split a selection into approvable drafts and drafts blocked by ⛔ 必修. */
export function partitionApproveBlockers<T extends ApproveGateDraft>(
  drafts: T[]
): { eligible: T[]; blocked: ApproveBlockedEntry<T>[] } {
  const eligible: T[] = [];
  const blocked: ApproveBlockedEntry<T>[] = [];
  for (const draft of drafts) {
    const texts = approveBlockerTexts(draft);
    if (texts.length > 0) blocked.push({ draft, texts });
    else eligible.push(draft);
  }
  return { eligible, blocked };
}

/** Confirm text for the batch strip when some selected drafts will be skipped. */
export function formatBatchApproveBlockedConfirm(
  blockedCount: number,
  eligibleCount: number
): string {
  return `有 ${blockedCount} 件有 ⛔ 必修項目會被略過，要核准其餘 ${eligibleCount} 件嗎？`;
}

/** Columns the approve routes must read to grade a draft server-side. */
export const APPROVE_GATE_COLUMNS =
  "warnings, ip_name, character_name, title_zh, twd_price, twd_cost";
