// A21-1 (文案·三之五b item 1): rule-engine Shopify handle slug. Without this,
// Shopify falls back to deriving the handle from the (Chinese) title itself,
// which produces a percent-encoded/garbled URL instead of a readable
// romanized one -- this builds "{ip}-{character}-{type}" from ip_catalog /
// ip_characters' English aliases (the same alias data titleGenerator /
// seoGenerator already use for display names) so the handle stays readable.
import { DisplayLabelContext } from './displayLabels';
import type { IpCatalogEntry, IpCharacter } from './sourceTypes';

// Canonical product-type label -> English slug word. Keyed off
// normalizeProductTypeForDisplay()'s output (same space as scenarioKeywords /
// titleGenerator PRODUCT_TYPE_ALIASES). P6: +滑鼠／鍵盤／手把控制器／保溫杯瓶／大型娃娃.
// Remaining catalog types without slugs → empty type segment (stable hash still OK).
const PRODUCT_TYPE_SLUGS: Record<string, string> = {
  絨毛娃娃: 'plush',
  吊飾掛件: 'keychain',
  盲盒: 'blind-box',
  扭蛋: 'capsule-toy',
  娃娃抱枕: 'plush-pillow',
  壓克力立牌: 'acrylic-stand',
  手機支架: 'phone-stand',
  公仔模型: 'figure',
  // P6｜P3 五類
  滑鼠: 'mouse',
  鍵盤: 'keyboard',
  手把控制器: 'gamepad',
  保溫杯瓶: 'tumbler',
  大型娃娃: 'jumbo-plush',
};

// SEO Panel V2-B: only add a core product term when we can map it confidently.
// This deliberately stays small and deterministic; unknown terms fall back to
// the existing IP / character / type handle instead of guessing a translation.
const CORE_PRODUCT_TERM_RULES: Array<{ match: RegExp; slug: string }> = [
  { match: /迷你(?:數位)?相機|mini\s+camera/i, slug: 'mini-camera' },
  { match: /拍立得|instant\s+camera/i, slug: 'instant-camera' },
  { match: /相機|攝影機|camera/i, slug: 'camera' },
  { match: /吹風機|吹風筒|hair\s*dryer/i, slug: 'hair-dryer' },
  { match: /羽毛球拍|badminton\s+racket/i, slug: 'badminton-racket' },
  { match: /鍵帽|keycap/i, slug: 'keycap' },
  { match: /卡套|證件套|card\s*holder/i, slug: 'card-holder' },
  { match: /小夜燈|夜燈|night\s*light/i, slug: 'night-light' },
  { match: /滑鼠墊|mouse\s*pad/i, slug: 'mouse-pad' },
  { match: /行動電源|充電寶|power\s*bank/i, slug: 'power-bank' },
  { match: /收納包|化妝包|pouch/i, slug: 'pouch' },
  { match: /杯墊|coaster/i, slug: 'coaster' },
];


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
  /**
   * SEO Panel V2-B: structured product identity from the existing copy pass
   * (normally titleItem). It is optional and never triggers another AI call.
   * Unknown/unreliable values are ignored, preserving the old handle contract.
   */
  coreProductTerm?: string | null | undefined;
  /**
   * P0-73: draft UUID (or any stable id). First 6 hex/alphanum chars become a
   * unique suffix so two chiikawa-hachiware-keychain products never share a
   * Matrixify/Shopify Handle.
   */
  draftId?: string | null | undefined;
}

function stripTrailingTypeSlug(coreSlug: string, typeSlug: string): string {
  if (!coreSlug || !typeSlug) return coreSlug;

  const coreParts = coreSlug.split('-').filter(Boolean);
  const typeParts = typeSlug.split('-').filter(Boolean);
  if (coreParts.length < typeParts.length) return coreSlug;

  const offset = coreParts.length - typeParts.length;
  const endsWithType = typeParts.every((part, index) => coreParts[offset + index] === part);
  if (!endsWithType) return coreSlug;

  return coreParts.slice(0, offset).join('-');
}

/**
 * Resolve a concise English core product term without free-form translation.
 * Chinese/mixed text must match the explicit trusted glossary above. Pure
 * ASCII item labels may pass through directly, capped to four words.
 */
export function resolveCoreProductSlug(
  value: string | null | undefined,
  productType: string | null | undefined,
): string {
  const normalized = normalize(value);
  if (!normalized) return '';

  const typeSlug = productType ? PRODUCT_TYPE_SLUGS[normalize(productType)] ?? '' : '';

  for (const rule of CORE_PRODUCT_TERM_RULES) {
    if (rule.match.test(normalized)) {
      return stripTrailingTypeSlug(rule.slug, typeSlug);
    }
  }

  // Structured titleItem sometimes already comes back in concise English.
  // Accept that only when it contains no CJK and is short enough to stay sane.
  if (!/[㐀-鿿]/.test(normalized) && /[A-Za-z]/.test(normalized)) {
    const asciiSlug = slugifyWord(normalized)
      .split('-')
      .filter(Boolean)
      .slice(0, 4)
      .join('-');
    return stripTrailingTypeSlug(asciiSlug, typeSlug);
  }

  return '';
}

/** Ordered [ip, character, core term, type] slug words, de-duped when two
 * adjacent segments are identical. The core term is optional and conservative;
 * if it cannot be resolved reliably the historical handle shape is preserved. */
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
  const coreProductSlug = resolveCoreProductSlug(input.coreProductTerm, input.productType);

  const segments = [ipSlug, characterSlug, coreProductSlug, typeSlug].filter(Boolean);
  return segments.filter((segment, index) => segments.indexOf(segment) === index);
}

const HANDLE_MAX_LENGTH = 80;
/** P0-73: always-preserved uniqueness tail ("-" + 6 chars). */
const HANDLE_SUFFIX_LEN = 6;

/**
 * First 6 lowercase alphanumerics from a draft id (UUID hyphens stripped).
 * Empty input → empty string (caller may omit the suffix entirely).
 */
export function handleUniquenessSuffix(draftId: string | null | undefined): string {
  const raw = (draftId ?? '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return raw.slice(0, HANDLE_SUFFIX_LEN);
}

export function generateShopifyHandleSlug(
  input: HandleSlugInput,
  context: DisplayLabelContext = {},
): string {
  const base =
    buildProductSlugSegments(input, context).join('-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '') ||
    'nestory-product';

  const uniq = handleUniquenessSuffix(input.draftId);
  if (!uniq) {
    // No draft id (image filename / unit tests without uniqueness need): keep
    // legacy max-length truncate of the identity slug alone.
    return base.slice(0, HANDLE_MAX_LENGTH).replace(/-+$/g, '') || 'nestory-product';
  }

  // P0-73: suffix must never be truncated away. Reserve room for "-" + 6 chars.
  const tail = `-${uniq}`;
  const maxBase = HANDLE_MAX_LENGTH - tail.length;
  const truncatedBase = base.slice(0, Math.max(1, maxBase)).replace(/-+$/g, '') || 'nestory-product';
  const full = `${truncatedBase}${tail}`;
  return full.slice(0, HANDLE_MAX_LENGTH);
}
