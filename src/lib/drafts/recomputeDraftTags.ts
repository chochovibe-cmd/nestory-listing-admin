import { dedupeNestoryTags, sortNestoryTags } from "@/lib/nestoryTagsV2";

export const TAG_DICT_WARNING_PATTERNS: RegExp[] = [
  /^角色「[^」]+」尚未建立\s*V2\s*字典/,
  /^角色「[^」]+」尚未建立正式\s*tag_rules/,
  /^角色「[^」]+」尚未建立二手\s*tag_rules/,
  /^角色「[^」]+」尚未建立\s*tag_rules/,
  /^IP「[^」]+」不在 V2 IP 字典中/,
  /^待收編類型：/,
];

function normalizeWarningText(text: string): string {
  return text.replace(/^[⚠⛔🔍\s]+/u, "").trim();
}

export function isTagDictWarning(text: string): boolean {
  const normalized = normalizeWarningText(text);
  return TAG_DICT_WARNING_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function hasTagDictWarnings(warnings: string[] | null | undefined): boolean {
  return (warnings ?? []).some(isTagDictWarning);
}

export function buildRecomputedTags(existingTags: string[], derivedTags: string[]): string[] {
  const derivedHasType = derivedTags.some((tag) => tag.startsWith("類型_"));
  const keep = existingTags.filter((tag) => !(derivedHasType && tag.startsWith("類型_")));
  const add = derivedTags.filter(
    (tag) => tag.startsWith("IP_") || tag.startsWith("角色_") || tag.startsWith("類型_"),
  );
  return sortNestoryTags(dedupeNestoryTags([...keep, ...add]));
}

export function buildRecomputedWarnings(
  existingWarnings: string[] | null | undefined,
  derivedWarnings: string[],
  opts: { ipInCatalog: boolean },
): string[] {
  const keep = (existingWarnings ?? []).filter((warning) => {
    if (isTagDictWarning(warning)) return false;
    if (
      opts.ipInCatalog &&
      /^AI 判斷 IP「[^」]+」不在建檔清單中/.test(normalizeWarningText(warning))
    ) {
      return false;
    }
    return true;
  });
  return Array.from(new Set([...keep, ...derivedWarnings]));
}
