// Toast: shared contract for the global toast/snackbar system. Any client
// component can call showToast(...) (see components/Toast.tsx) and <ToastHost/>
// (mounted once in layout.tsx) renders it — same window CustomEvent bridge
// pattern as GENERATION_PROGRESS_EVENT / JUMP_TO_DRAFT_EVENT. Kept in a plain
// (non-"use client") module so every caller imports the exact same constant.
export const TOAST_EVENT = "nestory:toast";

export type ToastVariant = "success" | "error" | "warn" | "info";

export type ToastDetail = {
  id: string;
  message: string;
  variant: ToastVariant;
  /** ms before auto-dismiss. 0 = stays until the person dismisses it. */
  duration: number;
};
