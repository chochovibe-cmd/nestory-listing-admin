// A16: type -> Taiwan long-tail scenario keyword dictionary. Rule-engine only
// (no LLM) -- the LLM is never asked to invent these; the copy pipeline picks
// 1-2 fixed candidates from here and injects them into seo_title/meta. Keyed
// on the same canonical labels `normalizeProductTypeForDisplay` /
// titleGenerator's PRODUCT_TYPE_ALIASES already produce, so no new
// type-taxonomy is introduced.
//
// Initial content drafted by AI (待老闆審 -- see docs/施工清單.md 待確認清單):
// this is a business/marketing judgment call about which search terms and
// gifting occasions actually match Nestory's customers, not something to
// guess confidently. team_settings row 'scenario_keywords_by_type' (migration
// 016) can override/extend this per-key without a code change once reviewed.
export const DEFAULT_SCENARIO_KEYWORDS: Record<string, string[]> = {
  吊飾掛件: ['包包掛飾', '交換禮物', '書包裝飾', '送禮首選'],
  絨毛娃娃: ['療癒小物', '送禮首選', '桌面擺飾', '交換禮物'],
  盲盒: ['開箱驚喜', '收藏系列', '交換禮物'],
  扭蛋: ['收藏系列', '桌面小物'],
  娃娃抱枕: ['療癒小物', '沙發擺飾', '送禮首選'],
  壓克力立牌: ['桌面擺飾', '收藏展示'],
  手機支架: ['桌面小物', '辦公室擺飾'],
  公仔模型: ['收藏展示', '送禮首選'],
};

function normalizeType(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').trim();
}

export function mergeScenarioKeywordMap(
  override: Record<string, string[]> | null | undefined,
): Record<string, string[]> {
  if (!override) return DEFAULT_SCENARIO_KEYWORDS;
  return { ...DEFAULT_SCENARIO_KEYWORDS, ...override };
}

/** Picks up to `count` scenario terms for the given (already-canonicalized) product types, de-duplicated. */
export function pickScenarioKeywords(
  productTypes: Array<string | null | undefined>,
  keywordMap: Record<string, string[]> = DEFAULT_SCENARIO_KEYWORDS,
  count = 2,
): string[] {
  const terms: string[] = [];

  for (const rawType of productTypes) {
    const type = normalizeType(rawType);
    const candidates = keywordMap[type] ?? [];

    for (const term of candidates) {
      if (terms.length >= count) return terms;
      if (!terms.includes(term)) terms.push(term);
    }
  }

  return terms;
}
