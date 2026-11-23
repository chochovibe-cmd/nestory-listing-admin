"use client";

import { defaultPricingSettings, type PricingSettings } from "./pricing";
import { hasSupabaseBrowserEnv } from "./supabase/client";
import { pickEditablePricing, samePricingSettings, validatePricingSettings } from "./pricingSettingsShared";

const STORAGE_KEY = "nestory_pricing_settings";
const SETTINGS_EVENT = "nestory:pricing-settings-changed";
export const PRICING_SYNC_STATUS_EVENT = "nestory:pricing-sync-status";

export type PricingSyncState =
  | "local_only" | "loading" | "cloud" | "cloud_empty" | "load_error"
  | "saving" | "saved" | "save_error" | "invalid";
export type PricingSyncStatus = { state: PricingSyncState; message?: string | null; updatedAt?: string | null };

let cloudSettings: PricingSettings | null = null;
let lastSuccessfulCloudSettings: PricingSettings | null = null;
let status: PricingSyncStatus = { state: "local_only" };
let loadStarted = false;
let pendingPatch: Partial<PricingSettings> = {};
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let savedTimer: ReturnType<typeof setTimeout> | null = null;
let putInFlight = false;
let seedInFlight = false;

export function getPricingSyncStatus(): PricingSyncStatus {
  return status;
}

function setStatus(next: PricingSyncStatus, emit = true) {
  const changed = status.state !== next.state || status.message !== next.message || status.updatedAt !== next.updatedAt;
  status = next;
  if (emit && changed && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PRICING_SYNC_STATUS_EVENT, { detail: status }));
  }
}

function readLocal(): PricingSettings {
  if (typeof window === "undefined") return defaultPricingSettings;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPricingSettings;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return defaultPricingSettings;
    return { ...defaultPricingSettings, ...parsed } as PricingSettings;
  } catch {
    return defaultPricingSettings;
  }
}

function writeLocal(settings: PricingSettings) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* storage may be unavailable */ }
}

function dispatchSettings(settings: PricingSettings) {
  window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: settings }));
}

function startLoad() {
  if (loadStarted || typeof window === "undefined") return;
  loadStarted = true;
  if (!hasSupabaseBrowserEnv()) {
    setStatus({ state: "local_only" });
    return;
  }
  // Publish loading after the caller has returned from render, while status is
  // immediately readable by synchronous guards.
  status = { state: "loading" };
  void Promise.resolve().then(() => {
    if (typeof window !== "undefined" && status.state === "loading") {
      window.dispatchEvent(new CustomEvent(PRICING_SYNC_STATUS_EVENT, { detail: status }));
    }
  });
  void Promise.resolve().then(async () => {
    try {
      const response = await fetch("/api/settings/pricing", { method: "GET", credentials: "same-origin" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) throw new Error(typeof result?.message === "string" ? result.message : "連線失敗");
      if (!result.settings) {
        setStatus({ state: "cloud_empty" });
        return;
      }
      const parsed = validatePricingSettings(result.settings);
      if (!parsed.ok) throw new Error("雲端定價設定格式不正確，請到設定頁重新儲存一次");
      const loaded: PricingSettings = { ...parsed.settings, version: typeof result.updatedAt === "string" ? result.updatedAt : result.settings.version ?? null };
      const before = getStoredValueBeforeCloud();
      cloudSettings = loaded;
      lastSuccessfulCloudSettings = loaded;
      writeLocal(loaded);
      setStatus({ state: "cloud", updatedAt: loaded.version ?? null });
      if (!samePricingSettings(before, loaded)) dispatchSettings(loaded);
    } catch (error) {
      setStatus({ state: "load_error", message: error instanceof Error ? error.message : "連線失敗" });
    }
  });
}

function getStoredValueBeforeCloud(): PricingSettings {
  return readLocal();
}

export function getStoredPricingSettings(): PricingSettings {
  if (typeof window === "undefined") return defaultPricingSettings;
  startLoad();
  return cloudSettings ?? readLocal();
}

/** True only when this browser really holds its own pricing values (not just the code defaults). */
export function hasOwnPricingSettingsOnThisDevice(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    return Object.keys(pickEditablePricing(JSON.parse(raw))).length > 0;
  } catch {
    return false;
  }
}

function mergedCurrent(): PricingSettings {
  return cloudSettings ?? readLocal();
}

function queuePut() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => { debounceTimer = null; void flushPendingPatch(); }, 800);
}

