"use client";

import { useEffect, useId, useRef } from "react";
import type { SummaryRow } from "@/lib/drafts/approveSummary";

/**
 * B11: pre-approve summary (Shopify-affecting paths only — 差異 11 D1-B).
 * Desktop: centered modal. Mobile <960px: bottom sheet (AGENTS 鐵則).
 */
export function ApproveSummaryModal({
  open,
  heading,
  rows,
  primaryLabel,
  primaryDanger = false,
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  heading: string;
  rows: SummaryRow[];
  primaryLabel: string;
  primaryDanger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => primaryRef.current?.focus(), 30);
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

  if (!open) return null;

  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="modal-overlay open"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
      role="dialog"
    >
      <div className="modal-box approve-summary-modal" ref={panelRef}>
        <div className="modal-hdr">
          <span id={titleId}>{heading}</span>
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
          <ul className="approve-sum-list">
            {rows.map((row, index) => (
              <li className={`sum-row sum-row-${row.tone}`} key={`${index}-${row.text.slice(0, 24)}`}>
                <span
                  aria-hidden
                  className={`st-dot st-${row.tone === "ok" ? "ok" : row.tone === "info" ? "idle" : row.tone === "warn" ? "busy" : "ng"}`}
                />
                <span className="sum-row-text">{row.text}</span>
              </li>
            ))}
          </ul>
          <div className="approve-sum-actions">
            <button
              className="approve-sum-btn"
              disabled={busy}
              onClick={onCancel}
              type="button"
            >
              返回處理
            </button>
            <button
              className={`primary approve-sum-btn${primaryDanger ? " danger" : ""}`}
              disabled={busy}
              onClick={onConfirm}
              ref={primaryRef}
              type="button"
            >
              {busy ? "處理中…" : primaryLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
