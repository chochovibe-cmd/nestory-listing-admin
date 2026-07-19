/**
 * D9: build public Shopify Online Store product URLs for iframe / new-tab preview.
 * Admin URLs must not be used in iframe (X-Frame-Options).
 */

/** Normalize shop domain (strip protocol, path, trailing slash). */
export function normalizeShopifyStoreDomain(
  raw: string | null | undefined
): string | null {
  if (!raw || typeof raw !== "string") return null;
  let d = raw.trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^https?:\/\//, "");
  d = d.split("/")[0] ?? "";
  d = d.replace(/:\d+$/, "");
  if (!d || d.includes(" ") || !d.includes(".")) return null;
  return d;
}

/** Sanitize product handle for URL path segment. */
export function sanitizeShopifyHandle(
  raw: string | null | undefined
): string | null {
  if (!raw || typeof raw !== "string") return null;
  const h = raw.trim().replace(/^\/+|\/+$/g, "");
  if (!h) return null;
  // Shopify handles: letters, numbers, hyphens
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(h)) return null;
  return h;
}

/**
 * Public product page: https://{domain}/products/{handle}
 * Returns null when domain or handle missing/invalid.
 */
export function buildShopifyStorefrontProductUrl(params: {
  storeDomain: string | null | undefined;
  handle: string | null | undefined;
}): string | null {
  const domain = normalizeShopifyStoreDomain(params.storeDomain);
  const handle = sanitizeShopifyHandle(params.handle);
  if (!domain || !handle) return null;
  return `https://${domain}/products/${handle}`;
}

/**
 * Prefer Online Store URL for iframe; admin product URL is for "open admin" only
 * (never iframe — almost always blocked).
 */
export function pickShopifyPreviewUrls(params: {
  storeDomain?: string | null;
  handle?: string | null;
  adminUrl?: string | null;
}): {
  storefrontUrl: string | null;
  adminUrl: string | null;
} {
  const storefrontUrl = buildShopifyStorefrontProductUrl({
    storeDomain: params.storeDomain,
    handle: params.handle
  });
  const admin =
    typeof params.adminUrl === "string" && params.adminUrl.trim().startsWith("http")
      ? params.adminUrl.trim()
      : null;
  return { storefrontUrl, adminUrl: admin };
}
