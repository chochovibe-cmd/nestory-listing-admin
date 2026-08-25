import { extractFeatureTerms } from './featureTerms';
import {
  DisplayLabelContext,
  formatCharacterShortNameFromContext,
  formatListingIpDisplayNameFromContext,
} from './displayLabels';
import { ListingDraftInput } from './types';
import { normalizeProductTypeForDisplay } from '../productTypeLabels';
import { pickScenarioKeywords } from './scenarioKeywords';

// P2-83（2026-07-18 老闆定案，覆寫夜工統一 80）：
// 官網 title_zh ≤60；enriched_title／seo_title ≤80。
export const OFFICIAL_TITLE_MAX_LENGTH = 60;
export const ENRICHED_TITLE_MAX_LENGTH = 80;
/** @deprecated use OFFICIAL_TITLE_MAX_LENGTH — kept name only for older verify mirrors */
const TITLE_MAX_LENGTH = OFFICIAL_TITLE_MAX_LENGTH;

// P2-80：標題第三段永不輸出的萬用詞（SEO／D 段情境詞庫可另用，標題過濾）
export const TITLE_SEGMENT3_BLACKLIST: readonly string[] = [
  '生日禮物',
  '送禮首選',
  '最佳選擇',
  '送禮推薦',
  '熱賣',
  '爆款',
  '必買',
  '超值',
  '限時',
];

const NOISE_TERMS = [
  '日本正版',
  '正版授權',
  '正版',
  '高級',
  '生日禮物女',
  '生日禮物',
  '禮物女',
  '禮物',
  '批發',
  '代購',
  '熱賣',
  '爆款',
  '官方',
  '正品',
  '送禮首選',
  '最佳選擇',
];

// Order matters: first match wins. Longer / more specific patterns before broad ones.
// P6: 大型娃娃 before bare 娃娃; 滑鼠(?!墊) so 滑鼠墊 is not eaten; 鍵盤(?!帽) same for 鍵帽.
const PRODUCT_TYPE_ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/大型娃娃|巨型娃娃|超大娃娃|大型玩偶|大娃娃/, '大型娃娃'],
  [/棉花娃娃|棉娃|plush|ぬいぐるみ|絨毛娃娃|毛絨娃娃|絨毛公仔|毛絨公仔|絨毛玩偶|毛絨玩偶|小娃娃|小玩偶|布偶|玩偶|娃娃/, '絨毛娃娃'],
  [/包包掛件|包包吊飾|包包掛飾|手機掛飾|娃娃吊飾|掛件|吊飾|鑰匙圈|鑰匙扣|徽章|別針|keychain|charm|badge|pin/i, '吊飾掛件'],
  [/盲盒|盲袋/, '盲盒'],
  [/扭蛋/, '扭蛋'],
  [/娃娃抱枕|抱枕/, '娃娃抱枕'],
  [/亞克力立牌|壓克力立牌/, '壓克力立牌'],
  [/手機支架/, '手機支架'],
  [/公仔模型|公仔|手辦|模型/, '公仔模型'],
  // P6｜P3 五類（標題去重）；滑鼠／鍵盤負向預查對齊 nestoryTagsV2 Q10
  [/電競滑鼠|無線滑鼠|有線滑鼠|滑鼠(?!墊)|鼠标(?!垫)|mouse(?!\s*pad)/i, '滑鼠'],
  [/機械鍵盤|無線鍵盤|電競鍵盤|鍵盤(?!帽)|键盘(?!帽)|keyboard/i, '鍵盤'],
  [/手把控制器|遊戲手把|游戏手柄|手把|手柄|搖桿|摇杆|gamepad|controller|joystick/i, '手把控制器'],
  [/保溫杯瓶|保溫杯|保温杯|隨行杯|随行杯|水壺|水壶|水瓶|tumbler/i, '保溫杯瓶'],
];

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/三丽鸥/g, '三麗鷗')
    .replace(/毛绒/g, '毛絨')
    .replace(/挂件/g, '掛件')
    .replace(/钥匙扣/g, '鑰匙圈')
    .replace(/钥匙圈/g, '鑰匙圈')
    .replace(/亚克力/g, '壓克力')
    .replace(/台灯/g, '桌燈')
    .replace(/灯具/g, '燈具')
    .replace(/摆件/g, '擺件')
    .replace(/联名/g, '聯名')
    .replace(/夏威美/g, '夏威夷')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length).trim() : value;
}

