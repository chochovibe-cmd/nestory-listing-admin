/**
 * D9: cache Shopify Online Store domain for client preflight / iframe preview.
 * Source: GET /api/status → shopifyStoreDomain (server SHOPIFY_STORE_DOMAIN).
 */

const CACHE_KEY = "nestory_shopify_store_domain_v1";
let memoryDomain: string | null | undefined;

export function getCachedShopifyStoreDomain(): string | null {
  if (memoryDomain !== undefined) return memoryDomain;
  if (typeof window === "undefined") {
    memoryDomain = null;
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    memoryDomain = raw && raw.trim() ? raw.trim() : null;
  } catch {
    memoryDomain = null;
  }
  return memoryDomain ?? null;
}

function setCachedShopifyStoreDomain(domain: string | null) {
  memoryDomain = domain;
  if (typeof window === "undefined") return;
  try {
    if (domain) window.sessionStorage.setItem(CACHE_KEY, domain);
    else window.sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * Fetch once per session (or reuse cache). Never throws.
 */
export async function resolveShopifyStoreDomain(): Promise<string | null> {
  const cached = getCachedShopifyStoreDomain();
  if (cached) return cached;
  try {
    const res = await fetch("/api/status", { method: "GET", cache: "no-store" });
    if (!res.ok) {
      setCachedShopifyStoreDomain(null);
      return null;
    }
    const body = (await res.json().catch(() => ({}))) as {
      shopifyStoreDomain?: unknown;
    };
    const raw =
      typeof body.shopifyStoreDomain === "string" ? body.shopifyStoreDomain.trim() : "";
    const domain = raw
      ? raw.replace(/^https?:\/\//i, "").split("/")[0]?.toLowerCase() || null
      : null;
    setCachedShopifyStoreDomain(domain);
    return domain;
  } catch {
    setCachedShopifyStoreDomain(null);
    return null;
  }
}
