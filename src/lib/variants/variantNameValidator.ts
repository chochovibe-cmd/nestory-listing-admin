/**
 * VARIANT-CLEAN: validator for the AI polish layer (pure).
 *
 * The AI only ever proposes wording. Every proposal is checked against the rule-layer
 * result of the same cell, and ANY failed check sends that cell back to the rule result:
 *   1. numbers, units, English words survive;
 *   2. the product / brand / IP / character name that the rule result carries survives;
 *   3. length stays within +-4 characters of the rule result (no shortening by dropping the name);
 *   4. no new information: no new digits / English, at most 3 new Han characters, no new sales words;
 *   5. variant names stay unique as a combination.
 */
import { localizeToTaiwanTraditionalText } from "@/lib/zhTwLocalizer";
import { scanForbiddenTerms } from "@/lib/providers/forbiddenTerms";
import { normalizeOptionValueForMerge } from "./variantCrossExpand";

export const AI_LENGTH_TOLERANCE = 4;
export const AI_MAX_NEW_HAN_CHARS = 3;

const EXTRA_SALES_WORDS = ["正版", "現貨", "包郵", "免運", "新品", "熱銷", "限量", "特價", "贈"] as const;

export type NameProtectContext = {
  /** IP / character / brand / product names that must not vanish when the rule text has them. */
  names?: Array<string | null | undefined>;
};

export type AiCellCheck = {
  row: number;
  axis: number;
  rule: string;
  ai: string | null;
  accepted: boolean;
  /** Why the AI text was rejected (null when accepted or when AI changed nothing). */
  reason: string | null;
};

export type AiValidationResult = {
  /** Final values per row/axis: AI text where it passed every check, else the rule text. */
  rows: string[][];
  cells: AiCellCheck[];
};

const DIGIT_RUN = /\d+(?:\.\d+)?/g;
const LATIN_RUN = /[A-Za-z][A-Za-z0-9.+\-_]*/g;
const HAN = /[㐀-鿿]/g;

function squash(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function runs(text: string, pattern: RegExp): string[] {
  return squash(text).match(pattern) ?? [];
}

/** Shared leading product name of one axis (>= 3 chars, >= 2 rows), cut before a bracket or space. */
export function commonLeadingName(texts: string[]): string | null {
  const filled = texts.filter((t) => t.length > 0);
  if (filled.length < 2) return null;
  let prefix = filled[0];
  for (const text of filled.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < text.length && prefix[i] === text[i]) i += 1;
    prefix = prefix.slice(0, i);
    if (!prefix) return null;
  }
  const cut = prefix.search(/[【（(\[\s｜|/／\-－+＋]/);
  const name = (cut >= 0 ? prefix.slice(0, cut) : prefix).trim();
  return name.length >= 3 ? name : null;
}

function checkCell(rule: string, ai: string, protectedNames: string[]): string | null {
  if (!ai.trim()) return "AI 回傳空白";

  const aiSquash = squash(ai);
  const canonicalAi = squash(localizeToTaiwanTraditionalText(ai));
  const canonicalRule = squash(localizeToTaiwanTraditionalText(rule));
  for (const token of [...runs(rule, DIGIT_RUN), ...runs(rule, LATIN_RUN)]) {
    if (!aiSquash.includes(token)) return `缺少數字／英文「${token}」`;
  }
  for (const name of protectedNames) {
    const canonicalName = squash(localizeToTaiwanTraditionalText(name));
    if (canonicalRule.includes(canonicalName) && !canonicalAi.includes(canonicalName)) {
      return `缺少名稱「${name}」`;
    }
  }

  if (Math.abs([...ai.trim()].length - [...rule.trim()].length) > AI_LENGTH_TOLERANCE) {
    return `長度與規則結果差超過 ${AI_LENGTH_TOLERANCE} 字`;
  }

  const ruleDigits = new Set(runs(rule, DIGIT_RUN));
  const ruleLatin = new Set(runs(rule, LATIN_RUN));
  for (const d of runs(ai, DIGIT_RUN)) if (!ruleDigits.has(d)) return `多出數字「${d}」`;
  for (const l of runs(ai, LATIN_RUN)) if (!ruleLatin.has(l)) return `多出英文「${l}」`;

  const ruleHan = new Set(rule.match(HAN) ?? []);
  const newHan = (ai.match(HAN) ?? []).filter((ch) => !ruleHan.has(ch));
  if (new Set(newHan).size > AI_MAX_NEW_HAN_CHARS) return "新增了原文沒有的資訊";

  for (const word of [...scanForbiddenTerms(ai), ...EXTRA_SALES_WORDS.filter((w) => ai.includes(w))]) {
    if (!rule.includes(word)) return `新增行銷用語「${word}」`;
  }
  return null;
}

function tupleKey(values: string[]): string {
  return values.map((v) => normalizeOptionValueForMerge(v)).join("\u0001");
}

/**
 * `ruleRows[row][axis]` is the rule-layer text ("" for an unused axis);
 * `aiRows` is whatever the AI returned (validated here, may be garbage).
 */
export function validateAiVariantNames(
  ruleRows: string[][],
  aiRows: unknown,
  ctx: NameProtectContext = {}
): AiValidationResult {
  const shapeOk =
    Array.isArray(aiRows) &&
    aiRows.length === ruleRows.length &&
    aiRows.every(
      (row, i) =>
        Array.isArray(row) &&
        row.length === ruleRows[i].length &&
        row.every((cell) => typeof cell === "string")
    );

  const cells: AiCellCheck[] = [];
  if (!shapeOk) {
    ruleRows.forEach((row, r) =>
      row.forEach((rule, axis) =>
        cells.push({ row: r, axis, rule, ai: null, accepted: false, reason: "AI 回傳格式不符" })
      )
    );
    return { rows: ruleRows.map((row) => [...row]), cells };
  }

  const ai = aiRows as string[][];
  const axisCount = Math.max(0, ...ruleRows.map((row) => row.length));
  const leading = Array.from({ length: axisCount }, (_, axis) =>
    commonLeadingName(ruleRows.map((row) => row[axis] ?? ""))
  );

  const result = ruleRows.map((row) => [...row]);
  ruleRows.forEach((row, r) =>
    row.forEach((rule, axis) => {
      if (!rule) return;
      const proposal = ai[r][axis].trim();
      const names = [...(ctx.names ?? []), leading[axis]].filter((n): n is string => Boolean(n && n.trim().length >= 2));
      const reason = proposal === rule ? null : checkCell(rule, proposal, names);
      const accepted = reason == null;
      cells.push({ row: r, axis, rule, ai: proposal, accepted, reason });
      if (accepted) result[r][axis] = proposal;
    })
  );

  // Uniqueness of the whole combination: colliding rows go back to the rule text.
  const groups = new Map<string, number[]>();
  result.forEach((row, r) => {
    const key = tupleKey(row);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  });
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    for (const r of members) {
      result[r] = [...ruleRows[r]];
      cells
        .filter((cell) => cell.row === r && cell.accepted && cell.ai !== cell.rule)
        .forEach((cell) => {
          cell.accepted = false;
          cell.reason = "整理後和其他款式重複";
        });
    }
  }

  return { rows: result, cells };
}
