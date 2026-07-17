"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  EXPORT_TABLE_COLUMNS,
  exportPreflightHeading,
  exportPrimaryLabel,
  formatPriceCell,
  type ExportPreflightReport
} from "@/lib/csv/exportPreflight";

/**
 * D9-open + R3 §10: export preflight + dual-mode preview (list / table).
 * Shell = B11 ApproveSummaryModal (modal-overlay / modal-box / <960 bottom sheet).
 */
export function ExportPreflightModal({
  open,
  report,
  busy = false,
  confirmLabel,
  onCancel,
  onConfirm
}: {
  open: boolean;
  report: ExportPreflightReport | null;
  busy?: boolean;
  /** Override primary button (e.g. multi-export flow). */
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [viewMode, setViewMode] = useState<"list" | "table">("list");

  useEffect(() => {
    if (!open) return;
    setViewMode("list");
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // UX-E T32: export leave-queue is high-risk → focus 返回 first
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

  if (!open || !report) return null;

  const heading = exportPreflightHeading(report.kind);
  const primaryLabel = confirmLabel ?? exportPrimaryLabel(report);
  const canExport = report.canExport && !busy;

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
      <div className="modal-box approve-summary-modal export-preflight-modal">
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
          <p className="export-pf-overview">
            <strong>{report.totalSelected}</strong> 件
            {report.kind === "showmore" && report.markupPercent != null ? (
              <>
                {" "}
                · 加價 <strong>+{report.markupPercent}%</strong>
                <span className="muted"> · 售價已美化</span>
              </>
            ) : (
              <span className="muted"> · Matrixify 售價不加價</span>
            )}
          </p>

          <div className="export-pf-mode-toggle" role="tablist" aria-label="預覽模式">
            <button
              aria-selected={viewMode === "list"}
              className={`btn-mini${viewMode === "list" ? " sel" : ""}`}
              onClick={() => setViewMode("list")}
              role="tab"
              type="button"
            >
              條列摘要
            </button>
            <button
              aria-selected={viewMode === "table"}
              className={`btn-mini${viewMode === "table" ? " sel" : ""}`}
              onClick={() => setViewMode("table")}
              role="tab"
              type="button"
            >
              表格模式
            </button>
          </div>

          {viewMode === "list" && report.items.length > 0 ? (
            <ul className="export-pf-items" aria-label="售價摘要">
              {report.items.map((item) => (
                <li
                  className={`export-pf-item${item.hasError ? " has-error" : item.hasWarn ? " has-warn" : ""}`}
                  key={item.draftId}
                  title={item.titleFull}
                >
                  <div className="export-pf-item-head">
                    <span className="export-pf-title">{item.titleShort}</span>
                    <span className="export-pf-prices">
                      售 {formatPriceCell(item.sellPriceDisplay)}
                      {item.compareAtDisplay != null ? (
                        <span className="muted"> / 原 {formatPriceCell(item.compareAtDisplay)}</span>
                      ) : null}
                    </span>
                    <span
                      aria-label={item.hasError ? "紅燈" : item.hasWarn ? "黃燈" : "綠燈"}
                      className={`export-pf-lamp ${item.hasError ? "is-err" : item.hasWarn ? "is-warn" : "is-ok"}`}
                    />
                  </div>
                  {item.issues.length > 0 ? (
                    <ul className="export-pf-item-issues">
                      {item.issues.map((issue, index) => (
                        <li
                          className={`sum-row sum-row-${issue.level === "error" ? "ng" : issue.level === "info" ? "info" : "warn"}`}
                          key={`${item.draftId}-${issue.code}-${index}`}
                        >
                          <span
                            aria-hidden
                            className={`st-dot st-${issue.level === "error" ? "ng" : issue.level === "info" ? "idle" : "busy"}`}
                          />
                          <span className="sum-row-text">{issue.message}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="schip schip--ok export-pf-ok-chip">欄位 OK</span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          {viewMode === "table" && report.items.length > 0 ? (
            <div className="export-pf-table-wrap">
              <table className="export-pf-table">
                <thead>
                  <tr>
                    {EXPORT_TABLE_COLUMNS.map((col) => (
                      <th key={col.key}>{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.items.map((item) => (
                    <tr
                      className={item.hasError ? "has-error" : item.hasWarn ? "has-warn" : ""}
                      key={item.draftId}
                    >
                      <td title={item.titleFull}>{item.titleShort}</td>
                      <td>{formatPriceCell(item.sellPriceDisplay)}</td>
                      <td>{formatPriceCell(item.compareAtDisplay)}</td>
                      <td className="export-pf-sku">{item.skuDisplay || "—"}</td>
                      <td>{item.variantCount > 0 ? item.variantCount : "1"}</td>
                      <td>{item.imageCount}</td>
                      <td>
                        <span
                          className={`export-pf-lamp ${item.hasError ? "is-err" : item.hasWarn ? "is-warn" : "is-ok"}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {report.errorCount > 0 || report.warnCount > 0 || report.infoCount > 0 ? (
            <div className="export-pf-summary-counts" role="status">
              {report.errorCount > 0 ? (
                <span className="schip schip--error">錯誤 {report.errorCount}（會擋下）</span>
              ) : null}
              {report.warnCount > 0 ? (
                <span className="schip schip--warn">警告 {report.warnCount}（可繼續）</span>
              ) : null}
              {report.infoCount > 0 && report.errorCount === 0 && report.warnCount === 0 ? (
                <span className="schip schip--idle">提示 {report.infoCount}</span>
              ) : null}
            </div>
          ) : (
            <p className="muted export-pf-all-ok">未發現缺欄；確認後下載 CSV。</p>
          )}

          {report.infoMessages.length > 0 ? (
            <ul className="approve-sum-list export-pf-info-list">
              {report.infoMessages.map((text, index) => (
                <li className="sum-row sum-row-info" key={`info-${index}`}>
                  <span aria-hidden className="st-dot st-idle" />
                  <span className="sum-row-text muted">{text}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {report.items.length === 0 && report.errorMessages.length > 0 ? (
            <ul className="approve-sum-list">
              {report.errorMessages.map((text, index) => (
                <li className="sum-row sum-row-ng" key={`e-${index}`}>
                  <span aria-hidden className="st-dot st-ng" />
                  <span className="sum-row-text">{text}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="approve-sum-actions">
            <button
              className="approve-sum-btn"
              disabled={busy}
              onClick={onCancel}
              ref={cancelRef}
              type="button"
            >
              返回處理
            </button>
            <button
              className="primary approve-sum-btn"
              disabled={!canExport}
              onClick={onConfirm}
              ref={primaryRef}
              type="button"
            >
              {busy ? "下載中…" : primaryLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
