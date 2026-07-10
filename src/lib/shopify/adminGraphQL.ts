import { getShopifyAdminToken, invalidateShopifyAdminToken } from "@/lib/shopify/adminToken";

// A1: thin authenticated wrapper around the Admin GraphQL endpoint. Centralises
// the "attach current token, retry once on 401" logic so publishDraft.ts (and
// Phase D's Shopify Files calls -- stagedUploadsCreate/fileCreate/
// productCreateMedia/fileDelete, per 圖床架構) don't each reimplement it.
export async function callShopifyAdminGraphQL<T = unknown>(
  query: string,
  variables: Record<string, unknown>,
): Promise<{ response: Response; result: T }> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const apiVersion = process.env.SHOPIFY_API_VERSION || "2026-04";

  if (!domain) {
    throw new Error("SHOPIFY_STORE_DOMAIN is not configured.");
  }

  const endpoint = `https://${domain}/admin/api/${apiVersion}/graphql.json`;

  const post = async (accessToken: string) =>
    fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });

  let token = await getShopifyAdminToken();
  let response = await post(token);

  // The client_credentials token has no refresh token and no reliable
  // "about to expire" signal beyond our own clock -- a 401 here means the
  // cached token was rejected (expired early, revoked, or clock drift), so
  // invalidate and exchange exactly once more before giving up.
  if (response.status === 401) {
    invalidateShopifyAdminToken();
    token = await getShopifyAdminToken();
    response = await post(token);
  }

  const result = (await response.json()) as T;
  return { response, result };
}
