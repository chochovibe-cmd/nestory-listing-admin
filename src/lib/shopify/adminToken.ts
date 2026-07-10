// A1 (2026-07-10 rewrite): Shopify stopped letting stores create custom apps
// from Settings -> Develop apps on 2026-01-01. The replacement is a Dev
// Dashboard app authenticated via OAuth client_credentials grant -- there is
// no long-lived static token and no refresh token; a fresh access token must
// be exchanged with the client id/secret whenever the previous one is
// missing, expiring, or rejected (401).
//
// Server-side only. SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET must never reach
// the browser (not NEXT_PUBLIC_*, never returned in any API response).

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

// Module-level cache: best-effort within a warm serverless instance, empty
// again after a cold start -- that's fine, it just means one extra token
// exchange on the first request of a new instance.
let cached: CachedToken | null = null;
let inFlight: Promise<string> | null = null;

// Refresh a bit before the real expiry so a cached token is never handed out
// right as it's about to lapse mid-request.
const SAFETY_MARGIN_MS = 60_000;

export function hasShopifyAdminCredentials(): boolean {
  return Boolean(process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET && process.env.SHOPIFY_STORE_DOMAIN);
}

async function exchangeToken(): Promise<CachedToken> {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const domain = process.env.SHOPIFY_STORE_DOMAIN;

  if (!clientId || !clientSecret || !domain) {
    throw new Error(
      "Shopify credentials are not configured (SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET / SHOPIFY_STORE_DOMAIN).",
    );
  }

  const response = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Shopify token exchange failed (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  const accessToken = payload?.access_token;
  const expiresIn = Number(payload?.expires_in);

  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("Shopify token exchange response did not include access_token.");
  }

  // Per Shopify's client_credentials grant: no refresh token, expires_in is
  // in seconds (observed 86399 -- just under 24h). Fall back to a 0 lifetime
  // (always re-exchange) if the field is ever missing/unparseable, rather
  // than caching something with an unknown expiry.
  return {
    accessToken,
    expiresAt: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 0),
  };
}

/**
 * Returns a valid Shopify Admin API access token, exchanging a new one only
 * when the cache is empty or within SAFETY_MARGIN_MS of expiring. Concurrent
 * callers during a refresh share a single in-flight exchange rather than each
 * firing their own request.
 */
export async function getShopifyAdminToken(): Promise<string> {
  if (cached && cached.expiresAt - SAFETY_MARGIN_MS > Date.now()) {
    return cached.accessToken;
  }

  if (!inFlight) {
    inFlight = exchangeToken()
      .then((token) => {
        cached = token;
        return token.accessToken;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  return inFlight;
}

/** Call after a 401 from the Admin API so the next getShopifyAdminToken() call re-exchanges instead of reusing the rejected token. */
export function invalidateShopifyAdminToken(): void {
  cached = null;
}
