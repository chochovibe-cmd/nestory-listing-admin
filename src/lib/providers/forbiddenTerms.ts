// A11: soft (warn-only) forbidden-term scan for generated copy. The same list
// is instructed in the system prompt (禁忌詞), but the LLM occasionally leaks
// one through; per 文案·二·4 we surface it as a validation_warning for the
// human reviewer instead of hard-blocking the draft.
//
// Single-character 淘寶 address words from the prompt (親) are intentionally
// EXCLUDED from the automated scan: a bare substring match flags legitimate
// brand-voice words like 親切/親子 on almost every listing, drowning the signal.
// Those stay a prompt-level instruction only.
export const FORBIDDEN_COPY_TERMS: readonly string[] = [
  "超值",
  "爆款",
  "必買",
  "剁手",
  "秒殺",
  "全網低價",
  "全網最低",
  "清倉",
  "狂銷",
  "熱賣",
  "CP值",
  "買到賺到",
  "神物",
  "頂規",
  "保證升值",
  "限時搶購",
  "錯過可惜",
  "網紅推薦",
  "買貴退差",
  "旗艦",
  "贈品可選",
  "店鋪優惠",
  "寶貝",
  "手辦狂熱者評價",
];

/** Returns the forbidden terms present in `text` (deduped, in list order). */
export function scanForbiddenTerms(text: string | null | undefined): string[] {
  if (!text) return [];
  return FORBIDDEN_COPY_TERMS.filter((term) => text.includes(term));
}

/**
 * Scans several copy fields at once and, if any forbidden term is found,
 * returns a single consolidated warning string; otherwise null.
 */
export function buildForbiddenTermWarning(fields: Array<string | null | undefined>): string | null {
  const found = scanForbiddenTerms(fields.filter(Boolean).join("\n"));
  if (found.length === 0) return null;
  return `文案疑似含叫賣／禁忌詞：${found.join("、")}（僅提醒，未自動阻擋，請人工確認後修改）`;
}
