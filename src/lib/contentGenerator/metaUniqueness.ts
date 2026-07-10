// A21-5 (文案·三之五b item 5): Meta Description uniqueness guard. Two
// warn-only checks (never blocks -- same posture as A11's forbiddenTerms):
//   1) content gap: the final meta_description should actually name the
//      character and a feature, not just the IP/type -- otherwise two
//      products under the same IP read identically to a searcher.
//   2) cross-product duplicate: same IP, near-identical meta_description
//      text -- Google treats these as duplicate content.
import {
  DisplayLabelContext,
  formatCharacterDisplayNameFromContext,
  formatCharacterShortNameFromContext,
} from './displayLabels';
import type { IpCharacter } from './sourceTypes';

function normalize(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').trim();
}

function buildCharacterTokens(character: string, ip: string, context: DisplayLabelContext): string[] {
  if (!character) return [];

  const tokens = new Set<string>();
  const add = (value: string | null | undefined) => {
    const normalized = normalize(value);
    if (normalized) tokens.add(normalized);
  };

  add(character);
  add(formatCharacterShortNameFromContext(character, ip, context));
  add(formatCharacterDisplayNameFromContext(character, ip, context));

  const entry = (context.ipCharacters ?? []).find(
    (item: Pick<IpCharacter, 'character_name' | 'ip_name' | 'aliases'>) =>
      normalize(item.character_name) === normalize(character),
  );
  entry?.aliases.forEach(add);

  return Array.from(tokens);
}

/** Warns when the final meta_description names neither the character nor any
 * extracted feature term -- only fires when we actually have a character/
 * feature to check against, so it never duplicates validation.ts's separate
 * "缺少角色資料" warning for products with no character at all. */
export function buildMetaContentGapWarning(
  metaDescription: string,
  character: string,
  ip: string,
  featureTerms: string[],
  context: DisplayLabelContext,
): string | null {
  const meta = metaDescription ?? '';
  if (!meta.trim()) return null;

  const missing: string[] = [];

  const characterTokens = buildCharacterTokens(character, ip, context);
  if (characterTokens.length > 0 && !characterTokens.some((token) => meta.includes(token))) {
    missing.push('角色');
  }

  if (featureTerms.length > 0 && !featureTerms.some((term) => meta.includes(term))) {
    missing.push('特色');
  }

  if (missing.length === 0) return null;

  return `Meta Description 未包含${missing.join('、')}關鍵字，建議人工確認是否要調整措辭讓商品更好區分。`;
}

function normalizeForCompare(value: string): string {
  return normalize(value)
    .toLowerCase()
    .replace(/[\s，。、！？!?.,|｜]/g, '');
}

function bigramSet(value: string): Set<string> {
  const chars = Array.from(value);
  const set = new Set<string>();
  for (let i = 0; i < chars.length - 1; i += 1) {
    set.add(chars[i] + chars[i + 1]);
  }
  return set;
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = bigramSet(a);
  const setB = bigramSet(b);
  if (setA.size === 0 || setB.size === 0) return a === b ? 1 : 0;

  let intersection = 0;
  for (const gram of setA) {
    if (setB.has(gram)) intersection += 1;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const DUPLICATE_SIMILARITY_THRESHOLD = 0.7;

export interface MetaSiblingDraft {
  id: string;
  title: string | null;
  metaDescription: string | null;
}

/** Warns when metaDescription is near-identical (character-bigram Jaccard
 * similarity) to another draft's already-generated meta under the same IP.
 * Caller is responsible for scoping `siblings` to the same ip_name and
 * excluding the current draft (route.ts does the actual DB query). */
export function buildMetaDuplicateWarning(
  metaDescription: string,
  siblings: MetaSiblingDraft[],
): string | null {
  const normalizedMeta = normalizeForCompare(metaDescription ?? '');
  if (!normalizedMeta) return null;

  for (const sibling of siblings) {
    const normalizedSibling = normalizeForCompare(sibling.metaDescription ?? '');
    if (!normalizedSibling) continue;

    const similarity = jaccardSimilarity(normalizedMeta, normalizedSibling);
    if (similarity >= DUPLICATE_SIMILARITY_THRESHOLD) {
      const label = sibling.title ? `「${sibling.title}」` : `草稿 ${sibling.id.slice(0, 8)}`;
      return `Meta Description 與同 IP 商品 ${label} 相似度過高（約 ${Math.round(similarity * 100)}%），Google 可能視為重複內容，建議調整措辭。`;
    }
  }

  return null;
}
