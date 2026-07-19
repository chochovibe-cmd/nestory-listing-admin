"use client";

import type { PriceMode } from "@/types/domain";

/** S2: 定價分頁 — 從 ResultCard 展開區拆出。UX-AD T130: 頂部價格摘要卡片. */
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
  const sellNum = Number(sellPrice);
  const sellDisplay =
    sellPrice !== "" && Number.isFinite(sellNum)
      ? Math.round(sellNum).toLocaleString()
      : null;
  const profitTone =
    profit == null ? "" : profit > 0 ? " success" : profit < 0 ? " danger" : "";
  const marginTone =
    profitPct == null
      ? ""
      : profitPct > 0
        ? " success"
        : profitPct < 0
          ? " danger"
          : "";

  return (
    <div className="rc-tabpanel" role="tabpanel">
      {/* UX-AD T130: mini dashboard — 成本／售價／利潤／利潤率 */}
      <div className="rc-price-summary">
        <div className="rc-price-item">
          <div className="rc-price-item-label">成本</div>
          <div className="rc-price-item-value">
            {twdCost != null ? `NT$${twdCost.toLocaleString()}` : "—"}
          </div>
        </div>
        <div className="rc-price-item">
          <div className="rc-price-item-label">售價</div>
          <div className="rc-price-item-value">
            {sellDisplay != null ? `NT$${sellDisplay}` : "—"}
          </div>
        </div>
        <div className="rc-price-item">
          <div className="rc-price-item-label">利潤</div>
          <div className={`rc-price-item-value${profitTone}`}>
            {profit != null ? `NT$${profit.toLocaleString()}` : "—"}
          </div>
        </div>
        <div className="rc-price-item">
          <div className="rc-price-item-label">利潤率</div>
          <div className={`rc-price-item-value${marginTone}`}>
            {profitPct != null ? `${profitPct}%` : "—"}
          </div>
        </div>
      </div>

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
