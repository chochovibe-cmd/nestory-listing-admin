/**
 * P5 層2：IP 背景資料包（knowledge_pack）。
 * 生成時注入 prompt 事實區——僅供語感／情境／粉絲共鳴；
 * **不得**作為規格數字或商品事實來源（規格走既有證據池）。
 *
 * 存放：ip_catalog.knowledge_pack jsonb（migration 038）
 * DEFAULT 在 code；DB 非空列覆蓋同 key（與 A16／IP_TONE_MAP 同模式）。
 */

export const IP_KNOWLEDGE_PACK_MAX_CHARS = 600;
export const IP_KNOWLEDGE_PACK_VERSION = 1;

export const IP_KNOWLEDGE_HONESTY_RULE =
  "僅供語感、情境、粉絲共鳴的描寫，不得作為規格數字與商品事實的來源——規格仍以賣家自標、規格圖 OCR、網搜證據池為準，不確定不寫。";

export interface IpKnowledgePack {
  relations: string;
  scenes: string;
  fandom_hooks: string;
  keywords: string[];
  updated_at?: string;
  version?: number;
}

export type IpKnowledgePackMap = Record<string, IpKnowledgePack>;

const UPDATED = "2026-07-19";

function pack(
  relations: string,
  scenes: string,
  fandom_hooks: string,
  keywords: string[],
): IpKnowledgePack {
  return {
    relations,
    scenes,
    fandom_hooks,
    keywords,
    updated_at: UPDATED,
    version: IP_KNOWLEDGE_PACK_VERSION,
  };
}

/**
 * P5 層2 Top21（老闆 2026-07-19：原 Top20 + Miffy）。
 * Key = ip_catalog.ip_name 可能值；同 IP 中英雙 key 防 merge 落空。
 */
