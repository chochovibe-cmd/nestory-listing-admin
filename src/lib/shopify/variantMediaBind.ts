/**
 * VARIANT-CLEAN: bind each variant to its own product image on Shopify.
 *
 * product_variants.image_id says which local image a 款式 shows, but Shopify only accepts a
 * MediaImage id, and that exists only after the media was attached and processed (READY).
 * So the bind runs AFTER the media step: read the product's media + variants, wait (bounded)
 * for the needed images to turn READY, then send ONE productVariantsBulkUpdate carrying only
 * {id, mediaId}. Everything here is best effort: a failure becomes a warning, never a failed publish.
 * The 重同步工具 reuses the same matching + bind for products that went live before this existed.
 */
import {
  planResumeVariantSync,
  type ResumeRemoteVariant
} from "@/lib/variants/shopifyVariants";
import type { ShopifyVariantSeed } from "@/lib/variants/types";
import type { ShopifyAdminGraphQLCaller } from "@/lib/shopify/productLifecycle";

export const PRODUCT_MEDIA_BIND_QUERY = `
  query ProductMediaBind($id: ID!) {
    product(id: $id) {
      id
      media(first: 100) {
        nodes {
          id mediaContentType status
          ... on MediaImage { image { url } }
        }
      }
      variants(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          id title sku price compareAtPrice
          selectedOptions { name value }
          media(first: 1) { nodes { id } }
        }
      }
    }
  }
`;

export const BIND_VARIANT_MEDIA_MUTATION = `
  mutation BindVariantMedia($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id }
      userErrors { field message }
    }
  }
`;

export const ADD_VARIANT_MEDIA_MUTATION = `
  mutation AddVariantImageMedia($product: ProductUpdateInput!, $media: [CreateMediaInput!]!) {
    productUpdate(product: $product, media: $media) {
      product {
        id
        media(first: 100) { nodes { id mediaContentType status } }
      }
      userErrors { field message }
    }
  }
`;

/** Default budget: wait at most 12s, and never past the caller's deadline. */
export const MEDIA_READY_MAX_WAIT_MS = 12_000;
export const MEDIA_READY_POLL_MS = 1_500;
const MAX_ROUNDS = 12;

export type LocalImageRef = {
  /** product_images.id */
  id: string;
  url: string | null;
  alt?: string | null;
  /** Saved from an earlier sync/bind, when known. */
  shopifyMediaId?: string | null;
  /** false = not part of the product's media payload (e.g. a detail image) -> must be added first. */
  inProductMedia: boolean;
};

export type RemoteMediaNode = {
  id: string;
  mediaContentType?: string | null;
  status?: string | null;
  image?: { url?: string | null } | null;
};

export type RemoteBindVariant = ResumeRemoteVariant & {
  price?: string | null;
  compareAtPrice?: string | null;
  media?: { nodes?: Array<{ id: string }> } | null;
};

export function imageBasename(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const last = new URL(url).pathname.split("/").pop() ?? "";
    return last ? decodeURIComponent(last).toLowerCase() : null;
  } catch {
    return null;
  }
}

export type ImageMediaMatch = {
  /** product_images.id -> Shopify MediaImage id */
  byImageId: Map<string, string>;
  /** local image ids that could not be matched to any remote image */
  unmatched: string[];
};

/**
 * Which Shopify MediaImage is which local image. Order of trust:
 * 1) the media id saved on the image row, if Shopify still has it;
 * 2) the file name (processed_file_url is usually already a cdn.shopify.com file, so the
 *    name survives); only when exactly one local and one remote image share it;
 * 3) position, only when both sides have the same number of images.
 */
