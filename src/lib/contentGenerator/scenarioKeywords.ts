// A16: type -> Taiwan long-tail scenario keyword dictionary. Rule-engine only
// (no LLM) -- the LLM is never asked to invent these; the copy pipeline picks
// 1-2 fixed candidates from here and injects them into seo_title/meta and the
// D段 "適用情境" bullet (A17). Keyed on the same canonical labels
// `normalizeProductTypeForDisplay` / titleGenerator's PRODUCT_TYPE_ALIASES
// already produce, so no new type-taxonomy is introduced.
//
// Content is a business/marketing judgment call about which search terms and
// gifting occasions actually match Nestory's customers. team_settings row
// 'scenario_keywords_by_type' (migration 016) can override/extend this
// per-key without a code change.
// Reviewed 2026-07-10 (marketing pass, commander session): dropped 送禮首選
// (seller puffery, zero search volume), added 生日禮物 (highest-volume TW gift
// long-tail), and reordered — pickScenarioKeywords() always takes the FIRST
// `count` terms, so position 1-2 of each list is what actually ships.
export const DEFAULT_SCENARIO_KEYWORDS: Record<string, string[]> = {
  吊飾掛件: ['包包掛飾', '交換禮物', '生日禮物', '書包裝飾'],
  絨毛娃娃: ['療癒小物', '生日禮物', '交換禮物', '房間佈置'],
  盲盒: ['交換禮物', '開箱驚喜', '收藏系列'],
  扭蛋: ['桌面小物', '交換禮物', '收藏系列'],
  娃娃抱枕: ['療癒小物', '午睡神器', '生日禮物'],
  壓克力立牌: ['桌面擺飾', '追星應援', '收藏展示'],
  手機支架: ['追劇神器', '辦公桌小物', '實用禮物'],
  公仔模型: ['收藏展示', '桌面擺飾', '生日禮物'],
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

// A17: D段 in the AI copy pipeline is one plain-text A/B/C/D/E blob (see
// systemPrompt.ts), not separate fields, so adding a deterministic bullet
// means locating the "D｜商品資訊" block by its header line and inserting
// before the next header/end -- never before the header, never fabricating a
// D段 that the model legitimately omitted (no info beyond the product name).
const SECTION_HEADER = /^([A-E])｜/;

export function appendScenarioBulletToDescription(
  description: string | null | undefined,
  scenarioTerms: string[],
): string {
  const text = description ?? '';
  if (!text || scenarioTerms.length === 0) return text;

  const lines = text.split(/\r?\n/);
  let dStart = -1;
  let dEnd = lines.length;

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(SECTION_HEADER);
    if (!match) continue;

    if (dStart === -1) {
      if (match[1] === 'D') dStart = i;
      continue;
    }

    dEnd = i;
    break;
  }

  if (dStart === -1) return text; // model omitted D段 -- don't force one just for this

  if (lines.slice(dStart, dEnd).some((line) => line.includes('適用情境'))) {
    return text; // idempotent on regen
  }

  let contentEnd = dEnd;
  while (contentEnd > dStart + 1 && lines[contentEnd - 1].trim() === '') {
    contentEnd -= 1;
  }

  const bulletLine = '➼ 適用情境：' + scenarioTerms.join('、');
  return [...lines.slice(0, contentEnd), bulletLine, ...lines.slice(contentEnd)].join('\n');
}
