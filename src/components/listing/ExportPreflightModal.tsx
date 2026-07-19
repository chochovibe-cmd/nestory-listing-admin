"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  exportPreflightHeading,
  exportPrimaryLabel,
  formatPriceCell,
  type ExportPreflightReport,
  type PreflightItem
} from "@/lib/csv/exportPreflight";
import {
  formatPlainTextAsHtml,
  isLikelyHtml
} from "@/lib/contentGenerator/htmlFormat";

/**
 * D9: customer product preview — mock layout + optional real Shopify Online Store iframe.
 * Admin URLs are never iframe'd (X-Frame blocked). Blank iframe → new-tab fallback.
 */
function StorefrontPreview({
  items,
  index,
  onIndexChange
}: {
  items: PreflightItem[];
  index: number;
  onIndexChange: (next: number) => void;
}) {
  const safeIndex = Math.min(Math.max(0, index), Math.max(0, items.length - 1));
  const item = items[safeIndex];
  const [pane, setPane] = useState<"mock" | "live">("mock");
  const [iframeBusy, setIframeBusy] = useState(true);

  useEffect(() => {
    setPane("mock");
    setIframeBusy(true);
  }, [safeIndex, item?.draftId]);

  if (!item) return null;

  const liveUrl = item.storefrontUrl;
  const canLive = Boolean(liveUrl);
  const activePane = canLive && pane === "live" ? "live" : "mock";

  const descRaw = item.descriptionText || "";
  const descHtml = descRaw
    ? isLikelyHtml(descRaw)
      ? descRaw
      : formatPlainTextAsHtml(descRaw)
    : "";
  const hero = item.imageUrls[0] ?? null;
  const thumbs = item.imageUrls.slice(0, 5);

  return (
    <div className="export-pf-storefront">
      <div className="export-pf-storefront-nav">
        <button
          className="btn-mini"
          disabled={safeIndex <= 0}
          onClick={() => onIndexChange(safeIndex - 1)}
          type="button"
        >
          ← 上一件
        </button>
        <span className="muted export-pf-storefront-count" aria-live="polite">
          {safeIndex + 1} / {items.length}
        </span>
        <button
          className="btn-mini"
          disabled={safeIndex >= items.length - 1}
          onClick={() => onIndexChange(safeIndex + 1)}
          type="button"
        >
          下一件 →
        </button>
      </div>

      <div className="export-pf-storefront-panes" role="tablist" aria-label="預覽來源">
        <button
          aria-selected={activePane === "mock"}
          className={`btn-mini${activePane === "mock" ? " sel" : ""}`}
          onClick={() => setPane("mock")}
          role="tab"
          type="button"
        >
          示意預覽
        </button>
        <button
          aria-selected={activePane === "live"}
          className={`btn-mini${activePane === "live" ? " sel" : ""}`}
          disabled={!canLive}
          onClick={() => {
            if (!canLive) return;
            setIframeBusy(true);
            setPane("live");
          }}
          role="tab"
          title={
            canLive
              ? "嵌入 Shopify 官網商品頁（若商店禁止嵌入會空白）"
              : "需有 shopify handle 與商店網域（發布後或已產生 handle）"
          }
          type="button"
        >
          Shopify 官網
        </button>
      </div>

      {activePane === "live" && liveUrl ? (
        <>
          <p className="muted export-pf-storefront-note">
            真實 Online Store 商品頁。若下方空白，代表商店禁止嵌入——請用新分頁開啟。
            草稿／未上架商品可能 404。
          </p>
          <div className="export-pf-storefront-live-actions">
            <a
              className="btn-mini"
              href={liveUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              新分頁開啟官網
            </a>
            {item.shopifyAdminUrl ? (
              <a
                className="btn-mini"
                href={item.shopifyAdminUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                開 Shopify 後台
              </a>
            ) : null}
          </div>
          <div className="export-pf-storefront-iframe-wrap">
            {iframeBusy ? (
              <p className="muted export-pf-storefront-iframe-busy" role="status">
                載入 Shopify 頁面中…
              </p>
            ) : null}
            <iframe
              className="export-pf-storefront-iframe"
              key={liveUrl}
              onLoad={() => setIframeBusy(false)}
              referrerPolicy="no-referrer-when-downgrade"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              src={liveUrl}
              title={`Shopify 商品頁：${item.titleFull || item.shopifyHandle || "preview"}`}
            />
          </div>
        </>
      ) : (
        <>
          <p className="muted export-pf-storefront-note">
            {canLive
              ? "示意預覽（系統內版型）。可切到「Shopify 官網」看真實頁面。"
              : "示意預覽。尚無官網連結（需 handle + 已設定 SHOPIFY_STORE_DOMAIN）。"}
          </p>
          <article className="export-pf-storefront-card">
            <div className="export-pf-storefront-media">
              {hero ? (
                // eslint-disable-next-line @next/next/no-img-element -- remote Storage / CDN URLs
                <img alt="" className="export-pf-storefront-hero" src={hero} />
              ) : (
                <div className="export-pf-storefront-hero-empty">尚無圖片</div>
              )}
              {thumbs.length > 1 ? (
                <div className="export-pf-storefront-thumbs">
                  {thumbs.map((url, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt=""
                      className="export-pf-storefront-thumb"
                      key={`${url}-${i}`}
                      src={url}
                    />
                  ))}
                </div>
              ) : null}
            </div>
            <div className="export-pf-storefront-info">
              <h3 className="export-pf-storefront-title">
                {item.titleFull || "（無標題）"}
              </h3>
              <div className="export-pf-storefront-price-row">
                <span className="export-pf-storefront-price">
                  {formatPriceCell(item.sellPriceDisplay)}
                </span>
                {item.compareAtDisplay != null ? (
                  <span className="muted export-pf-storefront-compare">
                    {formatPriceCell(item.compareAtDisplay)}
                  </span>
                ) : null}
              </div>
              {item.skuDisplay && item.skuDisplay !== "—" ? (
                <p className="muted export-pf-storefront-sku">SKU {item.skuDisplay}</p>
              ) : null}
              {descHtml ? (
                <div
                  className="export-pf-storefront-body rc-html-preview"
                  dangerouslySetInnerHTML={{ __html: descHtml }}
                />
              ) : (
                <p className="muted">尚無商品介紹</p>
              )}
            </div>
          </article>
        </>
      )}
    </div>
  );
}

/**
 * UX-O T68: fixed Matrixify CSV header order (Fable).
 * Do not derive from Object.keys — order must match download CSV.
 */
export const MATRIXIFY_PREVIEW_HEADERS = [
  "Command",
  "Handle",
  "Title",
  "Body HTML",
  "Vendor",
  "Type",
  "Tags",
  "Published",
  "Status",
  "SEO Title",
  "SEO Description",
  "Option1 Name",
  "Option1 Value",
  "Option2 Name",
  "Option2 Value",
  "Option3 Name",
  "Option3 Value",
  "Variant SKU",
  "Variant Price",
  "Variant Cost",
  "Variant Inventory Tracker",
  "Variant Inventory Qty",
  "Variant Inventory Policy",
  "Variant Requires Shipping",
  "Variant Image",
  "Image Src",
  "Image Position",
  "Image Alt Text"
] as const;

/** Showmore template column order (matches emptyShowmoreRow / buildShowmoreRows). */
export const SHOWMORE_PREVIEW_HEADERS = [
  "商品名稱*",
  "商品簡述",
  "商品介紹",
  "配送限定",
  "商品編號(sku)",
  "第一層樣式名稱",
  "第一層樣式*",
  "第二層樣式名稱",
  "第二層樣式",
  "第三層樣式名稱",
  "第三層樣式",
  "原價",
  "售價*",
  "成本",
  "官網庫存*",
  "重量(kg)*",
  "VIP價格",
  "主要圖片*",
  "廣告圖",
  "商品圖片",
  "商品樣式圖片"
] as const;

/** Long text columns — ellipsis + title tooltip; never auto-fill prior row. */
const LONG_CELL_HEADERS = new Set([
  "Body HTML",
  "SEO Description",
  "Tags",
  "商品介紹",
  "商品簡述",
  "商品圖片",
  "Image Src",
  "Variant Image",
  "主要圖片*",
  "廣告圖"
]);

export type ExportPreviewRow = Record<string, unknown>;

/**
 * Render cell as CSV does: empty stays empty (no "—" filler, no prior-row fill).
 */
function formatFullTableCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return String(value);
}

/**
 * D9-open + R3 §10 + UX-O T68: export preflight dual-mode.
 * List = report.items summary; table = full CSV rows (fullTableRows).
 * Shell = B11 ApproveSummaryModal (modal-overlay / modal-box / <960 bottom sheet).
 */
export function ExportPreflightModal({
  open,
  report,
  fullTableRows = null,
  busy = false,
  confirmLabel,
  onCancel,
  onConfirm
}: {
  open: boolean;
  report: ExportPreflightReport | null;
  /**
   * UX-O T68: complete CSV-shaped rows from buildMatrixifyRows / buildShowmoreRows.
   * Table mode only; blanks are intentional — never fill from previous row.
   */
  fullTableRows?: ExportPreviewRow[] | null;
  busy?: boolean;
  /** Override primary button (e.g. multi-export flow). */
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  /** D9: list / full CSV table / customer-page mock (not real Shopify iframe) */
  const [viewMode, setViewMode] = useState<"list" | "table" | "storefront">("list");
  const [storefrontIndex, setStorefrontIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    setViewMode("list");
    setStorefrontIndex(0);
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
  const tableHeaders: readonly string[] =
    report.kind === "showmore" ? SHOWMORE_PREVIEW_HEADERS : MATRIXIFY_PREVIEW_HEADERS;
  const tableRows = fullTableRows ?? [];

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
            <button
              aria-selected={viewMode === "storefront"}
              className={`btn-mini${viewMode === "storefront" ? " sel" : ""}`}
              onClick={() => setViewMode("storefront")}
              role="tab"
              type="button"
              title="顧客商品頁示意（非 Shopify 即時 iframe）"
            >
              商品頁預覽
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

          {viewMode === "table" ? (
            tableRows.length > 0 ? (
              <div className="export-pf-table-wrap">
                <table className="export-pf-table export-pf-table--full">
                  <thead>
                    <tr>
                      {tableHeaders.map((header) => (
                        <th key={header}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row, rowIndex) => (
                      <tr key={`csv-row-${rowIndex}`}>
                        {tableHeaders.map((header) => {
                          const text = formatFullTableCell(row[header]);
                          const isLong = LONG_CELL_HEADERS.has(header);
                          return (
                            <td
                              className={isLong ? "export-pf-cell-long" : undefined}
                              key={header}
                              title={text || undefined}
                            >
                              {text}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted export-pf-table-empty">尚無可預覽的完整 CSV 列。</p>
            )
          ) : null}

          {viewMode === "storefront" ? (
            report.items.length > 0 ? (
              <StorefrontPreview
                index={storefrontIndex}
                items={report.items}
                onIndexChange={setStorefrontIndex}
              />
            ) : (
              <p className="muted export-pf-table-empty">尚無商品可預覽。</p>
            )
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
