import { callShopifyAdminGraphQL } from "@/lib/shopify/adminGraphQL";

export type ShopifyProductLifecycleStatus = "ACTIVE" | "ARCHIVED" | "DRAFT" | "UNLISTED";

export type ShopifyAdminGraphQLCaller = (
  query: string,
  variables: Record<string, unknown>
) => Promise<{ response: Response; result: any }>;

const defaultCaller: ShopifyAdminGraphQLCaller = (query, variables) =>
  callShopifyAdminGraphQL(query, variables);

export function isRealShopifyProductId(productId: unknown): productId is string {
  return (
    typeof productId === "string" &&
    productId.trim().length > 0 &&
    productId !== "mock-product-id"
  );
}

function messages(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function assertLiveProductId(productId: string): void {
  if (!isRealShopifyProductId(productId)) {
    throw new Error("Refusing Shopify lifecycle mutation for a missing/mock product ID");
  }
}

export async function getShopifyProductStatus(
  productId: string,
  caller: ShopifyAdminGraphQLCaller = defaultCaller
): Promise<{ id: string; status: ShopifyProductLifecycleStatus } | null> {
  assertLiveProductId(productId);
  const query = `
    query ProductLifecycleStatus($id: ID!) {
      product(id: $id) { id status }
    }
  `;
  const { response, result } = await caller(query, { id: productId });
  if (!response.ok) {
    throw new Error(`Shopify product status query failed: HTTP ${response.status}`);
  }
  if (Array.isArray(result?.errors) && result.errors.length > 0) {
    throw new Error(`Shopify product status query failed: ${messages(result.errors)}`);
  }
  const product = result?.data?.product;
  if (!product) return null;
  if (product.id !== productId) {
    throw new Error(`Shopify product status query returned a different product ID: ${String(product.id)}`);
  }
  if (!["ACTIVE", "ARCHIVED", "DRAFT", "UNLISTED"].includes(product.status)) {
    throw new Error(`Unexpected Shopify product status: ${String(product.status)}`);
  }
  return { id: product.id, status: product.status };
}

export async function setShopifyProductStatus(
  productId: string,
  status: ShopifyProductLifecycleStatus,
  caller: ShopifyAdminGraphQLCaller = defaultCaller
): Promise<{ id: string; status: ShopifyProductLifecycleStatus; updatedAt: string }> {
  assertLiveProductId(productId);
  const mutation = `
    mutation ProductUpdateStatus($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id status updatedAt }
        userErrors { field message }
      }
    }
  `;
  const { response, result } = await caller(mutation, { product: { id: productId, status } });
  const userErrors = result?.data?.productUpdate?.userErrors;
  if (!response.ok) {
    throw new Error(`Shopify productUpdate status failed: HTTP ${response.status}`);
  }
  if (Array.isArray(result?.errors) && result.errors.length > 0) {
    throw new Error(`Shopify productUpdate status failed: ${messages(result.errors)}`);
  }
  if (Array.isArray(userErrors) && userErrors.length > 0) {
    throw new Error(`Shopify productUpdate status userErrors: ${messages(userErrors)}`);
  }
  const product = result?.data?.productUpdate?.product;
  if (!product || product.id !== productId || product.status !== status) {
    throw new Error(
      `Shopify productUpdate status confirmation mismatch: expected ${productId} ${status}, got ${String(product?.id)} ${String(product?.status)}`
    );
  }
  return { id: product.id, status: product.status, updatedAt: product.updatedAt };
}


function legacyGidTail(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const tail = id.split("/").pop()?.trim();
  return tail || null;
}

const ONLINE_STORE_PUBLICATION_ID_ENV = "SHOPIFY_ONLINE_STORE_PUBLICATION_ID";
const PUBLICATION_GID_PREFIX = "gid://shopify/Publication/";
// Fallback only: exact (trimmed) publication names of the Online Store sales channel.
// Never add POS / Google & YouTube / any other channel name here.
const ONLINE_STORE_PUBLICATION_NAMES = new Set([
  "online store",
  "線上商店",
  "网上商店",
  "線上商店 online store"
]);

function isOnlineStorePublicationName(name: unknown): boolean {
  return typeof name === "string" && ONLINE_STORE_PUBLICATION_NAMES.has(name.trim().toLowerCase());
}

export async function getShopifyOnlineStorePublicationId(
  caller: ShopifyAdminGraphQLCaller = defaultCaller
): Promise<string> {
  const override = process.env[ONLINE_STORE_PUBLICATION_ID_ENV]?.trim();
  if (override && override.startsWith(PUBLICATION_GID_PREFIX)) return override;

  const query = `
    query OnlineStorePublicationDiscovery {
      channels(first: 50) {
        nodes {
          id
          name
          handle
          app { handle }
        }
      }
      publications(first: 50) {
        nodes {
          id
          name
        }
      }
    }
  `;
  const { response, result } = await caller(query, {});
  if (!response.ok) {
    throw new Error(`Shopify publication discovery failed: HTTP ${response.status}`);
  }
  // The deprecated `channels` field can error for a non-sales-channel app while `publications`
  // still returns data; only fail hard when there is no publications data to fall back on.
  if (
    Array.isArray(result?.errors) &&
    result.errors.length > 0 &&
    !Array.isArray(result?.data?.publications?.nodes)
  ) {
    throw new Error(`Shopify publication discovery failed: ${messages(result.errors)}`);
  }

  const channels = Array.isArray(result?.data?.channels?.nodes) ? result.data.channels.nodes : [];
  const publications = Array.isArray(result?.data?.publications?.nodes) ? result.data.publications.nodes : [];
  const onlineStoreChannel = channels.find(
    (channel: any) => channel?.handle === "online_store" || channel?.app?.handle === "online_store"
  );

  if (onlineStoreChannel?.id) {
    const channelTail = legacyGidTail(onlineStoreChannel.id);
    const byLegacyId = channelTail
      ? publications.find((publication: any) => legacyGidTail(publication?.id) === channelTail)
      : null;
    const byChannelName = onlineStoreChannel?.name
      ? publications.find((publication: any) => publication?.name === onlineStoreChannel.name)
      : null;
    const publication = byLegacyId ?? byChannelName;
    if (publication?.id) return publication.id as string;
  }

  const byName = publications.filter(
    (publication: any) => publication?.id && isOnlineStorePublicationName(publication?.name)
  );
  if (byName.length > 1) {
    throw new Error(
      `Shopify Online Store publication is ambiguous (matches: ${byName
        .map((publication: any) => `${String(publication.name).trim()} ${String(publication.id)}`)
        .join("、")}). Set ${ONLINE_STORE_PUBLICATION_ID_ENV}.`
    );
  }
  if (byName.length === 1) return byName[0].id as string;

  const seen = publications
    .map((publication: any) => (typeof publication?.name === "string" ? publication.name.trim() : ""))
    .filter(Boolean)
    .join("、");
  throw new Error(
    `Shopify Online Store publication could not be discovered (publications seen: ${seen || "none"}). Set ${ONLINE_STORE_PUBLICATION_ID_ENV}.`
  );
}

// ---------------------------------------------------------------------------
// Google & YouTube channel (OPTIONAL). Online Store stays the only required channel.
// POS is never published: only the Online Store id and the Google id are ever sent.
// ---------------------------------------------------------------------------
const GOOGLE_PUBLICATION_ID_ENV = "SHOPIFY_GOOGLE_PUBLICATION_ID";
const POS_PUBLICATION_NAME_RE = /point of sale|銷售點|销售点|\bpos\b/i;

export function isPosPublicationName(name: unknown): boolean {
  return typeof name === "string" && POS_PUBLICATION_NAME_RE.test(name);
}

/** "Google & YouTube", "Google 和 YouTube", "Google & YouTube 頻道" ... (name contains both words). */
export function isGooglePublicationName(name: unknown): boolean {
  if (typeof name !== "string") return false;
  const lower = name.trim().toLowerCase();
  return lower.includes("google") && lower.includes("youtube") && !isPosPublicationName(lower);
}

export type GooglePublicationDiscovery = { id: string | null; warning: string | null };

/**
 * Finds the Google & YouTube publication. Never throws for "not found": the
 * channel is optional, so the caller only gets `id:null` plus a warning.
 * A discovery/transport error also becomes a warning.
 */
export async function discoverShopifyGooglePublication(
  caller: ShopifyAdminGraphQLCaller = defaultCaller
): Promise<GooglePublicationDiscovery> {
  const override = process.env[GOOGLE_PUBLICATION_ID_ENV]?.trim();
  const validOverride = override && override.startsWith(PUBLICATION_GID_PREFIX) ? override : null;

  const query = `
    query GooglePublicationDiscovery {
      publications(first: 50) {
        nodes {
          id
          name
        }
      }
    }
  `;
  let publications: any[] = [];
  try {
    const { response, result } = await caller(query, {});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!Array.isArray(result?.data?.publications?.nodes)) {
      throw new Error(messages(result?.errors ?? result));
    }
    publications = result.data.publications.nodes;
  } catch (error) {
    // Without the list the override's name cannot be checked against POS; a configured
    // id is still used, but nothing is guessed.
    if (validOverride) return { id: validOverride, warning: null };
    return {
      id: null,
      warning: `Google & YouTube 頻道探索失敗，已略過（商品已正常上架）：${
        error instanceof Error ? error.message : String(error)
      }`
    };
  }

  if (validOverride) {
    const named = publications.find((publication: any) => publication?.id === validOverride);
    if (named && isPosPublicationName(named.name)) {
      return {
        id: null,
        warning: `${GOOGLE_PUBLICATION_ID_ENV} 指向「${String(named.name).trim()}」（銷售點類通路），已略過 Google & YouTube 頻道`
      };
    }
    return { id: validOverride, warning: null };
  }

  const matches = publications.filter(
    (publication: any) => publication?.id && isGooglePublicationName(publication?.name)
  );
  if (matches.length === 1) return { id: matches[0].id as string, warning: null };
  if (matches.length > 1) {
    return {
      id: null,
      warning: `找到多個 Google & YouTube 頻道，已略過（請設定 ${GOOGLE_PUBLICATION_ID_ENV}）`
    };
  }
  return { id: null, warning: "找不到 Google & YouTube 頻道，已略過（商品已正常上架）" };
}

