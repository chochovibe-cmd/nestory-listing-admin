import { NESTORY_TAG_PREFIX_ORDER } from "@/lib/nestoryTagsV2";

export type TagDisplayGroup = {
  key: string; // e.g. "定位_" | "other"
  label: string; // e.g. "定位" | "其他"
  tags: string[]; // full tag strings, e.g. "IP_三麗鷗"
};

/**
 * Group tags by Nestory prefix for result-card display only.
 * Unknown / no-prefix tags go into "其他". Empty groups are omitted.
 * Does not change engine output or persistence.
 */
export function groupTagsByPrefix(tags: string[]): TagDisplayGroup[] {
  const cleaned = tags.map((t) => t.trim()).filter(Boolean);
  // Dedupe, keep first-seen order
  const seen = new Set<string>();
  const unique = cleaned.filter((t) => (seen.has(t) ? false : (seen.add(t), true)));

  const buckets = new Map<string, string[]>();
  for (const prefix of NESTORY_TAG_PREFIX_ORDER) buckets.set(prefix, []);
  const other: string[] = [];

  for (const tag of unique) {
    const prefix = NESTORY_TAG_PREFIX_ORDER.find((p) => tag.startsWith(p));
    if (prefix) buckets.get(prefix)!.push(tag);
    else other.push(tag);
  }

  const groups: TagDisplayGroup[] = [];
  for (const prefix of NESTORY_TAG_PREFIX_ORDER) {
    const list = buckets.get(prefix) ?? [];
    if (list.length === 0) continue;
    groups.push({
      key: prefix,
      label: prefix.replace(/_$/u, ""),
      tags: list
    });
  }
  if (other.length > 0) {
    groups.push({ key: "other", label: "其他", tags: other });
  }
  return groups;
}
