/**
 * E4-open: 月預算＋AI 成本明細（文案 token 估算）.
 * Q1-A copy_generated_at month · Q2-A team-wide (not E1/E2 scope) ·
 * Q3-A NT$600 @ fixed 32 · Q4-A sum only (no fake per-model split) ·
 * null cost ≠ $0 · zero migration · not a credit-card bill.
 */

import {
  isCreatedInTaiwanMonth,
  taiwanMonthRange,
  type TaiwanMonthRange
} from "@/lib/dashboard/makeQuotaStats";

/** Plan book / Mockup default monthly AI budget (NT$). */
export const DEFAULT_MONTHLY_BUDGET_NTD = 600;

/** Fixed USD→NT$ for display only (not bank FX). */
export const DEFAULT_USD_TO_TWD = 32;

/** Yellow warning when spent/budget ≥ this fraction. */
export const COST_BUDGET_WARN_RATIO = 0.8;

/** Soft cap for month fetch (same order as E3 batches). */
export const COST_DRAFT_FETCH_LIMIT = 500;

/** How many detail rows to show in the UI list. */
export const COST_DETAIL_UI_LIMIT = 20;

export const COST_DRAFT_SELECT_COLUMNS =
  "id, title_zh, generation_cost_estimate, generation_model, copy_generated_at, generation_input_tokens, generation_output_tokens";

export type CostDraftRow = {
  id: string;
  title_zh?: string | null;
  generation_cost_estimate?: number | null;
  generation_model?: string | null;
  copy_generated_at?: string | null;
  generation_input_tokens?: number | null;
  generation_output_tokens?: number | null;
};

export type CostDetailItem = {
  id: string;
  title: string;
  costUsd: number;
  costNtd: number;
  model: string | null;
  copyGeneratedAt: string;
  href: string;
};

export type CostBudgetView = {
  month: TaiwanMonthRange;
  /** Sum of non-null costs in month (USD). */
  totalUsd: number;
  totalNtd: number;
  budgetNtd: number;
  remainingNtd: number;
  /** spent/budget, 0 if budget≤0 */
  usedRatio: number;
  barPct: number;
  warn: boolean;
  /** Drafts with copy_generated_at in month (fetched). */
  monthRowCount: number;
  /** Rows with finite generation_cost_estimate. */
  withCostCount: number;
  /** Rows in month with null/invalid cost (not counted as $0). */
  missingCostCount: number;
  usdToTwd: number;
  honestyLabel: string;
  subHint: string;
  emptyText: string | null;
  warnText: string | null;
  truncationNote: string | null;
  detailItems: CostDetailItem[];
  /** Total with-cost rows; UI shows first COST_DETAIL_UI_LIMIT. */
  detailTotal: number;
};

/** Parse cost: only finite numbers count; null/NaN → null (not 0). */
export function parseCostUsd(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function usdToNtd(usd: number, rate: number = DEFAULT_USD_TO_TWD): number {
  const r =
    typeof rate === "number" && Number.isFinite(rate) && rate > 0
      ? rate
      : DEFAULT_USD_TO_TWD;
  return Math.round(usd * r * 100) / 100;
}

export function resolveBudgetNtd(envValue?: string | null): number {
  if (envValue == null || envValue === "") return DEFAULT_MONTHLY_BUDGET_NTD;
  const n = Number(envValue);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MONTHLY_BUDGET_NTD;
  return Math.floor(n);
}

export function resolveUsdToTwd(envValue?: string | null): number {
  if (envValue == null || envValue === "") return DEFAULT_USD_TO_TWD;
  const n = Number(envValue);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_USD_TO_TWD;
  return n;
}

export function truncateTitle(title: string | null | undefined, max = 28): string {
  const t = (title ?? "").trim();
  if (!t) return "（無標題）";
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd)) return "—";
  // Up to 4 dp for small token costs; strip trailing zeros lightly
  const s = usd.toFixed(4).replace(/\.?0+$/, "");
  return `$${s}`;
}

export function formatNtd(ntd: number): string {
  if (!Number.isFinite(ntd)) return "—";
  const rounded = Math.round(ntd);
  if (Math.abs(ntd - rounded) < 0.005) return `NT$${rounded}`;
  return `NT$${ntd.toFixed(1)}`;
}

/** Supabase / PostgREST missing-column messages for A13/014 fields. */
export function isMissingCostColumnError(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("generation_cost_estimate") ||
    m.includes("copy_generated_at") ||
    m.includes("generation_input_tokens") ||
    m.includes("generation_output_tokens") ||
    (m.includes("column") && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes("column"))
  );
}

