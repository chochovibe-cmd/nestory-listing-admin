import { beautifyNestoryPrice } from "./nestoryPrice";

export type CostCurrency = "CNY" | "TWD";

/** B6: 特價（售價＋定價劃線）／單一售價（不填 compare_at）。 */
export type PriceMode = "sale" | "single";

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

export interface CalculatePriceOptions {
  settings?: PricingSettings;
  currency?: CostCurrency;
  priceMode?: PriceMode;
  manualPricing?: ManualPricingOverride;
  /**
   * B6 A 案：手填目標利潤（台幣）。公式模式下生效；
   * 售價 = beautify(成本 + 目標利潤)。直填模式下呼叫端應忽略。
   */
  targetProfitTwd?: number | null;
  /** 是否由利潤驅動售價（true 時套用 targetProfitTwd + 美化）。 */
  profitDriven?: boolean;
}

export interface PriceResult {
  costTwd: number;
  sellPrice: number;
  /** 單一售價模式永遠為 null。 */
  compareAtPrice: number | null;
  /** 售價 − 成本（可為負，清倉賠售）。 */
  profitTwd: number;
  /** 相對售價的毛利率 %（售價 ≤0 時為 0）。 */
  profitPct: number;
  /**
   * 利潤驅動且美化後實際利潤與目標不同時：
   * 「美化後實際 NT$…」；否則 null。
   */
  profitNote: string | null;
  /**
   * 軟警告（不擋送出）：售價低於成本、成本為 0／未填等。
   */
  warnings: string[];
  pricingFormula: Record<string, unknown> | "manual_twd";
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

function profitMetrics(sellPrice: number, costTwd: number) {
  const profitTwd = sellPrice - costTwd;
  const profitPct = sellPrice > 0 ? Math.round((profitTwd / sellPrice) * 100) : 0;
  return { profitTwd, profitPct };
}

function buildWarnings(input: {
  costInput: number;
  costTwd: number;
  sellPrice: number;
}): string[] {
  const warnings: string[] = [];

  if (!Number.isFinite(input.costInput) || input.costInput <= 0) {
    warnings.push("成本尚未填寫或為 0，利潤計算可能不準（清倉可略過，送出前請再確認）。");
  }

  if (input.costTwd > 0 && input.sellPrice > 0 && input.sellPrice < input.costTwd) {
    warnings.push(
      `售價 NT$${input.sellPrice.toLocaleString()} 低於成本 NT$${input.costTwd.toLocaleString()}（賠售／清倉可繼續，請確認）。`
    );
  }

  return warnings;
}

/**
 * 公式售價：預設用利潤加成；若 profitDriven 則跳「不低於 成本+目標利潤」的最近美化價。
 */
function formulaSellPrice(
  costTwd: number,
  settings: PricingSettings,
  profitDriven: boolean,
  targetProfitTwd: number | null | undefined
): { sellPrice: number; profitNote: string | null } {
  if (profitDriven && targetProfitTwd != null && Number.isFinite(targetProfitTwd)) {
    // 允許負利潤（清倉賠售）；售價仍至少 NT$1，黃字警告由 buildWarnings 處理。
    const want = targetProfitTwd;
    const floor = costTwd + want;
    const sellPrice = beautifyNestoryPrice(Math.max(floor, 1));
    const actual = sellPrice - costTwd;
    const profitNote =
      actual !== want ? `美化後實際 NT$${actual.toLocaleString()}` : null;
    return { sellPrice, profitNote };
  }

  const rawSellPrice = Math.max(costTwd * settings.marginMultiplier, settings.minPrice);
  return { sellPrice: beautifyNestoryPrice(rawSellPrice), profitNote: null };
}

function formulaCompareAt(
  costTwd: number,
  sellPrice: number,
  settings: PricingSettings,
  priceMode: PriceMode
): number | null {
  if (priceMode === "single") return null;
  const rawCompareAtPrice = Math.max(costTwd * settings.compareAtMultiplier, sellPrice);
  return Math.max(beautifyNestoryPrice(rawCompareAtPrice), sellPrice);
}

export function calculatePrice(
  price: number,
  options: CalculatePriceOptions = {}
): PriceResult {
  const {
    settings = defaultPricingSettings,
    currency = "CNY",
    priceMode = "sale",
    manualPricing,
    targetProfitTwd = null,
    profitDriven = false
  } = options;

  const costInput = Number.isFinite(price) ? price : 0;
  const base = currency === "TWD" ? costInput : costInput * settings.rate;
  // 成本未填時 costTwd 視為 0，方便 UI 仍能顯示手填售價與警告。
  const costTwd =
    costInput > 0 ? Math.ceil(base * settings.costMultiplier) : 0;

  if (manualPricing?.enabled) {
    const sellPrice =
      manualPricing.sellPrice && manualPricing.sellPrice > 0
        ? Math.round(manualPricing.sellPrice)
        : costTwd > 0
          ? Math.max(costTwd, settings.minPrice)
          : 0;

    let compareAtPrice: number | null = null;
    if (priceMode === "sale") {
      compareAtPrice =
        manualPricing.compareAtPrice && manualPricing.compareAtPrice > 0
          ? Math.round(manualPricing.compareAtPrice)
          : sellPrice > 0
            ? sellPrice
            : null;
    }

    const { profitTwd, profitPct } = profitMetrics(sellPrice, costTwd);

    return {
      costTwd,
      sellPrice,
      compareAtPrice,
      profitTwd,
      profitPct,
      profitNote: null,
      warnings: buildWarnings({ costInput, costTwd, sellPrice }),
      pricingFormula: {
        kind: "manual_twd",
        priceMode,
        currency,
        sellPrice,
        compareAtPrice
      }
    };
  }

  const { sellPrice, profitNote } = formulaSellPrice(
    costTwd,
    settings,
    profitDriven,
    targetProfitTwd
  );
  const compareAtPrice = formulaCompareAt(costTwd, sellPrice, settings, priceMode);
  const { profitTwd, profitPct } = profitMetrics(sellPrice, costTwd);

  return {
    costTwd,
    sellPrice,
    compareAtPrice,
    profitTwd,
    profitPct,
    profitNote,
    warnings: buildWarnings({ costInput, costTwd, sellPrice }),
    pricingFormula: {
      kind: "formula",
      priceMode,
      currency,
      settings,
      profitDriven: Boolean(profitDriven),
      targetProfitTwd: profitDriven ? targetProfitTwd : null,
      profitTwd
    }
  };
}
