import { externalTimeoutMessage, isExternalTimeout } from "../externalTimeout";
import { TavilyWebSearchProvider } from "./tavily";
import type {
  WebSearchCache,
  WebSearchEvidence,
  WebSearchProvider,
  WebSearchProviderName,
  WebSearchResult,
} from "./types";

export type { WebSearchCache, WebSearchEvidence, WebSearchProvider, WebSearchProviderName, WebSearchResult, WebSearchSource } from "./types";

/**
 * Factory: WEB_SEARCH_PROVIDER=tavily|serper (default tavily).
 * Serper is reserved for later; selecting it without an implementation
 * still returns a configured-check that is false until wired.
 */
export function createWebSearchProvider(
  name?: string | null,
): WebSearchProvider {
  const selected = (name ?? process.env.WEB_SEARCH_PROVIDER ?? "tavily")
    .trim()
    .toLowerCase() as WebSearchProviderName | string;

  if (selected === "serper") {
    // Placeholder: same interface, not configured until SERPER_API_KEY + impl land.
    return {
      name: "serper",
      isConfigured: () => Boolean(process.env.SERPER_API_KEY?.trim()),
      search: async () => {
        throw new Error("Serper web search is not implemented yet; set WEB_SEARCH_PROVIDER=tavily.");
      },
    };
  }

  return new TavilyWebSearchProvider();
}

/** NFKC + trim + collapse whitespace — cache key for D2-A. */
const WEB_SEARCH_CACHE_VERSION = "adv8eq4";
export function fingerprintWebSearchQuery(query: string): string {
  const normalized = query.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  return `${WEB_SEARCH_CACHE_VERSION}:${normalized}`;
}

const IDENTITY_STOP_TERMS = [
  "聯名", "联名", "正版", "實用", "实用", "生日", "禮物", "礼物", "家用",
  "新婚", "閨蜜", "闺蜜", "商品", "規格", "规格", "尺寸", "材質", "材质",
  "可愛", "可爱", "卡通", "動漫", "动漫", "收藏", "人物", "設計", "设计", "系列",
];

const IDENTITY_CHAR_FOLD: Record<string, string> = {
  風: "风", 機: "机", 龍: "龙", 聯: "联", 優: "优", 創: "创", 禮: "礼",
  實: "实", 護: "护", 離: "离", 靜: "静", 乾: "干", 擺: "摆", 飾: "饰",
  鑰: "钥", 絨: "绒", 麗: "丽", 電: "电", 燈: "灯", 貓: "猫", 樂: "乐",
  髮: "发", 賣: "卖", 買: "买", 體: "体", 歲: "岁",
};

function foldIdentityText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .split("")
    .map((char) => IDENTITY_CHAR_FOLD[char] ?? char)
    .join("");
}

function identityCjkCore(value: string, ipName?: string | null): string {
  let text = foldIdentityText(value).replace(/[a-z0-9]+/g, "");
  const ip = foldIdentityText(ipName).replace(/[^\u4e00-\u9fff]+/g, "");
  if (ip) text = text.split(ip).join("");
  for (const term of IDENTITY_STOP_TERMS) {
    const folded = foldIdentityText(term).replace(/[^\u4e00-\u9fff]+/g, "");
    if (folded) text = text.split(folded).join("");
  }
  return text.replace(/[^\u4e00-\u9fff]+/g, "");
}

function identityLatinTokens(value: string, ipName?: string | null): string[] {
  const text = foldIdentityText(value);
  const ipTokens = new Set(foldIdentityText(ipName).match(/[a-z][a-z0-9]{2,}/g) ?? []);
  const stop = new Set(["product", "item", "official", "gift", "anime", "figure", "model", "collectible"]);
  return Array.from(new Set(text.match(/[a-z][a-z0-9]{2,}/g) ?? []))
    .filter((token) => !ipTokens.has(token) && !stop.has(token));
}

