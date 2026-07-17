import { mapSaleStatusToNestoryTagValue } from './saleStatus';
import type {
  IpCatalogEntry,
  IpCharacter,
  ProductStatus,
  ProductVariant,
} from './contentGenerator/sourceTypes';
import { localizeToTaiwanTraditionalText } from './zhTwLocalizer';
import { CHARM_ACCESSORY_TAG_LABEL, normalizeProductTypeForTags } from './productTypeLabels';

export const NESTORY_TAG_PREFIX_ORDER = [
  '定位_',
  'IP_',
  '角色_',
  '類型_',
  '主題_',
  '銷售_',
  '品相_',
  '瑕疵_',
  '價格帶_',
  '營運_',
] as const;

type NestoryTagPrefix = (typeof NESTORY_TAG_PREFIX_ORDER)[number];

export type NestoryTagsV2Draft = {
  product_status: ProductStatus;
  ip: string | string[] | null | undefined;
  characters: string[] | null | undefined;
  product_types: string[] | null | undefined;
  use_cases: string[] | null | undefined;
  sale_status?: string | null;
  recommend_tags?: string[] | null;
  product_name?: string | null;
  variant_feature?: string | null;
  usage_scene?: string | null;
  intro?: string | null;
  notes?: string | null;
  price?: number | string | null;
  secondhand_grade?: string | null;
  secondhand_condition?: string | null;
  secondhand_notes?: string | null;
  variants?: ProductVariant[] | null;
};

export type NestoryTagsV2Options = {
  ipCatalog?: Pick<IpCatalogEntry, 'ip_name' | 'aliases'>[];
  ipCharacters?: Pick<IpCharacter, 'ip_name' | 'character_name' | 'aliases'>[];
};

export type NestoryTagsV2BuildResult = {
  tags: string[];
  missing: string[];
  warnings: string[];
};

const ALLOWED_PREFIXES = new Set<NestoryTagPrefix>(NESTORY_TAG_PREFIX_ORDER);
const INVALID_PLACEHOLDER_VALUES = new Set(['待補', '未命名商品草稿']);
const MAX_SHOPIFY_TAGS = 250;

export const NESTORY_TAGS_V2_PRODUCT_TYPE_LABELS = [
  '公仔模型',
  '景品',
  'PVC',
  '一番賞大賞',
  '一番賞小賞',
  '盲盒',
  '扭蛋',
  '黏土人',
  '娃娃抱枕',
  '吊飾掛件',
  '壓克力立牌',
  '可動模型',
  '盒玩',
  '食玩',
  '模型套組',
  '桌面擺件',
  '展示收納',
  '複製畫海報',
  '掛畫裝飾',
  '燈具小物',
  '杯具餐具',
  '毛巾毯子',
  '生活雜貨',
  '手機殼',
  '手機支架',
  '藍牙耳機',
  '藍牙音響',
  '滑鼠墊',
  '鍵帽',
  '充電周邊',
  '服飾',
  '包包',
  '帽子',
  '襪子',
  '飾品配件',
  '文具',
  '貼紙',
  '筆記本',
  '卡片票卡',
  '印章',
  '立牌',
  '絨毛娃娃',
] as const;

const FIXED_PRODUCT_TYPES = new Set<string>([...NESTORY_TAGS_V2_PRODUCT_TYPE_LABELS, CHARM_ACCESSORY_TAG_LABEL]);

export const NESTORY_TAGS_V2_THEME_LABELS = [
  '可愛療癒',
  '桌面佈置',
  '房間佈置',
  '手機電腦',
  '展示收納',
  '服飾配件',
  '送禮推薦',
  '順手加購',
  '文具小物',
  '收藏入門',
  '收藏展示',
  '居家日用',
  '外出小物',
  '居家療癒',
] as const;

const FIXED_THEMES = new Set<string>(NESTORY_TAGS_V2_THEME_LABELS);

export const NESTORY_TAGS_V2_OPERATION_LABELS = [
  '新品上架',
  '人氣熱銷',
  '限量收藏',
  'CP爆擊',
  '活動主打',
  '清倉優惠',
] as const;

