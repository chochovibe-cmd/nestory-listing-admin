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

export function parseWebSearchCache(raw: unknown): WebSearchCache | null {
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
