/**
 * D1: Shopify Files permanent image hosting.
 *
 * Flow:
 *  1. stagedUploadsCreate (Admin GraphQL) → stagedTargets[{ url, resourceUrl, parameters[] }]
 *  2. Multipart POST bytes to staged url (parameters order; file last)
 *  3. fileCreate with originalSource = resourceUrl
 *  4. Poll file node until READY / CDN URL (image.url | preview.image.url)
 *  5. Caller writes cdn.shopify.com into product_images.processed_file_url
 *
 * Prerequisites: write_files scope; callShopifyAdminGraphQL + token exchange ready.
 * Never invent a fake CDN URL on failure.
 */

import { callShopifyAdminGraphQL } from "@/lib/shopify/adminGraphQL";
import { hasShopifyAdminCredentials } from "@/lib/shopify/adminToken";
import type { ProcessedImageStorage } from "@/lib/images/imagePipeline";

export type ShopifyFilesUploadInput = {
  filename: string;
  mimeType: string;
  fileSize: number;
  /** Processed image bytes (WebP preferred). */
  bytes: Buffer;
  /** Optional alt for fileCreate. */
  alt?: string | null;
  /**
   * Optional public temp URL for diagnostics only — never used as arbitrary client URL.
   * Callers must fetch bytes themselves from DB-stored URLs.
   */
  sourceHint?: string;
};

export type ShopifyFilesErrorCode =
  | "SHOPIFY_ERROR"
  | "CONFIG"
  | "UPLOAD_FAILED"
  | "NO_CDN_URL";

export type ShopifyFilesUploadResult =
  | {
      ok: true;
      storage: Extract<ProcessedImageStorage, "shopify_cdn">;
      cdnUrl: string;
      fileGid: string;
    }
  | {
      ok: false;
      code: ShopifyFilesErrorCode;
      error: string;
      /** Present when fileCreate succeeded but CDN poll failed. */
      fileGid?: string;
      retryable?: boolean;
    };

export type StagedUploadParameter = { name: string; value: string };

export type ShopifyFileNodeLike = {
  id?: string | null;
  fileStatus?: string | null;
  url?: string | null;
  image?: { url?: string | null } | null;
  preview?: { image?: { url?: string | null } | null } | null;
};

export const SHOPIFY_FILES_OPERATIONS = {
  stagedUploadsCreate: "stagedUploadsCreate",
  fileCreate: "fileCreate",
  fileDelete: "fileDelete",
  nodePoll: "node"
} as const;

/** CDN poll: max attempts × delay (Q2-A). */
export const CDN_POLL_MAX_ATTEMPTS = 5;
export const CDN_POLL_DELAY_MS = 800;

// --- Pure helpers (unit-testable; mirrored in verify-d1-files.mjs) ---

/** True when URL is already on Shopify CDN (idempotent finalize skip). */
export function isShopifyCdnUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  try {
    const host = new URL(url.trim()).hostname.toLowerCase();
    if (host === "cdn.shopify.com") return true;
    if (host.endsWith(".cdn.shopify.com")) return true;
    if (host === "cdn.shopifycdn.net" || host.endsWith(".shopifycdn.net")) return true;
    // Some stores return shop-specific CDN hosts still under Shopify files.
    if (host.endsWith(".myshopify.com") && url.includes("/cdn/")) return true;
    return false;
  } catch {
    return false;
  }
}

export type FinalizeSourcePick =
  | { kind: "already_cdn"; url: string }
  | { kind: "processed"; url: string }
  | { kind: "original"; url: string }
  | { kind: "none"; reason: string };

/**
 * Prefer processed temp WebP; fallback original; skip if already CDN.
 * Never accepts a client-supplied arbitrary URL — callers pass DB columns only.
 */
export function pickFinalizeSource(input: {
  processedFileUrl: string | null | undefined;
  originalFileUrl: string | null | undefined;
}): FinalizeSourcePick {
  const processed = input.processedFileUrl?.trim() || "";
  const original = input.originalFileUrl?.trim() || "";

  if (processed && isShopifyCdnUrl(processed)) {
    return { kind: "already_cdn", url: processed };
  }
  if (original && isShopifyCdnUrl(original) && !processed) {
    return { kind: "already_cdn", url: original };
  }
  if (processed) {
    return { kind: "processed", url: processed };
  }
  if (original) {
    return { kind: "original", url: original };
  }
  return { kind: "none", reason: "missing processed_file_url and original_file_url" };
}