const OPERATION_TAGS = new Map([
  ['新品上架', '新品上架'],
  ['人氣熱銷', '人氣熱銷'],
  ['限量收藏', '限量收藏'],
  ['CP爆擊', 'CP爆擊'],
  ['活動主打', '活動主打'],
  ['清倉優惠', '清倉優惠'],
  ['編輯精選', '新品上架'],
]);

const PRODUCT_TYPE_CANONICALS = new Map([
  ['亞克力立牌', '壓克力立牌'],
  ['壓克力立牌', '壓克力立牌'],
  ['壓克力', '壓克力立牌'],
  ['立牌', '立牌'],
  ['手辦', '公仔模型'],
  ['公仔', '公仔模型'],
  ['公仔模型', '公仔模型'],
  ['模型', '公仔模型'],
  ['模型套組', '模型套組'],
  ['吊飾掛件', CHARM_ACCESSORY_TAG_LABEL],
  ['吊飾徽章', CHARM_ACCESSORY_TAG_LABEL],
  ['吊飾', CHARM_ACCESSORY_TAG_LABEL],
  ['掛件', CHARM_ACCESSORY_TAG_LABEL],
  ['鑰匙扣', CHARM_ACCESSORY_TAG_LABEL],
  ['鑰匙圈', CHARM_ACCESSORY_TAG_LABEL],
  ['徽章', CHARM_ACCESSORY_TAG_LABEL],
  ['別針', CHARM_ACCESSORY_TAG_LABEL],
  ['包包掛飾', CHARM_ACCESSORY_TAG_LABEL],
  ['包包掛件', CHARM_ACCESSORY_TAG_LABEL],
  ['包包吊飾', CHARM_ACCESSORY_TAG_LABEL],
  ['手機掛飾', CHARM_ACCESSORY_TAG_LABEL],
  ['娃娃吊飾', CHARM_ACCESSORY_TAG_LABEL],
  ['keychain', CHARM_ACCESSORY_TAG_LABEL],
  ['charm', CHARM_ACCESSORY_TAG_LABEL],
  ['badge', CHARM_ACCESSORY_TAG_LABEL],
  ['pin', CHARM_ACCESSORY_TAG_LABEL],
  ['娃娃抱枕', '娃娃抱枕'],
  ['小娃娃', '絨毛娃娃'],
  ['毛絨公仔', '絨毛娃娃'],
  ['絨毛公仔', '絨毛娃娃'],
  ['毛絨玩偶', '絨毛娃娃'],
  ['絨毛玩偶', '絨毛娃娃'],
  ['小玩偶', '絨毛娃娃'],
  ['布偶', '絨毛娃娃'],
  ['玩偶', '絨毛娃娃'],
  ['絨毛娃娃', '絨毛娃娃'],
  ['\u68c9\u82b1\u5a03\u5a03', '絨毛娃娃'],
  ['\u68c9\u5a03', '絨毛娃娃'],
  ['plush', '絨毛娃娃'],
  ['ぬいぐるみ', '絨毛娃娃'],
  ['毛絨', '娃娃抱枕'],
  ['絨毛', '娃娃抱枕'],
  ['抱枕', '娃娃抱枕'],
  ['景品', '景品'],
  ['PVC', 'PVC'],
  ['一番賞大賞', '一番賞大賞'],
  ['一番賞小賞', '一番賞小賞'],
  ['盲盒', '盲盒'],
  ['盲袋', '盲盒'],
  ['扭蛋', '扭蛋'],
  ['黏土人', '黏土人'],
  ['盒玩', '盒玩'],
  ['食玩', '食玩'],
  ['可動模型', '可動模型'],
  ['桌面擺件', '桌面擺件'],
  ['擺件', '桌面擺件'],
  ['展示收納', '展示收納'],
  ['收納', '展示收納'],
  ['複製畫海報', '複製畫海報'],
  ['海報', '複製畫海報'],
  ['掛畫裝飾', '掛畫裝飾'],
  ['掛畫', '掛畫裝飾'],
  ['燈具小物', '燈具小物'],
  ['燈具', '燈具小物'],
  // P1 C1：臺燈系別名對齊燈具小物（回饋：生成寫「臺燈」會被 V2 擋）
  ['臺燈', '燈具小物'],
  ['台燈', '燈具小物'],
  ['檯燈', '燈具小物'],
  ['桌燈', '燈具小物'],
  ['夜燈', '燈具小物'],
  ['杯具餐具', '杯具餐具'],
  ['杯具', '杯具餐具'],
  ['餐具', '杯具餐具'],
  ['毛巾毯子', '毛巾毯子'],
  ['毛巾', '毛巾毯子'],
  ['毯子', '毛巾毯子'],
  ['生活雜貨', '生活雜貨'],
  ['手機殼', '手機殼'],
  ['手機支架', '手機支架'],
  ['藍牙耳機', '藍牙耳機'],
  ['藍牙音響', '藍牙音響'],
  ['滑鼠墊', '滑鼠墊'],
  ['鍵帽', '鍵帽'],
  ['充電周邊', '充電周邊'],
  ['服飾', '服飾'],
  ['服飾配件', '飾品配件'],
  ['包包', '包包'],
  ['帽子', '帽子'],
  ['襪子', '襪子'],
  ['飾品配件', '飾品配件'],
  ['文具小物', '文具'],
  ['文具', '文具'],
  ['貼紙', '貼紙'],
  ['筆記本', '筆記本'],
  ['卡片票卡', '卡片票卡'],
  ['卡片', '卡片票卡'],
  ['印章', '印章'],
]);

