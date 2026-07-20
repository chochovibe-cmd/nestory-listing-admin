"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * R2 station②: 📄 定稿預覽 — locked copy / tags / price (read-only).
 * UX-I T54/T57: modal-hdr shell + Esc close (display only).
 * UX-B2-P01 1-2: portal to body so fixed overlay is not trapped inside
 * .result-card (transform/overflow → wrong containing block / collapse ghost).
 */
export function LockedCopyPreview({
  open,
  onClose,
  title,
  tags,
  sellPrice,
  compareAt,
  why,
  highlights,
  description,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  tags: string;
  sellPrice: string;
  compareAt: string;
  why: string;
  highlights: string;
  description: string;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="modal-overlay open"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className="modal-box"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="locked-copy-title"
      >
        <div className="modal-hdr">
          <span id="locked-copy-title">📄 定稿預覽（唯讀）</span>
          <button aria-label="關閉" className="modal-close" onClick={onClose} type="button">
            ×
          </button>
        </div>
        <div className="modal-body">
          <div className="field">
            <div className="rc-label">標題</div>
            <div className="rc-text">{title || "—"}</div>
          </div>
          <div className="field">
            <div className="rc-label">售價</div>
            <div className="rc-text">
              {sellPrice ? `NT$${sellPrice}` : "—"}
              {compareAt ? ` ／ 定價 NT$${compareAt}` : ""}
            </div>
          </div>
          <div className="field">
            <div className="rc-label">Tags</div>
            <div className="rc-text" style={{ whiteSpace: "pre-wrap" }}>
              {tags || "—"}
            </div>
          </div>
          <div className="field">
            <div className="rc-label">為什麼選它</div>
            <div className="rc-text" style={{ whiteSpace: "pre-wrap" }}>
              {why || "—"}
            </div>
          </div>
          <div className="field">
            <div className="rc-label">賣點</div>
            <div className="rc-text" style={{ whiteSpace: "pre-wrap" }}>
              {highlights || "—"}
            </div>
          </div>
          <div className="field">
            <div className="rc-label">描述摘要</div>
            <div className="rc-text" style={{ whiteSpace: "pre-wrap", maxHeight: 160, overflow: "auto" }}>
              {(description || "—").slice(0, 800)}
              {(description || "").length > 800 ? "…" : ""}
            </div>
          </div>
          <div className="modal-actions">
            <button onClick={onClose} type="button">
              關閉
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
