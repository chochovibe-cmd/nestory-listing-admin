"use client";

import { useEffect, useRef, useState } from "react";
import { defaultPricingSettings } from "@/lib/pricing";
import { getStoredPricingSettings } from "@/lib/pricingSettingsStore";
import {
  FX_REFERENCE_CHANGED_EVENT,
  getStoredFxReference,
  isFreshFxReference,
  setStoredFxReference,
  type FxReference
} from "@/lib/fx/fxReferenceStore";

/**
 * C6: topbar shows applied CNY→TWD + today's reference (display only).
 * UX-PKG1 1-3: 今日參考 is primary visual; 套用中 is secondary.
 * Never one-click applies; fetch/apply live on /settings (pricing).
 * Open-page auto-fetch updates nestory_fx_reference only — not pricing rate.
 */
export function ExchangeRateWidget() {
  // SSR-safe defaults: read localStorage only after mount (hydration).
  const [applied, setApplied] = useState(defaultPricingSettings.rate);
  const [reference, setReference] = useState<FxReference | null>(null);
  const autoFetchStarted = useRef(false);

  useEffect(() => {
    setApplied(getStoredPricingSettings().rate);
    setReference(getStoredFxReference());

    function onPricing(event: Event) {
      const detail = (event as CustomEvent<{ rate?: number }>).detail;
      if (typeof detail?.rate === "number" && Number.isFinite(detail.rate)) {
        setApplied(detail.rate);
        return;
      }
      setApplied(getStoredPricingSettings().rate);
    }

    function onReference(event: Event) {
      const detail = (event as CustomEvent<FxReference>).detail;
      if (detail && typeof detail.rate === "number") {
        setReference(detail);
        return;
      }
      setReference(getStoredFxReference());
    }

    window.addEventListener("nestory:pricing-settings-changed", onPricing);
    window.addEventListener(FX_REFERENCE_CHANGED_EVENT, onReference);
    return () => {
      window.removeEventListener("nestory:pricing-settings-changed", onPricing);
      window.removeEventListener(FX_REFERENCE_CHANGED_EVENT, onReference);
    };
  }, []);

  // Q1-A: auto-fetch today's reference once when missing or not Taiwan calendar day.
  // Failures leave 今日 — with no toast spam.
  useEffect(() => {
    if (autoFetchStarted.current) return;
    const existing = getStoredFxReference();
    if (isFreshFxReference(existing)) {
      setReference(existing);
      return;
    }

    autoFetchStarted.current = true;
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/fx/cny-twd", { cache: "no-store" });
        const data = (await response.json()) as {
          ok?: boolean;
          rate?: number;
          asOf?: string;
          source?: string;
        };
        if (cancelled) return;
        if (!response.ok || !data.ok || typeof data.rate !== "number") {
          // Honest: do not invent a number; leave reference as-is / null.
          return;
        }
        setStoredFxReference({
          rate: data.rate,
          source: typeof data.source === "string" ? data.source : "api",
          asOf: typeof data.asOf === "string" ? data.asOf : undefined
        });
        // setStoredFxReference dispatches event; local state also updates via listener.
      } catch {
        // Silent fail for auto path — settings page shows explicit errors on manual fetch.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const todayLabel =
    reference && isFreshFxReference(reference)
      ? reference.rate.toFixed(2)
      : "—";

  const todayTitle =
    reference && isFreshFxReference(reference)
      ? `今日參考匯率 ${reference.rate.toFixed(2)}（僅顯示；到設定頁按「套用」才改算價）`
      : "今日參考尚未取得或抓取失敗（不影響套用中匯率）";

  return (
    <>
      <span title="匯率（今日參考為主；套用中到設定頁才改算價）">CNY/TWD</span>
      <span className="fx-ref-primary" title={todayTitle}>
        今日 {todayLabel}
      </span>
      <span
        className="rate-val-secondary"
        title={`目前商品套用中的匯率 ${applied.toFixed(2)}`}
      >
        套用中 {applied.toFixed(2)}
      </span>
    </>
  );
}