export const DEFAULT_IP_KNOWLEDGE_PACKS: IpKnowledgePackMap = {
  吉伊卡哇: pack(
    "吉伊（Chiikawa）膽小愛哭愛吃；好友小八（Hachiware）溫柔穩重；兔兔（Usagi）奔放愛喊「ヤハ」；栗子饅頭、獅薩等常一起出現。",
    "討伐怪物、泡澡、上班、吃草泥馬肉包、被奇怪生物追、三人日常互動。",
    "討伐、小可愛、ヤハ、那個誰、くりまんじゅう。",
    ["ちいかわ", "小八", "兔兔", "討伐", "療癒"],
  ),
  三麗鷗: pack(
    "Hello Kitty 為品牌核心；大耳狗、美樂蒂、酷洛米、布丁狗、大寶等角色各自粉絲圈，常聯名跨界。",
    "三麗鷗樂園、角色生日祭、粉紅／酷黑配色周邊、聯名家電與小物。",
    "Kitty 蝴蝶結、酷洛米反差萌、大耳狗純白療癒、三麗鷗男子。",
    ["Sanrio", "Hello Kitty", "酷洛米", "大耳狗", "美樂蒂"],
  ),
  "Sumikko Gurashi": pack(
    "角落生物喜歡待在角落；白熊、企鵝？、貓、炸豬排、蜥蜴等各有內向小故事，角落妖精偶爾登場。",
    "縮在角落、喫茶店、學校、海洋、旅行主題的角落日常。",
    "角落、內向、炸豬排是假貨？、企鵝其實是皇帝企鵝。",
    ["すみっコぐらし", "角落生物", "白熊", "炸豬排", "療癒"],
  ),
  角落小夥伴: pack(
    "角落生物喜歡待在角落；白熊、企鵝？、貓、炸豬排、蜥蜴等各有內向小故事，角落妖精偶爾登場。",
    "縮在角落、喫茶店、學校、海洋、旅行主題的角落日常。",
    "角落、內向、炸豬排是假貨？、企鵝其實是皇帝企鵝。",
    ["すみっコぐらし", "角落生物", "白熊", "炸豬排", "療癒"],
  ),
  角落生物: pack(
    "角落生物喜歡待在角落；白熊、企鵝？、貓、炸豬排、蜥蜴等各有內向小故事。",
    "縮在角落、喫茶店、學校、旅行主題日常。",
    "角落、內向、炸豬排是假貨？",
    ["すみっコぐらし", "角落生物", "白熊", "療癒"],
  ),
  Mofusand: pack(
    "mofusand 筆下貓咪常戴鯊魚帽或變裝；無固定劇情主線，以插畫造型系列為主。",
    "鯊魚貓、食物變裝、海洋與甜點主題插畫周邊。",
    "鯊魚貓、モフサンド、軟萌變裝貓。",
    ["mofusand", "貓福珊迪", "鯊魚貓", "モフサンド"],
  ),
  寶可夢: pack(
    "訓練家收服寶可夢冒險；皮卡丘為招牌，御三家、進化鏈、道館與聯盟是核心結構。",
    "初次選寶可夢、進化瞬間、道館徽章、傳說遇敵、寶可夢中心。",
    "收服、進化、道館、我選擇你、圖鑑收集。",
    ["Pokémon", "皮卡丘", "訓練家", "進化", "圖鑑"],
  ),
  鬼滅之刃: pack(
    "竈門炭治郎尋妹禰豆子（鬼化）之路；義勇、善逸、伊之助等同儕；柱們與鬼舞辻無慘對立。",
    "水之呼吸型、全集中、那田蜘蛛山、無限列車、遊郭、刀鍛冶之里。",
    "全集中、呼吸法、豆子箱、善逸睡觉放電、岩柱幽默。",
    ["鬼滅", "炭治郎", "禰豆子", "呼吸", "柱"],
  ),
  航海王: pack(
    "蒙其·D·魯夫組草帽海賊團尋找 One Piece；伙伴各有夢想，與四皇、海軍、革命軍交錯。",
    "伸縮橡膠拳、懸賞單更新、惡魔果實覺醒、海上餐廳與新世界島嶼。",
    "肉、夥伴、海賊王、懸賞金、D 之一族。",
    ["ONE PIECE", "魯夫", "草帽", "惡魔果實", "懸賞"],
  ),
  火影忍者: pack(
    "漩渦鳴人立志成為火影；佐助復仇線、卡卡西指導、忍界大戰與尾獸。",
    "影分身、寫輪眼／輪迴眼、中忍考試、佩恩襲擊木葉、終末之谷。",
    "鳴人啊、曉、查克拉、羈絆、忍道。",
    ["Naruto", "鳴人", "佐助", "火影", "忍術"],
  ),
  咒術迴戰: pack(
    "虎杖悠仁吞宿儺手指進入咒術高專；伏黑、釘崎、五條悟與咒詛師／咒靈對抗。",
    "領域展開、渋谷事變、特級咒物、無量空處。",
    "領域展開、宿儺、五條老師、咒力。",
    ["JJK", "虎杖", "五條悟", "領域展開", "咒靈"],
  ),
  鏈鋸人: pack(
    "淀治與波奇塔合體成電鋸人；瑪奇瑪、早川秋、帕瓦等同儕與惡魔公使線交錯，黑色幽默重。",
    "電鋸啟動、惡魔契約、公安對惡魔、突如其來的悲劇反轉。",
    "波奇塔、電次、黑暗幽默、惡魔名字梗。",
    ["Chainsaw Man", "電鋸人", "波奇塔", "瑪奇瑪", "惡魔"],
  ),
  蠟筆小新: pack(
    "野原新之助一家住春日部；風間、阿呆、正男、妮妮是幼稚園同學，動感超人是偶像。",
    "屁股舞、動感超人變身、媽媽揍小新、旅行與劇場版冒險。",
    "喔喔喔、動感光波、屁股左搖右搖、媽媽的拖鞋。",
    ["小新", "春日部", "動感超人", "野原", "幼稚園"],
  ),
  間諜家家酒: pack(
    "黃昏（洛伊德）假結婚約兒，領養安妮亞組成偽裝家庭；約兒暗地是刺客，邦德是超能狗。",
    "作業竊聽、優雅的暗殺、花生迷安妮亞、東國西國冷戰日常。",
    "哇酷哇酷、洛伊德的假笑、尤里姐控、花生。",
    ["SPY×FAMILY", "安妮亞", "洛伊德", "約兒", "邦德"],
  ),
  葬送的芙莉蓮: pack(
    "魔法使芙莉蓮壽命極長，勇者一行解散後重新踏上理解「人」的旅途；菲倫、修塔爾克同行。",
    "勇者希梅爾之墓、魔法考試、惡魔交涉、風景與告別。",
    "旅途很長、希梅爾會怎麼做、魔法收集。",
    ["Frieren", "芙莉蓮", "菲倫", "希梅爾", "魔法"],
  ),
  迪士尼: pack(
    "迪士尼經典與皮克斯角色宇宙；米奇家族為符號，公主系列、反派與主題樂園體驗並存。",
    "樂園遊行、經典童話結局、跨作品彩蛋與紀念周邊。",
    "夢想、魔法、迪士尼公主、米老鼠剪影。",
    ["Disney", "米奇", "公主", "樂園", "經典"],
  ),
  星際寶貝: pack(
    "實驗體 626 史迪奇流落夏威夷，被里洛收養；「歐哈納」＝家人，彼此不拋棄。",
    "衝浪、草裙舞、太空追緝、史迪奇搗蛋與贖罪。",
    "歐哈納、阿囉哈、626、藍色搗蛋鬼。",
    ["Stitch", "史迪奇", "里洛", "歐哈納", "夏威夷"],
  ),
  "Lilo & Stitch": pack(
    "實驗體 626 史迪奇流落夏威夷，被里洛收養；歐哈納＝家人。",
    "衝浪、搗蛋、太空追緝與家庭羈絆。",
    "歐哈納、626、阿囉哈。",
    ["Stitch", "史迪奇", "里洛", "歐哈納"],
  ),
  美少女戰士: pack(
    "月野兔變身水手月亮，與水手戰士守護地球；地場衛／タキシード假面、月野貓露娜同行。",
    "變身咒語、月光權杖、銀水晶、對暗黑王國戰鬥。",
    "以月亮之名、變身器、內在宇宙、美戰老粉懷舊。",
    ["Sailor Moon", "水手月亮", "月光", "銀水晶", "變身"],
  ),
  初音未來: pack(
    "Crypton 虛擬歌姬 Hatsune Miku；蔥意象、粉絲創作歌曲與Live，無單一官方劇情主線。",
    "演唱會全息Live、磁鐵舞、雙馬尾蔥色造型。",
    "世界第一的公主殿下、蔥、VOCALOID、DD。",
    ["Miku", "VOCALOID", "初音", "雙馬尾", "全息"],
  ),
  "THE MONSTERS": pack(
    "泡泡瑪特 THE MONSTERS 系列；Labubu 尖牙精靈最具辨識度，與其他怪物造型並存，偏潮玩收藏。",
    "盲盒開箱、大型公仔、聯名與隱藏款追獵。",
    "Labubu、拉布布、隱藏款、潮玩櫃。",
    ["Labubu", "拉布布", "POP MART", "盲盒", "潮玩"],
  ),
  哈利波特: pack(
    "哈利進入霍格華茲，與榮恩、赫敏組團對抗佛地魔；學院帽分院、魔法世界法則完整。",
    "上車九又四分之三月台、魁地奇、三巫鬥法、霍格華茲戰役。",
    "分院、妙麗的包、阿瓦達索命、馬份對立。",
    ["Harry Potter", "霍格華茲", "魔法", "分院", "魔杖"],
  ),
  "Harry Potter": pack(
    "哈利進入霍格華茲，與榮恩、赫敏對抗佛地魔；學院與魔法世界法則完整。",
    "九又四分之三月台、魁地奇、霍格華茲戰役。",
    "分院、三強、魔法世界。",
    ["Harry Potter", "霍格華茲", "魔法", "分院"],
  ),
  Marvel: pack(
    "漫威英雄宇宙；復仇者、蜘蛛人、X 戰警等支線交錯，電影宇宙（MCU）強化大眾記憶。",
    "英雄集結、無限寶石、身份揭祕、城市大戰。",
    "I am Iron Man、無限手套、英雄穿模。",
    ["漫威", "復仇者", "MCU", "英雄", "超能力"],
  ),
  Miffy: pack(
    "Dick Bruna 創作的米菲兔；線條簡潔、色彩明亮，家人與小動物朋友構成溫柔繪本世界。",
    "騎腳踏車、過生日、看星星、日常生活小事件。",
    "米飛／米菲、荷蘭繪本、簡筆兔、Nijntje。",
    ["米菲", "米飛", "Nijntje", "Dick Bruna", "繪本"],
  ),
};

