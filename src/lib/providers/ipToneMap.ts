import type { CopyTone } from "./copy";

/**
 * B8 / P5: IP → concrete tone for「依IP自動匹配」only.
 * Manual tone selections never consult this map (see resolveCopyTone).
 *
 * Pattern matches A16 scenario keywords: DEFAULT in code + team_settings
 * key `ip_tone_map_overrides` can override/extend without a deploy.
 * Overrides are NOT seeded — reserved for boss live edits.
 *
 * P5 層1（2026-07-19 老闆審定）:
 * - 032 全量 + 種子補齊 ≈151 catalog key
 * - 改：Deadpool → 小編聊天口吻；THE MONSTERS → 黑膠文藝收藏感
 * - 其餘提案全收
 * - 同一 IP 若 032 merge 可能保留中文或英文 key，雙 key 同 tone 防 lookup 落空
 *
 * 既有 D5-B 保留：
 * - 鏈鋸人 → 小編聊天口吻
 * - 美少女戰士 → 黑膠文藝收藏感
 */
export const DEFAULT_IP_TONE_MAP: Partial<Record<string, CopyTone>> = {
  // ── 黑膠文藝收藏感 ──
  史努比: "黑膠文藝收藏感",
  Peanuts: "黑膠文藝收藏感",
  "The Little Prince": "黑膠文藝收藏感",
  "Sentimental Circus": "黑膠文藝收藏感",
  "Wallace & Gromit": "黑膠文藝收藏感",
  "The Addams Family": "黑膠文藝收藏感",
  "The Legend of Zelda": "黑膠文藝收藏感",
  葬送的芙莉蓮: "黑膠文藝收藏感",
  新世紀福音戰士: "黑膠文藝收藏感",
  星際大戰: "黑膠文藝收藏感",
  "Star Wars": "黑膠文藝收藏感",
  哈利波特: "黑膠文藝收藏感",
  "Harry Potter": "黑膠文藝收藏感",
  哥吉拉: "黑膠文藝收藏感",
  Godzilla: "黑膠文藝收藏感",
  魔戒: "黑膠文藝收藏感",
  "The Lord of the Rings": "黑膠文藝收藏感",
  回到未來: "黑膠文藝收藏感",
  "Back to the Future": "黑膠文藝收藏感",
  "POP MART": "黑膠文藝收藏感",
  "THE MONSTERS": "黑膠文藝收藏感",
  MOLLY: "黑膠文藝收藏感",
  SKULLPANDA: "黑膠文藝收藏感",
  HIRONO: "黑膠文藝收藏感",
  美少女戰士: "黑膠文藝收藏感",
  機動戰士鋼彈: "黑膠文藝收藏感",
  鋼之鍊金術師: "黑膠文藝收藏感",
  文豪野犬: "黑膠文藝收藏感",
  Spawn: "黑膠文藝收藏感",
  異形: "黑膠文藝收藏感",
  終結者: "黑膠文藝收藏感",
  駭客任務: "黑膠文藝收藏感",
  "BE@RBRICK": "黑膠文藝收藏感",
  KAWS: "黑膠文藝收藏感",
  Kidrobot: "黑膠文藝收藏感",

  // ── 日系選物店溫柔感 ──
  Miffy: "日系選物店溫柔感",
  嚕嚕米: "日系選物店溫柔感",
  Moomin: "日系選物店溫柔感",
  "Peter Rabbit": "日系選物店溫柔感",
  Paddington: "日系選物店溫柔感",
  Barbapapa: "日系選物店溫柔感",
  Rilakkuma: "日系選物店溫柔感",
  "Koupen Chan": "日系選物店溫柔感",
  "Steven Universe": "日系選物店溫柔感",
  "Sesame Street": "日系選物店溫柔感",
  Doraemon: "日系選物店溫柔感",
  哆啦A夢: "日系選物店溫柔感",
  "Animal Crossing": "日系選物店溫柔感",
  迪士尼: "日系選物店溫柔感",
  Disney: "日系選物店溫柔感",
  小熊維尼: "日系選物店溫柔感",
  "Winnie the Pooh": "日系選物店溫柔感",
  玩具總動員: "日系選物店溫柔感",
  "Toy Story": "日系選物店溫柔感",
  DIMOO: "日系選物店溫柔感",
  紫羅蘭永恆花園: "日系選物店溫柔感",
  藥師少女的獨語: "日系選物店溫柔感",
  庫洛魔法使: "日系選物店溫柔感",
  米奇與好友: "日系選物店溫柔感",
  冰雪奇緣: "日系選物店溫柔感",

  // ── 可愛周邊輕鬆感 ──
  "Care Bears": "可愛周邊輕鬆感",
  Monchhichi: "可愛周邊輕鬆感",
  Pusheen: "可愛周邊輕鬆感",
  Molang: "可愛周邊輕鬆感",
  "Esther Bunny": "可愛周邊輕鬆感",
  "Line Dog": "可愛周邊輕鬆感",
  "Kanahei's Small Animals": "可愛周邊輕鬆感",
  Mofusand: "可愛周邊輕鬆感",
  "Sumikko Gurashi": "可愛周邊輕鬆感",
  角落小夥伴: "可愛周邊輕鬆感",
  角落生物: "可愛周邊輕鬆感",
  Tarepanda: "可愛周邊輕鬆感",
  Kapibarasan: "可愛周邊輕鬆感",
  "Nyan Nyan Nyanko": "可愛周邊輕鬆感",
  "Neko Atsume": "可愛周邊輕鬆感",
  Pingu: "可愛周邊輕鬆感",
  "Bread Barbershop": "可愛周邊輕鬆感",
  "My Little Pony": "可愛周邊輕鬆感",
  "The Smurfs": "可愛周邊輕鬆感",
  小小兵: "可愛周邊輕鬆感",
  Minions: "可愛周邊輕鬆感",
  "Shaun the Sheep": "可愛周邊輕鬆感",
  寶可夢: "可愛周邊輕鬆感",
  Kirby: "可愛周邊輕鬆感",
  星之卡比: "可愛周邊輕鬆感",
  "Super Mario": "可愛周邊輕鬆感",
  星際寶貝: "可愛周邊輕鬆感",
  "Lilo & Stitch": "可愛周邊輕鬆感",
  CRYBABY: "可愛周邊輕鬆感",
  HACIPUPU: "可愛周邊輕鬆感",
  "Baby Three": "可愛周邊輕鬆感",
  Nanci: "可愛周邊輕鬆感",
  吉伊卡哇: "可愛周邊輕鬆感",
  三麗鷗: "可愛周邊輕鬆感",
  初音未來: "可愛周邊輕鬆感",
  "Love Live!": "可愛周邊輕鬆感",
  PUCKY: "可愛周邊輕鬆感",
  "Sonny Angel": "可愛周邊輕鬆感",
  Smiski: "可愛周邊輕鬆感",
  "Baby Milo": "可愛周邊輕鬆感",
  Tokidoki: "可愛周邊輕鬆感",
  "Funko Pop!": "可愛周邊輕鬆感",

  // ── 中二熱血宣言 ──
  ThunderCats: "中二熱血宣言",
  忍者龜: "中二熱血宣言",
  "Teenage Mutant Ninja Turtles": "中二熱血宣言",
  "Ben 10": "中二熱血宣言",
  航海王: "中二熱血宣言",
  火影忍者: "中二熱血宣言",
  七龍珠: "中二熱血宣言",
  "Dragon Ball": "中二熱血宣言",
  鬼滅之刃: "中二熱血宣言",
  咒術迴戰: "中二熱血宣言",
  排球少年: "中二熱血宣言",
  藍色監獄: "中二熱血宣言",
  "JOJO的奇妙冒險": "中二熱血宣言",
  我的英雄學院: "中二熱血宣言",
  進擊的巨人: "中二熱血宣言",
  "Attack on Titan": "中二熱血宣言",
  Marvel: "中二熱血宣言",
  "Spider-Man": "中二熱血宣言",
  "DC Comics": "中二熱血宣言",
  Batman: "中二熱血宣言",
  侏羅紀世界: "中二熱血宣言",
  "Jurassic World": "中二熱血宣言",
  Avengers: "中二熱血宣言",
  Superman: "中二熱血宣言",
  "Wonder Woman": "中二熱血宣言",
  博人傳: "中二熱血宣言",
  獵人: "中二熱血宣言",
  死神: "中二熱血宣言",
  遊戲王: "中二熱血宣言",
  "Re:從零開始的異世界生活": "中二熱血宣言",
  Fate: "中二熱血宣言",
  刀劍神域: "中二熱血宣言",
  東京復仇者: "中二熱血宣言",
  黑子的籃球: "中二熱血宣言",
  犬夜叉: "中二熱血宣言",
  幽遊白書: "中二熱血宣言",
  怪獸8號: "中二熱血宣言",
  "X-Men": "中二熱血宣言",
  "The Flash": "中二熱血宣言",
  變形金剛: "中二熱血宣言",

  // ── 小編聊天口吻 ──
  飛天小女警: "小編聊天口吻",
  "The Powerpuff Girls": "小編聊天口吻",
  探險活寶: "小編聊天口吻",
  "Adventure Time": "小編聊天口吻",
  "We Bare Bears": "小編聊天口吻",
  "The Amazing World of Gumball": "小編聊天口吻",
  海綿寶寶: "小編聊天口吻",
  "SpongeBob SquarePants": "小編聊天口吻",
  湯姆貓與傑利鼠: "小編聊天口吻",
  "Tom and Jerry": "小編聊天口吻",
  "Looney Tunes": "小編聊天口吻",
  "Scooby-Doo": "小編聊天口吻",
  Garfield: "小編聊天口吻",
  辛普森家庭: "小編聊天口吻",
  "The Simpsons": "小編聊天口吻",
  南方四賤客: "小編聊天口吻",
  "South Park": "小編聊天口吻",
  瑞克和莫蒂: "小編聊天口吻",
  "Rick and Morty": "小編聊天口吻",
  "Gravity Falls": "小編聊天口吻",
  "The Boss Baby": "小編聊天口吻",
  蠟筆小新: "小編聊天口吻",
  Splatoon: "小編聊天口吻",
  Minecraft: "小編聊天口吻",
  間諜家家酒: "小編聊天口吻",
  鏈鋸人: "小編聊天口吻",
  "Chainsaw Man": "小編聊天口吻",
  名偵探柯南: "小編聊天口吻",
  我推的孩子: "小編聊天口吻",
  捉鬼敢死隊: "小編聊天口吻",
  Ghostbusters: "小編聊天口吻",
  孤獨搖滾: "小編聊天口吻",
  Deadpool: "小編聊天口吻",
  銀魂: "小編聊天口吻",
  膽大黨: "小編聊天口吻",
  "Suicide Squad": "小編聊天口吻",
  "The Boys": "小編聊天口吻",
  史瑞克: "小編聊天口吻",
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