export function matchImagesToMedia(
  localImages: LocalImageRef[],
  remoteMedia: RemoteMediaNode[]
): ImageMediaMatch {
  const remoteImages = remoteMedia.filter(
    (node) => (node.mediaContentType ?? "IMAGE") === "IMAGE" && node.id
  );
  const remoteIds = new Set(remoteImages.map((node) => node.id));
  const byImageId = new Map<string, string>();
  const takenRemote = new Set<string>();

  for (const local of localImages) {
    if (local.shopifyMediaId && remoteIds.has(local.shopifyMediaId) && !takenRemote.has(local.shopifyMediaId)) {
      byImageId.set(local.id, local.shopifyMediaId);
      takenRemote.add(local.shopifyMediaId);
    }
  }

  const remoteByName = new Map<string, string[]>();
  for (const node of remoteImages) {
    const name = imageBasename(node.image?.url);
    if (!name) continue;
    remoteByName.set(name, [...(remoteByName.get(name) ?? []), node.id]);
  }
  const localNameCount = new Map<string, number>();
  for (const local of localImages) {
    const name = imageBasename(local.url);
    if (name) localNameCount.set(name, (localNameCount.get(name) ?? 0) + 1);
  }
  for (const local of localImages) {
    if (byImageId.has(local.id)) continue;
    const name = imageBasename(local.url);
    if (!name || localNameCount.get(name) !== 1) continue;
    const candidates = (remoteByName.get(name) ?? []).filter((id) => !takenRemote.has(id));
    if (candidates.length === 1) {
      byImageId.set(local.id, candidates[0]);
      takenRemote.add(candidates[0]);
    }
  }

  const inMedia = localImages.filter((local) => local.inProductMedia);
  if (inMedia.length > 0 && inMedia.length === remoteImages.length) {
    inMedia.forEach((local, index) => {
      if (byImageId.has(local.id)) return;
      const node = remoteImages[index];
      if (node && !takenRemote.has(node.id)) {
        byImageId.set(local.id, node.id);
        takenRemote.add(node.id);
      }
    });
  }

  return {
    byImageId,
    unmatched: localImages.filter((local) => !byImageId.has(local.id)).map((local) => local.id)
  };
}

export type VariantMediaBindPlan = {
  /** {id, mediaId} pairs ready for productVariantsBulkUpdate */
  binds: Array<{ id: string; mediaId: string; label: string }>;
  /** variants (by label) whose image is matched but not READY yet */
  notReady: string[];
  /** variants (by label) whose image could not be matched to a Shopify image */
  unmatched: string[];
  /** variants that already show the wanted media (nothing to send) */
  alreadyBound: number;
  /** seeds Shopify has no variant for */
  unmatchedVariants: string[];
};

function seedLabel(seed: ShopifyVariantSeed): string {
  return seed.optionValues.map((ov) => ov.name).join("／") || "款式";
}

/** Pure: which variant gets which media right now (READY only). */
export function planVariantMediaBinds(input: {
  seeds: ShopifyVariantSeed[];
  remoteVariants: RemoteBindVariant[];
  match: ImageMediaMatch;
  remoteMedia: RemoteMediaNode[];
}): VariantMediaBindPlan {
  const plan = planResumeVariantSync(input.seeds, input.remoteVariants);
  const status = new Map(input.remoteMedia.map((node) => [node.id, node.status ?? ""]));
  const remoteById = new Map(input.remoteVariants.map((variant) => [variant.id, variant]));
  const out: VariantMediaBindPlan = {
    binds: [],
    notReady: [],
    unmatched: [],
    alreadyBound: 0,
    unmatchedVariants: plan.missing.map(seedLabel)
  };
  for (const { seed, variantId } of plan.matched) {
    if (!seed.imageId) continue;
    const mediaId = input.match.byImageId.get(seed.imageId);
    if (!mediaId) {
      out.unmatched.push(seedLabel(seed));
      continue;
    }
    if ((status.get(mediaId) ?? "") !== "READY") {
      out.notReady.push(seedLabel(seed));
      continue;
    }
    const current = remoteById.get(variantId)?.media?.nodes?.[0]?.id ?? null;
    if (current === mediaId) {
      out.alreadyBound += 1;
      continue;
    }
    out.binds.push({ id: variantId, mediaId, label: seedLabel(seed) });
  }
  return out;
}

function errorsOf(result: any, path: string): unknown[] {
  const userErrors = result?.data?.[path]?.userErrors;
  if (Array.isArray(userErrors) && userErrors.length > 0) return userErrors;
  if (Array.isArray(result?.errors) && result.errors.length > 0) return result.errors;
  return [];
}

/** Reads a product's variants the way the bind query returns them. */
export function toRemoteBindVariants(rawNodes: unknown): RemoteBindVariant[] {
  return ((Array.isArray(rawNodes) ? rawNodes : []) as any[]).map((node) => ({
    id: String(node?.id),
    title: typeof node?.title === "string" ? node.title : null,
    sku: typeof node?.sku === "string" ? node.sku : null,
    price: node?.price ?? null,
    compareAtPrice: node?.compareAtPrice ?? null,
    media: node?.media ?? null,
    selectedOptions: Array.isArray(node?.selectedOptions)
      ? node.selectedOptions.map((o: any) => ({ name: String(o?.name ?? ""), value: String(o?.value ?? "") }))
      : []
  }));
}

