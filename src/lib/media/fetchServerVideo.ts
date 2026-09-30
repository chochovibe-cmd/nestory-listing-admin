import { lookup as dnsLookup } from "node:dns/promises";
import {
  gateSourceUrl,
  isBlockedIpv4,
  isBlockedIpv6Literal,
  parseIpv4
} from "@/lib/sourceFetch/ssrf";

export const SERVER_VIDEO_MAX_REDIRECTS = 4;
export const SERVER_VIDEO_DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
export const SERVER_VIDEO_DEFAULT_TIMEOUT_MS = 45_000;

type ResolvedAddress = { address: string; family: number };

export type ServerVideoFetchFailureCode =
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
  | "content_too_large";

export type ServerVideoFetchResult =
  | { ok: true; bytes: Buffer; contentType: string; finalUrl: string }
  | { ok: false; code: ServerVideoFetchFailureCode; message: string };

export type FetchServerVideoOptions = {
  fetchImpl?: typeof fetch;
  resolveHost?: (hostname: string) => Promise<ResolvedAddress[]>;
  headers?: HeadersInit;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
};

function fail(
  code: ServerVideoFetchFailureCode,
  message: string
): ServerVideoFetchResult {
  return { ok: false, code, message };
}

function addressIsBlocked(address: string): boolean {
  const ipv4 = parseIpv4(address);
  if (ipv4 != null) return isBlockedIpv4(ipv4);
  return isBlockedIpv6Literal(address);
}

async function ensurePublicDnsTarget(
  hostname: string,
  resolveHost: (hostname: string) => Promise<ResolvedAddress[]>
): Promise<ServerVideoFetchResult | null> {
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolveHost(hostname);
  } catch {
    return fail("dns_lookup_failed", "Video host could not be resolved safely");
  }
  if (!addresses.length) {
    return fail("dns_lookup_failed", "Video host did not resolve to an address");
  }
  if (addresses.some((entry) => addressIsBlocked(entry.address))) {
    return fail("blocked_ip", "Video URL resolves to a private or metadata address");
  }
  return null;
}

function normalizeContentType(raw: string | null): string | null {
  const value = raw?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (value.startsWith("video/")) return value;
  if (value === "application/octet-stream") return value;
  return null;
}

async function readLimitedBytes(
  response: Response,
  maxBytes: number
): Promise<{ ok: true; bytes: Buffer } | { ok: false; message: string }> {
  const advertisedLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(advertisedLength) && advertisedLength > maxBytes) {
    return { ok: false, message: `Video exceeds ${maxBytes} byte limit` };
  }
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.byteLength <= maxBytes
      ? { ok: true, bytes }
      : { ok: false, message: `Video exceeds ${maxBytes} byte limit` };
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, message: `Video exceeds ${maxBytes} byte limit` };
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Body already consumed/cancelled.
    }
  }
  return { ok: true, bytes: Buffer.concat(chunks) };
}

function hostMatches(hostname: string, suffix: string): boolean {
  const host = hostname.toLowerCase();
  return host === suffix || host.endsWith(`.${suffix}`);
}

function videoHeaders(url: URL, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  if (!headers.has("Accept")) headers.set("Accept", "video/*,application/octet-stream;q=0.9,*/*;q=0.5");
  if (!headers.has("User-Agent")) {
    headers.set(
      "User-Agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36"
    );
  }
  if (
    !headers.has("Referer") &&
    ["taobao.com", "tmall.com", "alicdn.com", "tbcdn.cn"].some((suffix) =>
      hostMatches(url.hostname, suffix)
    )
  ) {
    headers.set("Referer", "https://item.taobao.com/");
  }
  return headers;
}

export async function fetchServerVideo(
  rawUrl: string,
  options: FetchServerVideoOptions = {}
): Promise<ServerVideoFetchResult> {
  const initial = gateSourceUrl(rawUrl);
  if (!initial.ok) {
    return fail(
      initial.reason === "invalid" ? "invalid_url" : "blocked_url",
      "Video URL is not allowed"
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const resolveHost =
    options.resolveHost ??
    ((hostname: string) => dnsLookup(hostname, { all: true, verbatim: true }));
  const maxBytes = options.maxBytes ?? SERVER_VIDEO_DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? SERVER_VIDEO_MAX_REDIRECTS;
  const timeoutMs = options.timeoutMs ?? SERVER_VIDEO_DEFAULT_TIMEOUT_MS;

  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    return fail("content_too_large", "Video byte limit is invalid");
  }
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > SERVER_VIDEO_MAX_REDIRECTS) {
    return fail("too_many_redirects", "Video redirect limit is invalid");
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
          headers: videoHeaders(current, options.headers)
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return fail("timeout", "Video download timed out");
        }
        return fail("network", "Video download failed");
      }

      if (response.status >= 300 && response.status < 400) {
        if (redirects >= maxRedirects) {
          return fail("too_many_redirects", "Video URL redirected too many times");
        }
        const location = response.headers.get("location");
        if (!location) {
          return fail("redirect_missing_location", "Video redirect did not include a location");
        }
        let nextUrl: URL;
        try {
          nextUrl = new URL(location, current);
        } catch {
          return fail("invalid_url", "Video redirect location is invalid");
        }
        const gated = gateSourceUrl(nextUrl.toString());
        if (!gated.ok) {
          return fail("blocked_url", "Video redirect target is not allowed");
        }
        try {
          await response.body?.cancel();
        } catch {
          // Redirect body intentionally discarded.
        }
        current = gated.url;
        redirects += 1;
        continue;
      }

      if (!response.ok) {
        return fail("http_status", `Video download failed: HTTP ${response.status}`);
      }
      const contentType = normalizeContentType(response.headers.get("content-type"));
      if (!contentType) {
        return fail(
          "invalid_content_type",
          "Video response must declare video/* or application/octet-stream"
        );
      }
      const body = await readLimitedBytes(response, maxBytes);
      if (!body.ok) return fail("content_too_large", body.message);

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