const THEME_CANONICALS = new Map([
  ['可愛療癒', '可愛療癒'],
  ['桌面佈置', '桌面佈置'],
  ['房間佈置', '房間佈置'],
  ['手機電腦', '手機電腦'],
  ['展示收納', '展示收納'],
  ['服飾配件', '服飾配件'],
  ['送禮推薦', '送禮推薦'],
  ['送禮首選', '送禮推薦'],
  ['順手加購', '順手加購'],
  ['文具小物', '文具小物'],
  ['收藏入門', '收藏入門'],
  ['收藏展示', '收藏展示'],
  ['居家日用', '居家日用'],
  ['生活雜貨', '居家日用'],
  ['外出小物', '外出小物'],
  ['包包掛件', '外出小物'],
  ['包包吊飾', '外出小物'],
  ['掛件', '外出小物'],
  ['鑰匙圈', '外出小物'],
  ['吊飾', '外出小物'],
  ['隨身小物', '外出小物'],
  ['外出系', '外出小物'],
  ['居家療癒', '居家療癒'],
  ['大娃娃', '居家療癒'],
  ['抱枕', '居家療癒'],
  ['居家系', '居家療癒'],
  ['床邊', '居家療癒'],
  ['沙發', '居家療癒'],
  ['房間', '居家療癒'],
]);

function compact(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function normalizeText(value: string | null | undefined): string {
  return localizeToTaiwanTraditionalText(compact(value)).normalize('NFKC').trim();
}

function normalizeLookup(value: string): string {
  return normalizeText(value).toLocaleLowerCase().replace(/\s+/g, ' ');
}

function stripTagPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length).trim() : value;
}

function addUnique(values: string[], value: string, limit = Number.POSITIVE_INFINITY) {
  const nextValue = normalizeText(value);

  if (!nextValue || values.includes(nextValue) || values.length >= limit) {
    return;
  }

  values.push(nextValue);
}

function splitLabelValues(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map(normalizeText).filter(Boolean);
  }

  const normalized = normalizeText(value ?? '');

  if (!normalized || INVALID_PLACEHOLDER_VALUES.has(normalized)) {
    return [];
  }

  return normalized.split(/[、,，/|+]+/).map(normalizeText).filter(Boolean);
}

function getTagPrefix(tag: string): NestoryTagPrefix | null {
  return NESTORY_TAG_PREFIX_ORDER.find((prefix) => tag.startsWith(prefix)) ?? null;
}

function isAllowedTag(tag: string): boolean {
  const prefix = getTagPrefix(tag);
  return prefix !== null && ALLOWED_PREFIXES.has(prefix);
}

function addTag(tags: string[], prefix: NestoryTagPrefix, value: string) {
  const canonicalValue = normalizeText(value);

  if (!canonicalValue) {
    return;
  }

  const tag = prefix + canonicalValue;

  if (isAllowedTag(tag) && !tags.includes(tag)) {
    tags.push(tag);
  }
}

