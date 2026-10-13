"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PublishBlocker } from "@/lib/shopify/publishReadiness";

/**
 * PUBLISH-GUARD: shown when /publish answers 409 PUBLISH_NEEDS_PRICE_CONFIRM
 * (bundle variant sharing the single-item cost, or capture flagged the price as
 * "needs confirmation"). Same shell as Station3PublishModal; the primary button
 * stays disabled until the operator ticks the checkbox.
 */
export function PublishPriceConfirmModal({
  open,
  blockers,
  busy = false,
  onCancel,
  onConfirm
}: {
  open: boolean;
  blockers: PublishBlocker[];
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChecked(false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Destructive-ish publish modal → focus 取消 first (same as Station3PublishModal).
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
      <div className="modal-box approve-summary-modal station3-publish-modal">
        <div className="modal-hdr">
          <span id={titleId}>發布前請確認款式價</span>
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
            {blockers.map((blocker, index) => (
              <li className="sum-row sum-row-warn" key={`${blocker.code}-${index}`}>
                <span aria-hidden className="st-dot st-busy" />
                <span className="sum-row-text">{blocker.message}</span>
              </li>
            ))}
          </ul>

          <label className="check-row">
            <input
              checked={checked}
              disabled={busy}
              onChange={(event) => setChecked(event.target.checked)}
              type="checkbox"
            />
            我已逐一核對每個款式的成本（含套組／整盒款）
          </label>

          <div className="approve-sum-actions">
            <button
              className="approve-sum-btn"
              disabled={busy}
              onClick={onCancel}
              ref={cancelRef}
              type="button"
            >
              取消
            </button>
            <button
              className="primary approve-sum-btn"
              disabled={!checked || busy}
              onClick={onConfirm}
              type="button"
            >
              {busy ? "處理中…" : "確認並發布"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