async function flushPendingPatch() {
  if (putInFlight || Object.keys(pendingPatch).length === 0) return;
  const sentPatch = pickEditablePricing(pendingPatch);
  pendingPatch = {};
  putInFlight = true;
  setStatus({ state: "saving", updatedAt: lastSuccessfulCloudSettings?.version ?? null });
  try {
    const response = await fetch("/api/settings/pricing", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: sentPatch })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.ok || !result.settings) throw new Error(typeof result?.message === "string" ? result.message : "連線失敗");
    const parsed = validatePricingSettings(result.settings);
    if (!parsed.ok) throw new Error("雲端定價設定格式不正確，請到設定頁重新儲存一次");
    const serverSettings: PricingSettings = { ...parsed.settings, version: typeof result.updatedAt === "string" ? result.updatedAt : result.settings.version ?? null };
    lastSuccessfulCloudSettings = serverSettings;
    cloudSettings = serverSettings;
    if (Object.keys(pendingPatch).length > 0) {
      const current = { ...serverSettings, ...pendingPatch };
      const valid = validatePricingSettings(current);
      if (valid.ok) {
        cloudSettings = { ...valid.settings, version: serverSettings.version };
        writeLocal(cloudSettings);
        dispatchSettings(cloudSettings);
        setStatus({ state: "saving", updatedAt: serverSettings.version ?? null });
        queuePut();
      } else {
        pendingPatch = {};
        writeLocal(serverSettings);
        dispatchSettings(serverSettings);
        setStatus({ state: "invalid", message: valid.message, updatedAt: serverSettings.version ?? null });
      }
    } else {
      writeLocal(serverSettings);
      dispatchSettings(serverSettings);
      setStatus({ state: "saved", updatedAt: serverSettings.version ?? null });
      if (savedTimer) clearTimeout(savedTimer);
      savedTimer = setTimeout(() => {
        savedTimer = null;
        if (status.state === "saved") setStatus({ state: "cloud", updatedAt: serverSettings.version ?? null });
      }, 2000);
    }
  } catch (error) {
    pendingPatch = {};
    if (lastSuccessfulCloudSettings) {
      cloudSettings = lastSuccessfulCloudSettings;
      writeLocal(lastSuccessfulCloudSettings);
      dispatchSettings(lastSuccessfulCloudSettings);
    }
    setStatus({ state: "save_error", message: error instanceof Error ? error.message : "連線失敗", updatedAt: lastSuccessfulCloudSettings?.version ?? null });
  } finally {
    putInFlight = false;
    if (Object.keys(pendingPatch).length > 0 && status.state !== "invalid") queuePut();
  }
}

export function setStoredPricingSettings(patch: Partial<PricingSettings>): void {
  if (typeof window === "undefined") return;
  if (seedInFlight) return;
  if (!hasSupabaseBrowserEnv()) {
    const next = { ...getStoredPricingSettings(), ...patch };
    writeLocal(next);
    dispatchSettings(next);
    return;
  }
  startLoad();
  if (status.state === "local_only" || status.state === "cloud_empty") {
    const next = { ...getStoredPricingSettings(), ...patch };
    writeLocal(next);
    dispatchSettings(next);
    return;
  }
  if (status.state === "loading" || status.state === "load_error") return;
  const current = mergedCurrent();
  const next = { ...current, ...patch };
  const validation = validatePricingSettings(next);
  if (!validation.ok) {
    setStatus({ state: "invalid", message: validation.message, updatedAt: lastSuccessfulCloudSettings?.version ?? null });
    return;
  }
  const editable = pickEditablePricing(patch);
  cloudSettings = { ...validation.settings, version: current.version ?? null };
  writeLocal(cloudSettings);
  dispatchSettings(cloudSettings);
  pendingPatch = { ...pendingPatch, ...editable };
  if (savedTimer) { clearTimeout(savedTimer); savedTimer = null; }
  if (status.state !== "saving") setStatus({ state: "cloud", updatedAt: lastSuccessfulCloudSettings?.version ?? current.version ?? null });
  queuePut();
}

export async function seedCloudPricingFromThisDevice(): Promise<{ ok: boolean; message?: string }> {
  if (!hasOwnPricingSettingsOnThisDevice()) {
    return { ok: false, message: "這台裝置沒有自己的定價設定，請到平常定價的那台電腦操作" };
  }
  if (status.state !== "cloud_empty" || seedInFlight) return { ok: false, message: "目前不能設定全店共用" };
  const local = readLocal();
  const parsed = validatePricingSettings(local);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  seedInFlight = true;
  try {
    const response = await fetch("/api/settings/pricing", {
      method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: parsed.settings })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.ok || !result.settings) throw new Error(typeof result?.message === "string" ? result.message : "連線失敗");
    const saved = validatePricingSettings(result.settings);
    if (!saved.ok) throw new Error("雲端定價設定格式不正確，請到設定頁重新儲存一次");
    const settings: PricingSettings = { ...saved.settings, version: typeof result.updatedAt === "string" ? result.updatedAt : result.settings.version ?? null };
    cloudSettings = settings;
    lastSuccessfulCloudSettings = settings;
    writeLocal(settings);
    setStatus({ state: "cloud", updatedAt: settings.version ?? null });
    dispatchSettings(settings);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "連線失敗" };
  } finally {
    seedInFlight = false;
  }
}