function canonicalizeIpName(
  value: string,
  catalog: NestoryTagsV2Options['ipCatalog'],
): string | null {
  const normalized = normalizeLookup(value);

  if (!normalized || INVALID_PLACEHOLDER_VALUES.has(normalizeText(value))) {
    return null;
  }

  if (catalog && catalog.length > 0) {
    const matched = catalog.find((entry) => {
      const terms = [entry.ip_name, ...(entry.aliases ?? [])];
      return terms.some((term) => normalizeLookup(term) === normalized);
    });

    return matched ? normalizeText(matched.ip_name) : null;
  }

  if (['sanrio', '三丽鸥', '三麗鷗'].includes(normalized)) {
    return '三麗鷗';
  }

  if (['the monsters', 'themonsters'].includes(normalized)) {
    return 'THE MONSTERS';
  }

  if (normalized === 'crybaby') {
    return 'CRYBABY';
  }

  return normalizeText(value);
}

function canonicalizeCharacterName(
  value: string,
  characters: NestoryTagsV2Options['ipCharacters'],
): string | null {
  const normalized = normalizeLookup(value);

  if (!normalized) {
    return null;
  }

  if (!characters || characters.length === 0) {
    return null;
  }

  const matched = characters.find((character) => {
    const terms = [character.character_name, ...(character.aliases ?? [])];
    return terms.some((term) => normalizeLookup(term) === normalized);
  });

  return matched ? normalizeText(matched.character_name) : null;
}

function canonicalizeProductType(value: string): string | null {
  const normalized = normalizeProductTypeForTags(stripTagPrefix(normalizeText(value), '類型_'));

  const direct = PRODUCT_TYPE_CANONICALS.get(normalized);

  if (direct && FIXED_PRODUCT_TYPES.has(direct)) {
    return direct;
  }

  const matched = Array.from(PRODUCT_TYPE_CANONICALS.entries())
    .sort(([left], [right]) => right.length - left.length)
    .find(([keyword, canonical]) => normalized.includes(keyword) && FIXED_PRODUCT_TYPES.has(canonical));

  return matched ? matched[1] : null;
}

function canonicalizeTheme(value: string): string | null {
  const normalized = stripTagPrefix(normalizeText(value), '主題_');

  if (FIXED_THEMES.has(normalized)) {
    return normalized;
  }

  const direct = THEME_CANONICALS.get(normalized);

  if (direct && FIXED_THEMES.has(direct)) {
    return direct;
  }

  return null;
}

function mapSaleStatusTag(draft: NestoryTagsV2Draft): string | null {
  const saleStatus = normalizeText(draft.sale_status);

  if (!saleStatus || INVALID_PLACEHOLDER_VALUES.has(saleStatus)) {
    return null;
  }

  // Bug fix (2026-07-02): don't pass the already-OpenCC-normalized `saleStatus`
  // here. This module's normalizeText() runs localizeToTaiwanTraditionalText(),
  // which converts 台 -> 臺 (e.g. "台灣現貨" -> "臺灣現貨"). saleStatus.ts's own
  // normalizeSaleStatusLabel() does an exact match against "台灣現貨" (the
  // common character), so the OpenCC-converted string never matches and the
  // 銷售_ tag silently comes back missing. mapSaleStatusToNestoryTagValue()
  // already does its own (non-OpenCC) normalization internally, so pass the
  // raw value through instead.
  return mapSaleStatusToNestoryTagValue(draft.sale_status, draft.product_status);
}

function getNumericAmount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function getDraftSearchText(draft: NestoryTagsV2Draft): string {
  return [
    draft.product_name,
    draft.variant_feature,
    draft.usage_scene,
    draft.intro,
    draft.notes,
  ].map(normalizeText).join(' ');
}

