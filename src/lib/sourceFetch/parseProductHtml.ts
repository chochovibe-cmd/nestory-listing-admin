/**
 * B3-fetch-open: pure HTML → product fields (og / title / JSON-LD Product).
 * No network. Q3-A: variants always empty (do not invent SKU rows from HTML).
 */

import type { RecognitionFields } from "@/lib/screenshotRecognition";

export type HostClass = "taobao" | "tmall" | "generic";

export type ParsedProductHtml = {
  fields: RecognitionFields;
  hostClass: HostClass;
  /** At least one fillable product signal was found. */
  hasUsableFields: boolean;
};

const EMPTY_FIELDS: RecognitionFields = {
  title: null,
  costCny: null,
  features: null,
  specText: null,
  variants: []
};

export function classifyHost(hostname: string): HostClass {
  const h = hostname.trim().toLowerCase().replace(/\.$/, "");
  // tmall before taobao (some hosts contain both patterns)
  if (
    h === "tmall.com" ||
    h.endsWith(".tmall.com") ||
    h === "tmall.hk" ||
    h.endsWith(".tmall.hk") ||
    h.includes("tmall")
  ) {
    return "tmall";
  }
  if (
    h === "taobao.com" ||
    h.endsWith(".taobao.com") ||
    h.includes("taobao")
  ) {
    return "taobao";
  }
  return "generic";
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    });
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function metaContent(html: string, propertyOrName: string): string | null {
  const esc = propertyOrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // property/name before content
  const re1 = new RegExp(
    `<meta[^>]+(?:property|name)=["']${esc}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i"
  );
  // content before property/name
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${esc}["'][^>]*>`,
    "i"
  );
  const m = html.match(re1) || html.match(re2);
  if (!m?.[1]) return null;
  const v = decodeHtmlEntities(m[1]).trim();
  return v || null;
}

function extractTitleTag(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m?.[1]) return null;
  const t = stripTags(m[1]);
  if (!t) return null;
  // Drop common site suffixes noise lightly
  return t.slice(0, 300);
}

function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // ignore broken ld+json
    }
  }
  return blocks;
}

function walkJsonLd(node: unknown, out: Record<string, unknown>[]): void {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) walkJsonLd(item, out);
    return;
  }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if (obj["@graph"]) walkJsonLd(obj["@graph"], out);
  out.push(obj);
  // nested types sometimes appear under mainEntity
  if (obj.mainEntity) walkJsonLd(obj.mainEntity, out);
}

function isProductType(typeVal: unknown): boolean {
  if (typeof typeVal === "string") {
    return /product/i.test(typeVal);
  }
  if (Array.isArray(typeVal)) {
    return typeVal.some((t) => typeof t === "string" && /product/i.test(t));
  }
  return false;
}

/**
 * Q2-A: only accept cost when currency is clearly CNY / ¥.
 * Ambiguous plain numbers without currency → do not fill.
 */
export function extractCnyPrice(
  amount: unknown,
  currencyHint?: string | null
): number | null {
  let n: number | null = null;
  if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) {
    n = amount;
  } else if (typeof amount === "string") {
    const cleaned = amount.replace(/,/g, "").trim();
    // Prefer explicit ¥ / CNY / RMB in the string
    const yen = cleaned.match(/(?:¥|￥|CNY|RMB)\s*([\d]+(?:\.\d+)?)/i);
    const plain = cleaned.match(/^([\d]+(?:\.\d+)?)$/);
    if (yen) {
      const v = Number(yen[1]);
      if (Number.isFinite(v) && v > 0) n = v;
    } else if (plain && currencyHint && /^(CNY|RMB|¥|￥)$/i.test(currencyHint.trim())) {
      const v = Number(plain[1]);
      if (Number.isFinite(v) && v > 0) n = v;
    } else if (plain && /¥|￥|CNY|RMB/i.test(cleaned)) {
      const v = Number(plain[1]);
      if (Number.isFinite(v) && v > 0) n = v;
    }
    // No bare number without currency (Q2-A)
  }

  if (n == null) return null;
  // If currency hint is present and clearly not CNY, reject
  if (currencyHint) {
    const c = currencyHint.trim().toUpperCase();
    if (c && !/^(CNY|RMB|¥|￥)$/i.test(c) && c !== "CNY") {
      // allow ¥ symbol variants already handled; reject TWD/USD/etc.
      if (!/CNY|RMB/.test(c) && c !== "¥" && c !== "￥") {
        if (["TWD", "USD", "HKD", "JPY", "EUR", "GBP"].includes(c)) return null;
      }
    }
  }
  return Math.round(n * 100) / 100;
}

