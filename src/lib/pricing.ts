import { beautifyNestoryPrice } from "./nestoryPrice";

export type CostCurrency = "CNY" | "TWD";

export interface ManualPricingOverride {
  enabled: boolean;
  sellPrice?: number | null;
  compareAtPrice?: number | null;
}

export interface PricingSettings {
  rate: number;
  costMultiplier: number;
  marginMultiplier: number;
  compareAtMultiplier: number;
  minPrice: number;
}

// Fallback used until a component loads the adjustable values from
// team_settings (see supabase/migrations/006_team_settings.sql, key
// "pricing_defaults" added in 011_result_card_fields.sql). The settings page
// (Phase 6) is where an admin can change these without a code change.
export const defaultPricingSettings: PricingSettings = {
  rate: 4.5,
  costMultiplier: 1.3,
  marginMultiplier: 1.4,
  compareAtMultiplier: 1.8,
  minPrice: 199
};

export function calculatePrice(
  price: number,
  options: {
    settings?: PricingSettings;
    currency?: CostCurrency;
    manualPricing?: ManualPricingOverride;
  } = {}
) {
  const { settings = defaultPricingSettings, currency = "CNY", manualPricing } = options;
  const base = currency === "TWD" ? price : price * settings.rate;
  const costTwd = Math.ceil(base * settings.costMultiplier);

  if (manualPricing?.enabled) {
    const sellPrice = manualPricing.sellPrice && manualPricing.sellPrice > 0
      ? manualPricing.sellPrice
      : Math.max(costTwd, settings.minPrice);
    const compareAtPrice = manualPricing.compareAtPrice && manualPricing.compareAtPrice > 0
      ? manualPricing.compareAtPrice
      : sellPrice;
    const profitPct = sellPrice > 0 ? Math.round(((sellPrice - costTwd) / sellPrice) * 100) : 0;

    return { costTwd, sellPrice, compareAtPrice, profitPct, pricingFormula: "manual_twd" as const };
  }

  const rawSellPrice = Math.max(costTwd * settings.marginMultiplier, settings.minPrice);
  const sellPrice = beautifyNestoryPrice(rawSellPrice);
  const rawCompareAtPrice = Math.max(costTwd * settings.compareAtMultiplier, sellPrice);
  const compareAtPrice = Math.max(beautifyNestoryPrice(rawCompareAtPrice), sellPrice);
  const profitPct = sellPrice > 0 ? Math.round(((sellPrice - costTwd) / sellPrice) * 100) : 0;

  return {
    costTwd,
    sellPrice,
    compareAtPrice,
    profitPct,
    pricingFormula: settings
  };
}
