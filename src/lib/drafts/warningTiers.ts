/**
 * R2 §8: three-tier warnings (回饋 31、40).
 * Pure helpers — no DB. Grades existing warning strings + draft field gaps.
 *
 * Q6-A: 「待確認」count = only ⚠; 🔍 icon separate; ⛔ red separate.
 */

export type WarningTier = "suggest" | "confirm" | "block";

export type GradedWarning = {
  tier: WarningTier;
  text: string;
  /** Stable key for UI grouping. */
  source: "draft_warnings" | "field_gap";
};

export type WarningTierSummary = {
  suggest: GradedWarning[];
  confirm: GradedWarning[];
  block: GradedWarning[];
  /** Q6-A: only ⚠ */
  confirmCount: number;
  blockCount: number;
  suggestCount: number;
};

/** 🔍 建議 — not counted as 待確認, never blocks. */
const SUGGEST_PATTERNS: RegExp[] = [
  /使用情境/,
  /推薦標籤/,
  /網搜/,
  /請核實/,
  /建議/,
  /可補強/,
  /meta.*相似/,
  /相似度/,
  /情境詞/,
  /內部連結/,
];

/** ⛔ 必修 — blocks approve / station route. */
const BLOCK_PATTERNS: RegExp[] = [
  /尚未建立/,
  /角色「[^」]+」尚未/,
  /IP.*缺/,
  /缺少\s*IP/,
  /必填/,
  /成本不齊/,
  /每款式成本/,
  /blocked/i,
  /無法生成/,
];

function normalizeWarningText(raw: string): string {
  return raw.replace(/^[⚠⛔🔍\s]+/, "").trim();
}

export function gradeWarningText(raw: string): WarningTier {
  const text = normalizeWarningText(raw);
  if (!text) return "confirm";
  for (const re of BLOCK_PATTERNS) {
    if (re.test(text)) return "block";
  }
  for (const re of SUGGEST_PATTERNS) {
    if (re.test(text)) return "suggest";
  }
  return "confirm";
}

export type DraftFieldGapInput = {
  ip_name?: string | null;
  character_name?: string | null;
  title_zh?: string | null;
  twd_price?: number | null;
  twd_cost?: number | null;
  /** When true, at least one variant has null cost while draft needs per-variant costs. */
  variantCostIncomplete?: boolean;
  /** Missing character dictionary already surfaced via warnings — still block. */
  missingCharacterInDict?: boolean;
  missingIp?: boolean;
};

/**
 * Extra ⛔/⚠ from live draft fields (not only warnings[] strings).
 */
export function fieldGapWarnings(input: DraftFieldGapInput): GradedWarning[] {
  const out: GradedWarning[] = [];
  if (input.missingIp || !input.ip_name?.trim()) {
    out.push({
      tier: "block",
      text: "缺少 IP（必填）",
      source: "field_gap",
    });
  }
  if (input.missingCharacterInDict) {
    out.push({
      tier: "block",
      text: "資料庫缺角色（請一鍵新增或改角色名）",
      source: "field_gap",
    });
  }
  if (!input.title_zh?.trim()) {
    out.push({
      tier: "block",
      text: "標題空白（必填）",
      source: "field_gap",
    });
  }
  if (input.variantCostIncomplete) {
    out.push({
      tier: "block",
      text: "每款式成本不齊（請補齊或跟隨商品成本）",
      source: "field_gap",
    });
  }
  if (input.twd_price == null || Number.isNaN(Number(input.twd_price))) {
    out.push({
      tier: "confirm",
      text: "售價未算",
      source: "field_gap",
    });
  }
  return out;
}

export function gradeDraftWarnings(
  warnings: string[] | null | undefined,
  fieldGaps?: DraftFieldGapInput
): WarningTierSummary {
  const suggest: GradedWarning[] = [];
  const confirm: GradedWarning[] = [];
  const block: GradedWarning[] = [];
  const seen = new Set<string>();

  const push = (w: GradedWarning) => {
    const key = `${w.tier}|${w.text}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (w.tier === "suggest") suggest.push(w);
    else if (w.tier === "block") block.push(w);
    else confirm.push(w);
  };

  for (const raw of warnings ?? []) {
    const text = typeof raw === "string" ? normalizeWarningText(raw) : "";
    if (!text) continue;
    push({
      tier: gradeWarningText(text),
      text,
      source: "draft_warnings",
    });
  }

  if (fieldGaps) {
    for (const w of fieldGapWarnings(fieldGaps)) push(w);
  }

  return {
    suggest,
    confirm,
    block,
    confirmCount: confirm.length,
    blockCount: block.length,
    suggestCount: suggest.length,
  };
}

/** True when station① 核准 or station② 審核 must be blocked. */
export function hasBlockingWarnings(summary: WarningTierSummary): boolean {
  return summary.blockCount > 0;
}

/** Q6-A: badge number for 「N 項待確認」= ⚠ only. */
export function countConfirmOnly(summary: WarningTierSummary): number {
  return summary.confirmCount;
}
