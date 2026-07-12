import type { CopyTone } from "./copy";

/**
 * B8: IP → concrete tone for「依IP自動匹配」only.
 * Manual tone selections never consult this map (see resolveCopyTone).
 *
 * Pattern matches A16 scenario keywords: DEFAULT in code + team_settings
 * key `ip_tone_map_overrides` can override/extend without a deploy.
 *
 * Reviewed 2026-07-12 (老闆 D5-B):
 * - 鏈鋸人 → 小編聊天口吻（梗與黑色幽默，非正經熱血）
 * - 美少女戰士 → 黑膠文藝收藏感（懷舊成年粉絲／復古收藏）
 */
export const DEFAULT_IP_TONE_MAP: Partial<Record<string, CopyTone>> = {
  鬼滅之刃: "中二熱血宣言",
  火影忍者: "中二熱血宣言",
  咒術迴戰: "中二熱血宣言",
  進擊的巨人: "中二熱血宣言",
  鏈鋸人: "小編聊天口吻",
  我的英雄學院: "中二熱血宣言",
  七龍珠: "中二熱血宣言",
  航海王: "中二熱血宣言",
  "JOJO的奇妙冒險": "中二熱血宣言",
  吉伊卡哇: "可愛周邊輕鬆感",
  三麗鷗: "可愛周邊輕鬆感",
  Mofusand: "可愛周邊輕鬆感",
  Pusheen: "可愛周邊輕鬆感",
  蠟筆小新: "小編聊天口吻",
  間諜家家酒: "小編聊天口吻",
  我推的孩子: "小編聊天口吻",
  葬送的芙莉蓮: "黑膠文藝收藏感",
  紫羅蘭永恆花園: "日系選物店溫柔感",
  孤獨搖滾: "小編聊天口吻",
  初音未來: "可愛周邊輕鬆感",
  寶可夢: "可愛周邊輕鬆感",
  名偵探柯南: "小編聊天口吻",
  新世紀福音戰士: "黑膠文藝收藏感",
  機動戰士鋼彈: "黑膠文藝收藏感",
  迪士尼: "日系選物店溫柔感",
  星際寶貝: "可愛周邊輕鬆感",
  小熊維尼: "日系選物店溫柔感",
  美少女戰士: "黑膠文藝收藏感",
  哈利波特: "黑膠文藝收藏感",
  Marvel: "中二熱血宣言",
  Batman: "中二熱血宣言",
  "Spider-Man": "中二熱血宣言",
  Avengers: "中二熱血宣言",
  Deadpool: "中二熱血宣言",
  "DC Comics": "中二熱血宣言",
  Superman: "中二熱血宣言",
  "Wonder Woman": "中二熱血宣言",
};

/** Concrete tones only — never map to 依IP自動匹配 (would recurse). */
const CONCRETE_TONES: ReadonlySet<string> = new Set([
  "黑膠文藝收藏感",
  "日系選物店溫柔感",
  "可愛周邊輕鬆感",
  "中二熱血宣言",
  "小編聊天口吻",
]);

/**
 * Merge team_settings overrides onto DEFAULT. Invalid tone strings are skipped.
 * Override values replace defaults for the same IP key (exact ip_catalog name).
 */
export function mergeIpToneMap(
  override: Record<string, string> | null | undefined,
): Partial<Record<string, CopyTone>> {
  const merged: Partial<Record<string, CopyTone>> = { ...DEFAULT_IP_TONE_MAP };
  if (!override || typeof override !== "object") return merged;

  for (const [rawKey, rawTone] of Object.entries(override)) {
    const key = rawKey.normalize("NFKC").trim();
    const tone = typeof rawTone === "string" ? rawTone.normalize("NFKC").trim() : "";
    if (!key || !CONCRETE_TONES.has(tone)) continue;
    merged[key] = tone as CopyTone;
  }
  return merged;
}

export function lookupIpTone(
  ipName: string | null | undefined,
  toneMap: Partial<Record<string, CopyTone>> = DEFAULT_IP_TONE_MAP,
): CopyTone | undefined {
  const key = (ipName ?? "").normalize("NFKC").trim();
  if (!key) return undefined;
  return toneMap[key];
}
