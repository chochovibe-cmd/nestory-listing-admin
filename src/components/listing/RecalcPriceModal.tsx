"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { PriceMode, PricingSettings } from "@/lib/pricing";
import { describePricingSettings } from "@/lib/variants/priceResyncPlan";
import {
  isVariantRowFilled,
  recalculateUnlockedVariantPrices,
  type VariantFormRow
} from "@/lib/variants";

function money(value: string): string {
  return value.trim() ? `NT$${value}` : "—";
}

/**
 * VARIANT-CLEAN: 依公式重算售價 — 舊價 → 新價 comparison for every UNLOCKED variant.
 * Locked rows (✎ 手動) are listed but never touched. 套用 only fills the card's local form;
 * the normal 儲存 persists it. Same modal shell as PublishPriceConfirmModal.
 */
export function RecalcPriceModal({
  open,
  rows,
  priceMode,
  productCost,
  settings,
  onClose,
  onApply
}: {
  open: boolean;
  rows: VariantFormRow[];
  priceMode: PriceMode;
  productCost: number | null;
  settings: PricingSettings;
  onClose: () => void;
  onApply: (next: VariantFormRow[]) => void;
}) {
  const titleId = useId();
  const recalculated = useMemo(
    () =>
      open
        ? recalculateUnlockedVariantPrices(rows, {
            currency: "CNY",
            priceMode,
            settings,
            productCost
          })
        : rows,
    [open, rows, priceMode, productCost, settings]
  );

  const lines = useMemo(
    () =>
      rows
        .map((row, index) => ({ row, next: recalculated[index], index }))
        .filter(({ row }) => isVariantRowFilled(row))
        .map(({ row, next, index }) => ({
          index,
          label: row.optionValues.filter(Boolean).join("／") || "款式",
          locked: Boolean(row.sellPriceLocked && row.compareAtLocked),
          // A row with no usable cost recalculates to blank; never offer to wipe a price.
          noCost: !next.sellPrice.trim(),
          changed: Boolean(next.sellPrice.trim()) && (row.sellPrice !== next.sellPrice || row.compareAt !== next.compareAt),
          row,
          next
        })),
    [rows, recalculated]
  );

  const [checked, setChecked] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!open) return;
    setChecked(new Set(lines.filter((line) => line.changed && !line.locked).map((line) => line.index)));
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
    // Re-tick only when the dialog opens, not when the user toggles a row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const changedLines = lines.filter((line) => line.changed && !line.locked);

  return createPortal(
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="modal-overlay open"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      <div className="modal-box approve-summary-modal vc-modal">
        <div className="modal-hdr">
          <span id={titleId}>依公式重算售價</span>
          <button aria-label="關閉" className="modal-close" onClick={onClose} type="button">
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="vc-note">{describePricingSettings(settings)}</p>
          <p className="vc-note">只重算沒有鎖定的款式；已手動改過價的款式（✎）不會動。勾選後按「套用」，再儲存才會生效。</p>
          {changedLines.length === 0 ? (
            <p className="muted">所有未鎖定款式的價格都已符合目前公式，不需要調整。</p>
          ) : null}
          <ul className="vc-list">
            {lines.map((line) => (
              <li className="vc-row" key={line.index}>
                {line.locked ? (
                  <span aria-hidden className="vc-lock">
                    ✎
                  </span>
                ) : (
                  <input
                    aria-label={`套用 ${line.label}`}
                    checked={checked.has(line.index)}
                    disabled={!line.changed}
                    onChange={(event) => {
                      const next = new Set(checked);
                      if (event.target.checked) next.add(line.index);
                      else next.delete(line.index);
                      setChecked(next);
                    }}
                    type="checkbox"
                  />
                )}
                <div className="vc-row-main">
                  <div>{line.label}</div>
                  {line.locked ? (
                    <div className="vc-orig">已手動鎖定，維持 {money(line.row.sellPrice)}</div>
                  ) : line.noCost ? (
                    <div className="vc-orig">沒有成本，無法重算（維持 {money(line.row.sellPrice)}）</div>
                  ) : (
                    <div className="vc-price-line">
                      <span className="vc-price-old">{money(line.row.sellPrice)}</span>
                      <span aria-hidden> → </span>
                      <strong>{money(line.next.sellPrice)}</strong>
                      {priceMode === "sale" ? (
                        <span className="vc-orig">
                          （定價 {money(line.row.compareAt)} → {money(line.next.compareAt)}）
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="approve-sum-actions">
            <button className="approve-sum-btn" onClick={onClose} type="button">
              取消
            </button>
            <button
              className="primary approve-sum-btn"
              disabled={checked.size === 0}
              onClick={() =>
                onApply(
                  rows.map((row, index) => {
                    const target = lines.find((line) => line.index === index);
                    if (!target || !checked.has(index) || target.locked) return row;
                    return { ...row, sellPrice: target.next.sellPrice, compareAt: target.next.compareAt };
                  })
                )
              }
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
