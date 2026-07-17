"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  countSelectedActions,
  DEFAULT_STATION3_SELECTION,
  hasAnyAction,
  readStoredStation3Selection,
  STATION3_SINGLE_ACTION_REMINDER,
  writeStoredStation3Selection,
  type Station3PublishSelection,
  type Station3ShopifyChoice
} from "@/lib/drafts/station3Publish";

/**
 * R3 station③: multi-select publish/export.
 * Shell = ApproveSummaryModal (modal-overlay / modal-box / <960 bottom sheet).
 */
export function Station3PublishModal({
  open,
  draftCount,
  busy = false,
  onCancel,
  onConfirm
}: {
  open: boolean;
  draftCount: number;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (selection: Station3PublishSelection) => void;
}) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [selection, setSelection] = useState<Station3PublishSelection>(DEFAULT_STATION3_SELECTION);
  const [singleWarn, setSingleWarn] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelection(readStoredStation3Selection());
    setSingleWarn(false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // UX-E T32: destructive publish modal → focus 取消 first
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

  if (!open) return null;

  const canSubmit = hasAnyAction(selection) && !busy;

  function setShopify(value: Station3ShopifyChoice) {
    setSelection((prev) => ({ ...prev, shopify: value }));
    setSingleWarn(false);
  }

  function toggleCsv(key: "matrixify" | "showmore") {
    setSelection((prev) => ({ ...prev, [key]: !prev[key] }));
    setSingleWarn(false);
  }

  function handlePrimary() {
    if (!hasAnyAction(selection)) return;
    if (countSelectedActions(selection) === 1 && !singleWarn) {
      setSingleWarn(true);
      return;
    }
    writeStoredStation3Selection(selection);
    onConfirm(selection);
  }

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
      <div className="modal-box approve-summary-modal station3-publish-modal">
        <div className="modal-hdr">
          <span id={titleId}>發布／匯出</span>
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
          <p className="export-pf-overview">
            已選 <strong>{draftCount}</strong> 件 · 可同時勾多種格式
          </p>

          <fieldset className="station3-fieldset" disabled={busy}>
            <legend className="station3-legend">Shopify（二選一）</legend>
            <label className="check-row">
              <input
                checked={selection.shopify === "none"}
                name="station3-shopify"
                onChange={() => setShopify("none")}
                type="radio"
              />
              不上 Shopify
            </label>
            <label className="check-row">
              <input
                checked={selection.shopify === "draft"}
                name="station3-shopify"
                onChange={() => setShopify("draft")}
                type="radio"
              />
              API 建草稿
            </label>
            <label className="check-row">
              <input
                checked={selection.shopify === "active"}
                name="station3-shopify"
                onChange={() => setShopify("active")}
                type="radio"
              />
              API 正式上架
            </label>
          </fieldset>

          <fieldset className="station3-fieldset" disabled={busy}>
            <legend className="station3-legend">CSV 匯出（可並存）</legend>
            <label className="check-row">
              <input
                checked={selection.matrixify}
                onChange={() => toggleCsv("matrixify")}
                type="checkbox"
              />
              Matrixify CSV
            </label>
            <label className="check-row">
              <input
                checked={selection.showmore}
                onChange={() => toggleCsv("showmore")}
                type="checkbox"
              />
              Showmore CSV
            </label>
          </fieldset>

          {singleWarn ? (
            <p className="station3-single-warn" role="status">
              ⚠ {STATION3_SINGLE_ACTION_REMINDER}
            </p>
          ) : null}

          {!hasAnyAction(selection) ? (
            <p className="muted">請至少選一項。</p>
          ) : null}

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
            {singleWarn ? (
              <button
                className="approve-sum-btn"
                disabled={busy}
                onClick={() => setSingleWarn(false)}
                type="button"
              >
                返回加勾
              </button>
            ) : null}
            <button
              className={`primary approve-sum-btn${selection.shopify === "active" ? " danger" : ""}`}
              disabled={!canSubmit}
              onClick={handlePrimary}
              ref={primaryRef}
              type="button"
            >
              {busy
                ? "處理中…"
                : singleWarn
                  ? "仍只做這項"
                  : selection.shopify === "active"
                    ? "確認上架／匯出"
                    : "確認執行"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
