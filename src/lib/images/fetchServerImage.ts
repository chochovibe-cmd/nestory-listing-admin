import { lookup as dnsLookup } from "node:dns/promises";
import {
  gateSourceUrl,
  isBlockedIpv4,
  isBlockedIpv6Literal,
  parseIpv4
} from "@/lib/sourceFetch/ssrf";

/**
 * Security boundary for every server-side download of a product image.
 *
 * Image URLs can arrive from a capture extension, direct Supabase writes, or
 * previously stored data. Treat every one as untrusted: validate the first
 * URL, resolve its hostname, and repeat that work for every redirect hop.
 */

export const SERVER_IMAGE_MAX_REDIRECTS = 4;
export const SERVER_IMAGE_DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
export const SERVER_IMAGE_DEFAULT_TIMEOUT_MS = 12_000;

type ServerImageKind =
  | "jpeg"
  | "png"
  | "webp"
  | "gif"
  | "avif"
  | "heif"
  | "tiff"
  | "bmp"
  | "ico";

type ServerImageContentType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif"
  | "image/avif"
  | "image/heic"
  | "image/heif"
  | "image/tiff"
  | "image/bmp"
  | "image/x-icon";

const CONTENT_TYPE_TO_KIND: Record<ServerImageContentType, ServerImageKind> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/heic": "heif",
  "image/heif": "heif",
  "image/tiff": "tiff",
  "image/bmp": "bmp",
  "image/x-icon": "ico"
};

const CONTENT_TYPE_ALIASES: Record<string, ServerImageContentType> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png",
  "image/apng": "image/png",
  "image/x-ms-bmp": "image/bmp",
  "image/x-icon": "image/x-icon",
  "image/vnd.microsoft.icon": "image/x-icon"
};

export type ServerImageFetchFailureCode =
  | "invalid_url"
  | "blocked_url"
  | "dns_lookup_failed"
  | "blocked_ip"
  | "network"
  | "timeout"
  | "redirect_missing_location"
  | "too_many_redirects"
  | "http_status"
  | "invalid_content_type"
  | "content_too_large"
  | "invalid_image_magic"
  | "content_type_mismatch";

export type ServerImageFetchResult =
  | {
      ok: true;
      bytes: Buffer;
      contentType: ServerImageContentType;
      finalUrl: string;
    }
  | {
      ok: false;
      code: ServerImageFetchFailureCode;
      message: string;
    };

type ResolvedAddress = { address: string; family: number };

export type FetchServerImageOptions = {
  fetchImpl?: typeof fetch;
  resolveHost?: (hostname: string) => Promise<ResolvedAddress[]>;
  headers?: HeadersInit;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
};

function fail(code: ServerImageFetchFailureCode, message: string): ServerImageFetchResult {
  return { ok: false, code, message };
}

function normalizeImageContentType(raw: string | null): ServerImageContentType | null {
  const value = raw?.split(";", 1)[0]?.trim().toLowerCase();
  if (!value) return null;
  const normalized = CONTENT_TYPE_ALIASES[value] ?? value;
  return normalized in CONTENT_TYPE_TO_KIND ? (normalized as ServerImageContentType) : null;
}

function startsWithBytes(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return "";
  return Buffer.from(bytes.subarray(offset, offset + length)).toString("ascii");
}

/** Exported for source-contract verification and future unit tests. */
export function detectServerImageMagic(bytes: Uint8Array): ServerImageKind | null {
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (asciiAt(bytes, 0, 6) === "GIF87a" || asciiAt(bytes, 0, 6) === "GIF89a") return "gif";
  if (asciiAt(bytes, 0, 4) === "RIFF" && asciiAt(bytes, 8, 4) === "WEBP") return "webp";
  if (startsWithBytes(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWithBytes(bytes, [0x4d, 0x4d, 0x00, 0x2a])) {
    return "tiff";
  }
  if (asciiAt(bytes, 0, 2) === "BM") return "bmp";
  if (startsWithBytes(bytes, [0x00, 0x00, 0x01, 0x00])) return "ico";

  // ISO Base Media File Format: AVIF/HEIF brands are stored in the ftyp box.
  if (asciiAt(bytes, 4, 4) === "ftyp") {
    const brands: string[] = [];
    for (let offset = 8; offset + 4 <= Math.min(bytes.length, 40); offset += 4) {
      brands.push(asciiAt(bytes, offset, 4));
    }
    if (brands.some((brand) => brand === "avif" || brand === "avis")) return "avif";
    if (brands.some((brand) => ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand))) {
      return "heif";
    }
  }

  return null;
}

function resolvedAddressIsBlocked(address: string): boolean {
  const ipv4 = parseIpv4(address);
  if (ipv4 != null) return isBlockedIpv4(ipv4);
  return isBlockedIpv6Literal(address);
}

