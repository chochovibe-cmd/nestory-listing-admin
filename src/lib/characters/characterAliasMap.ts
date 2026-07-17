/**
 * P2-79: code-side character alias patches (no DB migration).
 * 032 IP-layer aliases often include character nicknames that never landed on
 * ip_characters.aliases — findCharacterEntry / display only saw character_name.
 *
 * Map key = identity-normalized surface form (NFKC, trim, collapse spaces, lower for lookup via helper).
 * Value = { ip_name, character_name } canonical dictionary row.
 *
 * Scope: orthographic variants + character nicknames missing on character rows.
 * Intentionally skips franchise-only IP labels (e.g. 「七龍珠」→孫悟空) to avoid
 * false character hits when the model only knows the franchise.
 */

export type CharacterAliasPatch = {
  ip_name: string;
  character_name: string;
};

/** Surface form → canonical character. Keys stored in display form; lookup is case-insensitive. */
export const CHARACTER_ALIAS_PATCHES: ReadonlyArray<readonly [string, CharacterAliasPatch]> = [
  // Miffy — IP has 米飛/米菲兔子; character seed only 米菲/米菲兔/Nijntje
  ["米飛", { ip_name: "Miffy", character_name: "Miffy" }],
  ["米菲兔子", { ip_name: "Miffy", character_name: "Miffy" }],
  // Peter Rabbit
  ["小兔彼得", { ip_name: "Peter Rabbit", character_name: "Peter Rabbit" }],
  ["彼得兔子", { ip_name: "Peter Rabbit", character_name: "Peter Rabbit" }],
  // Paddington (variant spellings)
  ["柏林頓熊", { ip_name: "Paddington", character_name: "Paddington" }],
  ["帕丁顿熊", { ip_name: "Paddington", character_name: "Paddington" }],
  ["帕丁頓熊", { ip_name: "Paddington", character_name: "Paddington" }],
  // Monchhichi simplified
  ["梦奇奇", { ip_name: "Monchhichi", character_name: "Monchhichi" }],
  // Pusheen
  ["胖吉猫", { ip_name: "Pusheen", character_name: "Pusheen" }],
  ["胖胖貓", { ip_name: "Pusheen", character_name: "Pusheen" }],
  // Molang
  ["茉浪兔", { ip_name: "Molang", character_name: "Molang" }],
  // Esther Bunny simplified
  ["爱丝特兔", { ip_name: "Esther Bunny", character_name: "Esther Bunny" }],
  // Line Dog word-order / simplified
  ["小狗線條", { ip_name: "Line Dog", character_name: "Line Dog" }],
  ["小狗线条", { ip_name: "Line Dog", character_name: "Line Dog" }],
  // Mofusand simplified
  ["猫福珊迪", { ip_name: "Mofusand", character_name: "Mofusand Cat" }],
  ["鲨鱼猫", { ip_name: "Mofusand", character_name: "Mofusand Cat" }],
  // Rilakkuma common TW/CN nicknames not on character row
  ["懶懶熊", { ip_name: "Rilakkuma", character_name: "Rilakkuma" }],
  ["懒懒熊", { ip_name: "Rilakkuma", character_name: "Rilakkuma" }],
  ["鬆弛熊", { ip_name: "Rilakkuma", character_name: "Rilakkuma" }],
  ["松弛熊", { ip_name: "Rilakkuma", character_name: "Rilakkuma" }],
  // Tarepanda
  ["懶懶熊貓", { ip_name: "Tarepanda", character_name: "Tarepanda" }],
  ["懒懒熊猫", { ip_name: "Tarepanda", character_name: "Tarepanda" }],
  // Kapibarasan
  ["水豚仔", { ip_name: "Kapibarasan", character_name: "Kapibarasan" }],
  // Koupen Chan simplified
  ["肯定企鹅", { ip_name: "Koupen Chan", character_name: "Koupen Chan" }],
  // Nyan Nyan Nyanko simplified
  ["喵喵猫", { ip_name: "Nyan Nyan Nyanko", character_name: "Nyan Nyan Nyanko" }],
  // Pingu simplified
  ["企鹅家族", { ip_name: "Pingu", character_name: "Pingu" }],
  // Garfield simplified
  ["加菲猫", { ip_name: "Garfield", character_name: "Garfield" }],
  // Winnie simplified
  ["小熊维尼", { ip_name: "Winnie the Pooh", character_name: "Winnie the Pooh" }],
  ["维尼", { ip_name: "Winnie the Pooh", character_name: "Winnie the Pooh" }],
  // Spider-Man simplified
  ["蜘蛛侠", { ip_name: "Spider-Man", character_name: "Spider-Man" }],
  // POP MART family orthography
  ["哈奇噗噗", { ip_name: "HACIPUPU", character_name: "HACIPUPU" }],
  ["哭哭寶貝", { ip_name: "CRYBABY", character_name: "CRYBABY" }],
  ["哭哭宝贝", { ip_name: "CRYBABY", character_name: "CRYBABY" }],
  ["骷髅熊猫", { ip_name: "SKULLPANDA", character_name: "SKULLPANDA" }],
  ["宝宝三", { ip_name: "Baby Three", character_name: "Baby Three" }],
  ["Nanci 囡茜", { ip_name: "Nanci", character_name: "Nanci" }],
  // Shaun the Sheep
  ["小羊肖恩", { ip_name: "Shaun the Sheep", character_name: "Shaun" }],
  // Boss Baby simplified
  ["宝贝老板", { ip_name: "The Boss Baby", character_name: "Boss Baby" }],
  // Barbapapa extended
  ["巴巴家族", { ip_name: "Barbapapa", character_name: "Barbapapa" }],
];

function patchKey(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

const PATCH_LOOKUP: Map<string, CharacterAliasPatch> = new Map(
  CHARACTER_ALIAS_PATCHES.map(([surface, patch]) => [patchKey(surface), patch]),
);

/** Lookup code-side character alias patch (case/space insensitive). */
export function lookupCharacterAliasPatch(surface: string): CharacterAliasPatch | null {
  const key = patchKey(surface);
  if (!key) return null;
  return PATCH_LOOKUP.get(key) ?? null;
}
