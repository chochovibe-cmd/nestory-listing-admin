"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import {
  isVariantRowFilled,
  normalizeOptionValueForMerge,
  rebuildDimensionValuesFromRows,
  type VariantDimension,
  type VariantFormRow
} from "@/lib/variants";
import type { VariantNamePreview } from "@/lib/variants/variantNamePreview";

export type VariantNameContext = {
  productName?: string | null;
  ip?: string | null;
  character?: string | null;
  brand?: string | null;
};

/**
 * VARIANT-CLEAN: 整理款式名稱 — 原名／整理後 comparison. Nothing is applied without this
 * dialog: rule layer loads at once, the AI wording only after the AI button is pressed,
 * every row can be ticked off or edited by hand, and 套用 only fills the card's local form
 * (the normal 儲存 persists it). Same modal shell as PublishPriceConfirmModal.
 */
export function VariantNameCleanModal({
  open,
  dimensions,
  rows,
  context,
  onClose,
  onApply
}: {
  open: boolean;
  dimensions: VariantDimension[];
  rows: VariantFormRow[];
  context: VariantNameContext;
  onClose: () => void;
  onApply: (next: { dimensions: VariantDimension[]; rows: VariantFormRow[] }) => void;
}) {
  const titleId = useId();
  const [preview, setPreview] = useState<VariantNamePreview | null>(null);
  const [busy, setBusy] = useState<"rules" | "ai" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [edits, setEdits] = useState<Record<number, string[]>>({});
  const [renameAxes, setRenameAxes] = useState<Set<number>>(new Set());

  // Only filled rows are sent; `slots[i]` = index of the card row behind preview row i.
  const slots = useMemo(
    () => rows.map((row, index) => (isVariantRowFilled(row) ? index : -1)).filter((index) => index >= 0),
    [rows]
  );

  async function load(useAi: boolean) {
    setBusy(useAi ? "ai" : "rules");
    setError(null);
    try {
      const response = await fetch("/api/variants/clean-names", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          useAi,
          productName: context.productName ?? null,
          ip: context.ip ?? null,
          character: context.character ?? null,
          brand: context.brand ?? null,
          rows: slots.map((slot) => ({
            option1_name: dimensions[0]?.name ?? null,
            option1_value: rows[slot].optionValues[0] || null,
            option2_name: dimensions[1]?.name ?? null,
            option2_value: rows[slot].optionValues[1] || null,
            option3_name: dimensions[2]?.name ?? null,
            option3_value: rows[slot].optionValues[2] || null
          }))
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.rows) {
        throw new Error(payload?.error ?? "整理款式名稱失敗");
      }
      const next = payload as VariantNamePreview;
      setPreview(next);
      setEdits({});
      setChecked(new Set(next.rows.filter((row) => row.changed).map((row) => row.index)));
      setRenameAxes(
        new Set(
          [0, 1, 2].filter((axis) => {
            const suggested = next.rows[0]?.suggested.names[axis];
            return Boolean(suggested) && suggested !== (dimensions[axis]?.name ?? null);
          })
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "整理款式名稱失敗");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    void load(false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
    // load() reads the rows at the moment the dialog opens; later card edits must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const finalValues = (index: number): string[] =>
    edits[index] ?? preview?.rows[index].suggested.values.map((v) => v ?? "") ?? ["", "", ""];

  const resultKeys = useMemo(() => {
    if (!preview) return [] as string[];
    return preview.rows.map((row) => {
      const values = checked.has(row.index)
        ? finalValues(row.index)
        : row.original.values.map((v) => v ?? "");
      return values.map((v) => normalizeOptionValueForMerge(v)).join("\u0001");
    });
    // finalValues depends on preview + edits
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, edits, checked]);
  const hasDuplicate = new Set(resultKeys).size !== resultKeys.length;

  const renameTargets = preview
    ? [0, 1, 2]
        .map((axis) => ({
          axis,
          from: dimensions[axis]?.name ?? "",
          to: preview.rows[0]?.suggested.names[axis] ?? ""
        }))
        .filter((r) => r.from && r.to && r.from !== r.to)
    : [];

  function apply() {
    if (!preview || hasDuplicate) return;
    const nextRows = rows.map((row, cardIndex) => {
      const previewIndex = slots.indexOf(cardIndex);
      if (previewIndex < 0 || !checked.has(previewIndex)) return row;
      const values = finalValues(previewIndex);
      return {
        ...row,
        optionValues: [values[0] ?? "", values[1] ?? "", values[2] ?? ""] as [string, string, string],
        // Keep what the import said the first time; later cleanups never overwrite it.
        sourceOptions:
          row.sourceOptions ?? {
            names: [0, 1, 2].map((axis) => dimensions[axis]?.name ?? null),
            values: preview.rows[previewIndex].original.values
          }
      };
    });
    const renamed = dimensions.map((dim, axis) => {
      const target = renameTargets.find((t) => t.axis === axis);
      return target && renameAxes.has(axis) ? { ...dim, name: target.to } : dim;
    });
    onApply({ dimensions: rebuildDimensionValuesFromRows(renamed, nextRows), rows: nextRows });
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="modal-overlay open"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      role="dialog"
    >
      <div className="modal-box approve-summary-modal vc-modal">
        <div className="modal-hdr">
          <span id={titleId}>整理款式名稱</span>
          <button aria-label="關閉" className="modal-close" onClick={onClose} type="button">
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="vc-note">
            先用固定規則整理（簡轉繁、台灣用語、符號）；商品名會保留。勾選要套用的列，也可以直接改文字，按「套用」後再儲存才會生效。
          </p>
          <div className="vc-toolbar">
            <Button disabled={busy !== null || !preview} loading={busy === "ai"} onClick={() => void load(true)} size="sm" type="button">
              AI 潤飾成台灣用語
            </Button>
            {preview?.aiUsed ? <span className="schip schip--ok">已加入 AI 潤飾（{preview.aiModel}）</span> : null}
          </div>
          {preview?.warning ? <p className="price-soft-warn">{preview.warning}</p> : null}
          {error ? (
            <p className="price-soft-warn" role="alert">
              {error}
            </p>
          ) : null}
          {busy === "rules" && !preview ? <p className="muted">整理中…</p> : null}

          {renameTargets.length > 0 ? (
            <div className="vc-rename">
              {renameTargets.map((target) => (
                <label className="check-row" key={target.axis}>
                  <input
                    checked={renameAxes.has(target.axis)}
                    onChange={(event) => {
                      const next = new Set(renameAxes);
                      if (event.target.checked) next.add(target.axis);
                      else next.delete(target.axis);
                      setRenameAxes(next);
                    }}
                    type="checkbox"
                  />
                  維度名稱「{target.from}」→「{target.to}」
                </label>
              ))}
            </div>
          ) : null}

          {preview ? (
            <ul className="vc-list">
              {preview.rows.map((row) => {
                const values = finalValues(row.index);
                return (
                  <li className="vc-row" key={row.index}>
                    <input
                      aria-label={`套用第 ${row.index + 1} 列`}
                      checked={checked.has(row.index)}
                      onChange={(event) => {
                        const next = new Set(checked);
                        if (event.target.checked) next.add(row.index);
                        else next.delete(row.index);
                        setChecked(next);
                      }}
                      type="checkbox"
                    />
                    <div className="vc-row-main">
                      {[0, 1, 2]
                        .filter((axis) => row.original.values[axis])
                        .map((axis) => (
                          <div className="vc-cell" key={axis}>
                            <div className="vc-orig">原名：{row.original.values[axis]}</div>
                            <input
                              aria-label={`第 ${row.index + 1} 列整理後名稱`}
                              className="vc-input"
                              onChange={(event) => {
                                const next = [...values];
                                next[axis] = event.target.value;
                                setEdits({ ...edits, [row.index]: next });
                                const ticked = new Set(checked);
                                ticked.add(row.index);
                                setChecked(ticked);
                              }}
                              type="text"
                              value={values[axis] ?? ""}
                            />
                          </div>
                        ))}
                      {row.aiRejected.length > 0 ? (
                        <p className="vc-warn-text">AI 建議被退回、改用規則結果：{row.aiRejected.join("；")}</p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {hasDuplicate ? <p className="price-soft-warn">整理後有款式名稱重複，請取消勾選或改名。</p> : null}

          <div className="approve-sum-actions">
            <button className="approve-sum-btn" onClick={onClose} type="button">
              取消
            </button>
            <button
              className="primary approve-sum-btn"
              disabled={!preview || checked.size + renameAxes.size === 0 || hasDuplicate || busy !== null}
              onClick={apply}
              type="button"
            >
              套用
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
