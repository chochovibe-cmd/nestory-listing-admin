/**
 * SYN-1 R2: seller-service filter + Taobao param noise cleanup
 * before rendering detail-image specs. Hard filter (not prompt-only).
 */

import {
  SELLER_SERVICE_FILTER_TERMS,
  TAOBAO_NOISE_SPEC_KEYS
} from "@/lib/images/detailCompose/sellerServiceTerms";

export type SpecRow = {
  key: string;
  value: string;
};

export function parseSpecRows(specText: string | null | undefined): SpecRow[] {
  const lines = String(specText || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return lines.map((line) => {
    const idx = line.search(/[：:]/);
    if (idx > 0) {
      return { key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
    }
    return { key: "", value: line };
  });
}

function containsServiceTerm(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return SELLER_SERVICE_FILTER_TERMS.some((term) => t.includes(term));
}

function isNoiseKey(key: string): boolean {
  const k = key.trim();
  if (!k) return false;
  return TAOBAO_NOISE_SPEC_KEYS.some(
    (noise) => k === noise || k.includes(noise)
  );
}

/**
 * Heuristic: key/value swapped (e.g. value looks like a short label and key is long prose).
 * Conservative — only flags obvious inversions.
 */
export function looksKeyValueSwapped(row: SpecRow): boolean {
  const k = row.key.trim();
  const v = row.value.trim();
  if (!k || !v) return false;
  // Value is a typical short attribute name, key is a long number-ish or sentence
  const valueLooksLikeLabel =
    v.length <= 8 && !/\d/.test(v) && /[\u4e00-\u9fff]/.test(v);
  const keyLooksLikeValue =
    k.length >= 12 && (/\d/.test(k) || k.length > v.length * 2);
  return valueLooksLikeLabel && keyLooksLikeValue;
}

/**
 * R2: drop seller-service rows, empty values, noise keys, swapped junk.
 */
export function filterSpecsForDetailImage(rows: SpecRow[]): SpecRow[] {
  const out: SpecRow[] = [];
  for (const row of rows) {
    const key = (row.key || "").trim();
    const value = (row.value || "").trim();

    // Empty value (or empty whole line)
    if (!value && !key) continue;
    if (key && !value) continue;
    if (!key && !value) continue;

    // Single-cell line with only service noise
    if (!key && containsServiceTerm(value)) continue;

    if (key && (isNoiseKey(key) || containsServiceTerm(key))) continue;
    if (value && containsServiceTerm(value)) continue;

    if (looksKeyValueSwapped({ key, value })) continue;

    out.push({ key, value: value || key });
  }
  return out;
}

/** Parse + filter in one step (spec_text → clean rows). */
export function parseAndFilterSpecText(specText: string | null | undefined): SpecRow[] {
  return filterSpecsForDetailImage(parseSpecRows(specText));
}