function cleanTitleText(value: string): string {
  let nextValue = normalizeText(value);

  for (const term of NOISE_TERMS) {
    nextValue = nextValue.split(term).join('');
  }

  return nextValue
    .replace(/[【】\[\]（）()]/g, '')
    .replace(/[|｜・,，、;；]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addUnique(values: string[], value: string, limit = Number.POSITIVE_INFINITY) {
  const nextValue = normalizeText(value);

  if (!nextValue || values.includes(nextValue) || values.length >= limit) {
    return;
  }

  values.push(nextValue);
}

function canonicalizeProductType(value: string): string | null {
  const normalized = normalizeProductTypeForDisplay(stripPrefix(normalizeText(value), '類型_'));

  if (!normalized) {
    return null;
  }

  for (const [pattern, canonical] of PRODUCT_TYPE_ALIASES) {
    if (pattern.test(normalized)) {
      return canonical;
    }
  }

  return normalized;
}

function inferProductTypes(draft: ListingDraftInput): string[] {
  const productTypes: string[] = [];
  const sourceText = [draft.product_name, draft.variant_feature, draft.usage_scene, draft.intro, draft.notes]
    .map(normalizeText)
    .join(' ');

  for (const rawType of draft.product_types) {
    const productType = canonicalizeProductType(rawType);

    if (productType) {
      addUnique(productTypes, productType, 2);
    }
  }

  for (const [pattern, productType] of PRODUCT_TYPE_ALIASES) {
    if (productTypes.length >= 2) {
      break;
    }

    if (pattern.test(sourceText)) {
      addUnique(productTypes, productType, 2);
    }
  }

  return productTypes;
}

// A15: `characterText` can carry a type word under a different surface form
// than its canonical (e.g. a character/product name literally containing "吊飾"
// while the canonicalized type is "吊飾掛件") -- a plain substring check on the
// canonical string misses that and produces doubled words like "吊飾吊飾" in the
// final title. Re-testing each type's own alias pattern against characterText
// catches the raw-word overlap that the canonical-string check alone cannot.
function typeAlreadyPresentIn(type: string, text: string): boolean {
  if (!text) return false;
  if (text.includes(type)) return true;

  const pattern = PRODUCT_TYPE_ALIASES.find(([, canonical]) => canonical === type)?.[0];
  return pattern ? pattern.test(text) : false;
}

/**
 * 夜工包（回饋 29）：除了偵測到的角色，也從款式文字／原標題比對
 * ipCharacters 別名，把「款式裡有出的角色」一併收進標題。
 */
export function collectCharacterNames(
  draft: ListingDraftInput,
  context: DisplayLabelContext,
  ipDisplayName: string,
): string[] {
  const names: string[] = [];
  for (const character of draft.characters) {
    const formatted = normalizeText(formatCharacterShortNameFromContext(character, draft.ip, context));
    if (formatted) {
      addUnique(names, formatted);
    }
  }

  const scanText = normalizeText([draft.variant_text, draft.product_name].filter(Boolean).join(' '));
  if (scanText && context.ipCharacters?.length) {
    const draftIp = normalizeText(draft.ip).toLocaleLowerCase();
    const matches: Array<{ index: number; name: string }> = [];
    for (const entry of context.ipCharacters) {
      const entryIp = normalizeText(entry.ip_name).toLocaleLowerCase();
      // 只比對同 IP（或字典未標 IP）的角色，避免跨 IP 誤認
      if (entryIp && draftIp && !entryIp.includes(draftIp) && !draftIp.includes(entryIp)) continue;
      const aliases = [entry.character_name, ...(entry.aliases ?? [])]
        .map(normalizeText)
        .filter((alias) => alias.length >= 2);
      const index = aliases
        .map((alias) => scanText.indexOf(alias))
        .filter((i) => i >= 0)
        .sort((a, b) => a - b)[0];
      if (index !== undefined) {
        const short = normalizeText(formatCharacterShortNameFromContext(entry.character_name, draft.ip, context));
        if (short) {
          matches.push({ index, name: short });
        }
      }
    }
    for (const match of matches.sort((a, b) => a.index - b.index)) {
      addUnique(names, match.name);
    }
  }

  return names;
}

/** COPY C1.2：1–3 個完整列出；超過 3 個才取前三＋「等角色」。 */
export function formatCharacterText(characters: string[]): string {
  if (characters.length === 0) return '';
  if (characters.length <= 3) return characters.join('・');
  return characters.slice(0, 3).join('・') + '等角色';
}

// 老闆工具的重複詞收斂（吊飾吊飾→吊飾掛件 這類）；煙霧測試 2026-07-18 抓到後補港。
const TITLE_DEDUPE_TERMS = [
  '絨毛吊飾', '吊飾掛件', '絨毛娃娃', '桌面小夜燈', '娃娃抱枕',
  '吊飾', '掛件', '鑰匙圈', '盲盒', '絨毛', '毛絨', '娃娃', '擺件', '抱枕', '公仔',
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function dedupeRepeatedTitleTerms(value: string): string {
  let result = normalizeText(value);
  for (const term of TITLE_DEDUPE_TERMS) {
    result = result.replace(new RegExp('(?:' + escapeRegExp(term) + '\\s*){2,}', 'g'), term);
  }
  return result
    .replace(/吊飾\s*吊飾/g, '吊飾掛件')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function buildCoreName(
  draft: ListingDraftInput,
  context: DisplayLabelContext,
  ipDisplayName: string,
  characters: string[],
): string {
  const productTypes = inferProductTypes(draft);
  const characterText = formatCharacterText(characters);
  const typeText = dedupeRepeatedTitleTerms(
    productTypes.filter((type) => !typeAlreadyPresentIn(type, characterText)).join('')
  );

  if (characterText && typeText) {
    return dedupeRepeatedTitleTerms(characterText + ' ' + typeText);
  }
  if (characterText || typeText) {
    return dedupeRepeatedTitleTerms(characterText + typeText);
  }

  return cleanTitleText(draft.product_name).slice(0, 18);
}

function getFeatureSourceText(draft: ListingDraftInput): string {
  return [draft.variant_feature, draft.intro, draft.product_name]
    .map(normalizeText)
    .filter(Boolean)
    .join(' ');
}

function getSizeText(sourceText: string): string | null {
  const sizeMatch = sourceText.match(/(\d+(?:\.\d+)?)\s*(cm|CM|公分|厘米)/);

  if (sizeMatch) {
    return sizeMatch[1] + 'cm';
  }

  const inchMatch = sourceText.match(/(\d+(?:\.\d+)?)\s*(吋|寸)/);

  if (inchMatch) {
    return inchMatch[1] + '吋';
  }

  return null;
}

// 夜工包：特色判斷階梯對齊老闆工具（造型款清單擴充＋系列＋功能＋款式可選）。
function getStyleText(sourceText: string): string | null {
  const stylePatterns: ReadonlyArray<readonly [RegExp, string]> = [
    [/夏威夷.*(?:沖浪|衝浪|surf)|(?:沖浪|衝浪|surf).*夏威夷|hawaii.*surf|surf.*hawaii/i, '夏威夷衝浪造型'],
    [/Sports\s*Club/i, 'Sports Club'],
    [/睡衣款|睡衣|pajama|pyjama/i, '睡衣款'],
    [/球衣款|球衣|jersey/i, '球衣款'],
    [/棒球款|棒球|baseball/i, '棒球款'],
    [/小畫家款|小畫家|畫家|painter/i, '小畫家款'],
    [/生日款|birthday/i, '生日款'],
    [/聖誕款|聖誕|christmas|xmas/i, '聖誕款'],
    [/滑雪服款|滑雪款|滑雪服|滑雪|ski/i, '滑雪服款'],
    [/和服款|和服|浴衣|kimono/i, '和服款'],
    [/校園款|制服|學生|school/i, '校園款'],
  ];
  for (const [pattern, feature] of stylePatterns) {
    if (pattern.test(sourceText)) return feature;
  }
  return null;
}

function getSeriesText(sourceText: string): string | null {
  const seriesPatterns: ReadonlyArray<readonly [RegExp, string]> = [
    [/\bFLASTA\b/i, 'FLASTA'],
    [/Mickey\s*(?:&|and)\s*Friends|米奇與好友|米奇和朋友/i, 'Mickey & Friends'],
  ];
  for (const [pattern, feature] of seriesPatterns) {
    if (pattern.test(sourceText)) return feature;
  }
  return null;
}

function getFunctionText(sourceText: string): string | null {
  const functionPatterns: ReadonlyArray<readonly [RegExp, string]> = [
    [/桌面擺件|桌上擺件|擺件|擺飾/i, '擺件款'],
    [/收納/i, '收納款'],
    [/可掛包|掛包|包包掛/i, '可掛包款'],
  ];
  for (const [pattern, feature] of functionPatterns) {
    if (pattern.test(sourceText)) return feature;
  }
  return null;
}

function getSelectableText(sourceText: string): string | null {
  if (/款式可選|多款可選|款式任選|可選款式|款式可挑/i.test(sourceText)) return '款式可選';
  if (/角色可選|角色任選|可選角色|人物可選/i.test(sourceText)) return '角色可選';
  return null;
}

export function isTitleSegment3Blacklisted(value: string): boolean {
  const text = normalizeText(value);
  if (!text) return false;
  return TITLE_SEGMENT3_BLACKLIST.some(
    (term) => text === term || text.includes(term),
  );
}

/** Strip blacklisted universal fluff from a third-segment candidate (P2-80 A2). */
export function sanitizeTitleSegment3(value: string): string {
  let next = normalizeText(value);
  for (const term of TITLE_SEGMENT3_BLACKLIST) {
    next = next.split(term).join('');
  }
  return next.replace(/\s{2,}/g, ' ').trim();
}

export const LOW_VALUE_TITLE_FEATURES: readonly string[] = [
  '隨機款', '標準款', '款式可選', '多款可選', '一般款',
];

/** Prefer evidence-rich feature candidates; generic fallbacks only win when no richer candidate exists. */
export function rankTitleFeatureCandidates(candidates: readonly (string | null | undefined)[]): string {
  const cleaned = candidates
    .map((value) => dedupeRepeatedTitleTerms(sanitizeTitleSegment3(value ?? '')))
    .filter(Boolean);
  const rich = cleaned.find((value) => !LOW_VALUE_TITLE_FEATURES.includes(value));
  return rich ?? cleaned[0] ?? '';
}

function pickTitleScenarioFallback(draft: ListingDraftInput): string | null {
  const productTypes = inferProductTypes(draft);
  const terms = pickScenarioKeywords(productTypes, undefined, 4).filter(
    (term) => !isTitleSegment3Blacklisted(term),
  );
  return terms[0] ?? null;
}

function getShortFeatureText(draft: ListingDraftInput, hasMultipleCharacters = false): string {
  const sourceText = [draft.product_name, draft.variant_feature, draft.variant_text, draft.intro]
    .map(normalizeText)
    .join(' ');
  const featureTerms = extractFeatureTerms(draft.image_description, getFeatureSourceText(draft)).filter(
    (term) => !isTitleSegment3Blacklisted(term),
  );
  const sizeText = getSizeText(sourceText);

  // P2-80 階梯：款式/特色優先 → 情境後備（已濾黑名單）→ 中性標準款/款式可選（永不輸出黑名單）
  const styleText = getStyleText(sourceText);
  if (styleText && sizeText) return styleText + ' ' + sizeText;
  if (styleText) return styleText;

  const seriesText = getSeriesText(sourceText);
  if (seriesText) return seriesText;

  const functionText = getFunctionText(sourceText);
  if (functionText) return functionText;

  if (featureTerms.length > 0) {
    return [...featureTerms, sizeText].filter(Boolean).join(' ');
  }

  if (draft.variant_feature?.trim()) {
    const cleaned = sanitizeTitleSegment3(
      cleanTitleText(draft.variant_feature).split(/[、，,。；;]/)[0].slice(0, 12),
    );
    if (cleaned) return cleaned;
  }

  if (sizeText) return sizeText;

  const scenario = pickTitleScenarioFallback(draft);
  if (scenario) return scenario;

  if (hasMultipleCharacters) return '款式可選';

  return getSelectableText(sourceText) ?? '標準款';
}

function textLen(value: string): number {
  return Array.from(value).length;
}

function sliceChars(value: string, max: number): string {
  return Array.from(value).slice(0, Math.max(0, max)).join('');
}

/** COPY C1.1: split every supported pipe spelling and rejoin using the one official separator. */
function splitTitlePipeSegments(value: string): string[] | null {
  const normalized = normalizeText(value);
  if (!/[|｜]/u.test(normalized)) return null;
  const parts = normalized
    .split(/\s*[|｜]\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length >= 2 ? parts : null;
}

export function normalizeTitleSeparators(value: string | null | undefined): string {
  const normalized = normalizeText(value ?? '');
  const parts = splitTitlePipeSegments(normalized);
  return parts ? parts.join(' | ') : normalized;
}

/**
 * P2-83: skeleton clamp — prefer cutting segment 3, never chop brand×IP (seg1).
 * Official separator is always " | ".
 */
export function enforceSkeletonTitleLength(
  seg1: string,
  seg2: string,
  seg3: string,
  maxLen: number = OFFICIAL_TITLE_MAX_LENGTH,
): string {
  const s1 = dedupeRepeatedTitleTerms(seg1);
  const s2 = dedupeRepeatedTitleTerms(seg2);
  const s3 = dedupeRepeatedTitleTerms(seg3);
  const join3 = (a: string, b: string, c: string) => {
    if (a && b && c) return `${a} | ${b} | ${c}`;
    if (a && b) return `${a} | ${b}`;
    return [a, b, c].filter(Boolean).join(' | ');
  };

  let feature = s3;
  let core = s2;
  let title = join3(s1, core, feature);
  if (textLen(title) <= maxLen) return title;

  // 1) shrink / drop third segment first
  while (feature && textLen(join3(s1, core, feature)) > maxLen) {
    if (textLen(feature) <= 1) {
      feature = '';
      break;
    }
    feature = sliceChars(feature, textLen(feature) - 1).trim();
  }
  title = join3(s1, core, feature);
  if (textLen(title) <= maxLen) return title;

  // 2) shrink second segment; keep first intact
  while (core && textLen(join3(s1, core, feature)) > maxLen) {
    if (textLen(core) <= 1) break;
    core = sliceChars(core, textLen(core) - 1).trim();
  }
  title = join3(s1, core, feature);
  if (textLen(title) <= maxLen) return title;

  // 3) last resort: seg1 + truncated remainder of max budget (still keep seg1 whole if possible)
  if (textLen(s1) >= maxLen) {
    return sliceChars(s1, maxLen);
  }
  const restBudget = maxLen - textLen(s1) - 3; // " | "
  const rest = [core, feature].filter(Boolean).join(' | ');
  if (restBudget <= 0) return s1;
  return `${s1} | ${sliceChars(rest, restBudget)}`.trim();
}

function enforceTitleLength(ip: string, coreName: string, featureText: string): string {
  return enforceSkeletonTitleLength(ip, coreName, featureText, OFFICIAL_TITLE_MAX_LENGTH);
}

export interface StructuredEnrichedTitleInput {
  brand?: string | null;
  ip?: string | null;
  characters?: readonly string[] | null;
  productType?: string | null;
  featureText?: string | null;
  structuredBaseTitle?: string | null;
  preserveStructuredBase?: boolean;
  maxLen?: number;
}

function featureCandidateFromTitle(value: string | null | undefined): string {
  const normalized = normalizeTitleSeparators(value ?? '');
  const parts = splitTitlePipeSegments(normalized);
  return sanitizeTitleSegment3(parts && parts.length >= 3 ? parts.slice(2).join(' | ') : normalized);
}

/**
 * COPY C1.2 structured title assembly. Segments 1–2 come only from structured
 * classification (or an already-confirmed structured base during field regen);
 * model text is allowed to supply segment 3 only.
 */
export function buildStructuredEnrichedTitle(input: StructuredEnrichedTitleInput): string {
  const baseParts = splitTitlePipeSegments(input.structuredBaseTitle ?? '');
  const brand = normalizeText(input.brand);
  const ip = normalizeText(input.ip);
  const structuredSeg1 = brand && ip ? `${brand} × ${ip}` : (ip || brand);
  const characters = Array.from(new Set((input.characters ?? []).map(normalizeText).filter(Boolean)));
  const characterText = formatCharacterText(characters);
  const productType = normalizeText(normalizeProductTypeForDisplay(input.productType ?? ''));
  const structuredSeg2 = characterText && productType
    ? dedupeRepeatedTitleTerms(`${characterText} ${productType}`)
    : (characterText || productType);

  const seg1 = input.preserveStructuredBase
    ? (baseParts?.[0] ?? structuredSeg1)
    : (structuredSeg1 || baseParts?.[0] || '');
  const seg2 = input.preserveStructuredBase
    ? (baseParts?.[1] ?? structuredSeg2)
    : (structuredSeg2 || baseParts?.[1] || '');

  let seg3 = rankTitleFeatureCandidates([
    featureCandidateFromTitle(input.featureText),
    baseParts?.slice(2).join(' | '),
  ]);
  if (productType && seg3.includes(productType)) {
    seg3 = seg3.split(productType).join(' ').replace(/\s{2,}/g, ' ').trim();
  }
  for (const term of seg2.split(/[・\s]+/u).filter((term) => term.length >= 2)) {
    if (seg3.includes(term)) seg3 = seg3.split(term).join(' ').replace(/\s{2,}/g, ' ').trim();
  }
  seg3 = rankTitleFeatureCandidates([seg3]) || '標準款';

  return enforceSkeletonTitleLength(seg1, seg2, seg3, input.maxLen ?? ENRICHED_TITLE_MAX_LENGTH);
}

/**
 * COPY C1.1 deterministic enriched-title contract:
 * - preserve current segment 1 order (brand × IP)
 * - segment 2 = existing character text + detected product type when missing
 * - separator always " | "
 * - segment 3 blacklist stays active; exact duplicate product type is removed from seg3
 * - caller chooses 60/80 clamp budget.
 */
export function normalizeEnrichedTitleContract(
  title: string | null | undefined,
  detectedProductType: string | null | undefined,
  maxLen: number = ENRICHED_TITLE_MAX_LENGTH,
): string {
  const normalized = normalizeTitleSeparators(title);
  if (!normalized) return '';

  const parts = splitTitlePipeSegments(normalized);
  if (!parts) {
    return clampOfficialTitle(normalized, maxLen);
  }

  const seg1 = parts[0] ?? '';
  let seg2 = parts[1] ?? '';
  let seg3 = parts.slice(2).join(' | ');
  const productType = canonicalizeProductType(detectedProductType ?? '');

  if (productType && !typeAlreadyPresentIn(productType, seg2)) {
    seg2 = dedupeRepeatedTitleTerms([seg2, productType].filter(Boolean).join(' '));
  }

  if (productType && seg3.includes(productType)) {
    seg3 = seg3.split(productType).join(' ').replace(/\s{2,}/g, ' ').trim();
  }
  seg3 = sanitizeTitleSegment3(seg3);
  if (!seg3 && parts.length >= 3) seg3 = '標準款';

  return enforceSkeletonTitleLength(seg1, seg2, seg3, maxLen);
}

/**
 * P2-83: clamp any free-form title (LLM enriched) down to official title_zh ≤60.
 * - With any supported pipe separator: skeleton-aware (prefer cut seg3, never cut seg1).
 * - Without separators: safe truncate — do not cut mid-word when possible; keep head.
 */
export function clampOfficialTitle(
  title: string | null | undefined,
  maxLen: number = OFFICIAL_TITLE_MAX_LENGTH,
): string {
  const raw = normalizeTitleSeparators(title ?? '');
  if (!raw) return '';

  const pipeSplit = splitTitlePipeSegments(raw);
  if (pipeSplit && pipeSplit.length >= 2) {
    const seg1 = pipeSplit[0];
    const seg2 = pipeSplit[1] ?? '';
    const seg3 = pipeSplit.slice(2).join(' | ');
    return enforceSkeletonTitleLength(seg1, seg2, seg3, maxLen);
  }

  if (textLen(raw) <= maxLen) return raw;

  // No pipe: try to keep a leading brand×IP-ish head before first multi-space or middle-dot run
  const headMatch = raw.match(/^(.+?(?:×.+?)?)(?:\s{2,}|\s+\/\s+)([\s\S]+)$/);
  if (headMatch) {
    return enforceSkeletonTitleLength(headMatch[1], headMatch[2], '', maxLen);
  }

  // Safe truncate: prefer cut at last space/、/・ before limit
  const chars = Array.from(raw);
  if (chars.length <= maxLen) return raw;
  const window = chars.slice(0, maxLen);
  const breakPoints = [' ', '、', '・', '，', ',', '/', '-', '－'];
  let cut = maxLen;
  for (let i = window.length - 1; i >= Math.floor(maxLen * 0.55); i -= 1) {
    if (breakPoints.includes(window[i])) {
      cut = i;
      break;
    }
  }
  // Avoid empty / tiny result
  if (cut < Math.floor(maxLen * 0.4)) cut = maxLen;
  return chars.slice(0, cut).join('').trim();
}

/** P2-80 + COPY C1.1: post-process LLM enriched title third segment and normalize all pipes. */
export function scrubEnrichedTitleSegment3(title: string | null | undefined): string {
  const raw = normalizeTitleSeparators(title ?? '');
  if (!raw) return '';

  const parts = splitTitlePipeSegments(raw);
  if (!parts || parts.length < 3) {
    // Flat/two-segment string: strip blacklist tokens only; pipe spelling is already normalized.
    return sanitizeTitleSegment3(raw) || raw;
  }

  const seg1 = parts[0].trim();
  const seg2 = parts[1].trim();
  let seg3 = parts.slice(2).join(' | ').trim();
  seg3 = sanitizeTitleSegment3(seg3);
  if (!seg3 || isTitleSegment3Blacklisted(seg3)) {
    seg3 = '標準款';
  }
  return [seg1, seg2, seg3].filter(Boolean).join(' | ');
}

export function generateDisplayTitle(draft: ListingDraftInput, context: DisplayLabelContext = {}): string | null {
  const ip = normalizeText(draft.ip);

  if (!ip) {
    return null;
  }

  const ipDisplayName = formatListingIpDisplayNameFromContext(ip, context);
  const characters = collectCharacterNames(draft, context, ipDisplayName);
  const coreName = buildCoreName(draft, context, ipDisplayName, characters);

  if (!coreName) {
    return null;
  }

  // 夜工包（回饋 27 老闆定案）：有聯名品牌 → 「品牌 × IP」；品牌優先於 IP，統一規則。
  const productBrand = normalizeText(draft.product_brand);
  const ipSegment = productBrand ? productBrand + ' × ' + ipDisplayName : ipDisplayName;

  if (draft.product_status === 'secondhand') {
    if (!draft.secondhand_grade) {
      return null;
    }

    return enforceTitleLength('【二手】' + ipSegment, coreName, draft.secondhand_grade);
  }

  return enforceTitleLength(ipSegment, coreName, getShortFeatureText(draft, characters.length > 1));
}
