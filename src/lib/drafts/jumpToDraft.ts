/**
 * R4 §7: cross-panel jump from 各站掛件 → result card.
 * Same window-event bridge pattern as generationProgress.
 * UX-AE T133: sessionStorage arrival highlight for Dashboard / deep-link jumps.
 */

import type { StationFilterKey } from "@/lib/drafts/stationFilter";

export const JUMP_TO_DRAFT_EVENT = "nestory:jump-to-draft";

/**
 * T133: optional draft id to pulse-highlight after navigation.
 * Value may be a real draft UUID, or JUMP_DRAFT_ID_FIRST for "first visible card".
 * Written by prepareTodoNavigation / callers; consumed once by DraftResultsPanel.
 */
export const JUMP_DRAFT_ID_STORAGE_KEY = "nestory:jump-draft-id";

/** Sentinel: highlight the first visible result card after stage/station filter. */
export const JUMP_DRAFT_ID_FIRST = "*";

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

export function scrollToDraftCard(
  draftId: string,
  opts?: { block?: ScrollLogicalPosition }
): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(draftCardDomId(draftId));
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: opts?.block ?? "start" });
}

/** Read one-shot jump target from sessionStorage (does not clear). */
export function readJumpDraftId(
  storage: Pick<Storage, "getItem"> | null | undefined
): string | null {
  try {
    const raw = storage?.getItem(JUMP_DRAFT_ID_STORAGE_KEY);
    if (typeof raw === "string" && raw.length > 0) return raw;
  } catch {
    /* ignore */
  }
  return null;
}

export function writeJumpDraftId(
  draftId: string,
  storage: Pick<Storage, "setItem"> | null | undefined
): void {
  try {
    storage?.setItem(JUMP_DRAFT_ID_STORAGE_KEY, draftId);
  } catch {
    /* ignore */
  }
}

export function clearJumpDraftId(
  storage: Pick<Storage, "removeItem"> | null | undefined
): void {
  try {
    storage?.removeItem(JUMP_DRAFT_ID_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
