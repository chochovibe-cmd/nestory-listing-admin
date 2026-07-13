"use client";

import { useEffect, useState } from "react";
import { defaultPricingSettings } from "@/lib/pricing";
import { getStoredPricingSettings } from "@/lib/pricingSettingsStore";

/**
 * C2 Q7-A: topbar shows applied CNY→TWD rate only.
 * Fetch / apply live rate lives on /settings (pricing section). Cron = C6.
 */
export function ExchangeRateWidget() {
  // Starts at the SSR-safe default and only reads localStorage after mount
  // (see useEffect below) — initializing useState directly from
  // getStoredPricingSettings() here would make the server-rendered markup
  // (no localStorage) mismatch the client's first render, triggering a
  // React hydration error.
  const [rate, setRate] = useState(defaultPricingSettings.rate);

  useEffect(() => {
    setRate(getStoredPricingSettings().rate);

    function onChange(event: Event) {
      const detail = (event as CustomEvent<{ rate?: number }>).detail;
      if (typeof detail?.rate === "number" && Number.isFinite(detail.rate)) {
        setRate(detail.rate);
        return;
      }
      setRate(getStoredPricingSettings().rate);
    }
    window.addEventListener("nestory:pricing-settings-changed", onChange);
    return () => window.removeEventListener("nestory:pricing-settings-changed", onChange);
  }, []);

  return (
    <>
      <span title="套用中匯率（到設定頁可套用今日匯率）">CNY/TWD</span>
      <span className="rate-val" title="套用中匯率">
        {rate.toFixed(2)}
      </span>
    </>
  );
}
