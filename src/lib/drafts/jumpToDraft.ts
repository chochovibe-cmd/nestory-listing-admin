/**
 * R4 §7: cross-panel jump from 各站掛件 → result card.
 * Same window-event bridge pattern as generationProgress.
 */

import type { StationFilterKey } from "@/lib/drafts/stationFilter";

export const JUMP_TO_DRAFT_EVENT = "nestory:jump-to-draft";

export type JumpToDraftDetail = {
  draftId: string;
  /** Preferred station filter when jumping into results pane. */
  station?: StationFilterKey | "input" | null;
};

export function draftCardDomId(draftId: string): string {
  return `draft-card-${draftId}`;
}

export function emitJumpToDraft(detail: JumpToDraftDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<JumpToDraftDetail>(JUMP_TO_DRAFT_EVENT, { detail })
  );
}

export function scrollToDraftCard(draftId: string): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(draftCardDomId(draftId));
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}
