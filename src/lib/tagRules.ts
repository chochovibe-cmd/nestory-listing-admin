import type { SupabaseClient } from "@supabase/supabase-js";
import { RuleGroup, TagRule, TagRuleGroups } from "./contentGenerator/sourceTypes";

export const RULE_GROUPS: RuleGroup[] = [
  "IP",
  "角色",
  "類型",
  "情境",
  "狀態",
  "推薦",
  "商品屬性",
  "等級",
];

export function createEmptyTagRuleGroups(): TagRuleGroups {
  return RULE_GROUPS.reduce((groups, group) => {
    groups[group] = [];
    return groups;
  }, {} as TagRuleGroups);
}

// Used for listing generation: all active rules, unfiltered by is_secondhand
// (generateShopifyTags itself branches on product_status to pick the right ones).
export async function listActiveListingTagRules(supabase: SupabaseClient): Promise<TagRule[]> {
  const { data, error } = await supabase
    .from("tag_rules")
    .select("id,rule_group,label,tag_value,is_secondhand,sort_order,created_at,updated_at")
    .eq("is_active", true)
    .order("rule_group", { ascending: true })
    .order("is_secondhand", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as TagRule[];
}

export function groupTagRulesByRuleGroup(rules: TagRule[]): TagRuleGroups {
  const groups = createEmptyTagRuleGroups();

  for (const rule of rules) {
    groups[rule.rule_group].push(rule);
  }

  return groups;
}