function inferProductTypesFromText(draft: NestoryTagsV2Draft): string[] {
  const text = getDraftSearchText(draft);
  const productTypes: string[] = [];

  if (/棉花娃娃|棉娃|plush|ぬいぐるみ|小娃娃|毛絨公仔|絨毛公仔|毛絨玩偶|絨毛玩偶|小玩偶|布偶|玩偶|娃娃/.test(text)) {
    addUnique(productTypes, '絨毛娃娃', 3);
  }

  if (/包包掛件|包包吊飾|包包掛飾|手機掛飾|娃娃吊飾|掛件|吊飾|鑰匙圈|鑰匙扣|徽章|別針|keychain|charm|badge|pin/i.test(text)) {
    addUnique(productTypes, CHARM_ACCESSORY_TAG_LABEL, 3);
  }

  if (/盲盒|盲袋/.test(text)) {
    addUnique(productTypes, '盲盒', 3);
  }

  if (/扭蛋/.test(text)) {
    addUnique(productTypes, '扭蛋', 3);
  }

  if (/抱枕|大娃娃/.test(text)) {
    addUnique(productTypes, '娃娃抱枕', 3);
  }

  return productTypes;
}

function inferThemesFromText(draft: NestoryTagsV2Draft): string[] {
  const text = getDraftSearchText(draft);
  const themes: string[] = [];

  if (/包包掛件|包包吊飾|掛件|鑰匙圈|吊飾|隨身小物|外出系/.test(text)) {
    addUnique(themes, '外出小物', 3);
  }

  if (/大娃娃|抱枕|居家系|床邊|沙發|房間/.test(text)) {
    addUnique(themes, '居家療癒', 3);
  }

  if (/禮物|生日|送禮/.test(text)) {
    addUnique(themes, '送禮推薦', 3);
  }

  return themes;
}

function getEffectivePrice(draft: NestoryTagsV2Draft): number | null {
  const variantPrices = (draft.variants ?? [])
    .map((variant) => getNumericAmount(variant.price))
    .filter((value): value is number => value !== null);

  if (variantPrices.length > 0) {
    return Math.min(...variantPrices);
  }

  return getNumericAmount(draft.price);
}

export function getPriceBandTag(price: number): string {
  if (price >= 1 && price <= 299) return '價格帶_百元小物';
  if (price >= 300 && price <= 699) return '價格帶_小資收藏';
  if (price >= 700 && price <= 1499) return '價格帶_標準收藏';
  if (price >= 1500 && price <= 2999) return '價格帶_高單收藏';
  if (price >= 3000) return '價格帶_重點收藏';

  return '';
}

function addThemeByType(themes: string[], productType: string, price: number | null) {
  if (productType === '絨毛娃娃') {
    addUnique(themes, '可愛療癒', 3);
  }

  if (productType === '娃娃抱枕') {
    addUnique(themes, '居家療癒', 3);
    addUnique(themes, '房間佈置', 3);
  }

  if (
    [
      '壓克力立牌',
      '立牌',
      '桌面擺件',
      '滑鼠墊',
      '鍵帽',
    ].includes(productType)
  ) {
    addUnique(themes, '桌面佈置', 3);
  }

  if (
    [
      '公仔模型',
      '景品',
      'PVC',
      '一番賞大賞',
      '一番賞小賞',
      '黏土人',
      '可動模型',
      '盒玩',
      '食玩',
      '模型套組',
      '壓克力立牌',
      '立牌',
    ].includes(productType)
  ) {
    addUnique(themes, '收藏展示', 3);
  }

  if (
    [
      '公仔模型',
      'PVC',
      '景品',
      '娃娃抱枕',
      '複製畫海報',
      '掛畫裝飾',
      '毛巾毯子',
      '燈具小物',
    ].includes(productType)
  ) {
    addUnique(themes, '房間佈置', 3);
  }

  if (
    [
      '手機殼',
      '手機支架',
      '藍牙耳機',
      '藍牙音響',
      '鍵帽',
      '滑鼠墊',
      '充電周邊',
    ].includes(productType)
  ) {
    addUnique(themes, '手機電腦', 3);
  }

  if (productType === '展示收納') {
    addUnique(themes, '展示收納', 3);
  }

  if (['服飾', '包包', '帽子', '襪子', '飾品配件'].includes(productType)) {
    addUnique(themes, '服飾配件', 3);
  }

  if (['文具', '貼紙', '筆記本', '卡片票卡', '印章'].includes(productType)) {
    addUnique(themes, '文具小物', 3);
  }

  if (['杯具餐具', '毛巾毯子', '生活雜貨'].includes(productType)) {
    addUnique(themes, '居家日用', 3);
  }

  if (
    price !== null &&
    price <= 699 &&
    [
      '手機支架',
      '手機殼',
      CHARM_ACCESSORY_TAG_LABEL,
      '貼紙',
      '文具',
      '卡片票卡',
    ].includes(productType)
  ) {
    addUnique(themes, '送禮推薦', 3);
  }

  if (
    price !== null &&
    price <= 299 &&
    [
      '手機支架',
      CHARM_ACCESSORY_TAG_LABEL,
      '貼紙',
      '文具',
      '卡片票卡',
      '印章',
    ].includes(productType)
  ) {
    addUnique(themes, '順手加購', 3);
  }
}