export async function getShopifyGooglePublicationId(
  caller: ShopifyAdminGraphQLCaller = defaultCaller
): Promise<string | null> {
  return (await discoverShopifyGooglePublication(caller)).id;
}

export type GoogleChannelPublishResult = {
  publicationId: string | null;
  published: boolean;
  warning: string | null;
};

/**
 * Best-effort publish to Google & YouTube. Never throws: any failure becomes a
 * warning so the (already confirmed) Online Store publication is never rolled back.
 * `onlyIfMissing` reads the current state first (reconcile) and skips the write
 * when the product is already published there.
 */
export async function publishShopifyProductToGoogle(
  productId: string,
  caller: ShopifyAdminGraphQLCaller = defaultCaller,
  options: { onlyIfMissing?: boolean; excludePublicationIds?: string[] } = {}
): Promise<GoogleChannelPublishResult> {
  try {
    assertLiveProductId(productId);
    const found = await discoverShopifyGooglePublication(caller);
    if (!found.id) return { publicationId: null, published: false, warning: found.warning };
    if (options.excludePublicationIds?.includes(found.id)) {
      return { publicationId: found.id, published: false, warning: null };
    }

    if (options.onlyIfMissing) {
      const stateQuery = `
        query ReconcileProductGoogleChannel($id: ID!, $publicationId: ID!) {
          product(id: $id) {
            id
            publishedOnPublication(publicationId: $publicationId)
          }
        }
      `;
      const { response, result } = await caller(stateQuery, { id: productId, publicationId: found.id });
      if (
        response.ok &&
        !(Array.isArray(result?.errors) && result.errors.length > 0) &&
        result?.data?.product?.publishedOnPublication === true
      ) {
        return { publicationId: found.id, published: false, warning: null };
      }
    }

    const mutation = `
      mutation PublishProductToGoogle($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          publishable {
            ... on Product { id status }
          }
          userErrors { field message }
        }
      }
    `;
    const { response, result } = await caller(mutation, {
      id: productId,
      input: [{ publicationId: found.id }]
    });
    const userErrors = result?.data?.publishablePublish?.userErrors;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (Array.isArray(result?.errors) && result.errors.length > 0) throw new Error(messages(result.errors));
    if (Array.isArray(userErrors) && userErrors.length > 0) throw new Error(messages(userErrors));
    return { publicationId: found.id, published: true, warning: null };
  } catch (error) {
    return {
      publicationId: null,
      published: false,
      warning: `Google & YouTube 頻道發布失敗，已略過（商品已正常上架）：${
        error instanceof Error ? error.message : String(error)
      }`
    };
  }
}

