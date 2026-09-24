/** Customer-facing product title cap. Official title_zh and enriched_title share this. */
export const PRODUCT_TITLE_MAX_LENGTH = 80;

const SEGMENT3_BLACKLIST = [
  "生日禮物",
  "送禮首選",
  "最佳選擇",
  "送禮推薦",
  "熱賣",
  "爆款",
  "必買",
  "超值",
  "限時",
] as const;

const FILLER_DIFFS = new Set(["標準款"]);
const MARKETPLACE_BRANDS = /^(淘寶|天貓|淘宝|天猫|蝦皮|shopee|taobao|tmall|amazon|yahoo)$/i;
const PHRASE_BREAKS = [" ", "、", "・", "／", "/", "，", ",", "×", "-", "－"];

export type ProductTitleParts = {
  rawTitle?: string | null;
  titleIp?: string | null;
  titleBrand?: string | null;
  titleItem?: string | null;
  titleDiff?: string | null;
  detectedIpDisplay?: string | null;
  detectedBrand?: string | null;
  /** Source title plus existing search text. English brand is used only when this evidence contains it. */
  brandEvidence?: string | null;
  maxLen?: number;
};

function textLen(value: string): number {
  return Array.from(value).length;
}

function sliceChars(value: string, max: number): string {
  return Array.from(value).slice(0, Math.max(0, max)).join("");
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/\//g, "／")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTitleSeparators(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw || !/[|｜]/u.test(raw)) return raw;
  return raw
    .split(/\s*[|｜]\s*/u)
    .map((segment) => segment.trim())
    .join(" | ");
}

export function parseTitleSegments(value: string | null | undefined): string[] {
  const normalized = normalizeTitleSeparators(value);
  if (!normalized) return [];
  if (!normalized.includes(" | ") && !normalized.includes("｜")) return [normalized];
  return normalized.split(" | ").map((segment) => segment.trim());
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const next = normalizeText(value);
    if (next) return next;
  }
  return "";
}

function isMarketplaceName(value: string): boolean {
  return MARKETPLACE_BRANDS.test(normalizeText(value));
}

function cleanBrand(value: string | null | undefined): string {
  const brand = normalizeText(value);
  if (!brand || isMarketplaceName(brand)) return "";
  return brand;
}

