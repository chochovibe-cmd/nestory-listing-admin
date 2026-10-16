import OpenCC from 'opencc-js';
import type { GeneratedListingContent } from './contentGenerator/types';
import type { ProductDraftPayload, ProductVariant } from './contentGenerator/sourceTypes';

const convertSimplifiedToTraditional = OpenCC.Converter({ from: 'cn', to: 'tw' });

// Apply these after OpenCC so Mainland terms that share traditional characters use Taiwan wording.
const TAIWAN_TERM_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ['客服諮詢', '客服諮詢'],
  ['正版授權', '正版授權'],
  ['公仔模型', '公仔模型'],
  ['影片', '影片'],
  ['視頻', '影片'],
  ['連結', '連結'],
  ['鏈接', '連結'],
  ['品質', '品質'],
  ['質量', '品質'],
  ['售後', '售後'],
  ['客服咨询', '客服諮詢'],
  ['諮詢', '諮詢'],
  ['咨询', '諮詢'],
  ['支援', '支援'],
  ['支持', '支援'],
  ['預設', '預設'],
  ['默認', '預設'],
  ['顏色', '顏色'],
  ['型號', '型號'],
  ['參數', '規格'],
  ['發貨', '出貨'],
  ['快遞', '物流'],
  ['包郵', '免運'],
  ['現貨', '現貨'],
  ['預售', '預購'],
  ['購買', '購買'],
  ['訂單', '訂單'],
  ['庫存', '庫存'],
  ['隨機', '隨機'],
  ['單盒', '單盒'],
  ['整盒', '整盒'],
  ['盲袋', '盲袋'],
  ['掛件', '吊飾'],
  ['鑰匙扣', '鑰匙圈'],
  ['亞克力', '壓克力'],
  ['立牌', '立牌'],
  ['手辦', '公仔'],
  ['毛絨', '絨毛'],
  ['擺件', '擺件'],
  ['收納', '收納'],
  ['適用', '適用'],
  ['尺寸', '尺寸'],
  ['材質', '材質'],
  ['包裝', '包裝'],
  ['贈品', '贈品'],
  ['活動', '活動'],
  ['優惠', '優惠'],
  ['滿額', '滿額'],
  ['正品', '正品'],
  // 夜工包（回饋 22 老闆抓漏，2026-07-18）：單位與大陸用語補強
  ['釐米', '公分'],
  ['厘米', '公分'],
  ['屏幕', '螢幕'],
  ['顯示屏', '螢幕'],
  ['網絡', '網路'],
  ['信息', '資訊'],
  ['軟件', '軟體'],
  ['硬件', '硬體'],
  ['塑料', '塑膠'],
  ['拉鏈', '拉鍊'],
  ['充電寶', '行動電源'],
  ['移動電源', '行動電源'],
  ['性價比', 'CP值'],
  ['髮卡', '髮夾'],
  // VARIANT-CLEAN：款式名常見 3C 用語（內存卡要排在內存之前）
  ['內存卡', '記憶卡'],
  ['內存', '記憶體'],
  ['U盤', '隨身碟'],
  ['數據線', '傳輸線'],
  // VARIANT-CLEAN fixbatch: Mainland IP / character wording -> Taiwan canonical wording.
  // OpenCC runs first, so these are the Traditional forms (with explicitly tested aliases).
  ['玉桂狗', '大耳狗'],
  ['庫洛米', '酷洛米'],
  ['美樂蒂', '美樂蒂'],
  ['帕恰狗', '帕恰狗'],
  ['布丁狗', '布丁狗'],
  ['大眼蛙', '大眼蛙'],
  ['凱蒂貓', 'Hello Kitty'],
  ['米老鼠', '米奇'],
  ['唐老鴨', '唐老鴨'],
  ['精靈寶可夢', '寶可夢'],
  ['口袋妖怪', '寶可夢'],
  ['皮卡丘', '皮卡丘'],
  ['史迪仔', '史迪奇'],
  ['奧特曼', '超人力霸王'],
  ['布朗熊', '熊大'],
  ['可妮兔', '兔兔'],
  ['小豬佩奇', '粉紅豬小妹'],
  ['托馬斯小火車', '湯瑪士小火車'],
  ['托馬斯', '湯瑪士小火車'],
  ['海賊王', '航海王'],
  ['蜘蛛俠', '蜘蛛人'],
  ['鋼鐵俠', '鋼鐵人'],
  ['星球大戰', '星際大戰'],
  ['機器貓', '哆啦A夢'],
  // 台灣名本身包含舊稱（龍珠⊂七龍珠、汪汪隊⊂汪汪隊立大功）：applyTaiwanTerms 會先保護已是台灣名的部分。
  ['龍珠', '七龍珠'],
  ['汪汪隊', '汪汪隊立大功'],
  // PKG2A / 回饋 84：款式值常見「鼠标」——OpenCC 先成「鼠標」，用語表再換成台灣「滑鼠」
  ['鼠标', '滑鼠'],
  ['鼠標', '滑鼠'],
  ['鼠标垫', '滑鼠墊'],
  ['鼠標墊', '滑鼠墊'],
  ['滑鼠垫', '滑鼠墊'],
];