/**
 * Q5-A + SYN-1 F:
 * - main + variant → Shopify Files
 * - detail / generated_detail → only when retain-for-listing flags are true
 * - otherwise stay Supabase temp (default not listed)
 */
export function isFinalizeUploadImageType(
  imageType: string | null | undefined,
  opts?: { retainForListing?: boolean }
): boolean {
  if (imageType === "main" || imageType === "variant") return true;
  if (
    (imageType === "detail" || imageType === "generated_detail") &&
    opts?.retainForListing === true
  ) {
    return true;
  }
  return false;
}

/**
 * Extract permanent image URL from fileCreate / node poll payload.
 * Prefer MediaImage.image.url, then preview.image.url, then GenericFile.url.
 */
export function extractCdnUrlFromFileNode(node: ShopifyFileNodeLike | null | undefined): string | null {
  if (!node) return null;
  const candidates = [node.image?.url, node.preview?.image?.url, node.url];
  for (const c of candidates) {
    const u = typeof c === "string" ? c.trim() : "";
    if (u && (isShopifyCdnUrl(u) || looksLikeShopifyFileUrl(u))) {
      return u;
    }
  }
  return null;
}

/** Accept Shopify file URLs even before host normalizes to cdn.shopify.com. */
function looksLikeShopifyFileUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.includes("shopify")) return true;
    if (u.pathname.includes("/s/files/")) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Path safety for best-effort temp delete (Q4-A):
 * must be `{owner}/{draftId}/processed/{imageId}.webp`.
 */
export function isOwnProcessedTempPath(
  storagePath: string,
  draftId: string,
  imageId: string
): boolean {
  if (!storagePath || !draftId || !imageId) return false;
  const parts = storagePath.split("/").filter(Boolean);
  if (parts.length < 4) return false;
  const draftIdx = parts.indexOf(draftId);
  if (draftIdx < 0 || draftIdx + 2 >= parts.length) return false;
  return (
    parts[draftIdx + 1] === "processed" && parts[draftIdx + 2] === `${imageId}.webp`
  );
}

/**
 * Build multipart field list: staged parameters first, then file last.
 * Pure helper for tests (order matters for S3-style staged uploads).
 */
export function buildStagedUploadFieldOrder(
  parameters: StagedUploadParameter[],
  fileFieldName = "file"
): string[] {
  return [...parameters.map((p) => p.name), fileFieldName];
}

export function isRetryableFilesError(
  result: Extract<ShopifyFilesUploadResult, { ok: false }>
): boolean {
  if (result.code === "CONFIG") return false;
  if (result.retryable === false) return false;
  if (result.retryable === true) return true;
  const msg = result.error.toLowerCase();
  if (
    msg.includes("permission") ||
    msg.includes("access_denied") ||
    msg.includes("unauthorized")
  ) {
    return false;
  }
  if (msg.includes("401") || msg.includes("403") || msg.includes("scope")) {
    return false;
  }
  // Do not re-upload after file already created (duplicate Files).
  if (result.fileGid) return false;
  if (result.code === "NO_CDN_URL") return false;
  return result.code === "UPLOAD_FAILED" || result.code === "SHOPIFY_ERROR";
}

// --- GraphQL documents ---

const STAGED_UPLOADS_CREATE = `
  mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }
`;

const FILE_CREATE = `
  mutation FileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        fileStatus
        ... on MediaImage {
          image { url }
          preview { image { url } }
        }
        ... on GenericFile {
          url
        }
      }
      userErrors { field message }
    }
  }
`;

const FILE_NODE_QUERY = `
  query FileNodePoll($id: ID!) {
    node(id: $id) {
      ... on MediaImage {
        id
        fileStatus
        image { url }
        preview { image { url } }
      }
      ... on GenericFile {
        id
        fileStatus
        url
      }
    }
  }
`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatUserErrors(
  errors: { field?: string[] | string | null; message?: string }[] | undefined
): string {
  if (!errors?.length) return "";
  return errors
    .map((e) => {
      const field = Array.isArray(e.field) ? e.field.join(".") : e.field ?? "";
      return field ? `${field}: ${e.message ?? ""}` : (e.message ?? "");
    })
    .filter(Boolean)
    .join("; ");
}

/**
 * Upload one processed image buffer to Shopify Files; return permanent CDN URL.
 * Network-ish failures may be retried once by the caller via isRetryableFilesError.
 */