/** Prefer a reliable Latin brand token when the model mixed in extra gloss. */
export function preferEnglishBrandName(value: string | null | undefined): string {
  const brand = cleanBrand(value);
  if (!brand) return "";
  if (/^[A-Za-z0-9][A-Za-z0-9 .&'’+\-]*$/.test(brand)) return brand;
  const latinToken = brand.match(/\b[A-Za-z][A-Za-z0-9.&'’+\-]*(?:\s+[A-Za-z][A-Za-z0-9.&'’+\-]*)*/);
  if (latinToken && latinToken[0].length >= 2 && !/[\u3400-\u9fff]/.test(latinToken[0])) {
    return latinToken[0];
  }
  return brand;
}

/** Official English names. Applied only when brandEvidence already contains that English token. */
const CONFIRMED_ENGLISH_BRANDS: Array<{ zh: RegExp; en: string }> = [
  { zh: /名創優品|名创优品/u, en: "MINISO" },
  { zh: /萬代|万代/u, en: "Bandai" },
  { zh: /樂高|乐高/u, en: "LEGO" },
];

export function resolveBrandWithEvidence(
  brand: string | null | undefined,
  evidence: string | null | undefined,
): string {
  const preferred = preferEnglishBrandName(brand);
  if (!preferred) return "";
  if (!/[\u3400-\u9fff]/u.test(preferred)) return preferred;
  const blob = `${preferred}\n${evidence ?? ""}`;
  for (const row of CONFIRMED_ENGLISH_BRANDS) {
    if (row.zh.test(blob)) return row.en;
  }
  return preferred;
}

const PRODUCT_KIND_SUFFIXES = [
  "公仔吊飾盲盒",
  "盲盒擺件",
  "吊飾盲盒",
  "公仔吊飾",
  "盲盒",
  "擺件",
  "吊飾",
  "公仔",
  "模型",
  "手辦",
  "立牌",
  "徽章",
  "娃娃",
  "鑰匙圈",
];

const STYLE_TOKENS = ["黏土人", "Q版", "萌粒", "鍵帽", "盒玩", "軟膠", "景品", "坐姿", "站姿"];

/** Move sculpt words out of「角色＋商品種類」and into the third segment. */
export function splitStyleFromItem(item: string, diff: string): { item: string; diff: string } {
  const text = normalizeText(item);
  const existingDiff = normalizeText(diff);
  const suffix = PRODUCT_KIND_SUFFIXES.find((kind) => text.endsWith(kind));
  if (!suffix || text === suffix) return { item: text, diff: existingDiff };
  let rest = text.slice(0, text.length - suffix.length).trim();
  const styles: string[] = [];
  for (let guard = 0; guard < STYLE_TOKENS.length + 2; guard += 1) {
    let best: { index: number; token: string } | null = null;
    for (const token of STYLE_TOKENS) {
      const index = rest.indexOf(token);
      if (index >= 0 && (!best || index < best.index)) best = { index, token };
    }
    if (!best) break;
    styles.push(best.token);
    rest = `${rest.slice(0, best.index)} ${rest.slice(best.index + best.token.length)}`.replace(/\s+/g, " ").trim();
  }
  if (styles.length === 0) return { item: text, diff: existingDiff };
  const stylePhrase = styles.join("");
  const nextDiff = !existingDiff || existingDiff.includes(stylePhrase)
    ? existingDiff || stylePhrase
    : `${stylePhrase} ${existingDiff}`;
  return { item: [rest, suffix].filter(Boolean).join(" "), diff: nextDiff };
}

export function assembleIpBrandSegment(ip: string, brand: string): string {
  const ipText = normalizeText(ip);
  const brandText = preferEnglishBrandName(brand);
  if (ipText && brandText) {
    const ipKey = ipText.toLocaleLowerCase();
    const brandKey = brandText.toLocaleLowerCase();
    if (ipKey.includes(brandKey) || brandKey.includes(ipKey)) return ipText;
    return `${brandText} × ${ipText}`;
  }
  return ipText || brandText;
}

function sanitizeDiff(value: string): string {
  let next = normalizeText(value);
  for (const term of SEGMENT3_BLACKLIST) {
    next = next.split(term).join("");
  }
  return next.replace(/\s{2,}/g, " ").trim();
}

function isFillerDiff(value: string): boolean {
  const text = normalizeText(value);
  if (!text) return true;
  if (FILLER_DIFFS.has(text)) return true;
  return SEGMENT3_BLACKLIST.some((term) => text === term || text.includes(term));
}

export function joinTitleSegments(seg1: string, seg2: string, seg3: string): string {
  return [seg1, seg2, seg3].map((part) => normalizeText(part)).filter(Boolean).join(" | ");
}

function stripLatinAliases(segment: string): string {
  const text = normalizeText(segment);
  if (!text) return "";
  const parts = text.split(" × ").map((part) => part.trim()).filter(Boolean);
  const stripped = parts.map((part) => {
    if (!/[\u3400-\u9fff]/.test(part) || !/[A-Za-z]/.test(part)) return part;
    return part
      .replace(/\s+[A-Za-z][A-Za-z0-9.&'’+\-]*(?:\s+[A-Za-z][A-Za-z0-9.&'’+\-]*)*$/g, "")
      .trim();
  });
  return stripped.filter(Boolean).join(" × ");
}

function dropExtraCharacters(segment: string): string {
  const text = normalizeText(segment);
  if (!text.includes("・")) return text;
  const [roles, ...rest] = text.split(/\s+/);
  const roleHead = roles.split("・")[0] ?? roles;
  return [roleHead, ...rest].filter(Boolean).join(" ");
}

function trimAtPhraseBoundary(value: string, budget: number): string {
  const text = normalizeText(value);
  if (textLen(text) <= budget) return text;
  const chars = Array.from(text);
  const window = chars.slice(0, Math.max(0, budget));
  let cut = window.length;
  for (let i = window.length - 1; i >= Math.floor(budget * 0.45); i -= 1) {
    if (PHRASE_BREAKS.includes(window[i])) {
      cut = i;
      break;
    }
  }
  if (cut < Math.floor(budget * 0.4)) cut = window.length;
  let trimmed = chars.slice(0, cut).join("").trim();
  if (/[A-Za-z0-9]$/.test(trimmed) && /[A-Za-z0-9]/.test(chars[cut] ?? "")) {
    const lastBreak = Math.max(
      trimmed.lastIndexOf(" "),
      trimmed.lastIndexOf("・"),
      trimmed.lastIndexOf("／"),
      trimmed.lastIndexOf("/"),
    );
    if (lastBreak >= Math.floor(budget * 0.4)) {
      trimmed = trimmed.slice(0, lastBreak).trim();
    }
  }
  return trimmed;
}

