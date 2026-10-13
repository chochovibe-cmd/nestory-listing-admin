"use client";

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * REVIEW-FLOW B2/B6: count-aware confirm dialog for the batch strip
 * (批次退回 / 略過 ⛔ 項目後核准其餘).
 *
 * Same shell + classes as the 紀錄頁 ConfirmModal and Station3PublishModal
 * (modal-overlay / modal-box / approve-sum-actions / <960 bottom sheet), focus lands on
 * 取消 first, Esc / backdrop cancel unless busy. No new CSS.
 */
export function ReviewConfirmModal({
  open,
  title,
  children,
  confirmLabel = "確認",
  cancelLabel = "取消",
  busy = false,
  danger = true,
  onCancel,
  onConfirm
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => cancelRef.current?.focus(), 30);
    return () => {
      document.body.style.overflow = prev;
      window.clearTimeout(t);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="modal-overlay open"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
      role="dialog"
    >
      <div className="modal-box">
        <div className="modal-hdr">
          <span id={titleId}>{title}</span>
          <button
            aria-label="關閉"
            className="modal-close"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            ×
          </button>
        </div>
        <div className="modal-body">
          {children}
          <div className="approve-sum-actions">
            <button
              className="approve-sum-btn"
              disabled={busy}
              onClick={onCancel}
              ref={cancelRef}
              type="button"
            >
              {cancelLabel}
            </button>
            <button
              className={`primary approve-sum-btn${danger ? " danger" : ""}`}
              disabled={busy}
              onClick={onConfirm}
              type="button"
            >
              {busy ? "處理中…" : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
