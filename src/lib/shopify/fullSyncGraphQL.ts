/**
 * G4 Shopify full-sync operations.
 *
 * Keep this file aligned with scripts/graphql/shopify-full-sync-2026-04.graphql.
 * That contract is validated against Shopify Admin GraphQL 2026-04 before use.
 */

export const PRODUCT_SYNC_SNAPSHOT_QUERY = `
  query ProductSyncSnapshot($id: ID!) {
    product(id: $id) {
      id title handle descriptionHtml vendor productType tags status updatedAt
      seo { title description }
      variants(first: 100) {
        nodes {
          id title sku price compareAtPrice inventoryPolicy
          selectedOptions { name value }
          inventoryItem {
            id tracked
            unitCost { amount currencyCode }
            inventoryLevels(first: 20) {
              nodes {
                location { id name }
                quantities(names: ["available"]) { name quantity }
              }
            }
          }
        }
      }
      media(first: 100) {
        nodes {
          id alt mediaContentType status
          ... on MediaImage { image { url } }
          ... on ExternalVideo { originUrl }
        }
      }
      metafields(first: 50, namespace: "custom") {
        nodes { id namespace key type value updatedAt }
      }
    }
  }
`;

export const SYNC_PRODUCT_CORE_MUTATION = `
  mutation SyncProductCore($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id status updatedAt }
      userErrors { field message }
    }
  }
`;

export const SYNC_PRODUCT_VARIANTS_MUTATION = `
  mutation SyncProductVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id sku price compareAtPrice inventoryPolicy
        inventoryItem { id }
      }
      userErrors { field message }
    }
  }
`;

export const CREATE_PRODUCT_VARIANTS_MUTATION = `
  mutation CreateProductVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
      productVariants {
        id sku price compareAtPrice
        inventoryItem { id }
      }
      userErrors { field message }
    }
  }
`;

export const DELETE_PRODUCT_VARIANTS_MUTATION = `
  mutation DeleteProductVariants($productId: ID!, $variantsIds: [ID!]!) {
    productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
      product { id updatedAt }
      userErrors { field message }
    }
  }
`;

export const ADD_PRODUCT_MEDIA_MUTATION = `
  mutation AddProductMedia($product: ProductUpdateInput!, $media: [CreateMediaInput!]!) {
    productUpdate(product: $product, media: $media) {
      product {
        id updatedAt
        media(first: 100) {
          nodes { id alt mediaContentType status }
        }
      }
      userErrors { field message }
    }
  }
`;

export const UPDATE_PRODUCT_FILES_MUTATION = `
  mutation UpdateProductFiles($files: [FileUpdateInput!]!) {
    fileUpdate(files: $files) {
      files { id alt fileStatus }
      userErrors { field message }
    }
  }
`;

export type ShopifyProductStatus = "ACTIVE" | "ARCHIVED" | "DRAFT" | "UNLISTED";

export type ShopifySyncSnapshot = {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  tags: string[];
  status: ShopifyProductStatus;
  updatedAt: string;
  seo?: { title?: string | null; description?: string | null } | null;
  variants: {
    nodes: Array<{
      id: string;
      title: string;
      sku: string | null;
      price: string;
      compareAtPrice: string | null;
      inventoryPolicy: "CONTINUE" | "DENY";
      selectedOptions: Array<{ name: string; value: string }>;
      inventoryItem: {
        id: string;
        tracked: boolean;
        unitCost?: { amount: string; currencyCode: string } | null;
        inventoryLevels: {
          nodes: Array<{
            location: { id: string; name: string };
            quantities: Array<{ name: string; quantity: number }>;
          }>;
        };
      };
    }>;
  };
  media: {
    nodes: Array<{
      id: string;
      alt: string | null;
      mediaContentType: "IMAGE" | "EXTERNAL_VIDEO" | "VIDEO" | "MODEL_3D";
      status: string;
      image?: { url: string } | null;
      originUrl?: string | null;
    }>;
  };
  metafields: {
    nodes: Array<{
      id: string;
      namespace: string;
      key: string;
      type: string;
      value: string;
      updatedAt: string;
    }>;
  };
};
