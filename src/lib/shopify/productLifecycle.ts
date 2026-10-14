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

export async function publishShopifyProductToOnlineStore(
  productId: string,
  caller: ShopifyAdminGraphQLCaller = defaultCaller
): Promise<{ id: string; publicationId: string; publishedAt: string }> {
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

  return {
    id: product.id,
    publicationId,
    publishedAt: product.publishedAt
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