function pickFromOffers(offers: unknown): number | null {
  if (!offers) return null;
  const list = Array.isArray(offers) ? offers : [offers];
  for (const o of list) {
    if (!o || typeof o !== "object") continue;
    const row = o as Record<string, unknown>;
    const currency =
      typeof row.priceCurrency === "string"
        ? row.priceCurrency
        : typeof row.currency === "string"
          ? row.currency
          : null;
    const price = extractCnyPrice(row.price ?? row.lowPrice ?? row.highPrice, currency);
    if (price != null) return price;
  }
  return null;
}

function fieldsFromJsonLd(blocks: unknown[]): Partial<RecognitionFields> {
  const nodes: Record<string, unknown>[] = [];
  for (const b of blocks) walkJsonLd(b, nodes);

  let title: string | null = null;
  let costCny: number | null = null;
  let features: string | null = null;

  for (const node of nodes) {
    if (!isProductType(node["@type"])) continue;
    if (!title && typeof node.name === "string" && node.name.trim()) {
      title = node.name.trim().slice(0, 300);
    }
    if (!features && typeof node.description === "string" && node.description.trim()) {
      features = stripTags(node.description).slice(0, 800);
    }
    if (costCny == null) {
      costCny = pickFromOffers(node.offers);
    }
  }

  return { title, costCny, features };
}

/**
 * Detect thin anti-bot shells / empty SPA pages with no product signals.
 * Heuristic only — used for taobao/tmall messaging, not for inventing data.
 */
export function looksLikeBlockedOrEmptyPage(html: string): boolean {
  const body = (html ?? "").trim();
  if (body.length < 80) return true;
  const lower = body.toLowerCase();
  // Common login / challenge markers (honest failure, not bypass)
  if (
    /login\.taobao|passport\.taobao|_____tmd_____|punish|captcha|滑塊|请登录|請登錄|security-x5/i.test(
      body
    )
  ) {
    return true;
  }
  // Almost no text content
  const textish = stripTags(body.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "));
  if (textish.length < 40) return true;
  // Empty root SPA with no og tags
  if (
    textish.length < 120 &&
    !/og:title|application\/ld\+json/i.test(lower) &&
    /<div\s+id=["']?(?:root|app|ice-container)["']?/i.test(body)
  ) {
    return true;
  }
  return false;
}

export function parseProductHtml(html: string, hostname = ""): ParsedProductHtml {
  const hostClass = classifyHost(hostname);
  const raw = html ?? "";

  if (!raw.trim()) {
    return { fields: { ...EMPTY_FIELDS }, hostClass, hasUsableFields: false };
  }

  const ogTitle = metaContent(raw, "og:title");
  const ogDesc = metaContent(raw, "og:description");
  const metaDesc = metaContent(raw, "description");
  const titleTag = extractTitleTag(raw);
  const ld = fieldsFromJsonLd(extractJsonLdBlocks(raw));

  // product:price:amount + currency (Open Graph product)
  const ogPriceAmount = metaContent(raw, "product:price:amount") || metaContent(raw, "og:price:amount");
  const ogPriceCurrency =
    metaContent(raw, "product:price:currency") || metaContent(raw, "og:price:currency");
  let costCny = ld.costCny ?? null;
  if (costCny == null && ogPriceAmount) {
    costCny = extractCnyPrice(ogPriceAmount, ogPriceCurrency);
  }
  // Also try ¥ in og:description
  if (costCny == null && ogDesc) {
    costCny = extractCnyPrice(ogDesc, null);
  }

  let title = (ld.title || ogTitle || titleTag || null)?.trim() || null;
  if (title) title = title.slice(0, 300);

  let features =
    (ld.features || ogDesc || metaDesc || null)?.trim() || null;
  if (features) features = stripTags(features).slice(0, 800);
  // Avoid duplicating title as features
  if (features && title && features === title) features = null;

  // Q3-A: never fill variants from URL HTML
  const fields: RecognitionFields = {
    title,
    costCny,
    features,
    specText: null,
    variants: []
  };

  const hasUsableFields = Boolean(
    fields.title ||
      (fields.costCny != null && fields.costCny > 0) ||
      fields.features ||
      fields.specText
  );

  return { fields, hostClass, hasUsableFields };
}
