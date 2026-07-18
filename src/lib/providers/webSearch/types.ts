// B8／B19: pluggable web-search backend. Tavily first; Serper when volume grows.
// Providers never invent results — missing key / failed call = honest empty + warning.

export type WebSearchProviderName = "tavily" | "serper";

export interface WebSearchSource {
  title: string;
  url: string;
}

export interface WebSearchResult {
  /** Plain-text summary for the copy LLM (繁中重點 + 來源標註). */
  summary: string;
  sources: WebSearchSource[];
  provider: WebSearchProviderName;
  query: string;
  /** True when this result came from draft cache, not a live API call. */
  fromCache: boolean;
}

/** One cached search payload (product-spec or IP background). */
export interface WebSearchCacheEntry {
  query: string;
  queryFingerprint: string;
  summary: string;
  sources: WebSearchSource[];
  provider: WebSearchProviderName | string;
  fetchedAt: string;
}

/**
 * Persisted on product_drafts.web_search_cache (migration 023 + P5 層3).
 * Top-level fields = product-spec search (B19).
 * `ipBackground` = optional cold-IP lore search (P5); same draft, separate fingerprint.
 */
export interface WebSearchCache extends WebSearchCacheEntry {
  ipBackground?: WebSearchCacheEntry;
}

export interface WebSearchProvider {
  name: WebSearchProviderName;
  isConfigured(): boolean;
  search(query: string): Promise<Omit<WebSearchResult, "fromCache">>;
}
