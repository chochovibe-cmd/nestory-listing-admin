import type { IpCatalogEntry, IpCharacter } from './sourceTypes';
import { lookupCharacterAliasPatch } from '@/lib/characters/characterAliasMap';

export type IpDisplayEntry = Pick<IpCatalogEntry, 'aliases' | 'ip_name'>;
export type CharacterDisplayEntry = Pick<IpCharacter, 'aliases' | 'character_name' | 'ip_name'>;

export type DisplayLabelContext = {
  ipCatalog?: IpDisplayEntry[];
  ipCharacters?: CharacterDisplayEntry[];
};

const IP_DISPLAY_OVERRIDES: Record<string, string> = {
  // A15: explicit safety net for the doc's literal example (\u4e09\u9e97\u9dd7 Sanrio) --
  // the generic alias-based fallback already produces this from ip_catalog's
  // seeded aliases (['Sanrio','\u30b5\u30f3\u30ea\u30aa']), but an override guarantees the
  // pairing even if that seed data is ever missing/edited.
  '\u4e09\u9e97\u9dd7': '\u4e09\u9e97\u9dd7 Sanrio',
  Sanrio: '\u4e09\u9e97\u9dd7 Sanrio',
  Miffy: '\u7c73\u83f2 Miffy',
  '\u7c73\u83f2': '\u7c73\u83f2 Miffy',
  Peanuts: '\u53f2\u52aa\u6bd4 Peanuts',
  '\u53f2\u52aa\u6bd4': '\u53f2\u52aa\u6bd4 Peanuts',
  '\u82b1\u751f\u6f2b\u756b': '\u82b1\u751f\u6f2b\u756b Peanuts',
  Moomin: '\u5695\u5695\u7c73 Moomin',
  '\u5695\u5695\u7c73': '\u5695\u5695\u7c73 Moomin',
  'Line Dog': '\u7dda\u689d\u5c0f\u72d7 Line Dog',
  '\u7dda\u689d\u5c0f\u72d7': '\u7dda\u689d\u5c0f\u72d7 Line Dog',
  'The Powerpuff Girls': '\u98db\u5929\u5c0f\u5973\u8b66 The Powerpuff Girls',
  '\u98db\u5929\u5c0f\u5973\u8b66': '\u98db\u5929\u5c0f\u5973\u8b66 The Powerpuff Girls',
  'Sumikko Gurashi': '\u89d2\u843d\u5c0f\u5925\u4f34 Sumikko Gurashi',
  '\u89d2\u843d\u5c0f\u5925\u4f34': '\u89d2\u843d\u5c0f\u5925\u4f34 Sumikko Gurashi',
  'Super Mario': '\u8d85\u7d1a\u746a\u5229\u6b50 Super Mario',
  Superman: '\u8d85\u4eba Superman',
  Tarepanda: '\u8db4\u8db4\u718a Tarepanda',
  'The Addams Family': '\u963f\u9054\u4e00\u65cf The Addams Family',
  'The Amazing World of Gumball': '\u963f\u7518\u5999\u4e16\u754c The Amazing World of Gumball',
  'The Boss Baby': '\u5bf6\u8c9d\u8001\u95c6 The Boss Baby',
  'The Boys': '\u9ed1\u888d\u7cfe\u5bdf\u968a The Boys',
  'The Flash': '\u9583\u96fb\u4fe0 The Flash',
  '\u795e\u5947\u5973\u4fe0': '\u795e\u529b\u5973\u8d85\u4eba Wonder Woman',
  '\u795e\u5947\u5973\u4fa0': '\u795e\u529b\u5973\u8d85\u4eba Wonder Woman',
  'Wonder Woman': '\u795e\u529b\u5973\u8d85\u4eba Wonder Woman',
  '\u585e\u5c14\u8fbe': '\u85a9\u723e\u9054\u50b3\u8aaa The Legend of Zelda',
  'The Legend of Zelda': '\u85a9\u723e\u9054\u50b3\u8aaa The Legend of Zelda',
  'The Little Prince': '\u5c0f\u738b\u5b50 The Little Prince',
  '\u84dd\u7cbe\u7075': '\u85cd\u8272\u5c0f\u7cbe\u9748 The Smurfs',
  'The Smurfs': '\u85cd\u8272\u5c0f\u7cbe\u9748 The Smurfs',
  ThunderCats: '\u9739\u9742\u8c93 ThunderCats',
  Splatoon: '\u6f06\u5f48\u5927\u4f5c\u6230 Splatoon',
  'We Bare Bears': '\u54b1\u5011\u88f8\u718a We Bare Bears',
  'X-Men': 'X\u6230\u8b66 X-Men',
  'Wallace & Gromit': '\u9177\u72d7\u5bf6\u8c9d Wallace & Gromit',
  THE_MONSTERS: 'THE MONSTERS',
};

