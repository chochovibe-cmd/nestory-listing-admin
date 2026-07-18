import { TavilyWebSearchProvider } from "./tavily";
import type {
  WebSearchCache,
  WebSearchProvider,
  WebSearchProviderName,
  WebSearchResult,
} from "./types";

export type { WebSearchCache, WebSearchProvider, WebSearchProviderName, WebSearchResult, WebSearchSource } from "./types";

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
export function fingerprintWebSearchQuery(query: string): string {
  return query.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * One combined query per generation (D1-A): cleaned title + light product-spec tail.
 * Prefer title; optional known IP/character/type hints when already on the draft.
 */
export function buildWebSearchQuery(input: {
  rawTitle: string;
  ipName?: string | null;
  characterName?: string | null;
  productType?: string | null;
}): string {
  let title = (input.rawTitle ?? "").normalize("NFKC").trim();
  // Drop common marketplace noise so the search focuses on the product.
  title = title
    .replace(/【[^】]*】/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/(包邮|包郵|现货|現貨|免运|免運|618|双11|雙11|促销|促銷)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const hints = [input.ipName, input.characterName, input.productType]
    .map((v) => (v ?? "").normalize("NFKC").trim())
    .filter(Boolean);

  const base = title || hints.join(" ");
  if (!base) return "";

  // Keep under ~200 chars for provider hygiene.
  const head = base.slice(0, 160);
  return `${head} 商品規格 尺寸 材質`.replace(/\s+/g, " ").trim();
}

function parseWebSearchCacheEntry(raw: unknown): {
  query: string;
  queryFingerprint: string;
  summary: string;
  sources: { title: string; url: string }[];
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

  return {
    query,
    queryFingerprint,
    summary,
    sources,
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
    const message = error instanceof Error ? error.message : "unknown error";
    warnings.push(`冷門 IP 背景網搜失敗（${message}），本次以中性寫法處理。`);
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
  existingCache?: unknown;
  provider?: WebSearchProvider;
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
  });
  if (!query) {
    warnings.push("Web Search 已開啟，但標題為空，無法組查詢，本次未搜尋。");
    return { result: null, cacheToPersist: null, warnings, didLiveSearch: false };
  }

  const fingerprint = fingerprintWebSearchQuery(query);
  const cached = parseWebSearchCache(params.existingCache);
  if (cached && cached.queryFingerprint === fingerprint && cached.summary.trim()) {
    return {
      result: {
        summary: cached.summary,
        sources: cached.sources,
        provider: (cached.provider as WebSearchProviderName) || provider.name,
        query: cached.query || query,
        fromCache: true,
      },
      cacheToPersist: null, // already on draft
      warnings,
      didLiveSearch: false,
    };
  }

  try {
    const live = await provider.search(query);
    if (!live.summary.trim()) {
      warnings.push("Web Search 已執行但沒有可用結果，本次文案未使用網路補充。");
      return { result: null, cacheToPersist: null, warnings, didLiveSearch: true };
    }

    const cache: WebSearchCache = {
      query: live.query,
      queryFingerprint: fingerprint,
      summary: live.summary,
      sources: live.sources,
      provider: live.provider,
      fetchedAt: new Date().toISOString(),
    };

    return {
      result: { ...live, fromCache: false },
      cacheToPersist: cache,
      warnings,
      didLiveSearch: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    warnings.push(`Web Search 失敗（${message}），本次生成未使用網路搜尋結果。`);
    return { result: null, cacheToPersist: null, warnings, didLiveSearch: false };
  }
}

export const WEB_SEARCH_USED_WARNING =
  "🔍 含網路搜尋資訊，請核實來源（規格數字須有依據才寫入）。";