function mapSecondhandConditionTag(draft: NestoryTagsV2Draft): string {
  const text = [
    draft.secondhand_grade,
    draft.secondhand_condition,
    draft.secondhand_notes,
  ].map(normalizeText).join(' ');

  if (/全新未拆|未拆|全新/.test(text)) return '全新未拆';
  if (/近全新|極新|九成新|S級|SS級/.test(text)) return '近全新';
  if (/良好|正常|A級|B級/.test(text)) return '良好';
  if (/可接受|使用痕跡|C級/.test(text)) return '可接受';
  if (/瑕疵|嚴重|D級/.test(text)) return '瑕疵品';
  if (/未檢查|未測/.test(text)) return '未檢查';

  return '未檢查';
}

function mapDefectTags(draft: NestoryTagsV2Draft): string[] {
  const text = [draft.secondhand_condition, draft.secondhand_notes].map(normalizeText).join(' ');
  const defects: string[] = [];

  if (/盒損|盒傷|盒況/.test(text)) defects.push('盒損');
  if (/缺件|缺少|缺配件/.test(text)) defects.push('缺件');
  if (/掉漆/.test(text)) defects.push('掉漆');
  if (/色移/.test(text)) defects.push('色移');
  if (/刮傷|刮痕/.test(text)) defects.push('刮傷');
  if (/泛黃|黃化/.test(text)) defects.push('泛黃');
  if (/污漬|髒污/.test(text)) defects.push('污漬');
  if (/異味|味道/.test(text)) defects.push('異味');
  if (/功能未測|未測|未檢查/.test(text)) defects.push('功能未測');

  return defects;
}

function hasRandomText(draft: NestoryTagsV2Draft): boolean {
  const text = [
    draft.product_name,
    draft.variant_feature,
    draft.usage_scene,
    draft.intro,
    draft.notes,
  ].map(normalizeText).join(' ');

  return /隨機|盲盒|盲袋/.test(text);
}

export function dedupeNestoryTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const tag of tags.map(normalizeText).filter(Boolean)) {
    if (!isAllowedTag(tag) || seen.has(tag)) {
      continue;
    }

    seen.add(tag);
    deduped.push(tag);
  }

  return deduped.slice(0, MAX_SHOPIFY_TAGS);
}

export function sortNestoryTags(tags: string[]): string[] {
  return dedupeNestoryTags(tags).sort((left, right) => {
    const leftPrefix = getTagPrefix(left);
    const rightPrefix = getTagPrefix(right);
    const leftIndex = leftPrefix ? NESTORY_TAG_PREFIX_ORDER.indexOf(leftPrefix) : Number.MAX_SAFE_INTEGER;
    const rightIndex = rightPrefix ? NESTORY_TAG_PREFIX_ORDER.indexOf(rightPrefix) : Number.MAX_SAFE_INTEGER;

    return leftIndex - rightIndex;
  });
}

