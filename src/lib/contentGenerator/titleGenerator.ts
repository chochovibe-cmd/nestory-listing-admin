import { extractFeatureTerms } from './featureTerms';
import { ListingDraftInput } from './types';

const TITLE_MAX_LENGTH = 45;
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
  [/\u68c9\u82b1\u5a03\u5a03|\u68c9\u5a03/, '\u68c9\u82b1\u5a03\u5a03'],
  [/絨毛娃娃|毛絨娃娃|絨毛公仔|毛絨公仔|絨毛玩偶|毛絨玩偶|小娃娃|小玩偶|布偶|玩偶/, '絨毛娃娃'],
  [/包包掛件|包包吊飾|掛件|吊飾/, '吊飾'],
  [/鑰匙圈|鑰匙扣/, '鑰匙圈'],
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
    .replace(/亚克力/g, '壓克力')
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
  const normalized = stripPrefix(normalizeText(value), '類型_');

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

function buildCoreName(draft: ListingDraftInput): string {
  const characters = draft.characters.map(normalizeText).filter(Boolean).slice(0, 2);
  const productTypes = inferProductTypes(draft);
  const characterText = characters.join('');
  const typeText = productTypes.filter((type) => !characterText.includes(type)).join('');

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

function getStyleText(sourceText: string): string | null {
  if (/小畫家/.test(sourceText)) return '小畫家款';
  if (/睡衣/.test(sourceText)) return '睡衣款';
  return null;
}

function getShortFeatureText(draft: ListingDraftInput): string {
  const sourceText = [draft.product_name, draft.variant_feature, draft.intro].map(normalizeText).join(' ');
  const featureTerms = extractFeatureTerms(draft.image_description, getFeatureSourceText(draft));
  const sizeText = getSizeText(sourceText);

  if (featureTerms.length > 0) {
    return [...featureTerms, sizeText].filter(Boolean).join(' ');
  }

  const styleText = getStyleText(sourceText);

  if (styleText && sizeText) {
    return styleText + ' ' + sizeText;
  }

  if (styleText) {
    return styleText;
  }

  if (draft.variant_feature?.trim()) {
    return cleanTitleText(draft.variant_feature).split(/[、，,。；;]/)[0].slice(0, 12);
  }

  if (sizeText) {
    return sizeText + ' 小尺寸';
  }

  return '標準款';
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

export function generateDisplayTitle(draft: ListingDraftInput): string | null {
  const ip = normalizeText(draft.ip);
  const productName = normalizeText(draft.product_name);

  if (!ip || !productName) {
    return null;
  }

  const coreName = buildCoreName(draft);

  if (!coreName) {
    return null;
  }

  if (draft.product_status === 'secondhand') {
    if (!draft.secondhand_grade) {
      return null;
    }

    return enforceTitleLength('【二手】' + ip, coreName, draft.secondhand_grade);
  }

  return enforceTitleLength(ip, coreName, getShortFeatureText(draft));
}