function ngramSet(value: string, size: number): Set<string> {
  const output = new Set<string>();
  for (let i = 0; i <= value.length - size; i += 1) output.add(value.slice(i, i + size));
  return output;
}

function overlapRatio(target: Set<string>, evidence: Set<string>): number {
  if (target.size === 0) return 0;
  let matches = 0;
  for (const token of target) if (evidence.has(token)) matches += 1;
  return matches / target.size;
}

/**
 * PB1.4 hard gate: high-risk product web evidence must look like the same item
 * before it is even shown to Product Brief. Same-IP / same-category is not enough.
 */
export function isTrustedProductWebEvidence(params: {
  rawTitle: string;
  ipName?: string | null;
  title: string;
  excerpt?: string | null;
}): boolean {
  const targetCjk = identityCjkCore(params.rawTitle, params.ipName);
  const evidenceCjk = identityCjkCore(`${params.title} ${params.excerpt ?? ""}`, params.ipName);

  if (targetCjk.length >= 4 && evidenceCjk.length >= 2) {
    const targetGrams = new Set([...ngramSet(targetCjk, 2), ...ngramSet(targetCjk, 3)]);
    const evidenceGrams = new Set([...ngramSet(evidenceCjk, 2), ...ngramSet(evidenceCjk, 3)]);
    if (overlapRatio(targetGrams, evidenceGrams) >= 0.42) return true;
  }

  const targetLatin = identityLatinTokens(params.rawTitle, params.ipName);
  if (targetLatin.length >= 2) {
    const evidenceLatin = new Set(identityLatinTokens(`${params.title} ${params.excerpt ?? ""}`, params.ipName));
    const matches = targetLatin.filter((token) => evidenceLatin.has(token)).length;
    if (matches >= 3 || matches / targetLatin.length >= 0.6) return true;
  }

  return false;
}

function buildTrustedProductSearchSummary(
  query: string,
  evidence: WebSearchEvidence[],
): string {
  if (evidence.length === 0) return "";
  const lines = [
    `【網路搜尋結果｜同款硬性比對後｜查詢：${query}】`,
    "以下只保留程式已通過同款身份比對的來源。沒有出現在這裡的搜尋結果，不可拿來補尺寸、材質、配件、年齡或其他商品規格。",
    "",
    "【可信來源摘錄】",
  ];
  for (const row of evidence) {
    lines.push(`- ${row.title}${row.url ? `（${row.url}）` : ""}`);
    if (row.excerpt) lines.push(`  ${row.excerpt}`);
  }
  return lines.join("\n");
}

function applyStrictProductIdentityGate(
  result: Omit<WebSearchResult, "fromCache"> | WebSearchResult,
  params: { rawTitle: string; ipName?: string | null },
): Omit<WebSearchResult, "fromCache"> | WebSearchResult | null {
  const trusted = (result.evidence ?? []).filter((row) =>
    isTrustedProductWebEvidence({
      rawTitle: params.rawTitle,
      ipName: params.ipName,
      title: row.title,
      excerpt: row.excerpt,
    }),
  );
  if (trusted.length === 0) return null;
  return {
    ...result,
    summary: buildTrustedProductSearchSummary(result.query, trusted),
    sources: trusted.map(({ title, url }) => ({ title, url })),
    evidence: trusted,
  };
}

function uniqueKeywordPieces(text: string): string[] {
  const tokens = text
    .split(/[\s,，、;；|/]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const token of tokens) {
    const key = token.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(token);
  }
  return unique;
}

function takeShare(text: string, maxLength: number, used: Set<string>): string {
  if (maxLength <= 0 || !text) return "";
  const pieces: string[] = [];
  let total = 0;
  for (const token of uniqueKeywordPieces(text)) {
    const key = token.toLocaleLowerCase();
    if (used.has(key)) continue;
    if (total + token.length + (pieces.length > 0 ? 1 : 0) > maxLength) continue;
    used.add(key);
    pieces.push(token);
    total += token.length + (pieces.length > 1 ? 1 : 0);
  }
  if (pieces.length === 0) {
    const fallback = text.slice(0, maxLength).trim();
    if (fallback && !used.has(fallback.toLocaleLowerCase())) {
      used.add(fallback.toLocaleLowerCase());
      return fallback;
    }
  }
  return pieces.join(" ").trim();
}

