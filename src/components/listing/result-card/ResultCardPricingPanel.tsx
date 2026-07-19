"use client";

import type { PriceMode } from "@/types/domain";

/** S2: 定價分頁 — 從 ResultCard 展開區拆出。 */
export function ResultCardPricingPanel({
  twdCost,
  profit,
  profitPct,
  priceMode,
  sellPrice,
  compareAtPrice,
  onSellPriceChange,
  onCompareAtPriceChange
}: {
  twdCost: number | null | undefined;
  profit: number | null;
  profitPct: number | null;
  priceMode: PriceMode;
  sellPrice: string;
  compareAtPrice: string;
  onSellPriceChange: (value: string) => void;
  onCompareAtPriceChange: (value: string) => void;
}) {
  return (
    <div className="rc-tabpanel" role="tabpanel">
      <div className="rc-tabpanel-grid">
        <div className="rc-field rc-span-2">
          <div className="rc-label">定價</div>
          {twdCost != null ? (
            <div className="muted">
              成本 NT${twdCost.toLocaleString()}
              {profit != null ? ` ／ 利潤 NT$${profit.toLocaleString()}` : null}
              {profitPct != null ? `（約 ${profitPct}%）` : null}
              {priceMode === "single" ? " ／ 單一售價（無劃線定價）" : " ／ 特價模式"}
            </div>
          ) : null}
          <div className="row">
            <div className="field">
              <label>售價 TWD</label>
              <input
                className="edit-input"
                min="0"
                onChange={(event) => onSellPriceChange(event.target.value)}
                type="number"
                value={sellPrice}
              />
            </div>
            {priceMode === "sale" ? (
              <div className="field">
                <label>定價 TWD</label>
                <input
                  className="edit-input"
                  min="0"
                  onChange={(event) => onCompareAtPriceChange(event.target.value)}
                  type="number"
                  value={compareAtPrice}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
