import { ProductStatus } from './sourceTypes';

export type AccordionContentDraft = {
  product_status: ProductStatus;
  ip: string;
  characters: string[];
  product_types: string[];
  use_cases: string[];
  product_name: string;
  variant_feature: string | null;
  usage_scene: string | null;
  sku: string | null;
  secondhand_grade: string | null;
  secondhand_condition: string | null;
  secondhand_notes: string | null;
};

function compact(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function joinLabels(values: string[], fallback = ''): string {
  const labels = values.map((value) => value.trim()).filter(Boolean);
  return labels.length > 0 ? labels.join('、') : fallback;
}

function uniqueLines(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

export function generateProductSpecsText(draft: AccordionContentDraft): string {
  const lines = uniqueLines([
    draft.product_name ? '商品名稱：' + draft.product_name : '',
    draft.ip ? 'IP／系列：' + draft.ip : '',
    draft.characters.length > 0 ? '角色／主題：' + joinLabels(draft.characters) : '',
    draft.product_types.length > 0 ? '商品類型：' + joinLabels(draft.product_types) : '',
    compact(draft.variant_feature) ? '款式／特徵：' + compact(draft.variant_feature) : '',
    compact(draft.sku) ? 'SKU：' + compact(draft.sku) : '',
    draft.product_status === 'secondhand' && compact(draft.secondhand_grade)
      ? '二手等級：' + compact(draft.secondhand_grade)
      : '',
    draft.product_status === 'secondhand' && compact(draft.secondhand_condition)
      ? '二手品況：' + compact(draft.secondhand_condition)
      : '',
    draft.product_status === 'secondhand' && compact(draft.secondhand_notes)
      ? '保存／瑕疵備註：' + compact(draft.secondhand_notes)
      : '',
  ]);

  if (lines.length === 0) {
    return '商品規格：依實際商品資訊為準';
  }

  if (!lines.some((line) => line.includes('款式') || line.includes('SKU') || line.includes('二手'))) {
    lines.push('詳細尺寸／材質：依實際商品資訊為準');
  }

  return lines.join('\n');
}

export function generateProductHighlightsText(draft: AccordionContentDraft): string {
  const characterText = joinLabels(draft.characters, '角色粉絲');
  const typeText = joinLabels(draft.product_types, '周邊商品');
  const useCaseText = joinLabels(draft.use_cases, '收藏展示、日常佈置');
  const highlights = uniqueLines([
    draft.ip ? '・' + draft.ip + ' ' + characterText + ' 主題收藏。' : '',
    typeText ? '・' + typeText + ' 類型，適合收藏或日常擺放。' : '',
    useCaseText ? '・適合 ' + useCaseText + '。' : '',
    compact(draft.variant_feature) ? '・款式特色：' + compact(draft.variant_feature) + '。' : '',
    compact(draft.usage_scene) ? '・' + compact(draft.usage_scene) : '',
    draft.product_status === 'secondhand' && compact(draft.secondhand_grade)
      ? '・二手等級 ' + compact(draft.secondhand_grade) + '，適合可接受二手品況差異的收藏者。'
      : '',
    draft.product_status === 'secondhand' && compact(draft.secondhand_condition)
      ? '・品況重點：' + compact(draft.secondhand_condition) + '。'
      : '',
  ]);

  while (highlights.length < 3) {
    highlights.push('・適合喜歡角色周邊的收藏玩家。');
  }

  return highlights.slice(0, 5).join('\n');
}

export function faqHtmlToMetafieldText(html: string | null | undefined): string {
  const value = compact(html);

  if (!value) {
    return '';
  }

  const pairs = Array.from(value.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/gi));

  if (pairs.length > 0) {
    return pairs
      .map((match) => {
        const question = stripHtml(match[1]);
        const answer = stripHtml(match[2]);
        return ['Q：' + question, 'A：' + answer].join('\n');
      })
      .join('\n\n');
  }

  return stripHtml(value);
}