/**
 * Leading keywords from long evidence (spec / note / vision) so a sparse title
 * can still search. Each source gets a fair share; leftovers are redistributed.
 */
function extractSupplementKeywords(
  sources: Array<string | null | undefined>,
  maxTotalLength: number,
): string {
  const cleaned = sources
    .map((raw) =>
      (raw ?? "")
        .normalize("NFKC")
        .replace(/https?:\/\/\S+/gi, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
  if (cleaned.length === 0) return "";

  const used = new Set<string>();
  const share = Math.floor(maxTotalLength / cleaned.length);
  const parts = cleaned.map((text) => takeShare(text, share, used));
  let usedLength = parts.join(" ").replace(/\s+/g, " ").trim().length;
  if (usedLength < maxTotalLength) {
    const leftover = maxTotalLength - usedLength;
    const extra = takeShare(cleaned.join(" "), leftover, used);
    if (extra) parts.push(extra);
  }
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/**
 * One combined query per generation (D1-A): cleaned title + light product-spec tail.
 * Title stays the trunk. Known IP/character/type hints, plus spec / note / vision
 * keywords, are appended so a sparse title still searches. Depth stays basic.
 */
export function buildWebSearchQuery(input: {
  rawTitle: string;
  ipName?: string | null;
  characterName?: string | null;
  productType?: string | null;
  specText?: string | null;
  note?: string | null;
  imageDescription?: string | null;
}): string {
  let title = (input.rawTitle ?? "").normalize("NFKC").trim();
  // Drop common marketplace noise so the search focuses on the product.
  title = title
    .replace(/【[^】]*】/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/(包邮|包郵|现货|現貨|免运|免運|618|双11|雙11|促销|促銷)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const titleHead = title.slice(0, 160);
  const hints = [input.ipName, input.characterName, input.productType]
    .map((v) => (v ?? "").normalize("NFKC").trim())
    .filter(Boolean)
    .filter((v) => !titleHead.includes(v));
  const extras = extractSupplementKeywords(
    [input.specText, input.note, input.imageDescription],
    120,
  );

  const base = [titleHead, hints.join(" "), extras].filter(Boolean).join(" ").trim();
  if (!base) return "";

  return `${base} 商品規格 尺寸 材質`.replace(/\s+/g, " ").trim();
}

function parseWebSearchCacheEntry(raw: unknown): {
  query: string;
  queryFingerprint: string;
  summary: string;
  sources: { title: string; url: string }[];
  evidence?: WebSearchEvidence[];
  provider: string;
  fetchedAt: string;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const query = typeof obj.query === "string" ? obj.query : "";
  const queryFingerprint =
    typeof obj.queryFingerprint === "string"
      ? obj.queryFingerprint
      : fingerprintWebSearchQuery(query);
  const summary = typeof obj.summary === "string" ? obj.summary : "";
  if (!summary.trim()) return null;

  const sources = Array.isArray(obj.sources)
    ? obj.sources
        .map((row) => {
          if (!row || typeof row !== "object") return null;
          const r = row as Record<string, unknown>;
          const title = typeof r.title === "string" ? r.title : "";
          const url = typeof r.url === "string" ? r.url : "";
          if (!url) return null;
          return { title, url };
        })
        .filter((row): row is { title: string; url: string } => row !== null)
    : [];

  const evidence = Array.isArray(obj.evidence)
    ? obj.evidence
        .map((row) => {
          if (!row || typeof row !== "object") return null;
          const r = row as Record<string, unknown>;
          const title = typeof r.title === "string" ? r.title : "";
          const url = typeof r.url === "string" ? r.url : "";
          const excerpt = typeof r.excerpt === "string" ? r.excerpt : "";
          if (!url) return null;
          return { title, url, excerpt };
        })
        .filter((row): row is WebSearchEvidence => row !== null)
    : undefined;

  return {
    query,
    queryFingerprint,
    summary,
    sources,
    ...(evidence ? { evidence } : {}),
    provider: typeof obj.provider === "string" ? obj.provider : "tavily",
    fetchedAt: typeof obj.fetchedAt === "string" ? obj.fetchedAt : "",
  };
}

export function parseWebSearchCache(raw: unknown): WebSearchCache | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const entry = parseWebSearchCacheEntry(raw);
  const ipBackground = parseWebSearchCacheEntry(obj.ipBackground) ?? undefined;
  if (!entry && !ipBackground) return null;
  // Product-spec path needs a top-level summary; IP-only cache uses empty product shell.
  if (!entry) {
    return {
      query: "",
      queryFingerprint: "",
      summary: "",
      sources: [],
      provider: ipBackground!.provider,
      fetchedAt: ipBackground!.fetchedAt,
      ipBackground,
    };
  }
  return ipBackground ? { ...entry, ipBackground } : entry;
}

/** Read only nested IP-background cache (P5 層3). */
export function parseIpBackgroundCacheEntry(
  raw: unknown,
): NonNullable<WebSearchCache["ipBackground"]> | null {
  if (!raw || typeof raw !== "object") return null;
  return parseWebSearchCacheEntry((raw as Record<string, unknown>).ipBackground);
}

/** Merge product-spec + IP-background writes into one draft.web_search_cache payload. */
export function mergeWebSearchCacheLayers(params: {
  existing?: unknown;
  productCache?: WebSearchCache | null;
  ipBackground?: NonNullable<WebSearchCache["ipBackground"]> | null;
}): WebSearchCache | null {
  // Only persist when at least one layer is newly produced this request.
  if (!params.productCache && !params.ipBackground) return null;

  const existing = parseWebSearchCache(params.existing);
  const product = params.productCache ?? existing;
  const ipBackground =
    params.ipBackground ?? existing?.ipBackground ?? undefined;

  if (!product?.summary?.trim() && !ipBackground?.summary?.trim()) return null;

  return {
    query: product?.query ?? "",
    queryFingerprint: product?.queryFingerprint ?? "",
    // parseWebSearchCacheEntry requires non-empty summary for product hits;
    // keep a non-empty placeholder only when product is empty but IP lore exists.
    summary: product?.summary?.trim()
      ? product.summary
      : ipBackground
        ? "（無商品規格搜尋）"
        : "",
    sources: product?.sources ?? [],
    ...(product?.evidence ? { evidence: product.evidence } : {}),
    provider: product?.provider ?? ipBackground?.provider ?? "tavily",
    fetchedAt:
      product?.fetchedAt || ipBackground?.fetchedAt || new Date().toISOString(),
    ...(ipBackground ? { ipBackground } : {}),
  };
}

/** P5 層3：冷門 IP 背景查詢（與商品規格查詢分開 fingerprint）。 */
export function buildIpBackgroundSearchQuery(ipName: string): string {
  const name = (ipName ?? "").normalize("NFKC").trim();
  if (!name) return "";
  return `${name} 角色 世界觀 簡介 粉絲`.replace(/\s+/g, " ").trim();
}

/**
 * Resolve IP-background search when catalog has no knowledge_pack (or IP unknown).
 * Shares draft web_search_cache under `ipBackground`; product-spec cache untouched.
 */
export async function resolveIpBackgroundSearchForGenerate(params: {
  useWebSearch: boolean;
  ipName: string | null | undefined;
  /** When true, skip search (pack already covers this IP). */
  hasKnowledgePack: boolean;
  existingCache?: unknown;
  provider?: WebSearchProvider;
}): Promise<{
  summary: string | null;
  /** Full cache object to persist (merges product + ipBackground). null = no write. */
  cacheToPersist: WebSearchCache | null;
  warnings: string[];
  didLiveSearch: boolean;
  /** True when we should inject the neutral-writing instruction. */
  useNeutralFallback: boolean;
}> {
  const warnings: string[] = [];
  if (params.hasKnowledgePack) {
    return {
      summary: null,
      cacheToPersist: null,
      warnings,
      didLiveSearch: false,
      useNeutralFallback: false,
    };
  }

  const ipName = (params.ipName ?? "").normalize("NFKC").trim();
  if (!ipName) {
    return {
      summary: null,
      cacheToPersist: null,
      warnings,
      didLiveSearch: false,
      useNeutralFallback: true,
    };
  }

  if (!params.useWebSearch) {
    return {
      summary: null,
      cacheToPersist: null,
      warnings,
      didLiveSearch: false,
      useNeutralFallback: true,
    };
  }

  const provider = params.provider ?? createWebSearchProvider();
  if (!provider.isConfigured()) {
    warnings.push(
      "冷門 IP 需要背景補充，但伺服器尚未設定搜尋服務（TAVILY_API_KEY），本次以中性寫法處理。",
    );
    return {
      summary: null,
      cacheToPersist: null,
      warnings,
      didLiveSearch: false,
      useNeutralFallback: true,
    };
  }

  const query = buildIpBackgroundSearchQuery(ipName);
  const fingerprint = fingerprintWebSearchQuery(query);
  const cachedIp = parseIpBackgroundCacheEntry(params.existingCache);
  if (cachedIp && cachedIp.queryFingerprint === fingerprint && cachedIp.summary.trim()) {
    return {
      summary: cachedIp.summary,
      cacheToPersist: null,
      warnings,
      didLiveSearch: false,
      useNeutralFallback: false,
    };
  }

  try {
    const live = await provider.search(query);
    if (!live.summary.trim()) {
      warnings.push("冷門 IP 背景網搜無可用結果，本次以中性寫法處理。");
      return {
        summary: null,
        cacheToPersist: null,
        warnings,
        didLiveSearch: true,
        useNeutralFallback: true,
      };
    }

    const ipBackground = {
      query: live.query,
      queryFingerprint: fingerprint,
      summary: live.summary,
      sources: live.sources,
      ...(live.evidence ? { evidence: live.evidence } : {}),
      provider: live.provider,
      fetchedAt: new Date().toISOString(),
    };

    return {
      summary: live.summary,
      // Route merges with product-spec cache via mergeWebSearchCacheLayers.
      cacheToPersist: mergeWebSearchCacheLayers({
        existing: params.existingCache,
        ipBackground,
      }),
      warnings,
      didLiveSearch: true,
      useNeutralFallback: false,
    };
  } catch (error) {
    const message = isExternalTimeout(error)
      ? externalTimeoutMessage("search")
      : error instanceof Error
        ? error.message
        : "unknown error";
    warnings.push(
      isExternalTimeout(error)
        ? message
        : `冷門 IP 背景網搜失敗（${message}），本次以中性寫法處理。`,
    );
    return {
      summary: null,
      cacheToPersist: null,
      warnings,
      didLiveSearch: false,
      useNeutralFallback: true,
    };
  }
}

/**
 * Resolve search for one generate call: cache hit (same fingerprint) skips API.
 * Missing key / empty query / provider errors return warnings; never throw to caller.
 */
export async function resolveWebSearchForGenerate(params: {
  useWebSearch: boolean;
  rawTitle: string;
  ipName?: string | null;
  characterName?: string | null;
  productType?: string | null;
  specText?: string | null;
  note?: string | null;
  imageDescription?: string | null;
  existingCache?: unknown;
  provider?: WebSearchProvider;
  /** PB1.4: only same-product source evidence may reach the Product Brief. */
  strictProductIdentity?: boolean;
}): Promise<{
  result: WebSearchResult | null;
  cacheToPersist: WebSearchCache | null;
  warnings: string[];
  /** True when a live API call was made (for tests / cost tracking). */
  didLiveSearch: boolean;
}> {
  const warnings: string[] = [];
  if (!params.useWebSearch) {
    return { result: null, cacheToPersist: null, warnings, didLiveSearch: false };
  }

  const provider = params.provider ?? createWebSearchProvider();
  if (!provider.isConfigured()) {
    warnings.push(
      "已要求 Web Search 補充資訊，但伺服器尚未設定搜尋服務（TAVILY_API_KEY），本次生成未使用網路搜尋結果。",
    );
    return { result: null, cacheToPersist: null, warnings, didLiveSearch: false };
  }

  const query = buildWebSearchQuery({
    rawTitle: params.rawTitle,
    ipName: params.ipName,
    characterName: params.characterName,
    productType: params.productType,
    specText: params.specText,
    note: params.note,
    imageDescription: params.imageDescription,
  });
  if (!query) {
    warnings.push("Web Search 已開啟，但標題、規格、備註與圖片辨識皆為空，無法組查詢，本次未搜尋。");
    return { result: null, cacheToPersist: null, warnings, didLiveSearch: false };
  }

  const fingerprint = fingerprintWebSearchQuery(query);
  const cached = parseWebSearchCache(params.existingCache);
  if (cached && cached.queryFingerprint === fingerprint && cached.summary.trim()) {
    const cachedResult: WebSearchResult = {
      summary: cached.summary,
      sources: cached.sources,
      ...(cached.evidence ? { evidence: cached.evidence } : {}),
      provider: (cached.provider as WebSearchProviderName) || provider.name,
      query: cached.query || query,
      fromCache: true,
    };
    const usableCached = params.strictProductIdentity
      ? applyStrictProductIdentityGate(cachedResult, params)
      : cachedResult;
    if (usableCached) {
      return {
        result: usableCached as WebSearchResult,
        cacheToPersist: null, // already on draft
        warnings,
        didLiveSearch: false,
      };
    }
    // Old/unstructured cache cannot satisfy the strict gate; do a fresh search.
  }

  try {
    const live = await provider.search(query);
    if (!live.summary.trim()) {
      warnings.push("Web Search 已執行但沒有可用結果，本次文案未使用網路補充。");
      return { result: null, cacheToPersist: null, warnings, didLiveSearch: true };
    }

    const usableLive = params.strictProductIdentity
      ? applyStrictProductIdentityGate(live, params)
      : live;
    if (!usableLive) {
      warnings.push(
        "Web Search 有結果，但沒有來源通過同款硬性比對；本次不把網搜規格交給文案模型。",
      );
      return { result: null, cacheToPersist: null, warnings, didLiveSearch: true };
    }

    const cache: WebSearchCache = {
      query: usableLive.query,
      queryFingerprint: fingerprint,
      summary: usableLive.summary,
      sources: usableLive.sources,
      ...(usableLive.evidence ? { evidence: usableLive.evidence } : {}),
      provider: usableLive.provider,
      fetchedAt: new Date().toISOString(),
    };

    return {
      result: { ...usableLive, fromCache: false },
      cacheToPersist: cache,
      warnings,
      didLiveSearch: true,
    };
  } catch (error) {
    const timedOut = isExternalTimeout(error);
    const message = timedOut
      ? externalTimeoutMessage("search")
      : error instanceof Error
        ? error.message
        : "unknown error";
    warnings.push(timedOut ? message : `Web Search 失敗（${message}），本次生成未使用網路搜尋結果。`);
    return { result: null, cacheToPersist: null, warnings, didLiveSearch: false };
  }
}

export const WEB_SEARCH_USED_WARNING =
  "🔍 含網路搜尋資訊，請核實來源（規格數字須有依據才寫入）。";