const PROTECTED_TEXT_PATTERN = /https?:\/\/[^\s<>"']+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

type LocalizableDraftTextFields = {
  product_name: string;
  variant_feature?: string | null;
  usage_scene?: string | null;
  intro?: string | null;
  notes?: string | null;
  secondhand_condition?: string | null;
  secondhand_notes?: string | null;
  display_title?: string | null;
  generated_description_html?: string | null;
  generated_faq_html?: string | null;
  seo_title?: string | null;
  meta_description?: string | null;
  variants?: ProductVariant[] | null;
};

/**
 * OpenCC cn→tw 詞庫會把「合家」轉成「閤家」（閤家歡樂）。
 * 「適合家庭／適合家用」裡的「合家」會被一起切到，變成「適閤家庭」。
 * 只還原「適閤」這個兩字詞，不把單字「閤」改回「合」，以免動到閤府、閤家歡樂。
 */
function restoreMistakenHejiaInsideShihe(value: string): string {
  return value.split("適閤").join("適合");
}

function applyTaiwanTerms(value: string): string {
  return TAIWAN_TERM_REPLACEMENTS.reduce((localized, [source, replacement]) => {
    if (!localized.includes(source) || source === replacement) return localized;
    // Already has Kitty in English: discard the Mainland alias, don't append a second Kitty.
    if (source === '凱蒂貓' && /(?:hello\s*)?kitty/i.test(localized)) {
      return localized.replace(/(?:[\s／\/|｜,，、+＋·・]*凱蒂貓[\s／\/|｜,，、+＋·・]*)+/g, '').trim();
    }
    // The Taiwan name contains the old alias (龍珠 → 七龍珠): keep existing Taiwan names intact so
    // a second pass never yields 七七龍珠 / 汪汪隊立大功立大功.
    if (replacement.includes(source)) {
      return localized
        .split(replacement)
        .map((part) => part.split(source).join(replacement))
        .join(replacement);
    }
    return localized.split(source).join(replacement);
  }, value);
}

function protectUrlsAndEmails(value: string): { text: string; restore: (localized: string) => string } {
  const protectedValues: string[] = [];
  const text = value.replace(PROTECTED_TEXT_PATTERN, (match) => {
    const token = '__NESTORY_PROTECTED_TEXT_' + protectedValues.length + '__';
    protectedValues.push(match);
    return token;
  });

  return {
    text,
    restore: (localized) =>
      protectedValues.reduce(
        (restored, original, index) =>
          restored.split('__NESTORY_PROTECTED_TEXT_' + index + '__').join(original),
        localized,
      ),
  };
}

function localizeOptionalText(value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined) {
    return value;
  }

  return localizeToTaiwanTraditionalText(value);
}

function localizeVariants(variants: ProductVariant[] | null | undefined): ProductVariant[] | null | undefined {
  if (!variants) {
    return variants;
  }

  return variants.map((variant) => ({
    ...variant,
    option1_value: localizeToTaiwanTraditionalText(variant.option1_value),
    option2_value: localizeToTaiwanTraditionalText(variant.option2_value),
  }));
}

export function localizeToTaiwanTraditionalText(text: string): string {
  if (!text) {
    return text;
  }

  const protectedText = protectUrlsAndEmails(text);
  const traditionalText = convertSimplifiedToTraditional(protectedText.text);

  const phraseFixed = restoreMistakenHejiaInsideShihe(traditionalText);
  return protectedText.restore(applyTaiwanTerms(phraseFixed));
}

function localizeDisplayTitleText(value: string | null | undefined): string | null {
  const localized = localizeOptionalText(value);

  return localized ? localized.split('包包吊飾').join('包包掛件') : null;
}

