/** Canonical Taiwan names for Sanrio characters used by COPY-A2c. */
export const TAIWAN_CHARACTER_NAMES = {
  Cinnamoroll: '大耳狗',
  Pompompurin: '布丁狗',
  Kuromi: '酷洛米',
  'My Melody': '美樂蒂',
  Pochacco: '帕恰狗',
  Hangyodon: '人魚漢頓',
  'Little Twin Stars': '雙子星',
  Gudetama: '蛋黃哥',
  Tuxedosam: '山姆企鵝',
  'Badtz-Maru': '酷企鵝',
  Keroppi: '大眼蛙',
} as const;

export type TaiwanCharacterNameField = 'seoTitle' | 'metaDescription' | (string & {});

const MAINLAND_NAMES: ReadonlyArray<readonly [string, string]> = [
  ['玉桂狗', '大耳狗'],
  ['库洛米', '酷洛米'],
  ['美乐蒂', '美樂蒂'],
];

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function isSeoField(field: TaiwanCharacterNameField): boolean {
  return field === 'seoTitle' || field === 'metaDescription';
}

function hasNearbyTaiwanName(text: string, start: number, end: number, taiwanName: string): boolean {
  const before = text.slice(Math.max(0, start - taiwanName.length - 4), start);
  const after = text.slice(end, Math.min(text.length, end + taiwanName.length + 4));
  // A Taiwan name within three characters already identifies the character.
  const prefix = new RegExp(`${escapeRegExp(taiwanName)}[\\s\\S]{0,3}$`);
  const suffix = new RegExp(`^[\\s\\S]{0,3}${escapeRegExp(taiwanName)}`);
  return prefix.test(before) || suffix.test(after);
}

/**
 * Normalize character names to Taiwan usage. SEO fields retain English names
 * for search discovery, while the three explicitly listed mainland variants
 * are normalized in every field.
 */
export function applyTaiwanCharacterNames(text: string, field: TaiwanCharacterNameField): string {
  if (typeof text !== 'string' || text.length === 0) return text;

  let result = text;
  for (const [mainlandName, taiwanName] of MAINLAND_NAMES) {
    result = result.replace(new RegExp(escapeRegExp(mainlandName), 'g'), taiwanName);
  }

  if (isSeoField(field)) return result;

  for (const [englishName, taiwanName] of Object.entries(TAIWAN_CHARACTER_NAMES)) {
    const escaped = `(?<![A-Za-z])${escapeRegExp(englishName)}(?![A-Za-z])`;
    const chinese = escapeRegExp(taiwanName);
    result = result
      .replace(new RegExp(chinese + '[^\\p{L}\\p{N}]{0,3}' + escaped + '[）)]?', 'giu'), taiwanName)
      .replace(new RegExp(escaped + '[^\\p{L}\\p{N}]{0,3}' + chinese + '[）)]?', 'giu'), taiwanName);
    // Match optional paired parentheses so removing a duplicate English name
    // also removes its now-empty brackets.
    const namePattern = new RegExp(`(?:（${escaped}）|\\(${escaped}\\)|${escaped})`, 'gi');
    result = result.replace(namePattern, (matched, offset: number, whole: string) => {
      const start = Number(offset);
      const end = start + matched.length;
      return hasNearbyTaiwanName(whole, start, end, taiwanName) ? '' : taiwanName;
    });
  }

  return result.replace(new RegExp('(' + Object.values(TAIWAN_CHARACTER_NAMES).join('|') + ')\\s+(?=的)', 'gu'), '$1').trim();
}
