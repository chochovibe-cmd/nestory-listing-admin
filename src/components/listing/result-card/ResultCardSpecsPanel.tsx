"use client";

import { VariantEditor } from "@/components/listing/VariantEditor";
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
  onDimensionsChange: (dims: VariantDimension[]) => void;
  onRowsChange: (rows: VariantFormRow[]) => void;
  onWarning: (msg: string | null) => void;
}) {
  return (
    <div className="rc-tabpanel" role="tabpanel">
      <div className="rc-field rc-span-2">
        <div className="rc-label">規格（款式）</div>
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
            productCost={productCost}
            rows={variantRows}
            warning={variantWarning}
          />
        </div>
      </div>
    </div>
  );
}
