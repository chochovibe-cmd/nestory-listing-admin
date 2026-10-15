/**
 * VARIANT-CLEAN: rule layer of 款式名稱整理 (pure, deterministic, idempotent).
 *
 * - whitespace trimmed / collapsed, full-width ASCII letters + digits -> half-width,
 *   ( ) -> （ ）, 【】 untouched
 * - OpenCC + the one shared Taiwan glossary (zhTwLocalizer)
 * - decorative marketing words dropped, unless that would empty or duplicate a name
 * - the product name inside a variant name is KEPT (no common-prefix stripping)
 * - axis names: 颜色分类 -> 款式, 尺码 -> 尺寸
 *
 * Used at capture import (rules only, originals go to source_options) and by the
 * 整理款式名稱 preview, which then adds the optional AI polish on top.
 */
import { localizeToTaiwanTraditionalText } from "@/lib/zhTwLocalizer";
import { normalizeOptionValueForMerge } from "./variantCrossExpand";

export type VariantOptionFields = {
  option1_name?: string | null;
  option1_value?: string | null;
  option2_name?: string | null;
  option2_value?: string | null;
  option3_name?: string | null;
  option3_value?: string | null;
};

/** Decorative sales words (Traditional; OpenCC runs first). Longest first. */
const MARKETING_WORDS = ["正版授權", "官方正版", "正品保證", "正品", "包郵", "免運", "現貨", "新品", "熱賣", "熱銷", "爆款", "特價"] as const;

const DIMENSION_NAME_MAP: ReadonlyArray<readonly [RegExp, string]> = [
  [/^顏色分類$|^顏色$|^規格分類$/, "款式"],
  [/^尺碼$|^尺碼分類$/, "尺寸"]
];

const EDGE_SEPARATORS = /^[\s/／|｜,，、;；:：\-－+＋·・]+|[\s/／|｜,，、;；:：\-－+＋·・]+$/g;

function toHalfWidthAlnum(text: string): string {
  return text
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, " ");
}

function tidy(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\(/g, "（")
    .replace(/\)/g, "）")
    .replace(/（\s+/g, "（")
    .replace(/\s+）/g, "）")
    .trim();
}

/** Stage 1: symbols + wording, no word removal. */
export function normalizeVariantText(text: string | null | undefined): string {
  const raw = String(text ?? "");
  if (!raw.trim()) return "";
  return tidy(toHalfWidthAlnum(localizeToTaiwanTraditionalText(raw)));
}

/** Stage 2: drop decorative marketing words; returns the input when nothing sensible is left. */
export function stripMarketingWords(text: string): string {
  let next = text;
  for (const word of MARKETING_WORDS) next = next.split(word).join(" ");
  next = next
    .replace(/【\s*】|（\s*）|\[\s*\]/g, " ")
    .replace(/\s+/g, " ")
    .replace(EDGE_SEPARATORS, "")
    .trim();
  return next.length >= 2 ? tidy(next) : text;
}

export function cleanDimensionName(name: string | null | undefined): string {
  const normalized = normalizeVariantText(name);
  if (!normalized) return "";
  for (const [pattern, replacement] of DIMENSION_NAME_MAP) {
    if (pattern.test(normalized)) return replacement;
  }
  return normalized;
}

/** Rule-layer result of one option value (marketing words dropped). */
export function cleanOptionValue(value: string | null | undefined): string {
  const normalized = normalizeVariantText(value);
  return normalized ? stripMarketingWords(normalized) : "";
}

function tupleKey(values: Array<string | null | undefined>): string {
  return values.map((v) => normalizeOptionValueForMerge(String(v ?? ""))).join("\u0001");
}

export type CleanedVariantFields = {
  names: [string | null, string | null, string | null];
  values: [string | null, string | null, string | null];
};

function fieldsOf(row: VariantOptionFields): CleanedVariantFields {
  return {
    names: [row.option1_name ?? null, row.option2_name ?? null, row.option3_name ?? null],
    values: [row.option1_value ?? null, row.option2_value ?? null, row.option3_value ?? null]
  };
}

/**
 * Rule layer for a whole variant list. Never produces an empty value or a
 * duplicate option combination: colliding rows fall back first to the
 * word-kept version (symbols/wording only), then to the original text.
 */
export function cleanVariantRows(rows: VariantOptionFields[]): CleanedVariantFields[] {
  const originals = rows.map(fieldsOf);
  const wordKept = originals.map((o) => ({
    names: o.names.map((n) => (n == null ? null : normalizeVariantText(n) || n)) as CleanedVariantFields["names"],
    values: o.values.map((v) => (v == null ? null : normalizeVariantText(v) || v)) as CleanedVariantFields["values"]
  }));
  const full: CleanedVariantFields[] = originals.map((o, i) => ({
    names: o.names.map((n) => (n == null ? null : cleanDimensionName(n) || n)) as CleanedVariantFields["names"],
    values: o.values.map((v, k) => (v == null ? null : cleanOptionValue(v) || wordKept[i].values[k] || v)) as CleanedVariantFields["values"]
  }));

  const result = full.map((f) => ({ names: [...f.names], values: [...f.values] })) as CleanedVariantFields[];
  const sources = [full, wordKept, originals];
  for (let level = 1; level < sources.length; level += 1) {
    const groups = new Map<string, number[]>();
    result.forEach((r, i) => {
      const key = tupleKey(r.values);
      groups.set(key, [...(groups.get(key) ?? []), i]);
    });
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      for (const i of members) {
        result[i] = { names: [...sources[level][i].names], values: [...sources[level][i].values] } as CleanedVariantFields;
      }
    }
  }
  // Axis names must stay consistent across rows: one row mapping 颜色分类 -> 款式 while another
  // keeps it would split the axis, so the mapping is all-or-nothing per axis.
  for (let axis = 0; axis < 3; axis += 1) {
    const mapped = new Set(result.map((r) => r.names[axis]).filter((n) => n != null));
    if (mapped.size > 1) {
      result.forEach((r, i) => {
        r.names[axis] = wordKept[i].names[axis];
      });
    }
  }
  return result;
}

/** True when the rule layer would change anything on this row. */
export function variantFieldsChanged(before: VariantOptionFields, after: CleanedVariantFields): boolean {
  const b = fieldsOf(before);
  return b.names.some((n, i) => n !== after.names[i]) || b.values.some((v, i) => v !== after.values[i]);
}