export function clampTitleByPhrases(
  title: string,
  maxLen: number = PRODUCT_TITLE_MAX_LENGTH,
): string {
  const raw = normalizeTitleSeparators(title);
  if (!raw) return "";
  if (textLen(raw) <= maxLen) return raw;

  const segs = parseTitleSegments(raw);
  if (segs.length >= 2) {
    let seg1 = segs[0];
    let seg2 = segs[1] ?? "";
    let seg3 = sanitizeDiff(segs.slice(2).join(" | "));
    if (isFillerDiff(seg3)) seg3 = "";

    const tryJoin = () => joinTitleSegments(seg1, seg2, seg3);
    if (textLen(tryJoin()) <= maxLen) return tryJoin();

    seg3 = "";
    if (textLen(tryJoin()) <= maxLen) return tryJoin();

    const aliasStripped2 = stripLatinAliases(seg2);
    if (aliasStripped2) seg2 = aliasStripped2;
    if (textLen(tryJoin()) <= maxLen) return tryJoin();

    const fewerRoles = dropExtraCharacters(seg2);
    if (fewerRoles) seg2 = fewerRoles;
    if (textLen(tryJoin()) <= maxLen) return tryJoin();

    const aliasStripped1 = stripLatinAliases(seg1);
    if (aliasStripped1) seg1 = aliasStripped1;
    if (textLen(tryJoin()) <= maxLen) return tryJoin();

    const seg1Len = textLen(seg1);
    const sepLen = seg2 ? 3 : 0;
    const budget = maxLen - seg1Len - sepLen;
    if (budget >= 4) {
      seg2 = trimAtPhraseBoundary(seg2, budget);
      return tryJoin();
    }
    if (seg1Len <= maxLen) return seg1;
    return trimAtPhraseBoundary(seg1, maxLen);
  }

  return trimAtPhraseBoundary(raw, maxLen) || sliceChars(raw, maxLen);
}

function scrubDiff(value: string): string {
  const cleaned = sanitizeDiff(value);
  return isFillerDiff(cleaned) ? "" : cleaned;
}

/**
 * Assemble the customer-facing product title.
 * Structured IP/brand/item/diff win over raw segment order; raw title is fallback only.
 * Never swaps brand/IP by guessing inside a single string.
 */
export function finalizeProductTitle(parts: ProductTitleParts): string {
  const maxLen = parts.maxLen ?? PRODUCT_TITLE_MAX_LENGTH;
  const rawSegs = parseTitleSegments(parts.rawTitle);
  const ip = firstNonEmpty(parts.titleIp, parts.detectedIpDisplay);
  const brand = resolveBrandWithEvidence(
    firstNonEmpty(parts.titleBrand, parts.detectedBrand),
    parts.brandEvidence,
  );
  const structuredSeg1 = assembleIpBrandSegment(ip, brand);
  const rawItem = firstNonEmpty(parts.titleItem, rawSegs.length >= 2 ? rawSegs[1] : "");
  const rawDiff = scrubDiff(firstNonEmpty(parts.titleDiff, rawSegs.length >= 3 ? rawSegs.slice(2).join(" | ") : ""));
  const split = splitStyleFromItem(rawItem, rawDiff);
  const item = split.item;
  const diff = scrubDiff(split.diff);

  let assembled = "";
  if (structuredSeg1) {
    assembled = joinTitleSegments(structuredSeg1, item, diff);
  } else if (rawSegs.length > 0) {
    const fallbackDiff = scrubDiff(rawSegs.slice(2).join(" | "));
    assembled = joinTitleSegments(rawSegs[0] ?? "", rawSegs[1] ?? "", fallbackDiff);
  }

  if (!assembled) assembled = normalizeTitleSeparators(parts.rawTitle);
  return clampTitleByPhrases(assembled, maxLen);
}