const CHARACTER_SHORT_OVERRIDES: Record<string, string> = {
  Aquaman: '\u6c34\u884c\u4fe0',
  Avengers: '\u5fa9\u4ec7\u8005\u806f\u76df',
  Batman: '\u8759\u8760\u4fe0',
  'Captain America': '\u7f8e\u570b\u968a\u9577',
  Deadpool: '\u6b7b\u4f8d',
  'Harley Quinn': '\u54c8\u8389\u594e\u8335',
  'Iron Man': '\u92fc\u9435\u4eba',
  Joker: '\u5c0f\u4e11',
  'Justice League': '\u6b63\u7fa9\u806f\u76df',
  Miffy: '\u7c73\u83f2',
  Snoopy: '\u53f2\u52aa\u6bd4',
  'Spider-Man': '\u8718\u86db\u4eba',
  'Suicide Squad': '\u81ea\u6bba\u7a81\u64ca\u968a',
  Superman: '\u8d85\u4eba',
  'The Flash': '\u9583\u96fb\u4fe0',
  'Wonder Woman': '\u795e\u529b\u5973\u8d85\u4eba',
  Wolverine: '\u91d1\u92fc\u72fc',
  'X-Men': 'X\u6230\u8b66',
  Blossom: '\u82b1\u82b1',
  Bubbles: '\u6ce1\u6ce1',
  Buttercup: '\u6bdb\u6bdb',
  Labubu: '\u62c9\u5e03\u5e03',
  'Line Dog': '\u7dda\u689d\u5c0f\u72d7',
};

const SIMPLIFIED_HINTS = /[\u4e3d\u9e25\u7ebf\u6761\u98de\u4f19\u4f34\u5b9d\u68a6\u7b14\u753b\u864e\u9f99\u6218\u6597\u8fdb\u51fb\u5de8\u4eba]/;

const DC_CHILD_IP_NAMES = new Set([
  'Aquaman',
  'Batman',
  'DC Comics',
  'Harley Quinn',
  'Joker',
  'Justice League',
  'Suicide Squad',
  'Superman',
  'The Flash',
  'Wonder Woman',
]);

const MARVEL_CHILD_IP_NAMES = new Set([
  'Avengers',
  'Captain America',
  'Deadpool',
  'Iron Man',
  'Marvel',
  'Spider-Man',
  'Wolverine',
  'X-Men',
]);

function normalize(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value: string | null | undefined): string {
  return normalize(value).toLowerCase();
}

function hasCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function hasLatin(value: string): boolean {
  return /[A-Za-z]/.test(value);
}

function isMostlyEnglish(value: string): boolean {
  const nextValue = normalize(value);
  return hasLatin(nextValue) && !hasCjk(nextValue);
}

function isLikelyTraditional(value: string): boolean {
  return hasCjk(value) && !SIMPLIFIED_HINTS.test(value);
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.map(normalize).filter(Boolean)));
}

function pickChineseAlias(aliases: string[]): string {
  const values = uniqueValues(aliases);
  return values.find(isLikelyTraditional) ?? values.find(hasCjk) ?? '';
}

function pickEnglishAlias(aliases: string[]): string {
  const values = uniqueValues(aliases).filter(isMostlyEnglish);
  const nonAcronyms = values.filter((value) => value.length > 3 || value.includes(' '));
  return nonAcronyms.sort((a, b) => b.length - a.length)[0] ?? values[0] ?? '';
}

function splitDisplayTokens(value: string): string[] {
  return uniqueValues(
    normalize(value)
      .split(/[\s/|,\u3001\uff0c]+/)
      .map((token) => token.trim()),
  );
}

function findIpEntry(ipName: string, ipCatalog: IpDisplayEntry[] = []): IpDisplayEntry | null {
  const target = normalizeKey(ipName);
  return ipCatalog.find((entry) => normalizeKey(entry.ip_name) === target) ?? null;
}

function characterEntryTerms(entry: CharacterDisplayEntry): string[] {
  return [entry.character_name, ...(entry.aliases ?? [])].map(normalize).filter(Boolean);
}

/**
 * P2-79: match character_name OR aliases (and code-side alias patches).
 * Previously only character_name was compared, so 「米飛」 never hit Miffy.
 */
function findCharacterEntry(
  characterName: string,
  ipName: string,
  ipCharacters: CharacterDisplayEntry[] = [],
): CharacterDisplayEntry | null {
  const targetCharacter = normalizeKey(characterName);
  const targetIp = normalizeKey(ipName);
  if (!targetCharacter) return null;

  const matchTerms = (entry: CharacterDisplayEntry) =>
    characterEntryTerms(entry).some((term) => normalizeKey(term) === targetCharacter);

  if (targetIp) {
    const inIp = ipCharacters.find((entry) => normalizeKey(entry.ip_name) === targetIp && matchTerms(entry));
    if (inIp) return inIp;
  }

  const byAliasOrName = ipCharacters.find(matchTerms);
  if (byAliasOrName) return byAliasOrName;

  // Code-side patches (032 character-layer gaps, no DB migration)
  const patch = lookupCharacterAliasPatch(characterName);
  if (patch) {
    if (targetIp && targetIp !== normalizeKey(patch.ip_name)) {
      // keep searching without forcing cross-IP
    } else {
      const patched =
        ipCharacters.find(
          (entry) =>
            normalizeKey(entry.ip_name) === normalizeKey(patch.ip_name) &&
            normalizeKey(entry.character_name) === normalizeKey(patch.character_name),
        ) ??
        ipCharacters.find(
          (entry) => normalizeKey(entry.character_name) === normalizeKey(patch.character_name),
        );
      if (patched) return patched;
      // Synthetic entry so short-name overrides still apply for known patches
      return {
        ip_name: patch.ip_name,
        character_name: patch.character_name,
        aliases: [normalize(characterName)],
      };
    }
  }

  return null;
}

