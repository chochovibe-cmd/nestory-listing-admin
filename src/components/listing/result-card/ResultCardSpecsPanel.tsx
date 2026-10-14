"use client";

import { useState } from "react";
import { CollapsibleSection } from "@/components/listing/CollapsibleSection";
import { RecalcPriceModal } from "@/components/listing/RecalcPriceModal";
import { VariantEditor } from "@/components/listing/VariantEditor";
import { VariantNameCleanModal, type VariantNameContext } from "@/components/listing/VariantNameCleanModal";
import { Button } from "@/components/ui/Button";
import { isPricePlaceholderCny } from "@/lib/import/captureTypes";
import { getStoredPricingSettings } from "@/lib/pricingSettingsStore";
import {
  isVariantRowFilled,
  type VariantDimension,
  type VariantFormRow
} from "@/lib/variants";
import type { ExcludedVariantEntry } from "@/lib/variants/restoreExcludedVariant";
import type { PriceMode } from "@/types/domain";

/** S2: 規格（款式）分頁 — 從 ResultCard 展開區拆出。 */
export function ResultCardSpecsPanel({
  variantDimensions,
  variantRows,
  variantImageOptions,
  variantWarning,
  priceMode,
  productCost,
  nameContext,
  excludedVariants,
  restoreBusyIndex,
  restoreDisabledReason,
  onRestoreExcluded,
  priceUnconfirmed = false,
  onDimensionsChange,
  onRowsChange,
  onWarning
}: {
  variantDimensions: VariantDimension[];
  variantRows: VariantFormRow[];
  variantImageOptions: Array<{ id: string; url: string; label: string }>;
  variantWarning: string | null;
  priceMode: PriceMode;
  productCost: number | null;
  nameContext: VariantNameContext;
  /** VARIANT-CLEAN: options the capture import kept out (非商品款式). */
  excludedVariants: ExcludedVariantEntry[];
  restoreBusyIndex: number | null;
  /** Non-null → 恢復 is disabled and this says why (e.g. unsaved edits). */
  restoreDisabledReason: string | null;
  onRestoreExcluded: (index: number) => void;
  /** PRICE-GUARD: capture hid/flagged per-variant prices and nobody confirmed them yet. */
  priceUnconfirmed?: boolean;
  onDimensionsChange: (dims: VariantDimension[]) => void;
  onRowsChange: (rows: VariantFormRow[]) => void;
  onWarning: (msg: string | null) => void;
}) {
  const costMissing = isPricePlaceholderCny(productCost);
  const effectiveProductCost = costMissing ? null : productCost;
  const [cleanOpen, setCleanOpen] = useState(false);
  const [recalcOpen, setRecalcOpen] = useState(false);
  const [excludedOpen, setExcludedOpen] = useState(false);
  const hasRows = variantRows.filter(isVariantRowFilled).length > 0;

  const unconfirmedLabels = priceUnconfirmed
    ? variantRows
        .filter((row) => isVariantRowFilled(row) && row.costIsInherited)
        .map((row) => row.optionValues.map((v) => v.trim()).filter(Boolean).join("／"))
    : [];

  return (
    <div className="rc-tabpanel" role="tabpanel">
      <div className="rc-field rc-span-2">
        <div className="rc-label">規格（款式）</div>
        {costMissing ? (
          <p className="price-soft-warn" style={{ margin: "0 0 8px" }}>
            ⚠ 成本未取得
          </p>
        ) : null}
        {priceUnconfirmed && unconfirmedLabels.length > 0 ? (
          <p className="price-soft-warn" style={{ margin: "0 0 8px" }}>
            ⚠ 淘寶隱藏了各款價格，這 {unconfirmedLabels.length} 款仍暫用商品成本（未逐款確認），發布前請逐款核對：
            {unconfirmedLabels.slice(0, 6).map((label) => `「${label}」`).join("")}
            {unconfirmedLabels.length > 6 ? "…" : ""}
          </p>
        ) : null}
        {variantDimensions.length === 0 && variantRows.filter(isVariantRowFilled).length === 0 ? (
          <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
            尚未建立款式 — 可新增維度或一列
          </p>
        ) : null}
        {hasRows ? (
          <div className="vc-toolbar">
            <Button onClick={() => setCleanOpen(true)} size="sm" type="button">
              整理款式名稱
            </Button>
            <Button onClick={() => setRecalcOpen(true)} size="sm" type="button">
              依公式重算售價
            </Button>
          </div>
        ) : null}
        <div className="rc-specs-wrap">
          <VariantEditor
            currency="CNY"
            dimensions={variantDimensions}
            images={variantImageOptions}
            onDimensionsChange={onDimensionsChange}
            onRowsChange={onRowsChange}
            onWarning={onWarning}
            priceMode={priceMode}
            pricingSettings={getStoredPricingSettings()}
            productCost={effectiveProductCost}
            unconfirmedCost={priceUnconfirmed}
            rows={variantRows}
            warning={variantWarning}
          />
        </div>

        {excludedVariants.length > 0 ? (
          <CollapsibleSection
            className="vc-excluded"
            onToggle={() => setExcludedOpen((open) => !open)}
            open={excludedOpen}
            summary={`${excludedVariants.length} 個`}
            title="已排除的款式"
          >
            <p className="vc-note">匯入時判斷不是商品（像「購買須知」「勿拍」「補差價」），所以沒有建立成款式。誤判的可以恢復。</p>
            {restoreDisabledReason ? <p className="price-soft-warn">{restoreDisabledReason}</p> : null}
            <ul className="vc-list">
              {excludedVariants.map((entry, index) => (
                <li className="vc-excluded-row" key={`${entry.label}-${index}`}>
                  <span className="vc-excluded-label">{entry.label}</span>
                  <Button
                    disabled={Boolean(restoreDisabledReason) || restoreBusyIndex !== null}
                    loading={restoreBusyIndex === index}
                    onClick={() => onRestoreExcluded(index)}
                    size="sm"
                    type="button"
                  >
                    恢復
                  </Button>
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        ) : null}
      </div>

      <VariantNameCleanModal
        context={nameContext}
        dimensions={variantDimensions}
        onApply={(next) => {
          onDimensionsChange(next.dimensions);
          onRowsChange(next.rows);
          setCleanOpen(false);
        }}
        onClose={() => setCleanOpen(false)}
        open={cleanOpen}
        rows={variantRows}
      />
      <RecalcPriceModal
        onApply={(next) => {
          onRowsChange(next);
          setRecalcOpen(false);
        }}
        onClose={() => setRecalcOpen(false)}
        open={recalcOpen}
        priceMode={priceMode}
        productCost={effectiveProductCost}
        rows={variantRows}
        settings={getStoredPricingSettings()}
      />
    </div>
  );
}