async function ensurePublicDnsTarget(
  hostname: string,
  resolveHost: (hostname: string) => Promise<ResolvedAddress[]>
): Promise<ServerImageFetchResult | null> {
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolveHost(hostname);
  } catch {
    return fail("dns_lookup_failed", "Image host could not be resolved safely");
  }

  if (!addresses.length) {
    return fail("dns_lookup_failed", "Image host did not resolve to an address");
  }
  if (addresses.some((entry) => resolvedAddressIsBlocked(entry.address))) {
    return fail("blocked_ip", "Image URL resolves to a private or metadata address");
  }

  return null;
}

async function readLimitedBytes(
  response: Response,
  maxBytes: number
): Promise<{ ok: true; bytes: Buffer } | { ok: false; message: string }> {
  const advertisedLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(advertisedLength) && advertisedLength > maxBytes) {
    return { ok: false, message: `Image exceeds ${maxBytes} byte limit` };
  }

  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.byteLength <= maxBytes
      ? { ok: true, bytes }
      : { ok: false, message: `Image exceeds ${maxBytes} byte limit` };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, message: `Image exceeds ${maxBytes} byte limit` };
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Best effort only; response body is already consumed or cancelled.
    }
  }

  return { ok: true, bytes: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))) };
}

function imageHeaders(headers?: HeadersInit): Headers {
  const next = new Headers(headers);
  if (!next.has("Accept")) next.set("Accept", "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8");
  return next;
}

/**
 * Fetch an image only after URL, DNS, redirect and response-body validation.
 * Never switch this to redirect:"follow": every redirect target is a new SSRF
 * boundary and must be gated again.
 */
export async function fetchServerImage(
  rawUrl: string,
  options: FetchServerImageOptions = {}
): Promise<ServerImageFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolveHost = options.resolveHost ?? ((hostname: string) => dnsLookup(hostname, { all: true, verbatim: true }));
  const maxBytes = options.maxBytes ?? SERVER_IMAGE_DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? SERVER_IMAGE_MAX_REDIRECTS;
  const timeoutMs = options.timeoutMs ?? SERVER_IMAGE_DEFAULT_TIMEOUT_MS;

  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    return fail("content_too_large", "Image byte limit is invalid");
  }
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > SERVER_IMAGE_MAX_REDIRECTS) {
    return fail("too_many_redirects", "Image redirect limit is invalid");
  }

  const initial = gateSourceUrl(rawUrl);
  if (!initial.ok) {
    return fail(initial.reason === "invalid" ? "invalid_url" : "blocked_url", "Image URL is not allowed");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let current = initial.url;
  let redirects = 0;

  try {
    while (true) {
      const dnsFailure = await ensurePublicDnsTarget(current.hostname, resolveHost);
      if (dnsFailure) return dnsFailure;

      let response: Response;
      try {
        response = await fetchImpl(current.toString(), {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          cache: "no-store",
          headers: imageHeaders(options.headers)
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return fail("timeout", "Image download timed out");
        }
        return fail("network", "Image download failed");
      }

      if (response.status >= 300 && response.status < 400) {
        if (redirects >= maxRedirects) {
          return fail("too_many_redirects", "Image URL redirected too many times");
        }
        const location = response.headers.get("location");
        if (!location) {
          return fail("redirect_missing_location", "Image redirect did not include a location");
        }
        let nextUrl: URL;
        try {
          nextUrl = new URL(location, current);
        } catch {
          return fail("invalid_url", "Image redirect location is invalid");
        }
        const gated = gateSourceUrl(nextUrl.toString());
        if (!gated.ok) {
          return fail("blocked_url", "Image redirect target is not allowed");
        }
        try {
          await response.body?.cancel();
        } catch {
          // Redirect response bodies are intentionally discarded.
        }
        current = gated.url;
        redirects += 1;
        continue;
      }

      if (!response.ok) {
        return fail("http_status", `Image download failed: HTTP ${response.status}`);
      }

      const contentType = normalizeImageContentType(response.headers.get("content-type"));
      if (!contentType) {
        return fail("invalid_content_type", "Image response must declare a supported image content type");
      }

      const body = await readLimitedBytes(response, maxBytes);
      if (!body.ok) return fail("content_too_large", body.message);
      const magic = detectServerImageMagic(body.bytes);
      if (!magic) {
        return fail("invalid_image_magic", "Image response bytes do not match a supported image format");
      }
      if (CONTENT_TYPE_TO_KIND[contentType] !== magic) {
        return fail("content_type_mismatch", "Image content type does not match its binary format");
      }

      return {
        ok: true,
        bytes: body.bytes,
        contentType,
        finalUrl: current.toString()
      };
    }
  } finally {
    clearTimeout(timer);
  }
}
