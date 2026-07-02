"use client";

import { useEffect, useState } from "react";
import { defaultPricingSettings } from "@/lib/pricing";
import { getStoredPricingSettings, setStoredPricingSettings } from "@/lib/pricingSettingsStore";

export function ExchangeRateWidget() {
  // Starts at the SSR-safe default and only reads localStorage after mount
  // (see useEffect below) -- initializing useState directly from
  // getStoredPricingSettings() here would make the server-rendered markup
  // (no localStorage) mismatch the client's first render, triggering a
  // React hydration error.
  const [rate, setRate] = useState(defaultPricingSettings.rate);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setRate(getStoredPricingSettings().rate);

    function onChange(event: Event) {
      const detail = (event as CustomEvent<{ rate: number }>).detail;
      if (detail?.rate) setRate(detail.rate);
    }
    window.addEventListener("nestory:pricing-settings-changed", onChange);
    return () => window.removeEventListener("nestory:pricing-settings-changed", onChange);
  }, []);

  async function fetchLiveRate() {
    setLoading(true);
    try {
      const response = await fetch("https://open.er-api.com/v6/latest/CNY");
      const data = await response.json();
      const twdRate = data?.rates?.TWD;
      if (typeof twdRate === "number") {
        const rounded = Math.round(twdRate * 100) / 100;
        setStoredPricingSettings({ rate: rounded });
        setRate(rounded);
      }
    } catch {
      // Live rate is a convenience; silently keep the last known rate on failure.
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <span>CNY/TWD</span>
      <span className="rate-val">{rate.toFixed(2)}</span>
      <button className="hdr-btn" disabled={loading} onClick={fetchLiveRate} title="更新即時匯率" type="button">
        {loading ? "更新中..." : "↻ 匯率"}
      </button>
    </>
  );
}
