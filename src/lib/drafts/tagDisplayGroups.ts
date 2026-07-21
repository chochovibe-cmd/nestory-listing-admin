import { NESTORY_TAG_PREFIX_ORDER } from "@/lib/nestoryTagsV2";

export type TagDisplayGroup = {
  key: string; // e.g. "定位_" | "other"
  label: string; // e.g. "定位" | "其他"
  tags: string[]; // full tag strings, e.g. "IP_三麗鷗"
};

/** Context-ish prefixes → Mockup `.t-ctx` (success 淡底). */
const CTX_PREFIXES = [
  "定位_",
  "主題_",
  "銷售_",
  "品相_",
  "瑕疵_",
  "價格帶_",
  "營運_",
  "來源_",
  "商品屬性_",
  "等級_"
] as const;

/**
 * UX-B4-P01: map a full tag string → Mockup tone class (`t-ip` / `t-char` / …).
 * Display-only; does not change engine output.
 * `warned` wins over prefix when the tag text looks like a revision warning.
 */
export function tagToneClass(tag: string): string {
  const t = tag.trim();
  if (!t) return "";
  if (t.includes("需修改") || t.startsWith("⚠") || t.includes("警告")) {
    return "warned";
  }
  if (t.startsWith("IP_")) return "t-ip";
  if (t.startsWith("角色_")) return "t-char";
  if (t.startsWith("類型_")) return "t-type";
  if (CTX_PREFIXES.some((p) => t.startsWith(p))) return "t-ctx";
  return "";
}

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
