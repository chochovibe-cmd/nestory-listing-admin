import { RuleGroup } from './sourceTypes';
import { findTagRule, findTagRuleByValue } from './tagMapping';
import { GeneratorContext } from './types';

function addUniqueTag(tags: string[], tagValue: string) {
  if (!tags.includes(tagValue)) {
    tags.push(tagValue);
  }
}

function mapLabelToTag(
  context: GeneratorContext,
  tags: string[],
  ruleGroup: RuleGroup,
  label: string,
  isSecondhand: boolean,
  missingSeverity: 'error' | 'warning',
  missingMessage: string,
) {
  const rule = findTagRule(context.tagRules, ruleGroup, label, isSecondhand);

  if (!rule) {
    if (missingSeverity === 'error') {
      context.errors.push(missingMessage);
    } else {
      context.warnings.push(missingMessage);
    }

    return;
  }

  addUniqueTag(tags, rule.tag_value);
}

export function generateShopifyTags(context: GeneratorContext): string[] {
  const { draft } = context;
  const tags: string[] = [];

  if (draft.product_status === 'secondhand') {
    const secondhandRule = findTagRuleByValue(context.tagRules, '商品屬性_二手');

    if (!secondhandRule) {
      context.errors.push('找不到二手商品屬性標籤：商品屬性_二手。');
    } else {
      addUniqueTag(tags, secondhandRule.tag_value);
    }

    if (draft.ip) {
      mapLabelToTag(
        context,
        tags,
        'IP',
        draft.ip,
        true,
        'error',
        `IP「${draft.ip}」尚未建立二手 tag_rules，無法產生二手 IP 標籤。`,
      );
    }

    for (const character of draft.characters) {
      mapLabelToTag(
        context,
        tags,
        '角色',
        character,
        true,
        'warning',
        `角色「${character}」尚未建立二手 tag_rules，將不產生二手角色標籤。`,
      );
    }

    for (const productType of draft.product_types) {
      mapLabelToTag(
        context,
        tags,
        '類型',
        productType,
        true,
        'error',
        `類型「${productType}」尚未建立二手 tag_rules，無法產生二手類型標籤。`,
      );
    }

    for (const useCase of draft.use_cases) {
      mapLabelToTag(
        context,
        tags,
        '情境',
        useCase,
        true,
        'warning',
        `情境「${useCase}」尚未建立二手 tag_rules，將不產生二手情境標籤。`,
      );
    }

    if (draft.secondhand_grade) {
      mapLabelToTag(
        context,
        tags,
        '等級',
        draft.secondhand_grade,
        true,
        'error',
        `二手等級「${draft.secondhand_grade}」尚未建立 tag_rules，無法產生二手等級標籤。`,
      );
    }

    if (draft.recommend_tags.length > 0) {
      context.warnings.push('二手商品不產生推薦標籤，推薦欄位已略過。');
    }

    return tags;
  }

  if (draft.ip) {
    mapLabelToTag(
      context,
      tags,
      'IP',
      draft.ip,
      false,
      'error',
      `IP「${draft.ip}」尚未建立 tag_rules，無法產生 IP 標籤。`,
    );
  }

  for (const character of draft.characters) {
    mapLabelToTag(
      context,
      tags,
      '角色',
      character,
      false,
      'warning',
      `角色「${character}」尚未建立正式 tag_rules，將不產生角色標籤。`,
    );
  }

  for (const productType of draft.product_types) {
    mapLabelToTag(
      context,
      tags,
      '類型',
      productType,
      false,
      'error',
      `類型「${productType}」尚未建立 tag_rules，無法產生類型標籤。`,
    );
  }

  for (const useCase of draft.use_cases) {
    mapLabelToTag(
      context,
      tags,
      '情境',
      useCase,
      false,
      'warning',
      `情境「${useCase}」尚未建立 tag_rules，將不產生情境標籤。`,
    );
  }

  if (draft.sale_status) {
    mapLabelToTag(
      context,
      tags,
      '狀態',
      draft.sale_status,
      false,
      'error',
      `銷售狀態「${draft.sale_status}」尚未建立 tag_rules，無法產生狀態標籤。`,
    );
  }

  for (const recommendTag of draft.recommend_tags) {
    mapLabelToTag(
      context,
      tags,
      '推薦',
      recommendTag,
      false,
      'warning',
      `推薦「${recommendTag}」尚未建立 tag_rules，將不產生推薦標籤。`,
    );
  }

  return tags;
}
