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

function applyTaiwanTerms(value: string): string {
  return TAIWAN_TERM_REPLACEMENTS.reduce(
    (localized, [source, replacement]) => localized.split(source).join(replacement),
    value,
  );
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

  return protectedText.restore(applyTaiwanTerms(traditionalText));
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
