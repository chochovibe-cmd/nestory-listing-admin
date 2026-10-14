"use client";

import { VariantEditor } from "@/components/listing/VariantEditor";
import { isPricePlaceholderCny } from "@/lib/import/captureTypes";
import { getStoredPricingSettings } from "@/lib/pricingSettingsStore";
import {
  isVariantRowFilled,
  type VariantDimension,
  type VariantFormRow
} from "@/lib/variants";
import type { PriceMode, ProductImage } from "@/types/domain";

/** S2: 規格（款式）分頁 — 從 ResultCard 展開區拆出。 */
export function ResultCardSpecsPanel({
  variantDimensions,
  variantRows,
  variantImageOptions,
  variantWarning,
  priceMode,
  productCost,
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
  /** PRICE-GUARD: capture hid/flagged per-variant prices and nobody confirmed them yet. */
  priceUnconfirmed?: boolean;
  onDimensionsChange: (dims: VariantDimension[]) => void;
  onRowsChange: (rows: VariantFormRow[]) => void;
  onWarning: (msg: string | null) => void;
}) {
  const costMissing = isPricePlaceholderCny(productCost);
  const effectiveProductCost = costMissing ? null : productCost;
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
      </div>
    </div>
  );
}
