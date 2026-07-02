import { beautifyNestoryPrice } from "./nestoryPrice";

export interface PricingSettings {
  rate: number;
  costMultiplier: number;
  marginMultiplier: number;
  minPrice: number;
}

// Fallback used until a component loads the adjustable values from
// team_settings (see supabase/migrations/006_team_settings.sql). The settings
// page (Phase 6) is where an admin can change these without a code change.
export const defaultPricingSettings: PricingSettings = {
  rate: 4.5,
  costMultiplier: 1.3,
  marginMultiplier: 1.4,
  minPrice: 199
};

export function calculatePrice(cnyPrice: number, settings = defaultPricingSettings) {
  const costTwd = Math.ceil(cnyPrice * settings.rate * settings.costMultiplier);
  const rawSellPrice = Math.max(costTwd * settings.marginMultiplier, settings.minPrice);
  const sellPrice = beautifyNestoryPrice(rawSellPrice);
  const profitPct = costTwd > 0 ? Math.round(((sellPrice - costTwd) / sellPrice) * 100) : 0;

  return {
    costTwd,
    sellPrice,
    profitPct,
    pricingFormula: settings
  };
}
