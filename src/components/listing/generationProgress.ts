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
