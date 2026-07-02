import { RuleGroup, TagRule } from './sourceTypes';

export function findTagRule(
  tagRules: TagRule[],
  ruleGroup: RuleGroup,
  label: string,
  isSecondhand: boolean,
): TagRule | null {
  return (
    tagRules.find(
      (rule) =>
        rule.rule_group === ruleGroup &&
        rule.label === label &&
        rule.is_secondhand === isSecondhand,
    ) ?? null
  );
}

export function findTagRuleByValue(tagRules: TagRule[], tagValue: string): TagRule | null {
  return tagRules.find((rule) => rule.tag_value === tagValue) ?? null;
}
