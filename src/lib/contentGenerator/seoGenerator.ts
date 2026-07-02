import { extractFeatureTerms } from './featureTerms';
import {
  DisplayLabelContext,
  formatCharacterDisplayNameFromContext,
  formatCharacterShortNameFromContext,
  formatListingIpDisplayNameFromContext,
  isCharacterRedundantWithIpDisplay,
  removeDuplicateDisplayTerms,
} from './displayLabels';
import { ListingDraftInput } from './types';
import type { IpCatalogEntry, IpCharacter } from './sourceTypes';
import { normalizeProductTypeForDisplay } from '../productTypeLabels';

const SEO_TITLE_MAX_LENGTH = 60;
const META_DESCRIPTION_MAX_LENGTH = 60;
const FORBIDDEN_META_TERMS = [
  '現貨',
  '約14天',
  '約 14 天',
  '到貨',
  '出貨',
  '物流',
  '缺貨',
  '預購時間',
  '清關',
  '海外採購時間',
  '下單後',
  '供應端',
];

type SeoContentOptions = DisplayLabelContext & {
  ipCatalog?: Pick<IpCatalogEntry, 'aliases' | 'ip_name'>[];
  ipCharacters?: Pick<IpCharacter, 'aliases' | 'character_name' | 'ip_name'>[];
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/三丽鸥/g, '三麗鷗')
    .replace(/毛绒/g, '毛絨')
    .replace(/挂件/g, '掛件')
    .replace(/钥匙扣/g, '鑰匙圈')
    .replace(/亚克力/g, '壓克力')
    .replace(/主題_|類型_|角色_|IP_/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(values: Array<string | null | undefined>): string[] {
  return values.map(normalizeText).filter(Boolean);
}

function textLength(value: string): number {
  return Array.from(value).length;
}

function firstLabel(values: string[]): string {
  return normalizeText(values[0]);
}

function getProductTypeText(draft: ListingDraftInput): string {
  const productTypes: string[] = [];

  for (const rawType of draft.product_types) {
    const type = normalizeProductTypeForDisplay(normalizeText(rawType));

    if (!type || productTypes.includes(type)) {
      continue;
    }

    if (productTypes.some((currentType) => currentType.includes(type))) {
      continue;
    }

    productTypes.push(type);

    if (productTypes.length >= 2) {
      break;
    }
  }

  return productTypes.join('') || '周邊';
}

function getPrimaryCharacter(draft: ListingDraftInput): string {
  return firstLabel(draft.characters);
}

function getHighValueCharacterAlias(
  character: string,
  ip: string,
  ipCharacters: SeoContentOptions['ipCharacters'] = [],
): string {
  const normalizedCharacter = normalizeText(character).toLocaleLowerCase();
  const normalizedIp = normalizeText(ip).toLocaleLowerCase();
  const matchedCharacter = ipCharacters.find((entry) => {
    const entryName = normalizeText(entry.character_name).toLocaleLowerCase();
    const entryIp = normalizeText(entry.ip_name).toLocaleLowerCase();

    return entryName === normalizedCharacter && (!normalizedIp || entryIp === normalizedIp);
  });

  if (!matchedCharacter) {
    return '';
  }

  return matchedCharacter.aliases
    .map(normalizeText)
    .find((alias) => /[A-Za-z]/.test(alias) && alias.toLocaleLowerCase() !== normalizedCharacter) ?? '';
}

function getFeatureSourceText(draft: ListingDraftInput): string {
  return compact([draft.variant_feature, draft.intro, draft.product_name]).join(' ');
}

function getFeatureKeyword(draft: ListingDraftInput): string {
  const sourceText = compact([draft.variant_feature, draft.product_name, draft.intro, draft.notes]).join(' ');
  const variantFeature = normalizeText(draft.variant_feature);

  if (/小畫家/.test(sourceText)) return '小畫家';
  if (/睡衣/.test(sourceText)) return '睡衣款';
  if (/生日/.test(sourceText)) return '';
  if (variantFeature) {
    return variantFeature
      .split(/[、，,。；;]/)[0]
      .replace(/\d+(?:\.\d+)?\s*(cm|CM|公分|厘米|吋|寸)/g, '')
      .replace(/款$/g, '款')
      .trim()
      .slice(0, 8);
  }

  return '';
}

function buildSeoTitle(parts: {
  alias: string;
  character: string;
  featureTerms: string[];
  ip: string;
  productType: string;
}): string {
  const build = (featureTerms: string[], alias: string) =>
    removeDuplicateDisplayTerms(compact([
      parts.ip,
      parts.character,
      ...featureTerms,
      parts.productType,
      alias,
      '\u6b63\u7248\u5468\u908a',
    ])).join(' ') + ' | \u6f6e\u5de2 Nestory';

  const featureTerms = parts.featureTerms.slice(0, 2);
  const candidates = [
    build(featureTerms, parts.alias),
    build(featureTerms.slice(0, 1), parts.alias),
    build(featureTerms.slice(0, 1), ''),
    build([], ''),
  ];

  return candidates.find((candidate) => textLength(candidate) <= SEO_TITLE_MAX_LENGTH) ?? candidates[candidates.length - 1];
}

function getMetaHighlight(feature: string): string {
  if (/小畫家/.test(feature)) {
    return '小畫家造型辨識度高';
  }

  if (feature) {
    return feature + '讓收藏更有主題感';
  }

  return '角色造型清楚，適合系列收藏';
}

function getMetaContext(ip: string, character: string): string {
  if (ip) return '適合收藏或送給' + ip + '粉絲';
  if (character) return '適合角色粉絲收藏';
  return '適合收藏玩家入手';
}

function sanitizeMetaDescription(value: string): string {
  let sanitized = value;

  for (const term of FORBIDDEN_META_TERMS) {
    sanitized = sanitized.split(term).join('');
  }

  return sanitized
    .replace(/，+/g, '，')
    .replace(/。+/g, '。')
    .replace(/\s+/g, '')
    .trim();
}

function fitMetaDescription(value: string): string {
  const sanitized = sanitizeMetaDescription(value);
  const chars = Array.from(sanitized);

  if (chars.length <= META_DESCRIPTION_MAX_LENGTH) {
    return sanitized.endsWith('。') ? sanitized : sanitized + '。';
  }

  return chars.slice(0, META_DESCRIPTION_MAX_LENGTH - 1).join('').replace(/[，、；]$/g, '') + '。';
}

function buildMetaDescription(ip: string, character: string, productType: string, feature: string): string {
  const subject = removeDuplicateDisplayTerms(compact([ip, character, productType])).join(' ');

  return fitMetaDescription(
    '\u6f6e\u5de2 Nestory \u7cbe\u9078' +
      subject +
      '\uff0c' +
      getMetaHighlight(feature) +
      '\uff0c' +
      getMetaContext(ip, character) +
      '\u3002',
  );
}

export function generateSeoContent(
  draft: ListingDraftInput,
  options: SeoContentOptions = {},
): {
  meta_description: string;
  seo_title: string;
} {
  const ip = normalizeText(draft.ip);
  const ipDisplayName = formatListingIpDisplayNameFromContext(ip, options);
  const primaryCharacter = getPrimaryCharacter(draft);
  const characterDisplayName = formatCharacterDisplayNameFromContext(primaryCharacter, ip, options);
  const characterShortName = formatCharacterShortNameFromContext(primaryCharacter, ip, options);
  const character = isCharacterRedundantWithIpDisplay(characterShortName, ipDisplayName) ? '' : characterDisplayName;
  const productType = getProductTypeText(draft);
  const feature = getFeatureKeyword(draft);
  const featureTerms = extractFeatureTerms(draft.image_description, getFeatureSourceText(draft));
  const alias = getHighValueCharacterAlias(primaryCharacter, ip, options.ipCharacters);

  return {
    seo_title: buildSeoTitle({
      alias,
      character,
      featureTerms: featureTerms.length > 0 ? featureTerms : compact([feature]),
      ip: ipDisplayName,
      productType,
    }),
    meta_description: buildMetaDescription(ipDisplayName, character, productType, feature),
  };
}
