export interface PricingSettings {
  rate: number;
  costMultiplier: number;
  marginMultiplier: number;
  minPrice: number;
}

export const defaultPricingSettings: PricingSettings = {
  rate: 4.5,
  costMultiplier: 1.3,
  marginMultiplier: 1.4,
  minPrice: 199
};

export function roundSellPrice(value: number): number {
  const step = value <= 500 ? 10 : value <= 2000 ? 50 : 100;
  return Math.ceil(value / step) * step;
}

export function calculatePrice(cnyPrice: number, settings = defaultPricingSettings) {
  const costTwd = Math.ceil(cnyPrice * settings.rate * settings.costMultiplier);
  const rawSellPrice = Math.max(costTwd * settings.marginMultiplier, settings.minPrice);
  const sellPrice = roundSellPrice(rawSellPrice);
  const profitPct = costTwd > 0 ? Math.round(((sellPrice - costTwd) / sellPrice) * 100) : 0;

  return {
    costTwd,
    sellPrice,
    profitPct,
    pricingFormula: settings
  };
}
