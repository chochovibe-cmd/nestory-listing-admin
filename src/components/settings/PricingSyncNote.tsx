"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { defaultPricingSettings, type PricingSettings } from "@/lib/pricing";
import {
  getPricingSyncStatus,
  getStoredPricingSettings,
  hasOwnPricingSettingsOnThisDevice,
  PRICING_SYNC_STATUS_EVENT,
  seedCloudPricingFromThisDevice,
  type PricingSyncStatus
} from "@/lib/pricingSettingsStore";
import { LOW_MARGIN_THRESHOLD } from "@/lib/pricingSettingsShared";

function formatTaiwanTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date).replace(",", "");
}

export function PricingFormulaPreview({ settings }: { settings: PricingSettings }) {
  return (
    <div className="formula-preview">
      成本（台幣）＝ 人民幣成本 × 匯率 {settings.rate.toFixed(2)} × 成本係數 {settings.costMultiplier.toFixed(2)}（無條件進位）
      <br />
      售價 ＝ 成本（台幣）× 利潤係數 {settings.marginMultiplier.toFixed(2)}，至少 NT${settings.minPrice}，再尾數美化
      <br />
      定價 ＝ 成本（台幣）× 定價係數 {settings.compareAtMultiplier.toFixed(2)}，至少高於售價，再尾數美化（單一售價商品沒有定價）
      <br />
      利潤 ＝ 售價 − 成本（台幣）
      <br />
      Showmore 匯出時另加 {settings.showmoreMarkupPercent}% 後再尾數美化（匯出時已套用）
    </div>
  );
}

export function PricingSyncNote({ variant }: { variant: "settings" | "workspace" }) {
  const [status, setStatus] = useState<PricingSyncStatus>(() => getPricingSyncStatus());
  const [settings, setSettings] = useState<PricingSettings>(defaultPricingSettings);
  const [hasOwn, setHasOwn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);

  useEffect(() => {
    const onStatus = (event: Event) => {
      const next = (event as CustomEvent<PricingSyncStatus>).detail;
      if (next) setStatus(next);
    };
    const onPricing = (event: Event) => {
      const next = (event as CustomEvent<PricingSettings>).detail;
      setSettings(next ? { ...defaultPricingSettings, ...next } : getStoredPricingSettings());
      setHasOwn(hasOwnPricingSettingsOnThisDevice());
    };
    window.addEventListener(PRICING_SYNC_STATUS_EVENT, onStatus);
    window.addEventListener("nestory:pricing-settings-changed", onPricing);
    setStatus(getPricingSyncStatus());
    setSettings(getStoredPricingSettings());
    setHasOwn(hasOwnPricingSettingsOnThisDevice());
    return () => {
      window.removeEventListener(PRICING_SYNC_STATUS_EVENT, onStatus);
      window.removeEventListener("nestory:pricing-settings-changed", onPricing);
    };
  }, []);

  async function seed() {
    setBusy(true);
    setSeedError(null);
    const result = await seedCloudPricingFromThisDevice();
    if (!result.ok) setSeedError(result.message || "連線失敗");
    setBusy(false);
  }

  if (status.state === "local_only") return <p className="settings-note">本機模式（沒有連雲端）：設定只存在這台裝置。</p>;
  if (status.state === "loading") return <p className="settings-muted">讀取雲端定價設定中…</p>;
  if (status.state === "cloud") return <p className="settings-note">全店共用（存在雲端），所有電腦和手機算出一樣的售價。最後修改：{formatTaiwanTime(status.updatedAt)}</p>;
  if (status.state === "saving") return <p className="settings-muted">儲存中…</p>;
  if (status.state === "saved") return <p className="settings-note">✓ 已存到雲端</p>;
  if (status.state === "save_error") return <p className="price-soft-warn">⚠ 沒有存到雲端：{status.message || "連線失敗"}。數字已改回雲端上的設定。</p>;
  if (status.state === "invalid") return <p className="price-soft-warn">⚠ {status.message || "定價設定不正確"}，這個數字還沒有存。</p>;
  if (status.state === "load_error") return <p className="price-soft-warn">⚠ 讀不到雲端定價設定，暫時用這台裝置上次的設定。請重新整理頁面再試；讀到之前不能修改。</p>;
  if (variant === "workspace" && !hasOwn) return <p className="settings-note">雲端還沒有全店共用的定價設定，這台裝置目前用系統預設值。請到平常定價的那台電腦，在「設定 → 💰 定價規則」設為全店共用。</p>;
  if (variant === "workspace") return <p className="settings-note">雲端還沒有全店共用的定價設定，目前用這台裝置的設定。到「設定 → 💰 定價規則」可以設為全店共用。</p>;
  if (!hasOwn) return (
    <div className="notice" role="status">
      <p>雲端還沒有全店共用的定價設定，現在每台電腦／手機各用各的，算出的售價可能不一樣。</p>
      <p>這台裝置沒有自己的定價設定，目前顯示的是系統預設值：匯率 {settings.rate}、成本係數 {settings.costMultiplier}、利潤係數 {settings.marginMultiplier}、定價係數 {settings.compareAtMultiplier}、最低售價 NT${settings.minPrice}、Showmore +{settings.showmoreMarkupPercent}%</p>
      <p>請到平常定價的那台電腦，打開這一頁按「把這台的設定設為全店共用」。</p>
    </div>
  );

  return (
    <div className="notice" role="status">
      <p>雲端還沒有全店共用的定價設定，現在每台電腦／手機各用各的，算出的售價可能不一樣。</p>
      <p>這台裝置的設定：匯率 {settings.rate}、成本係數 {settings.costMultiplier}、利潤係數 {settings.marginMultiplier}、定價係數 {settings.compareAtMultiplier}、最低售價 NT${settings.minPrice}、Showmore +{settings.showmoreMarkupPercent}%</p>
      <p>請在平常定價的那台電腦按這個按鈕。</p>
      <Button size="sm" variant="primary" loading={busy} type="button" onClick={() => void seed()}>把這台的設定設為全店共用</Button>
      {seedError ? <p className="price-soft-warn">⚠ 沒有設成功：{seedError}</p> : null}
    </div>
  );
}

export function PricingLowMarginWarning({ settings }: { settings: PricingSettings }) {
  return settings.marginMultiplier < LOW_MARGIN_THRESHOLD ? (
    <p className="price-soft-warn">⚠ 利潤係數低於 1.15，售價幾乎等於成本，扣掉尾數美化可能只剩幾十元利潤。</p>
  ) : null;
}
