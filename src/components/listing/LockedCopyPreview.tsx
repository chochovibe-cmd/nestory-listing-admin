"use client";

/**
 * R2 station②: 📄 定稿預覽 — locked copy / tags / price (read-only).
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
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal-box"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="locked-copy-title"
      >
        <h3 id="locked-copy-title">📄 定稿預覽（唯讀）</h3>
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
  );
}