export function localizeDraftTextFields<T extends LocalizableDraftTextFields>(draft: T): T {
  return {
    ...draft,
    product_name: localizeToTaiwanTraditionalText(draft.product_name),
    variant_feature: localizeOptionalText(draft.variant_feature),
    usage_scene: localizeOptionalText(draft.usage_scene),
    intro: localizeOptionalText(draft.intro),
    notes: localizeOptionalText(draft.notes),
    secondhand_condition: localizeOptionalText(draft.secondhand_condition),
    secondhand_notes: localizeOptionalText(draft.secondhand_notes),
    display_title: localizeDisplayTitleText(draft.display_title),
    generated_description_html: localizeOptionalText(draft.generated_description_html),
    generated_faq_html: localizeOptionalText(draft.generated_faq_html),
    seo_title: localizeOptionalText(draft.seo_title),
    meta_description: localizeOptionalText(draft.meta_description),
    variants: localizeVariants(draft.variants),
  } as T;
}

export function localizeGeneratedListingContent(
  generatedContent: GeneratedListingContent,
): GeneratedListingContent {
  return {
    ...generatedContent,
    display_title: localizeDisplayTitleText(generatedContent.display_title),
    generated_description_html: localizeToTaiwanTraditionalText(
      generatedContent.generated_description_html,
    ),
    generated_faq_html: localizeToTaiwanTraditionalText(generatedContent.generated_faq_html),
    seo_title: localizeToTaiwanTraditionalText(generatedContent.seo_title),
    meta_description: localizeToTaiwanTraditionalText(generatedContent.meta_description),
    validation_errors: generatedContent.validation_errors.map(localizeToTaiwanTraditionalText),
    validation_warnings: generatedContent.validation_warnings.map(localizeToTaiwanTraditionalText),
  };
}

/**
 * PKG2A / 回饋 84：variant_dimensions 軸名簡轉繁（冪等，不標記）。
 * 只在全文 generate 成功路徑呼叫；表單手填當下不動。
 */
export function localizeVariantDimensions<
  T extends { name?: string | null; values?: string[] | null },
>(dims: T[] | null | undefined): T[] | null | undefined {
  if (!dims) return dims;
  if (!Array.isArray(dims)) return dims;
  return dims.map((d) => {
    const name = d.name;
    const localizedName =
      name == null || name === "" ? name : localizeToTaiwanTraditionalText(name);
    const values = Array.isArray(d.values)
      ? d.values.map((v) =>
          v == null || v === "" ? v : localizeToTaiwanTraditionalText(String(v)),
        )
      : d.values;
    const nameChanged = localizedName !== name;
    const valuesChanged =
      Array.isArray(values) &&
      Array.isArray(d.values) &&
      values.some((v, i) => v !== d.values![i]);
    if (!nameChanged && !valuesChanged) return d;
    return {
      ...d,
      ...(nameChanged ? { name: localizedName } : {}),
      ...(valuesChanged ? { values } : {}),
    };
  });
}

type VariantOptionTextFields = {
  option1_name?: string | null;
  option1_value?: string | null;
  option2_name?: string | null;
  option2_value?: string | null;
  option3_name?: string | null;
  option3_value?: string | null;
};

/**
 * PKG2A / 回饋 84：product_variants option 軸名／值簡轉繁（冪等）。
 * OpenCC + 用語表連跑兩次結果相同（verify-pkg2a 鎖）。
 */
export function localizeProductVariantOptionFields<T extends VariantOptionTextFields>(row: T): T {
  const next = {
    option1_name: localizeOptionalText(row.option1_name) ?? null,
    option1_value: localizeOptionalText(row.option1_value) ?? null,
    option2_name: localizeOptionalText(row.option2_name) ?? null,
    option2_value: localizeOptionalText(row.option2_value) ?? null,
    option3_name: localizeOptionalText(row.option3_name) ?? null,
    option3_value: localizeOptionalText(row.option3_value) ?? null,
  };
  if (
    next.option1_name === (row.option1_name ?? null) &&
    next.option1_value === (row.option1_value ?? null) &&
    next.option2_name === (row.option2_name ?? null) &&
    next.option2_value === (row.option2_value ?? null) &&
    next.option3_name === (row.option3_name ?? null) &&
    next.option3_value === (row.option3_value ?? null)
  ) {
    return row;
  }
  return { ...row, ...next };
}

/** True when any option name/value field changed after localization. */
export function productVariantOptionsNeedLocalize(row: VariantOptionTextFields): boolean {
  return localizeProductVariantOptionFields(row) !== row;
}