export function costBudgetMigrationHint(
  errorMessage: string | null | undefined
): string | null {
  if (!errorMessage || !isMissingCostColumnError(errorMessage)) return null;
  return "成本欄位尚未建立，請在 Supabase SQL Editor 執行 migration 014（copy_generated_at／generation_cost_estimate 等）。成本無法估算。";
}

export function computeCostBudgetView(input: {
  rows: CostDraftRow[];
  budgetNtd?: number;
  usdToTwd?: number;
  fetchLimit?: number;
  detailUiLimit?: number;
  now?: Date;
  /** Operator under RLS: honest partial-scope hint */
  visibilityPartial?: boolean;
}): CostBudgetView {
  const month = taiwanMonthRange(input.now ?? new Date());
  const rate = resolveUsdToTwd(
    input.usdToTwd != null ? String(input.usdToTwd) : null
  );
  const budgetNtd =
    typeof input.budgetNtd === "number" &&
    Number.isFinite(input.budgetNtd) &&
    input.budgetNtd > 0
      ? Math.floor(input.budgetNtd)
      : DEFAULT_MONTHLY_BUDGET_NTD;
  const fetchLimit = input.fetchLimit ?? COST_DRAFT_FETCH_LIMIT;
  const detailUiLimit = input.detailUiLimit ?? COST_DETAIL_UI_LIMIT;

  // Q1-A: only rows with copy_generated_at in Taiwan month (server may pre-filter)
  const inMonth = input.rows.filter((r) =>
    isCreatedInTaiwanMonth(r.copy_generated_at, month)
  );

  let totalUsd = 0;
  let withCostCount = 0;
  let missingCostCount = 0;
  const withCost: CostDetailItem[] = [];

  for (const r of inMonth) {
    const cost = parseCostUsd(r.generation_cost_estimate);
    if (cost === null) {
      missingCostCount += 1;
      continue;
    }
    withCostCount += 1;
    totalUsd += cost;
    withCost.push({
      id: r.id,
      title: truncateTitle(r.title_zh),
      costUsd: cost,
      costNtd: usdToNtd(cost, rate),
      model: r.generation_model?.trim() || null,
      copyGeneratedAt: r.copy_generated_at!,
      href: `/drafts/${r.id}`
    });
  }

  // Sort detail: highest cost first, then newest
  withCost.sort((a, b) => {
    if (b.costUsd !== a.costUsd) return b.costUsd - a.costUsd;
    return Date.parse(b.copyGeneratedAt) - Date.parse(a.copyGeneratedAt);
  });

  // Round total after sum for stable display (6dp like estimateCopyCostUsd spirit)
  totalUsd = Math.round(totalUsd * 1_000_000) / 1_000_000;
  const totalNtd = usdToNtd(totalUsd, rate);
  const remainingNtd = Math.max(0, Math.round((budgetNtd - totalNtd) * 100) / 100);
  const usedRatio = budgetNtd > 0 ? totalNtd / budgetNtd : 0;
  const barPct = Math.min(100, Math.round(usedRatio * 100));
  const warn = usedRatio >= COST_BUDGET_WARN_RATIO;
  const pctLabel = Math.round(usedRatio * 100);

  const detailItems = withCost.slice(0, detailUiLimit);

  let emptyText: string | null = null;
  if (inMonth.length === 0) {
    emptyText = "本月尚無記到文案生成時間的草稿";
  } else if (withCostCount === 0) {
    emptyText = `本月 ${inMonth.length} 件有生成時間，但皆未記成本（不視為 $0）`;
  }

  let truncationNote: string | null = null;
  if (input.rows.length >= fetchLimit) {
    truncationNote = `已載入上限 ${fetchLimit} 筆，合計可能未列完`;
  }

  const vis = input.visibilityPartial
    ? "依你的可見權限"
    : "全隊";

  return {
    month,
    totalUsd,
    totalNtd,
    budgetNtd,
    remainingNtd,
    usedRatio,
    barPct,
    warn,
    monthRowCount: inMonth.length,
    withCostCount,
    missingCostCount,
    usdToTwd: rate,
    honestyLabel: "估算 · 非信用卡帳單",
    subHint: `${vis} · 台北 ${month.labelYm}（${month.rangeHint}）· 僅文案 token · 匯率約 ${rate}`,
    emptyText,
    warnText: warn
      ? `已用約 ${pctLabel}% · 接近月預算（NT$${budgetNtd}）`
      : null,
    truncationNote,
    detailItems,
    detailTotal: withCostCount
  };
}
