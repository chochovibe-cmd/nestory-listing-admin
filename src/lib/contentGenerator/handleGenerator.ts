// A21-1 (文案·三之五b item 1): rule-engine Shopify handle slug. Without this,
// Shopify falls back to deriving the handle from the (Chinese) title itself,
// which produces a percent-encoded/garbled URL instead of a readable
// romanized one -- this builds "{ip}-{character}-{type}" from ip_catalog /
// ip_characters' English aliases (the same alias data titleGenerator /
// seoGenerator already use for display names) so the handle stays readable.
import { DisplayLabelContext } from './displayLabels';
import type { IpCatalogEntry, IpCharacter } from './sourceTypes';

// Canonical product-type label -> English slug word. Same 8-key space as
// scenarioKeywords.ts / titleGenerator.ts's PRODUCT_TYPE_ALIASES (both are
// keyed off normalizeProductTypeForDisplay()'s output) -- no new taxonomy.
const PRODUCT_TYPE_SLUGS: Record<string, string> = {
  絨毛娃娃: 'plush',
  吊飾掛件: 'keychain',
  盲盒: 'blind-box',
  扭蛋: 'capsule-toy',
  娃娃抱枕: 'plush-pillow',
  壓克力立牌: 'acrylic-stand',
  手機支架: 'phone-stand',
  公仔模型: 'figure',
};

function normalize(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').trim();
}

function isLatinWord(value: string): boolean {
  return /[A-Za-z]/.test(value) && !/[㐀-鿿]/.test(value);
}

function slugifyWord(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Deterministic 4-letter fallback for names with no ASCII alias yet, so a
// slug segment is never empty or (worse) raw Chinese passed through to a URL.
// Same idea as sku.ts's hashToCode -- kept local since that one is a
// differently-shaped (3-letter, uppercase) unexported helper for SKUs.
function stableFallbackSlug(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  let hash = 0;
  for (const char of trimmed) {
    hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  }

  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  let code = '';
  let remainder = hash;
  for (let i = 0; i < 4; i += 1) {
    code += alphabet[remainder % alphabet.length];
    remainder = Math.floor(remainder / alphabet.length);
  }
  return code;
}

function pickAsciiAliasSlug(aliases: string[] = []): string {
  const slugs = aliases
    .map(normalize)
    .filter(isLatinWord)
    .map(slugifyWord)
    .filter(Boolean);

  return slugs.sort((a, b) => b.length - a.length)[0] ?? '';
}

function resolveNameSlug(name: string, aliases: string[] = []): string {
  const normalized = normalize(name);
  if (!normalized) return '';

  const aliasSlug = pickAsciiAliasSlug(aliases);
  if (aliasSlug) return aliasSlug;

  if (isLatinWord(normalized)) {
    const ownSlug = slugifyWord(normalized);
    if (ownSlug) return ownSlug;
  }

  return stableFallbackSlug(normalized);
}

export interface HandleSlugInput {
  ip: string | null | undefined;
  character?: string | null | undefined;
  productType?: string | null | undefined;
}

/** Ordered [ip, character, type] slug words, de-duped when two segments
 * romanize the same (e.g. a character's alias equals its IP's alias).
 * Shared by the Shopify handle (A21-1) and the Shopify Files image filename
 * (A21-4) so both stay built from the same product identity. */
export function buildProductSlugSegments(
  input: HandleSlugInput,
  context: DisplayLabelContext = {},
): string[] {
  const ipEntry = (context.ipCatalog ?? []).find(
    (entry: Pick<IpCatalogEntry, 'ip_name' | 'aliases'>) => normalize(entry.ip_name) === normalize(input.ip),
  );
  const ipSlug = input.ip ? resolveNameSlug(input.ip, ipEntry?.aliases) : '';

  const characterEntry = input.character
    ? (context.ipCharacters ?? []).find(
        (entry: Pick<IpCharacter, 'character_name' | 'ip_name' | 'aliases'>) =>
          normalize(entry.character_name) === normalize(input.character) &&
          (!input.ip || normalize(entry.ip_name) === normalize(input.ip)),
      )
    : undefined;
  const characterSlug = input.character ? resolveNameSlug(input.character, characterEntry?.aliases) : '';

  const typeSlug = input.productType ? PRODUCT_TYPE_SLUGS[normalize(input.productType)] ?? '' : '';

  const segments = [ipSlug, characterSlug, typeSlug].filter(Boolean);
  return segments.filter((segment, index) => segments[index - 1] !== segment);
}

const HANDLE_MAX_LENGTH = 80;

export function generateShopifyHandleSlug(
  input: HandleSlugInput,
  context: DisplayLabelContext = {},
): string {
  const slug = buildProductSlugSegments(input, context).join('-').replace(/-{2,}/g, '-');
  const trimmed = slug.slice(0, HANDLE_MAX_LENGTH).replace(/-+$/g, '');
  return trimmed || 'nestory-product';
}