export function formatIpDisplayName(ipName: string, aliases: string[] = []): string {
  const normalizedIpName = normalize(ipName);

  if (!normalizedIpName) {
    return '';
  }

  const override = IP_DISPLAY_OVERRIDES[normalizedIpName] ?? IP_DISPLAY_OVERRIDES[normalizedIpName.replace(/ /g, '_')];
  if (override) {
    return override;
  }

  if (isMostlyEnglish(normalizedIpName)) {
    const chineseAlias = pickChineseAlias(aliases);
    return chineseAlias ? chineseAlias + ' ' + normalizedIpName : normalizedIpName;
  }

  const englishAlias = pickEnglishAlias(aliases);
  return englishAlias ? normalizedIpName + ' ' + englishAlias : normalizedIpName;
}

export function formatCharacterDisplayName(characterName: string, aliases: string[] = []): string {
  const normalizedCharacterName = normalize(characterName);

  if (!normalizedCharacterName) {
    return '';
  }

  const shortOverride = CHARACTER_SHORT_OVERRIDES[normalizedCharacterName];

  if (isMostlyEnglish(normalizedCharacterName)) {
    const chineseAlias = shortOverride ?? pickChineseAlias(aliases);
    return chineseAlias ? chineseAlias + ' ' + normalizedCharacterName : normalizedCharacterName;
  }

  const englishAlias = pickEnglishAlias(aliases);
  return englishAlias ? normalizedCharacterName + ' ' + englishAlias : normalizedCharacterName;
}

export function formatIpDisplayNameFromContext(ipName: string, context: DisplayLabelContext = {}): string {
  const entry = findIpEntry(ipName, context.ipCatalog);
  return formatIpDisplayName(entry?.ip_name ?? ipName, entry?.aliases ?? []);
}

export function formatListingIpDisplayNameFromContext(ipName: string, context: DisplayLabelContext = {}): string {
  const entry = findIpEntry(ipName, context.ipCatalog);
  const canonicalIpName = normalize(entry?.ip_name ?? ipName);

  if (DC_CHILD_IP_NAMES.has(canonicalIpName)) {
    return 'DC';
  }

  if (MARVEL_CHILD_IP_NAMES.has(canonicalIpName)) {
    return 'Marvel';
  }

  return formatIpDisplayName(entry?.ip_name ?? ipName, entry?.aliases ?? []);
}

export function formatCharacterDisplayNameFromContext(
  characterName: string,
  ipName: string,
  context: DisplayLabelContext = {},
): string {
  const entry = findCharacterEntry(characterName, ipName, context.ipCharacters);
  return formatCharacterDisplayName(entry?.character_name ?? characterName, entry?.aliases ?? []);
}

export function formatCharacterShortName(characterName: string, aliases: string[] = []): string {
  const normalizedCharacterName = normalize(characterName);

  if (!normalizedCharacterName) {
    return '';
  }

  const override = CHARACTER_SHORT_OVERRIDES[normalizedCharacterName];
  if (override) {
    return override;
  }

  if (isMostlyEnglish(normalizedCharacterName)) {
    return pickChineseAlias(aliases) || normalizedCharacterName;
  }

  return normalizedCharacterName;
}

export function formatCharacterShortNameFromContext(
  characterName: string,
  ipName: string,
  context: DisplayLabelContext = {},
): string {
  const entry = findCharacterEntry(characterName, ipName, context.ipCharacters);
  return formatCharacterShortName(entry?.character_name ?? characterName, entry?.aliases ?? []);
}

export function isCharacterRedundantWithIpDisplay(characterName: string, ipDisplayName: string): boolean {
  const characterTokens = splitDisplayTokens(characterName);
  const ipTokens = splitDisplayTokens(ipDisplayName);

  return characterTokens.some((characterToken) =>
    ipTokens.some((ipToken) => normalizeKey(ipToken) === normalizeKey(characterToken)),
  );
}

export function removeDuplicateDisplayTerms(values: string[]): string[] {
  const result: string[] = [];
  const seenTokens = new Set<string>();

  for (const value of values.map(normalize).filter(Boolean)) {
    const tokens = splitDisplayTokens(value).map(normalizeKey);
    const hasDuplicate = tokens.some((token) => seenTokens.has(token));

    if (hasDuplicate) {
      continue;
    }

    result.push(value);
    tokens.forEach((token) => seenTokens.add(token));
  }

  return result;
}
