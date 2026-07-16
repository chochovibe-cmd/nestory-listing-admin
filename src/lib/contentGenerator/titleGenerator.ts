import { extractFeatureTerms } from './featureTerms';
import {
  DisplayLabelContext,
  formatCharacterShortNameFromContext,
  formatListingIpDisplayNameFromContext,
  isCharacterRedundantWithIpDisplay,
} from './displayLabels';
import { ListingDraftInput } from './types';
import { normalizeProductTypeForDisplay } from '../productTypeLabels';

// 夜工包（回饋 27，2026-07-18）：對齊老闆工具新版骨架——上限 45→80、
// 多角色「・」列法、品牌 × IP、特色判斷階梯。
const TITLE_MAX_LENGTH = 80;
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
];

const PRODUCT_TYPE_ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/棉花娃娃|棉娃|plush|ぬいぐるみ|絨毛娃娃|毛絨娃娃|絨毛公仔|毛絨公仔|絨毛玩偶|毛絨玩偶|小娃娃|小玩偶|布偶|玩偶|娃娃/, '絨毛娃娃'],
  [/包包掛件|包包吊飾|包包掛飾|手機掛飾|娃娃吊飾|掛件|吊飾|鑰匙圈|鑰匙扣|徽章|別針|keychain|charm|badge|pin/i, '吊飾掛件'],
  [/盲盒|盲袋/, '盲盒'],
  [/扭蛋/, '扭蛋'],
  [/娃娃抱枕|抱枕/, '娃娃抱枕'],
  [/亞克力立牌|壓克力立牌/, '壓克力立牌'],
  [/手機支架/, '手機支架'],
  [/公仔模型|公仔|手辦|模型/, '公仔模型'],
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
    if (formatted && !isCharacterRedundantWithIpDisplay(formatted, ipDisplayName)) {
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
        if (short && !isCharacterRedundantWithIpDisplay(short, ipDisplayName)) {
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

/** 老闆工具骨架：1 個直接放、2 個「・」連接、3 個以上取前三＋「等角色」。 */
export function formatCharacterText(characters: string[]): string {
  if (characters.length === 0) return '';
  if (characters.length === 1) return characters[0];
  if (characters.length === 2) return characters.join('・');
  return characters.slice(0, 3).join('・') + '等角色';
}

function buildCoreName(
  draft: ListingDraftInput,
  context: DisplayLabelContext,
  ipDisplayName: string,
  characters: string[],
): string {
  const productTypes = inferProductTypes(draft);
  const characterText = formatCharacterText(characters);
  const typeText = productTypes.filter((type) => !typeAlreadyPresentIn(type, characterText)).join('');

  if (characterText && typeText) {
    return characterText + ' ' + typeText;
  }
  if (characterText || typeText) {
    return characterText + typeText;
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

function getShortFeatureText(draft: ListingDraftInput, hasMultipleCharacters = false): string {
  const sourceText = [draft.product_name, draft.variant_feature, draft.variant_text, draft.intro]
    .map(normalizeText)
    .join(' ');
  const featureTerms = extractFeatureTerms(draft.image_description, getFeatureSourceText(draft));
  const sizeText = getSizeText(sourceText);

  // 階梯：尺寸 → 造型款 → 系列 → 功能 → 圖像特色詞 → 手填款式 → 款式可選 → 標準款
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
    return cleanTitleText(draft.variant_feature).split(/[、，,。；;]/)[0].slice(0, 12);
  }

  if (sizeText) return sizeText;

  if (hasMultipleCharacters) return '款式可選';

  return getSelectableText(sourceText) ?? '標準款';
}

function enforceTitleLength(ip: string, coreName: string, featureText: string): string {
  const title = ip + ' | ' + coreName + ' | ' + featureText;

  if (Array.from(title).length <= TITLE_MAX_LENGTH) {
    return title;
  }

  const compactTitle = ip + ' | ' + coreName.slice(0, 18) + ' | ' + featureText.slice(0, 14);

  if (Array.from(compactTitle).length <= TITLE_MAX_LENGTH) {
    return compactTitle;
  }

  return ip + ' | ' + coreName.slice(0, 14) + ' | ' + featureText.slice(0, 10);
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