/**
 * Reconcile helper: the product is already ACTIVE. Makes sure the required
 * channels are present. ONLY ever adds publications (never unpublishes, never
 * edits product content). Throws when the Online Store cannot be confirmed.
 */
export async function ensureShopifyProductChannels(
  productId: string,
  caller: ShopifyAdminGraphQLCaller = defaultCaller
): Promise<{ publishedAt: string | null; onlineStoreAdded: boolean; warnings: string[] }> {
  assertLiveProductId(productId);
  const publicationId = await getShopifyOnlineStorePublicationId(caller);
  const stateQuery = `
    query ReconcileProductChannels($id: ID!, $publicationId: ID!) {
      product(id: $id) {
        id
        status
        publishedAt
        publishedOnPublication(publicationId: $publicationId)
      }
    }
  `;
  const { response, result } = await caller(stateQuery, { id: productId, publicationId });
  if (!response.ok) {
    throw new Error(`Shopify channel state query failed: HTTP ${response.status}`);
  }
  if (Array.isArray(result?.errors) && result.errors.length > 0) {
    throw new Error(`Shopify channel state query failed: ${messages(result.errors)}`);
  }
  const product = result?.data?.product;
  if (!product || product.id !== productId) {
    throw new Error(`Shopify channel state query returned no product for ${productId}`);
  }

  if (product.publishedOnPublication === true) {
    const google = await publishShopifyProductToGoogle(productId, caller, {
      onlyIfMissing: true,
      excludePublicationIds: [publicationId]
    });
    return {
      publishedAt: typeof product.publishedAt === "string" && product.publishedAt ? product.publishedAt : null,
      onlineStoreAdded: false,
      warnings: google.warning ? [google.warning] : []
    };
  }

  const published = await publishShopifyProductToOnlineStore(productId, caller);
  return { publishedAt: published.publishedAt, onlineStoreAdded: true, warnings: published.warnings };
}