export async function uploadProcessedImageToShopifyFiles(
  input: ShopifyFilesUploadInput
): Promise<ShopifyFilesUploadResult> {
  if (!hasShopifyAdminCredentials()) {
    return {
      ok: false,
      code: "CONFIG",
      error:
        "Shopify credentials are not configured (SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET / SHOPIFY_STORE_DOMAIN).",
      retryable: false
    };
  }

  if (!input.bytes?.byteLength) {
    return { ok: false, code: "UPLOAD_FAILED", error: "empty image bytes", retryable: false };
  }
  if (!input.filename?.trim()) {
    return { ok: false, code: "UPLOAD_FAILED", error: "filename is required", retryable: false };
  }

  const filename = input.filename.trim();
  const mimeType = input.mimeType?.trim() || "image/webp";
  const fileSize = input.fileSize > 0 ? input.fileSize : input.bytes.byteLength;

  // 1) stagedUploadsCreate
  let stagedUrl: string;
  let resourceUrl: string;
  let parameters: StagedUploadParameter[];

  try {
    const { response, result } = await callShopifyAdminGraphQL<{
      data?: {
        stagedUploadsCreate?: {
          stagedTargets?: {
            url?: string;
            resourceUrl?: string;
            parameters?: StagedUploadParameter[];
          }[];
          userErrors?: { field?: string[]; message?: string }[];
        };
      };
      errors?: { message?: string }[];
    }>(STAGED_UPLOADS_CREATE, {
      input: [
        {
          filename,
          mimeType,
          httpMethod: "POST",
          resource: "FILE",
          fileSize: String(fileSize)
        }
      ]
    });

    if (!response.ok) {
      return {
        ok: false,
        code: "SHOPIFY_ERROR",
        error: `stagedUploadsCreate HTTP ${response.status}`,
        retryable: response.status >= 500 || response.status === 429
      };
    }

    const userErrors = result.data?.stagedUploadsCreate?.userErrors;
    if (userErrors?.length) {
      return {
        ok: false,
        code: "SHOPIFY_ERROR",
        error: `stagedUploadsCreate userErrors: ${formatUserErrors(userErrors)}`,
        retryable: false
      };
    }
    if (result.errors?.length) {
      return {
        ok: false,
        code: "SHOPIFY_ERROR",
        error: `stagedUploadsCreate errors: ${result.errors.map((e) => e.message).join("; ")}`,
        retryable: false
      };
    }

    const target = result.data?.stagedUploadsCreate?.stagedTargets?.[0];
    if (!target?.url || !target.resourceUrl) {
      return {
        ok: false,
        code: "SHOPIFY_ERROR",
        error: "stagedUploadsCreate returned no stagedTargets",
        retryable: false
      };
    }
    stagedUrl = target.url;
    resourceUrl = target.resourceUrl;
    parameters = Array.isArray(target.parameters) ? target.parameters : [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: "SHOPIFY_ERROR",
      error: `stagedUploadsCreate failed: ${message}`,
      retryable: true
    };
  }

  // 2) Direct multipart upload to staged URL (not long-term hosted on Vercel)
  try {
    const form = new FormData();
    for (const p of parameters) {
      if (p?.name != null) form.append(String(p.name), String(p.value ?? ""));
    }
    // File must be last. Node 18+ Blob accepts Uint8Array.
    const blob = new Blob([new Uint8Array(input.bytes)], { type: mimeType });
    form.append("file", blob, filename);

    const uploadRes = await fetch(stagedUrl, {
      method: "POST",
      body: form
      // Do not set Content-Type manually — boundary required.
    });

    if (!uploadRes.ok) {
      const bodyText = await uploadRes.text().catch(() => "");
      return {
        ok: false,
        code: "UPLOAD_FAILED",
        error: `staged upload HTTP ${uploadRes.status}${bodyText ? `: ${bodyText.slice(0, 200)}` : ""}`,
        retryable: uploadRes.status >= 500 || uploadRes.status === 429
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: "UPLOAD_FAILED",
      error: `staged upload network error: ${message}`,
      retryable: true
    };
  }

  // 3) fileCreate
  let fileGid: string;
  let initialNode: ShopifyFileNodeLike | null = null;

  try {
    const fileInput: Record<string, unknown> = {
      originalSource: resourceUrl,
      contentType: "IMAGE",
      filename
    };
    if (input.alt?.trim()) {
      fileInput.alt = input.alt.trim();
    }

    const { response, result } = await callShopifyAdminGraphQL<{
      data?: {
        fileCreate?: {
          files?: ShopifyFileNodeLike[];
          userErrors?: { field?: string[]; message?: string }[];
        };
      };
      errors?: { message?: string }[];
    }>(FILE_CREATE, { files: [fileInput] });

    if (!response.ok) {
      return {
        ok: false,
        code: "SHOPIFY_ERROR",
        error: `fileCreate HTTP ${response.status}`,
        retryable: response.status >= 500 || response.status === 429
      };
    }

    const userErrors = result.data?.fileCreate?.userErrors;
    if (userErrors?.length) {
      return {
        ok: false,
        code: "SHOPIFY_ERROR",
        error: `fileCreate userErrors: ${formatUserErrors(userErrors)}`,
        retryable: false
      };
    }
    if (result.errors?.length) {
      return {
        ok: false,
        code: "SHOPIFY_ERROR",
        error: `fileCreate errors: ${result.errors.map((e) => e.message).join("; ")}`,
        retryable: false
      };
    }

    const file = result.data?.fileCreate?.files?.[0];
    if (!file?.id) {
      return {
        ok: false,
        code: "SHOPIFY_ERROR",
        error: "fileCreate returned no file id",
        retryable: false
      };
    }
    fileGid = file.id;
    initialNode = file;

    const immediate = extractCdnUrlFromFileNode(file);
    if (immediate && file.fileStatus === "READY") {
      return {
        ok: true,
        storage: "shopify_cdn",
        cdnUrl: immediate,
        fileGid
      };
    }
    // Prefer immediate URL even if status not yet READY when Shopify already returned one.
    if (immediate && isShopifyCdnUrl(immediate)) {
      return {
        ok: true,
        storage: "shopify_cdn",
        cdnUrl: immediate,
        fileGid
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: "SHOPIFY_ERROR",
      error: `fileCreate failed: ${message}`,
      retryable: true
    };
  }

  // 4) Short poll for CDN URL (Q2-A)
  for (let attempt = 1; attempt <= CDN_POLL_MAX_ATTEMPTS; attempt++) {
    await sleep(CDN_POLL_DELAY_MS);

    try {
      const { response, result } = await callShopifyAdminGraphQL<{
        data?: { node?: ShopifyFileNodeLike | null };
        errors?: { message?: string }[];
      }>(FILE_NODE_QUERY, { id: fileGid });

      if (!response.ok) {
        continue;
      }

      const node = result.data?.node ?? null;
      const status = node?.fileStatus?.toUpperCase?.() ?? "";
      if (status === "FAILED") {
        return {
          ok: false,
          code: "SHOPIFY_ERROR",
          error: `Shopify fileStatus=FAILED for ${fileGid}`,
          fileGid,
          retryable: false
        };
      }

      const cdn = extractCdnUrlFromFileNode(node);
      if (cdn && (status === "READY" || isShopifyCdnUrl(cdn))) {
        return {
          ok: true,
          storage: "shopify_cdn",
          cdnUrl: cdn,
          fileGid
        };
      }
    } catch {
      // keep polling
    }
  }

  // Last chance: re-check initial node fields
  const fallback = extractCdnUrlFromFileNode(initialNode);
  if (fallback && isShopifyCdnUrl(fallback)) {
    return {
      ok: true,
      storage: "shopify_cdn",
      cdnUrl: fallback,
      fileGid
    };
  }

  return {
    ok: false,
    code: "NO_CDN_URL",
    error: `CDN URL not ready after ${CDN_POLL_MAX_ATTEMPTS}×${CDN_POLL_DELAY_MS}ms poll (fileGid=${fileGid})`,
    fileGid,
    retryable: false
  };
}

/**
 * Upload with at most one retry on network-ish failure (Q3-A).
 * Never retries after fileGid exists / NO_CDN_URL / CONFIG / permission errors.
 */
export async function uploadProcessedImageToShopifyFilesWithRetry(
  input: ShopifyFilesUploadInput
): Promise<ShopifyFilesUploadResult> {
  const first = await uploadProcessedImageToShopifyFiles(input);
  if (first.ok) return first;
  if (!isRetryableFilesError(first)) return first;
  return uploadProcessedImageToShopifyFiles(input);
}
