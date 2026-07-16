"use client";

import { COPY_TONES, type CopyTone } from "@/lib/providers/copy";

/**
 * R2 §4: 重新生成彈窗 — 語氣／修改方向／預估成本。
 * Shell matches ApproveSummaryModal (modal-overlay / modal-box / mobile drawer).
 */
export function RegenCopyModal({
  open,
  busy,
  tone,
  notes,
  costHint,
  onToneChange,
  onNotesChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  tone: CopyTone;
  notes: string;
  costHint: string;
  onToneChange: (tone: CopyTone) => void;
  onNotesChange: (notes: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      onClick={() => {
        if (!busy) onCancel();
      }}
      role="presentation"
    >
      <div
        className="modal-box"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="regen-copy-title"
      >
        <h3 id="regen-copy-title">↻ 重新生成文案</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          可換語氣、填修改方向；會重跑整份文案（單欄重生請用欄位旁 ↺）。
        </p>
        <div className="field">
          <label htmlFor="regen-tone">語氣</label>
          <select
            id="regen-tone"
            disabled={busy}
            value={tone}
            onChange={(e) => onToneChange(e.target.value as CopyTone)}
          >
            {COPY_TONES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="regen-notes">修改方向／補充資訊</label>
          <textarea
            id="regen-notes"
            disabled={busy}
            placeholder="例：更強調禮盒感、少用網路流行語、尺寸寫清楚…"
            rows={4}
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
          />
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          {costHint}
        </p>
        <div className="modal-actions">
          <button disabled={busy} onClick={onCancel} type="button">
            取消
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {busy ? "生成中…" : "確認重新生成"}
          </button>
        </div>
      </div>
    </div>
  );
}
