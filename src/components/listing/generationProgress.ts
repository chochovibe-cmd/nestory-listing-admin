// B1: shared contract for the 生成 progress card. The input panel (left) drives
// it, DraftResultsPanel (right) renders it, bridged by a window CustomEvent --
// the same cross-component pattern as nestory:pricing-settings-changed. Kept in
// a plain (non-"use client") module so both client components import the exact
// same constant/types without relying on cross-client-module value imports.
export const GENERATION_PROGRESS_EVENT = "nestory:generation-progress";

export type StepStatus = "pending" | "active" | "done" | "warn" | "error";

export type GenerationProgress = {
  visible: boolean;
  title: string;
  steps: { label: string; status: StepStatus }[];
  error?: string;
};

// The four honest phases of the two-request pipeline (analyze-images, then
// generate). Not a fake stream animation -- that waits for A20.
export const GENERATION_STEP_LABELS = [
  "建立草稿",
  "圖片分析（Vision 辨識／規格 OCR）",
  "AI 文案生成（IP 判斷＋文案＋定價）",
  "寫回草稿完成"
];

/** How long a completed gen-card may wait for a ResultCard before auto-clear. */
export const GENERATION_DONE_MAX_MS = 10_000;

/**
 * Survives DraftResultsPanel remount (router.refresh / replace).
 * router.refresh() usually keeps this module instance; no browser storage needed.
 */
let lastProgress: GenerationProgress | null = null;

export function getLastGenerationProgress(): GenerationProgress | null {
  return lastProgress;
}

export function setLastGenerationProgress(model: GenerationProgress | null): void {
  lastProgress = model && model.visible ? model : null;
}

export function generationProgressHasError(model: GenerationProgress): boolean {
  return Boolean(model.error) || model.steps.some((step) => step.status === "error");
}

export function generationProgressAllDone(model: GenerationProgress): boolean {
  return model.steps.length > 0 && model.steps.every((step) => step.status === "done");
}

export function draftMatchesGenerationProgressTitle(
  title: string,
  draft: {
    title_zh?: string | null;
    original_title?: string | null;
    taobao_title?: string | null;
  }
): boolean {
  const prefix = title.trim();
  if (!prefix) return false;
  for (const raw of [draft.title_zh, draft.original_title, draft.taobao_title]) {
    if (!raw) continue;
    const text = raw.trim();
    if (!text) continue;
    if (text.includes(prefix) || prefix.includes(text.slice(0, prefix.length))) {
      return true;
    }
  }
  return false;
}
