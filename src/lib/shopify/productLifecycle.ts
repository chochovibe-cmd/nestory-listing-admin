import { callShopifyAdminGraphQL } from "@/lib/shopify/adminGraphQL";

export type ShopifyProductLifecycleStatus = "ACTIVE" | "DRAFT";

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
  if (product.status !== "ACTIVE" && product.status !== "DRAFT") {
    throw new Error(`Unexpected Shopify product status: ${String(product.status)}`);
  }
  return { id: product.id, status: product.status };
}

export async function setShopifyProductStatus(
  productId: string,
  status: ShopifyProductLifecycleStatus,
  caller: ShopifyAdminGraphQLCaller = defaultCaller
): Promise<{ id: string; status: ShopifyProductLifecycleStatus }> {
  assertLiveProductId(productId);
  const mutation = `
    mutation ProductChangeStatus($productId: ID!, $status: ProductStatus!) {
      productChangeStatus(productId: $productId, status: $status) {
        product { id status }
        userErrors { field message }
      }
    }
  `;
  const { response, result } = await caller(mutation, { productId, status });
  const userErrors = result?.data?.productChangeStatus?.userErrors;
  if (!response.ok) {
    throw new Error(`Shopify productChangeStatus failed: HTTP ${response.status}`);
  }
  if (Array.isArray(result?.errors) && result.errors.length > 0) {
    throw new Error(`Shopify productChangeStatus failed: ${messages(result.errors)}`);
  }
  if (Array.isArray(userErrors) && userErrors.length > 0) {
    throw new Error(`Shopify productChangeStatus userErrors: ${messages(userErrors)}`);
  }
  const product = result?.data?.productChangeStatus?.product;
  if (!product || product.id !== productId || product.status !== status) {
    throw new Error(
      `Shopify productChangeStatus confirmation mismatch: expected ${productId} ${status}, got ${String(product?.id)} ${String(product?.status)}`
    );
  }
  return { id: product.id, status: product.status };
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