export async function publishShopifyProductToOnlineStore(
  productId: string,
  caller: ShopifyAdminGraphQLCaller = defaultCaller
): Promise<{
  id: string;
  publicationId: string;
  publishedAt: string;
  googlePublicationId: string | null;
  warnings: string[];
}> {
  assertLiveProductId(productId);
  const publicationId = await getShopifyOnlineStorePublicationId(caller);

  const mutation = `
    mutation PublishProductToOnlineStore($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        publishable {
          ... on Product { id status publishedAt }
        }
        userErrors { field message }
      }
    }
  `;
  const { response, result } = await caller(mutation, {
    id: productId,
    input: [{ publicationId }]
  });
  const userErrors = result?.data?.publishablePublish?.userErrors;
  if (!response.ok) {
    throw new Error(`Shopify Online Store publish failed: HTTP ${response.status}`);
  }
  if (Array.isArray(result?.errors) && result.errors.length > 0) {
    throw new Error(`Shopify Online Store publish failed: ${messages(result.errors)}`);
  }
  if (Array.isArray(userErrors) && userErrors.length > 0) {
    throw new Error(`Shopify Online Store publish userErrors: ${messages(userErrors)}`);
  }

  const publishable = result?.data?.publishablePublish?.publishable;
  if (!publishable || publishable.id !== productId || publishable.status !== "ACTIVE") {
    throw new Error(
      `Shopify Online Store publish confirmation mismatch for ${productId}: ${messages(publishable)}`
    );
  }

  const verifyQuery = `
    query VerifyProductOnlineStore($id: ID!, $publicationId: ID!) {
      product(id: $id) {
        id
        status
        publishedAt
        publishedOnPublication(publicationId: $publicationId)
      }
    }
  `;
  const { response: verifyResponse, result: verifyResult } = await caller(verifyQuery, {
    id: productId,
    publicationId
  });
  if (!verifyResponse.ok) {
    throw new Error(`Shopify Online Store publication readback failed: HTTP ${verifyResponse.status}`);
  }
  if (Array.isArray(verifyResult?.errors) && verifyResult.errors.length > 0) {
    throw new Error(
      `Shopify Online Store publication readback failed: ${messages(verifyResult.errors)}`
    );
  }

  const product = verifyResult?.data?.product;
  if (
    !product ||
    product.id !== productId ||
    product.status !== "ACTIVE" ||
    product.publishedOnPublication !== true ||
    typeof product.publishedAt !== "string" ||
    product.publishedAt.length === 0
  ) {
    throw new Error(
      `Shopify Online Store publication readback mismatch for ${productId}: ${messages(product)}`
    );
  }

  // Optional second channel: only after the required one is confirmed, never fatal.
  const google = await publishShopifyProductToGoogle(productId, caller, {
    excludePublicationIds: [publicationId]
  });

  return {
    id: product.id,
    publicationId,
    publishedAt: product.publishedAt,
    googlePublicationId: google.published ? google.publicationId : null,
    warnings: google.warning ? [google.warning] : []
  };
}

export async function deleteShopifyProduct(
  productId: string,
  caller: ShopifyAdminGraphQLCaller = defaultCaller
): Promise<string> {
  assertLiveProductId(productId);
  const mutation = `
    mutation ProductDelete($input: ProductDeleteInput!) {
      productDelete(input: $input) {
        deletedProductId
        userErrors { field message }
      }
    }
  `;
  const { response, result } = await caller(mutation, { input: { id: productId } });
  const userErrors = result?.data?.productDelete?.userErrors;
  if (!response.ok) {
    throw new Error(`Shopify productDelete failed: HTTP ${response.status}`);
  }
  if (Array.isArray(result?.errors) && result.errors.length > 0) {
    throw new Error(`Shopify productDelete failed: ${messages(result.errors)}`);
  }
  if (Array.isArray(userErrors) && userErrors.length > 0) {
    throw new Error(`Shopify productDelete userErrors: ${messages(userErrors)}`);
  }
  const deletedProductId = result?.data?.productDelete?.deletedProductId;
  if (deletedProductId !== productId) {
    throw new Error(
      `Shopify productDelete confirmation mismatch: expected ${productId}, got ${String(deletedProductId)}`
    );
  }
  return deletedProductId;
}
