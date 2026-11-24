import type { PricingSettings } from "@/lib/pricing";

export const PRICING_SETTINGS_KEY = "pricing_settings";

export type EditablePricingKey =
  | "rate"
  | "costMultiplier"
  | "marginMultiplier"
  | "compareAtMultiplier"
  | "minPrice"
  | "showmoreMarkupPercent";

export const PRICING_LIMITS: Record<EditablePricingKey, { label: string; min: number; max: number; integer?: boolean }> = {
  rate: { label: "匯率", min: 3, max: 7 },
  costMultiplier: { label: "成本係數", min: 1, max: 2 },
  marginMultiplier: { label: "利潤係數", min: 1, max: 4 },
  compareAtMultiplier: { label: "定價係數", min: 1, max: 5 },
  minPrice: { label: "最低售價", min: 0, max: 3000, integer: true },
  showmoreMarkupPercent: { label: "Showmore 加價%", min: 0, max: 30 }
};

export const LOW_MARGIN_THRESHOLD = 1.15;

const EDITABLE_KEYS: EditablePricingKey[] = [
  "rate", "costMultiplier", "marginMultiplier", "compareAtMultiplier", "minPrice", "showmoreMarkupPercent"
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function pickEditablePricing(input: unknown): Partial<PricingSettings> {
  if (!isRecord(input)) return {};
  const picked: Partial<PricingSettings> = {};
  for (const key of EDITABLE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      (picked as Record<EditablePricingKey, unknown>)[key] = input[key];
    }
  }
  return picked;
}

export function validatePricingSettings(
  input: unknown
): { ok: true; settings: PricingSettings } | { ok: false; field: EditablePricingKey; message: string } {
  const record = isRecord(input) ? input : {};
  const normalized: Partial<PricingSettings> = {};
  for (const key of EDITABLE_KEYS) {
    const { label, min, max, integer } = PRICING_LIMITS[key];
    const raw = record[key];
    const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
    const message = key === "minPrice"
      ? "最低售價要是 0–3000 的整數"
      : `${label}要在 ${min}–${max} 之間`;
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      return { ok: false, field: key, message };
    }
    (normalized as Record<EditablePricingKey, number>)[key] = value;
  }
  return { ok: true, settings: normalized as PricingSettings };
}

export function samePricingSettings(a: PricingSettings, b: PricingSettings): boolean {
  return EDITABLE_KEYS.every((key) => a[key] === b[key]);
}
