"use client";

import { defaultPricingSettings, PricingSettings } from "./pricing";

const STORAGE_KEY = "nestory_pricing_settings";

export function getStoredPricingSettings(): PricingSettings {
  if (typeof window === "undefined") return defaultPricingSettings;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPricingSettings;
    return { ...defaultPricingSettings, ...JSON.parse(raw) };
  } catch {
    return defaultPricingSettings;
  }
}

export function setStoredPricingSettings(patch: Partial<PricingSettings>) {
  if (typeof window === "undefined") return;
  const next = { ...getStoredPricingSettings(), ...patch };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("nestory:pricing-settings-changed", { detail: next }));
}