export type BindVariantMediaInput = {
  caller: ShopifyAdminGraphQLCaller;
  productId: string;
  seeds: ShopifyVariantSeed[];
  localImages: LocalImageRef[];
  /** Absolute ms timestamp: no new wait/request starts after this. */
  deadlineAt: number;
  maxWaitMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type BindVariantMediaResult = {
  bound: number;
  warnings: string[];
  /** product_images.id -> media id, so the caller can persist shopify_media_id */
  imageMediaIds: Map<string, string>;
};

/**
 * Bounded wait for READY, then one bulk update. Never throws.
 * Rounds: read -> (add images that are not in the product media yet, once) -> wait -> bind.
 */
export async function bindVariantMedia(input: BindVariantMediaInput): Promise<BindVariantMediaResult> {
  const now = input.now ?? (() => Date.now());
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pollMs = input.pollMs ?? MEDIA_READY_POLL_MS;
  const stopWaitingAt = Math.min(input.deadlineAt, now() + (input.maxWaitMs ?? MEDIA_READY_MAX_WAIT_MS));
  const warnings: string[] = [];

  const wantedImageIds = new Set(
    input.seeds.map((seed) => seed.imageId).filter((id): id is string => Boolean(id))
  );
  if (wantedImageIds.size === 0) return { bound: 0, warnings, imageMediaIds: new Map() };
  const wantedImages = input.localImages.filter((image) => wantedImageIds.has(image.id));

  let addedMissing = false;
  try {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const { response, result } = await input.caller(PRODUCT_MEDIA_BIND_QUERY, { id: input.productId });
      const product = result?.data?.product;
      if (
        !response.ok ||
        product?.id !== input.productId ||
        (Array.isArray(result?.errors) && result.errors.length > 0)
      ) {
        warnings.push("款式圖綁定略過：讀不到 Shopify 商品的圖片與款式。");
        return { bound: 0, warnings, imageMediaIds: new Map() };
      }
      const remoteMedia = (product.media?.nodes ?? []) as RemoteMediaNode[];
      const remoteVariants = toRemoteBindVariants(product.variants?.nodes);
      const match = matchImagesToMedia(wantedImages, remoteMedia);

      // A variant picture that is not part of the product's media (e.g. a detail image) is added first.
      const toAdd = wantedImages.filter(
        (image) => !match.byImageId.has(image.id) && !image.inProductMedia && image.url
      );
      if (toAdd.length > 0 && !addedMissing) {
        addedMissing = true;
        const added = await input.caller(ADD_VARIANT_MEDIA_MUTATION, {
          product: { id: input.productId },
          media: toAdd.map((image) => ({
            originalSource: image.url,
            alt: image.alt ?? "",
            mediaContentType: "IMAGE"
          }))
        });
        if (!added.response.ok || errorsOf(added.result, "productUpdate").length > 0) {
          warnings.push("款式圖綁定：把款式圖加進商品圖片失敗，該款略過。");
        }
        // The next read matches the new media by file name.
        continue;
      }

      const plan = planVariantMediaBinds({ seeds: input.seeds, remoteVariants, match, remoteMedia });
      if (plan.notReady.length > 0 && now() + pollMs < stopWaitingAt) {
        await sleep(pollMs);
        continue;
      }

      if (plan.notReady.length > 0) {
        warnings.push(`款式圖尚未處理完成，未綁定：${plan.notReady.join("、")}（稍後可用重同步工具補綁）`);
      }
      if (plan.unmatched.length > 0) {
        warnings.push(`款式圖對應不到 Shopify 圖片，未綁定：${plan.unmatched.join("、")}`);
      }
      if (plan.unmatchedVariants.length > 0) {
        warnings.push(`Shopify 上找不到對應款式，未綁圖：${plan.unmatchedVariants.join("、")}`);
      }
      if (plan.binds.length === 0) return { bound: 0, warnings, imageMediaIds: match.byImageId };

      const bind = await input.caller(BIND_VARIANT_MEDIA_MUTATION, {
        productId: input.productId,
        variants: plan.binds.map((b) => ({ id: b.id, mediaId: b.mediaId }))
      });
      const errors = errorsOf(bind.result, "productVariantsBulkUpdate");
      if (!bind.response.ok || errors.length > 0) {
        warnings.push(`款式圖綁定失敗：${JSON.stringify(errors.length ? errors : bind.result).slice(0, 240)}`);
        return { bound: 0, warnings, imageMediaIds: match.byImageId };
      }
      return { bound: plan.binds.length, warnings, imageMediaIds: match.byImageId };
    }
    warnings.push("款式圖綁定略過：等待圖片處理超過上限。");
    return { bound: 0, warnings, imageMediaIds: new Map() };
  } catch (error) {
    warnings.push(`款式圖綁定略過：${error instanceof Error ? error.message : String(error)}`);
    return { bound: 0, warnings, imageMediaIds: new Map() };
  }
}
