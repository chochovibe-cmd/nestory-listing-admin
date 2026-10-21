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
  restoreAllBusy,
  onRestoreAllSoldOut,
  priceRecalcPending = 0,
  priceUnconfirmed = false,
  onDimensionsChange,
  onRowsChange,
  onQueueImageDeletion,
  onWarning
}: {
  variantDimensions: VariantDimension[];
  variantRows: VariantFormRow[];
  variantImageOptions: Array<{ id: string; url: string; label: string; imageType?: string | null }>;
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
  /** CAPTURE-FIX: 「全部加回」 for the source-sold-out group is in flight. */
  restoreAllBusy: boolean;
  onRestoreAllSoldOut: () => void;
  /** CAPTURE-FIX: variants whose cost was refreshed by a re-capture but whose selling price is still blank. */
  priceRecalcPending?: number;
  /** PRICE-GUARD: capture hid/flagged per-variant prices and nobody confirmed them yet. */
  priceUnconfirmed?: boolean;
  onDimensionsChange: (dims: VariantDimension[]) => void;
  onRowsChange: (rows: VariantFormRow[]) => void;
  onQueueImageDeletion?: (imageIds: string[]) => void;
  onWarning: (msg: string | null) => void;
}) {
  const costMissing = isPricePlaceholderCny(productCost);
  const effectiveProductCost = costMissing ? null : productCost;
  const [cleanOpen, setCleanOpen] = useState(false);
  const [recalcOpen, setRecalcOpen] = useState(false);
  const [excludedOpen, setExcludedOpen] = useState(false);
  const soldOutExcluded = excludedVariants
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.reason === "source_sold_out");
  const otherExcluded = excludedVariants
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.reason !== "source_sold_out");
  const [soldOutOpen, setSoldOutOpen] = useState(soldOutExcluded.length <= 3);
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
        {priceRecalcPending > 0 ? (
          <p className="price-soft-warn" style={{ margin: "0 0 8px" }}>
            ⚠ 重新擷取更新了成本，有 {priceRecalcPending} 款的售價還是空的；請按下方「依公式重算售價」重新計算，再按儲存。
          </p>
        ) : null}
        {soldOutExcluded.length > 0 ? (
          <CollapsibleSection
            className="vc-excluded"
            onToggle={() => setSoldOutOpen((open) => !open)}
            open={soldOutOpen}
            summary={
              soldOutExcluded.slice(0, 3).map(({ entry }) => `「${entry.label}」`).join("") +
              (soldOutExcluded.length > 3 ? "…" : "")
            }
            title={`已排除 ${soldOutExcluded.length} 款來源售完`}
          >
            <p className="vc-note">這些款式在來源網站已經沒有庫存，匯入時先排除，避免上架賣不到的款式。補貨了可以加回；加回的款式成本會暫用商品成本，發布前請確認。</p>
            {restoreDisabledReason ? <p className="price-soft-warn">{restoreDisabledReason}</p> : null}
            <ul className="vc-list">
              {soldOutExcluded.map(({ entry, index }) => (
                <li className="vc-excluded-row" key={`${entry.label}-${index}`}>
                  <span className="vc-excluded-label">{entry.label}</span>
                  <Button
                    disabled={Boolean(restoreDisabledReason) || restoreBusyIndex !== null || restoreAllBusy}
                    loading={restoreBusyIndex === index}
                    onClick={() => onRestoreExcluded(index)}
                    size="sm"
                    type="button"
                  >
                    加回
                  </Button>
                </li>
              ))}
            </ul>
            {soldOutExcluded.length >= 2 ? (
              <div className="vc-toolbar">
                <Button
                  disabled={Boolean(restoreDisabledReason) || restoreBusyIndex !== null || restoreAllBusy}
                  loading={restoreAllBusy}
                  onClick={onRestoreAllSoldOut}
                  size="sm"
                  type="button"
                >
                  全部加回
                </Button>
              </div>
            ) : null}
          </CollapsibleSection>
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
            onQueueImageDeletion={onQueueImageDeletion}
            onWarning={onWarning}
            priceMode={priceMode}
            pricingSettings={getStoredPricingSettings()}
            productCost={effectiveProductCost}
            unconfirmedCost={priceUnconfirmed}
            rows={variantRows}
            warning={variantWarning}
          />
        </div>

        {otherExcluded.length > 0 ? (
          <CollapsibleSection
            className="vc-excluded"
            onToggle={() => setExcludedOpen((open) => !open)}
            open={excludedOpen}
            summary={`${otherExcluded.length} 個`}
            title="已排除的款式"
          >
            <p className="vc-note">匯入時判斷不是商品（像「購買須知」「勿拍」「補差價」），所以沒有建立成款式。誤判的可以恢復。</p>
            {restoreDisabledReason ? <p className="price-soft-warn">{restoreDisabledReason}</p> : null}
            <ul className="vc-list">
              {otherExcluded.map(({ entry, index }) => (
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