export function parseKnowledgePack(raw: unknown): IpKnowledgePack | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const relations = typeof o.relations === "string" ? o.relations.trim() : "";
  const scenes = typeof o.scenes === "string" ? o.scenes.trim() : "";
  const fandom_hooks = typeof o.fandom_hooks === "string" ? o.fandom_hooks.trim() : "";
  const keywords = Array.isArray(o.keywords)
    ? o.keywords
        .map((k) => (typeof k === "string" ? k.trim() : ""))
        .filter(Boolean)
    : [];
  if (!relations && !scenes && !fandom_hooks && keywords.length === 0) return null;
  return {
    relations,
    scenes,
    fandom_hooks,
    keywords,
    updated_at: typeof o.updated_at === "string" ? o.updated_at : undefined,
    version: typeof o.version === "number" ? o.version : undefined,
  };
}

/** DB rows overlay DEFAULT; empty/null DB pack keeps DEFAULT for that key. */
export function mergeKnowledgePackMap(
  dbRows: Array<{ ip_name: string; knowledge_pack?: unknown }> | null | undefined,
): IpKnowledgePackMap {
  const merged: IpKnowledgePackMap = { ...DEFAULT_IP_KNOWLEDGE_PACKS };
  if (!dbRows) return merged;
  for (const row of dbRows) {
    const key = (row.ip_name ?? "").normalize("NFKC").trim();
    if (!key) continue;
    const parsed = parseKnowledgePack(row.knowledge_pack);
    if (parsed) merged[key] = parsed;
  }
  return merged;
}

