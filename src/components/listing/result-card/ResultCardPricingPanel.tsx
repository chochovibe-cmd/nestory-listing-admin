"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { calculatePrice, type PriceMode as PricingPriceMode } from "@/lib/pricing";
import { getStoredPricingSettings } from "@/lib/pricingSettingsStore";
import type { PriceMode } from "@/types/domain";

/**
 * S2: 定價分頁 — 從 ResultCard 展開區拆出。
 * UX-AD T130: 頂部價格摘要卡片。
 * UX-B2-P11: 利潤驅動重用 calculatePrice（twd_cost 已是完整 TWD，costMultiplier 固定 1）。
 */
export function ResultCardPricingPanel({
  twdCost,
  priceMode,
  sellPrice,
  compareAtPrice,
  onSellPriceChange,
  onCompareAtPriceChange
}: {
  twdCost: number | null | undefined;
  /** @deprecated 摘要改依畫面售價 live 算；父層可不再傳 */
  profit?: number | null;
  /** @deprecated 摘要改依畫面售價 live 算；父層可不再傳 */
  profitPct?: number | null;
  priceMode: PriceMode;
  sellPrice: string;
  compareAtPrice: string;
  onSellPriceChange: (value: string) => void;
  onCompareAtPriceChange: (value: string) => void;
}) {
  const [profitDriven, setProfitDriven] = useState(false);
  const [targetProfitInput, setTargetProfitInput] = useState("");
  const [profitNote, setProfitNote] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const sellNum = Number(sellPrice);
  const hasValidSell = sellPrice !== "" && Number.isFinite(sellNum);
  const sellRounded = hasValidSell ? Math.round(sellNum) : null;
  const sellDisplay =
    sellRounded != null ? sellRounded.toLocaleString() : null;

  const hasCost = twdCost != null && Number.isFinite(twdCost);

  /** 11-2：摘要利潤／利潤率跟畫面編輯中的售價走，不綁 draft.twd_price */
  const liveProfit = useMemo(() => {
    if (!hasCost || sellRounded == null) return null;
    return sellRounded - (twdCost as number);
  }, [hasCost, sellRounded, twdCost]);

  const liveProfitPct = useMemo(() => {
    if (liveProfit == null || sellRounded == null || sellRounded <= 0) return null;
    return Math.round((liveProfit / sellRounded) * 100);
  }, [liveProfit, sellRounded]);

  const profitTone =
    liveProfit == null ? "" : liveProfit > 0 ? " success" : liveProfit < 0 ? " danger" : "";
  const marginTone =
    liveProfitPct == null
      ? ""
      : liveProfitPct > 0
        ? " success"
        : liveProfitPct < 0
          ? " danger"
          : "";

  /**
   * 利潤驅動算價：draft.twd_cost 已是完整台幣成本，禁止再乘 costMultiplier。
   * 路徑仍走 calculatePrice → formulaSellPrice 美化，不在面板內手寫公式。
   */
  const runProfitDriven = useCallback(
    (targetStr: string) => {
      if (!hasCost || twdCost == null) return;

      const settings = getStoredPricingSettings();
      const result = calculatePrice(twdCost, {
        currency: "TWD",
        settings: { ...settings, costMultiplier: 1 },
        priceMode: priceMode as PricingPriceMode,
        profitDriven: true,
        targetProfitTwd: Number(targetStr) || 0
      });

      onSellPriceChange(String(result.sellPrice));
      if (priceMode === "sale" && result.compareAtPrice != null) {
        onCompareAtPriceChange(String(result.compareAtPrice));
      }
      setProfitNote(result.profitNote);
      setWarnings(result.warnings);
    },
    [hasCost, twdCost, priceMode, onSellPriceChange, onCompareAtPriceChange]
  );

  function handleProfitInputChange(value: string) {
    if (!hasCost) return;
    setProfitDriven(true);
    setTargetProfitInput(value);
    runProfitDriven(value);
  }

  /** 手改售價 ≈ 暫時退出利潤驅動；利潤框只顯示售價−成本，不循環美化 */
  function handleSellPriceChange(value: string) {
    setProfitDriven(false);
    setProfitNote(null);
    onSellPriceChange(value);
  }

  function handleCompareAtChange(value: string) {
    // 改定價不強制改售價、不強制退出利潤驅動
    onCompareAtPriceChange(value);
  }

  // 非利潤驅動：利潤框同步成 售價−成本（對齊輸入區直填／公式顯示）
  useEffect(() => {
    if (profitDriven) return;
    if (liveProfit != null) {
      setTargetProfitInput(String(liveProfit));
    } else {
      setTargetProfitInput("");
    }
    setProfitNote(null);

    if (hasCost && sellRounded != null && sellRounded < (twdCost as number) && sellRounded > 0) {
      setWarnings([
        `售價 NT$${sellRounded.toLocaleString()} 低於成本 NT$${(twdCost as number).toLocaleString()}（賠售／清倉可繼續，請確認）。`
      ]);
    } else {
      setWarnings([]);
    }
  }, [profitDriven, liveProfit, hasCost, sellRounded, twdCost]);

  // 可選：設定變更且仍在利潤驅動時重算一次
  useEffect(() => {
    function onSettingsChanged() {
      if (!profitDriven || !hasCost) return;
      runProfitDriven(targetProfitInput);
    }
    window.addEventListener("nestory:pricing-settings-changed", onSettingsChanged);
    return () => {
      window.removeEventListener("nestory:pricing-settings-changed", onSettingsChanged);
    };
  }, [profitDriven, hasCost, targetProfitInput, runProfitDriven]);

  return (
    <div className="rc-tabpanel" role="tabpanel">
      {/* UX-AD T130: mini dashboard — 成本／售價／利潤／利潤率（live） */}
      <div className="rc-price-summary">
        <div className="rc-price-item">
          <div className="rc-price-item-label">成本</div>
          <div className="rc-price-item-value">
            {hasCost ? `NT$${(twdCost as number).toLocaleString()}` : "—"}
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
            {liveProfit != null ? `NT$${liveProfit.toLocaleString()}` : "—"}
          </div>
        </div>
        <div className="rc-price-item">
          <div className="rc-price-item-label">利潤率</div>
          <div className={`rc-price-item-value${marginTone}`}>
            {liveProfitPct != null ? `${liveProfitPct}%` : "—"}
          </div>
        </div>
      </div>

      <div className="rc-tabpanel-grid">
        <div className="rc-field rc-span-2">
          <div className="rc-label">定價</div>

          {/* 11-1：與輸入區同語意的利潤驅動列 */}
          {hasCost ? (
            <div className="price-live" style={{ marginBottom: 10, flexWrap: "wrap" }}>
              <span>
                成本 <b>NT${(twdCost as number).toLocaleString()}</b>
              </span>
              <span>
                → 售價 <b>NT${sellDisplay ?? "—"}</b>
              </span>
              {priceMode === "sale" && compareAtPrice !== "" && Number.isFinite(Number(compareAtPrice)) ? (
                <span>
                  定價 <s>NT${Math.round(Number(compareAtPrice)).toLocaleString()}</s>
                </span>
              ) : null}
              <span className="price-live-profit">
                利潤{" "}
                <input
                  aria-label="利潤台幣"
                  className="profit-input"
                  onChange={(e) => handleProfitInputChange(e.target.value)}
                  step="1"
                  title="手填利潤後售價跳到最近美化價（可低於成本，僅黃字提醒）"
                  type="number"
                  value={targetProfitInput}
                />
                <span className="profit-pct">
                  約 {liveProfitPct != null ? liveProfitPct : "—"}%
                </span>
                {profitNote ? <span className="profit-note">{profitNote}</span> : null}
              </span>
            </div>
          ) : (
            <div className="muted" style={{ marginBottom: 8 }}>
              無成本無法反推利潤；仍可手改售價／定價。
            </div>
          )}

          {warnings.length
            ? warnings.map((warning) => (
                <div className="price-soft-warn" key={warning}>
                  ⚠ {warning}
                </div>
              ))
            : null}

          <div className="muted" style={{ marginBottom: 6 }}>
            {priceMode === "single" ? "單一售價（無劃線定價）" : "特價模式"}
          </div>

          <div className="row">
            <div className="field">
              <label>售價 TWD</label>
              <input
                className="edit-input"
                min="0"
                onChange={(event) => handleSellPriceChange(event.target.value)}
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
                  onChange={(event) => handleCompareAtChange(event.target.value)}
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