export function buildNestoryTagsV2Result(
  draft: NestoryTagsV2Draft,
  options: NestoryTagsV2Options = {},
): NestoryTagsV2BuildResult {
  const tags: string[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];
  const productTypes: string[] = [];
  const themes: string[] = [];
  const price = getEffectivePrice(draft);

  addTag(tags, '定位_', 'IP周邊');
  addTag(tags, '定位_', '收藏選物');

  if (draft.product_status === 'secondhand') {
    addTag(tags, '定位_', '二手挖寶');
  } else {
    addTag(tags, '定位_', '正版授權');
  }

  for (const rawIp of splitLabelValues(draft.ip)) {
    const canonicalIp = canonicalizeIpName(rawIp, options.ipCatalog);

    if (canonicalIp) {
      addTag(tags, 'IP_', canonicalIp);
    } else {
      warnings.push('IP「' + rawIp + '」不在 V2 IP 字典中，未輸出 IP_ tag。');
    }
  }

  if (!tags.some((tag) => tag.startsWith('IP_'))) {
    missing.push('缺少 IP_ tag，請先套用或選擇 IP。');
  }

  const rawCharacters = [
    ...(draft.characters ?? []),
    ...(draft.variants ?? []).flatMap((variant) => [
      variant.character_name ?? '',
      variant.option1_value,
      variant.option2_value,
    ]),
  ].map(normalizeText).filter(Boolean);
  const canonicalCharacters: string[] = [];

  for (const rawCharacter of rawCharacters) {
    const canonicalCharacter = canonicalizeCharacterName(rawCharacter, options.ipCharacters);

    if (canonicalCharacter) {
      addUnique(canonicalCharacters, canonicalCharacter);
    } else if (!['', '不指定'].includes(rawCharacter)) {
      warnings.push('角色「' + rawCharacter + '」尚未建立 V2 字典 canonical name，未輸出角色_ tag。');
    }
  }

  if (canonicalCharacters.length > 12) {
    addTag(tags, '角色_', '集合款');
  } else {
    for (const character of canonicalCharacters) {
      addTag(tags, '角色_', character);
    }
  }

  if (hasRandomText(draft)) {
    addTag(tags, '角色_', '隨機款');
  }

  for (const rawType of draft.product_types ?? []) {
    const canonicalType = canonicalizeProductType(rawType);

    if (canonicalType) {
      addUnique(productTypes, canonicalType, 3);
    } else if (compact(rawType)) {
      warnings.push('商品類型「' + rawType + '」不在 Tags V2 固定類型中，未輸出 類型_ tag。');
    }
  }

  for (const inferredType of inferProductTypesFromText(draft)) {
    addUnique(productTypes, inferredType, 3);
  }

  for (const productType of productTypes) {
    addTag(tags, '類型_', productType);
  }

  if (productTypes.length === 0) {
    missing.push('缺少 類型_ tag，請選擇商品類型。');
  }

  for (const rawUseCase of draft.use_cases ?? []) {
    const canonicalTheme = canonicalizeTheme(rawUseCase);

    if (canonicalTheme) {
      addUnique(themes, canonicalTheme, 3);
    }
  }

  for (const productType of productTypes) {
    addThemeByType(themes, productType, price);
  }

  for (const inferredTheme of inferThemesFromText(draft)) {
    addUnique(themes, inferredTheme, 3);
  }

  for (const theme of themes) {
    addTag(tags, '主題_', theme);
  }

  const saleTag = mapSaleStatusTag(draft);

  if (saleTag) {
    addTag(tags, '銷售_', saleTag);
  } else {
    missing.push('缺少 銷售_ tag，請選擇銷售狀態。');
  }

  if (draft.product_status === 'secondhand') {
    addTag(tags, '品相_', mapSecondhandConditionTag(draft));

    for (const defectTag of mapDefectTags(draft)) {
      addTag(tags, '瑕疵_', defectTag);
    }
  }

  const priceBandTag = price === null ? '' : getPriceBandTag(price);

  if (priceBandTag) {
    tags.push(priceBandTag);
  } else {
    missing.push('缺少有效售價，無法產生 價格帶_ tag。');
  }

  for (const rawRecommendTag of draft.recommend_tags ?? []) {
    const operationTag = OPERATION_TAGS.get(normalizeText(rawRecommendTag));

    if (operationTag) {
      addTag(tags, '營運_', operationTag);
    }
  }

  return {
    tags: sortNestoryTags(tags),
    missing: Array.from(new Set(missing)),
    warnings: Array.from(new Set(warnings)),
  };
}

export function buildNestoryTagsV2(
  draft: NestoryTagsV2Draft,
  options: NestoryTagsV2Options = {},
): string[] {
  return buildNestoryTagsV2Result(draft, options).tags;
}

export function formatShopifyTags(tags: string[]): string {
  return sortNestoryTags(tags).join(', ');
}