export function lookupKnowledgePack(
  ipName: string | null | undefined,
  map: IpKnowledgePackMap = DEFAULT_IP_KNOWLEDGE_PACKS,
): IpKnowledgePack | null {
  const key = (ipName ?? "").normalize("NFKC").trim();
  if (!key) return null;
  return map[key] ?? null;
}

/** Best-effort: longest catalog name/alias found in title (for first-pass pack). */
export function guessIpNameFromTitle(
  title: string,
  catalog: Array<{ ip_name: string; aliases?: string[] | null }>,
): string | null {
  const t = (title ?? "").normalize("NFKC");
  if (!t.trim() || !catalog.length) return null;
  let best: { name: string; len: number } | null = null;
  for (const entry of catalog) {
    const names = [entry.ip_name, ...(entry.aliases ?? [])]
      .map((n) => (n ?? "").normalize("NFKC").trim())
      .filter((n) => n.length >= 2);
    for (const name of names) {
      if (t.includes(name) && (!best || name.length > best.len)) {
        best = { name: entry.ip_name, len: name.length };
      }
    }
  }
  return best?.name ?? null;
}

export function formatKnowledgePackBody(pack: IpKnowledgePack): string {
  const lines: string[] = [];
  if (pack.relations.trim()) lines.push(`角色關係：${pack.relations.trim()}`);
  if (pack.scenes.trim()) lines.push(`名場面：${pack.scenes.trim()}`);
  if (pack.fandom_hooks.trim()) lines.push(`粉絲梗：${pack.fandom_hooks.trim()}`);
  if (pack.keywords.length > 0) {
    lines.push(`關鍵字：${pack.keywords.map((k) => k.trim()).filter(Boolean).join("、")}`);
  }
  return lines.join("\n");
}

export function truncateKnowledgePackText(
  text: string,
  maxChars: number = IP_KNOWLEDGE_PACK_MAX_CHARS,
): { text: string; truncated: boolean } {
  const normalized = text.normalize("NFKC").trim();
  if (normalized.length <= maxChars) return { text: normalized, truncated: false };
  return { text: `${normalized.slice(0, Math.max(0, maxChars - 1))}…`, truncated: true };
}

/**
 * Full inject block for copy user message (includes honesty rule).
 * Returns null when no usable pack content.
 */
export function buildIpKnowledgePromptBlock(
  pack: IpKnowledgePack | null | undefined,
  options?: { maxChars?: number },
): { block: string; truncated: boolean } | null {
  if (!pack) return null;
  const body = formatKnowledgePackBody(pack);
  if (!body.trim()) return null;
  const { text, truncated } = truncateKnowledgePackText(body, options?.maxChars);
  const block =
    `IP 背景資料包（${IP_KNOWLEDGE_HONESTY_RULE}）\n${text}`;
  return { block, truncated };
}

/** When no pack and no search hit — honest neutral writing. */
export const IP_BACKGROUND_NEUTRAL_INSTRUCTION =
  "此 IP 無建檔背景資料包，且未取得可用的網路背景：請依已提供的外觀／材質／用途等事實中性書寫，勿裝熟粉、勿捏造角色關係、名場面或粉絲梗。";

export function buildIpBackgroundSearchPromptBlock(summary: string): string {
  const body = summary.normalize("NFKC").trim();
  return (
    `IP 網路背景補充（${IP_KNOWLEDGE_HONESTY_RULE}；搜尋內容須核實，不確定勿寫）\n${body}`
  );
}

export function countKnowledgePackChars(pack: IpKnowledgePack): number {
  return formatKnowledgePackBody(pack).length;
}
