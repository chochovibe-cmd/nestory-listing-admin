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
// Sales channels. Online Store AND Google & YouTube are REQUIRED (any discovery /
// transport / userErrors / not-confirmed problem throws, so the caller rolls the
// product back to DRAFT). Point of Sale is OPTIONAL: its problems are warnings only.
// Only these three publication ids are ever sent to publishablePublish.
// ---------------------------------------------------------------------------
const GOOGLE_PUBLICATION_ID_ENV = "SHOPIFY_GOOGLE_PUBLICATION_ID";
const POS_PUBLICATION_ID_ENV = "SHOPIFY_POS_PUBLICATION_ID";
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

type PublicationNode = { id?: string; name?: string };

async function listPublications(caller: ShopifyAdminGraphQLCaller): Promise<PublicationNode[]> {
  const query = `
    query SalesChannelPublicationDiscovery {
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
  if (!Array.isArray(result?.data?.publications?.nodes)) {
    throw new Error(`Shopify publication discovery failed: ${messages(result?.errors ?? result)}`);
  }
  return result.data.publications.nodes as PublicationNode[];
}

/** REQUIRED channel: throws when it cannot be resolved unambiguously. */
export function resolveGooglePublicationId(
  publications: PublicationNode[],
  onlineStorePublicationId?: string
): string {
  const override = process.env[GOOGLE_PUBLICATION_ID_ENV]?.trim();
  let id: string;
  if (override && override.startsWith(PUBLICATION_GID_PREFIX)) {
    const named = publications.find((publication) => publication?.id === override);
    if (named && isPosPublicationName(named.name)) {
      throw new Error(
        `${GOOGLE_PUBLICATION_ID_ENV} points at「${String(named.name).trim()}」(a Point of Sale publication), not Google & YouTube.`
      );
    }
    id = override;
  } else {
    const matches = publications.filter(
      (publication) => publication?.id && isGooglePublicationName(publication?.name)
    );
    if (matches.length > 1) {
      throw new Error(
        `Shopify Google & YouTube publication is ambiguous (matches: ${matches
          .map((publication) => `${String(publication.name).trim()} ${String(publication.id)}`)
          .join("、")}). Set ${GOOGLE_PUBLICATION_ID_ENV}.`
      );
    }
    if (matches.length === 0) {
      const seen = publications
        .map((publication) => (typeof publication?.name === "string" ? publication.name.trim() : ""))
        .filter(Boolean)
        .join("、");
      throw new Error(
        `Shopify Google & YouTube publication could not be discovered (publications seen: ${seen || "none"}). Set ${GOOGLE_PUBLICATION_ID_ENV}.`
      );
    }
    id = matches[0].id as string;
  }
  if (onlineStorePublicationId && id === onlineStorePublicationId) {
    throw new Error(`${GOOGLE_PUBLICATION_ID_ENV} resolves to the Online Store publication, not Google & YouTube.`);
  }
  return id;
}

/** OPTIONAL channel: never throws; problems come back as a warning. */
export function resolvePosPublication(publications: PublicationNode[]): { id: string | null; warning: string | null } {
  const override = process.env[POS_PUBLICATION_ID_ENV]?.trim();
  if (override && override.startsWith(PUBLICATION_GID_PREFIX)) return { id: override, warning: null };
  const matches = publications.filter(
    (publication) => publication?.id && isPosPublicationName(publication?.name)
  );
  if (matches.length === 1) return { id: matches[0].id as string, warning: null };
  if (matches.length > 1) {
    return {
      id: null,
      warning: `找到多個銷售點 (POS) 頻道，已略過（商品已正常上架；可設定 ${POS_PUBLICATION_ID_ENV}）`
    };
  }
  return { id: null, warning: "找不到銷售點 (POS) 頻道，已略過（商品已正常上架）" };
}

async function publishableToPublication(
  productId: string,
  publicationId: string,
  mutationName: "PublishProductToGoogle" | "PublishProductToPos",
  label: string,
  caller: ShopifyAdminGraphQLCaller
): Promise<void> {
  const mutation = `
    mutation ${mutationName}($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        publishable {
          ... on Product { id status }
        }
        userErrors { field message }
      }
    }
  `;
  const { response, result } = await caller(mutation, { id: productId, input: [{ publicationId }] });
  const userErrors = result?.data?.publishablePublish?.userErrors;
  if (!response.ok) throw new Error(`Shopify ${label} publish failed: HTTP ${response.status}`);
  if (Array.isArray(result?.errors) && result.errors.length > 0) {
    throw new Error(`Shopify ${label} publish failed: ${messages(result.errors)}`);
  }
  if (Array.isArray(userErrors) && userErrors.length > 0) {
    throw new Error(`Shopify ${label} publish userErrors: ${messages(userErrors)}`);
  }
}

/** Read-only: is the product published on this publication? Throws on transport / GraphQL errors. */
async function isPublishedOnPublication(
  productId: string,
  publicationId: string,
  label: string,
  caller: ShopifyAdminGraphQLCaller
): Promise<boolean> {
  const query = `
    query ProductChannelState($id: ID!, $publicationId: ID!) {
      product(id: $id) {
        id
        publishedOnPublication(publicationId: $publicationId)
      }
    }
  `;
  const { response, result } = await caller(query, { id: productId, publicationId });
  if (!response.ok) throw new Error(`Shopify ${label} publication readback failed: HTTP ${response.status}`);
  if (Array.isArray(result?.errors) && result.errors.length > 0) {
    throw new Error(`Shopify ${label} publication readback failed: ${messages(result.errors)}`);
  }
  const product = result?.data?.product;
  if (!product || product.id !== productId) {
    throw new Error(`Shopify ${label} publication readback returned no product for ${productId}`);
  }
  return product.publishedOnPublication === true;
}

export type ExtraChannelsResult = {
  googlePublicationId: string;
  posPublicationId: string | null;
  warnings: string[];
};

/**
 * Google & YouTube (REQUIRED: throws) then Point of Sale (OPTIONAL: warning).
 * Only ever ADDS publications. `onlyIfMissing` (reconcile) reads the current state first so
 * channels the product is already on are not published again.
 */
export async function publishShopifyProductToExtraChannels(
  productId: string,
  onlineStorePublicationId: string,
  caller: ShopifyAdminGraphQLCaller = defaultCaller,
  options: { onlyIfMissing?: boolean } = {}
): Promise<ExtraChannelsResult> {
  assertLiveProductId(productId);
  const publications = await listPublications(caller);

  const googleId = resolveGooglePublicationId(publications, onlineStorePublicationId);
  const googleAlready = options.onlyIfMissing
    ? await isPublishedOnPublication(productId, googleId, "Google & YouTube", caller)
    : false;
  if (!googleAlready) {
    await publishableToPublication(productId, googleId, "PublishProductToGoogle", "Google & YouTube", caller);
    if (!(await isPublishedOnPublication(productId, googleId, "Google & YouTube", caller))) {
      throw new Error(`Shopify Google & YouTube publication readback mismatch for ${productId}`);
    }
  }

  const warnings: string[] = [];
  let posPublicationId: string | null = null;
  try {
    const pos = resolvePosPublication(publications);
    if (!pos.id) {
      if (pos.warning) warnings.push(pos.warning);
    } else if (pos.id === onlineStorePublicationId || pos.id === googleId) {
      warnings.push("銷售點 (POS) 頻道編號與其他通路相同，已略過（商品已正常上架）");
    } else {
      const already = options.onlyIfMissing
        ? await isPublishedOnPublication(productId, pos.id, "POS", caller)
        : false;
      if (!already) {
        await publishableToPublication(productId, pos.id, "PublishProductToPos", "POS", caller);
      }
      posPublicationId = pos.id;
    }
  } catch (error) {
    posPublicationId = null;
    warnings.push(
      `銷售點 (POS) 頻道發布失敗，已略過（商品已正常上架）：${error instanceof Error ? error.message : String(error)}`
    );
  }

  return { googlePublicationId: googleId, posPublicationId, warnings };
}

/**
 * Reconcile helper: the product is already ACTIVE. Makes sure the channels are present:
 * Online Store (required), Google & YouTube (required), POS (optional, warning).
 * ONLY ever adds publications (never unpublishes, never edits product content).
 * Throws when a required channel cannot be confirmed.
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
    const extras = await publishShopifyProductToExtraChannels(productId, publicationId, caller, {
      onlyIfMissing: true
    });
    return {
      publishedAt: typeof product.publishedAt === "string" && product.publishedAt ? product.publishedAt : null,
      onlineStoreAdded: false,
      warnings: extras.warnings
    };
  }

  // Not on the Online Store yet: the full publish adds Online Store + Google + POS.
  const published = await publishShopifyProductToOnlineStore(productId, caller, {
    extrasOnlyIfMissing: true
  });
  return { publishedAt: published.publishedAt, onlineStoreAdded: true, warnings: published.warnings };
}

export async function publishShopifyProductToOnlineStore(
  productId: string,
  caller: ShopifyAdminGraphQLCaller = defaultCaller,
  options: { extrasOnlyIfMissing?: boolean } = {}
): Promise<{
  id: string;
  publicationId: string;
  publishedAt: string;
  googlePublicationId: string;
  posPublicationId: string | null;
  /** Optional-channel (POS) notes only; required channels throw instead. */
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

  // Google & YouTube is REQUIRED too (throws -> caller rolls back to DRAFT); POS is optional.
  const extras = await publishShopifyProductToExtraChannels(productId, publicationId, caller, {
    onlyIfMissing: options.extrasOnlyIfMissing === true
  });

  return {
    id: product.id,
    publicationId,
    publishedAt: product.publishedAt,
    googlePublicationId: extras.googlePublicationId,
    posPublicationId: extras.posPublicationId,
    warnings: extras.warnings
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
