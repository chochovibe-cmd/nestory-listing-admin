/**
 * B3-fetch-open: lightweight server-side product URL fetch.
 * Honest failure for taobao/tmall anti-bot — never headless browser / login bypass.
 */

import { localizeToTaiwanTraditionalText } from "@/lib/zhTwLocalizer";
import type { RecognitionFields } from "@/lib/screenshotRecognition";
import { gateSourceUrl } from "@/lib/sourceFetch/ssrf";
import {
  classifyHost,
  parseProductHtml,
  type HostClass
} from "@/lib/sourceFetch/parseProductHtml";

export const SOURCE_FETCH_DEFAULT_TIMEOUT_MS = 12_000;
export const SOURCE_FETCH_MAX_BODY_BYTES = 1_500_000;
export const SOURCE_FETCH_MAX_REDIRECTS = 4;

export const SOURCE_FETCH_USER_AGENT =
  "Mozilla/5.0 (compatible; NestoryListingBot/1.0; +https://nestory.local; lightweight product metadata)";

export type SourceFetchReason =
  | "invalid"
  | "scheme"
  | "ssrf"
  | "timeout"
  | "network"
  | "http_error"
  | "empty"
  | "blocked_or_empty"
  | "parse";

export type SourceFetchOk = {
  ok: true;
  fields: RecognitionFields;
  hostClass: HostClass;
  /** Short status for UI (optional). */
  message: string | null;
};

export type SourceFetchErr = {
  ok: false;
  reason: SourceFetchReason;
  hostClass: HostClass | null;
  httpStatus?: number;
  /** User-facing short message (Chinese). */
  message: string;
  fields: RecognitionFields;
};

export type SourceFetchResult = SourceFetchOk | SourceFetchErr;

export type FetchSourceUrlOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBodyBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
};

const EMPTY_FIELDS: RecognitionFields = {
  title: null,
  costCny: null,
  features: null,
  specText: null,
  variants: []
};

function localizeFields(fields: RecognitionFields): RecognitionFields {
  return {
    title: fields.title ? localizeToTaiwanTraditionalText(fields.title) : null,
    costCny: fields.costCny,
    features: fields.features ? localizeToTaiwanTraditionalText(fields.features) : null,
    specText: fields.specText ? localizeToTaiwanTraditionalText(fields.specText) : null,
    variants: [] // Q3-A
  };
}

/** Q1-A: anti-bot / empty = info yellow (same wording family for taobao + generic). */
export function messageForBlockedOrEmpty(hostClass: HostClass | null): string {
  if (hostClass === "taobao" || hostClass === "tmall") {
    return "這個網址目前抓不到商品資料（平台常擋自動讀取）。網址已保留供查重；請改用「上傳截圖自動辨識」或手動貼標題。";
  }
  return "暫時連不上來源頁或頁面沒有可讀的商品資料。網址已保留；請截圖或手填。";
}

export function messageForReason(
  reason: SourceFetchReason,
  hostClass: HostClass | null,
  httpStatus?: number
): string {
  switch (reason) {
    case "invalid":
    case "scheme":
      return "請貼可公開讀取的 http(s) 商品網址。";
    case "ssrf":
      return "請貼可公開讀取的 http(s) 商品網址。";
    case "timeout":
      return "暫時連不上來源頁。網址已保留；請截圖或手填。";
    case "network":
      return "暫時連不上來源頁。網址已保留；請截圖或手填。";
    case "http_error":
      if (hostClass === "taobao" || hostClass === "tmall" || (httpStatus != null && httpStatus >= 400)) {
        return messageForBlockedOrEmpty(hostClass);
      }
      return messageForBlockedOrEmpty(hostClass);
    case "empty":
    case "blocked_or_empty":
    case "parse":
      return messageForBlockedOrEmpty(hostClass);
    default:
      return messageForBlockedOrEmpty(hostClass);
  }
}

function err(
  reason: SourceFetchReason,
  hostClass: HostClass | null,
  httpStatus?: number
): SourceFetchErr {
  return {
    ok: false,
    reason,
    hostClass,
    httpStatus,
    message: messageForReason(reason, hostClass, httpStatus),
    fields: { ...EMPTY_FIELDS }
  };
}

/**
 * Follow redirects manually so each hop can re-run SSRF gate (Q4-A).
 */
async function fetchWithRedirectGuard(
  startUrl: URL,
  options: {
    fetchImpl: typeof fetch;
    signal: AbortSignal;
    maxRedirects: number;
    userAgent: string;
  }
): Promise<{ response: Response; finalUrl: URL } | SourceFetchErr> {
  let current = startUrl;
  let hostClass: HostClass = classifyHost(current.hostname);

  for (let hop = 0; hop <= options.maxRedirects; hop++) {
    hostClass = classifyHost(current.hostname);
    let response: Response;
    try {
      response = await options.fetchImpl(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal: options.signal,
        cache: "no-store",
        headers: {
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "User-Agent": options.userAgent,
          "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.5"
        }
      });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        return err("timeout", hostClass);
      }
      return err("network", hostClass);
    }

    const status = response.status;
    if (status >= 300 && status < 400) {
      const loc = response.headers.get("location");
      if (!loc) return err("http_error", hostClass, status);
      let next: URL;
      try {
        next = new URL(loc, current);
      } catch {
        return err("http_error", hostClass, status);
      }
      const gated = gateSourceUrl(next.toString());
      if (!gated.ok) {
        return err(gated.reason === "ssrf" ? "ssrf" : "invalid", hostClass);
      }
      current = gated.url;
      // Drain body so undici can reuse connection
      try {
        await response.arrayBuffer();
      } catch {
        /* ignore */
      }
      continue;
    }

    return { response, finalUrl: current };
  }

  return err("http_error", hostClass);
}

async function readBodyText(
  response: Response,
  maxBytes: number
): Promise<string> {
  // Prefer streaming truncate when body is available
  if (response.body && typeof response.body.getReader === "function") {
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
          chunks.push(value.slice(0, Math.max(0, value.byteLength - (total - maxBytes))));
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          break;
        }
        chunks.push(value);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }
    const merged = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(merged);
  }

  const buf = Buffer.from(await response.arrayBuffer());
  return buf.subarray(0, maxBytes).toString("utf8");
}

/**
 * Fetch and parse a product page. Call only from server (Route Handler).
 */
export async function fetchSourceUrl(
  rawUrl: string,
  options: FetchSourceUrlOptions = {}
): Promise<SourceFetchResult> {
  const gated = gateSourceUrl(rawUrl);
  if (!gated.ok) {
    return err(
      gated.reason === "scheme" ? "scheme" : gated.reason === "ssrf" ? "ssrf" : "invalid",
      null
    );
  }

  const hostClassGuess = classifyHost(gated.url.hostname);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? SOURCE_FETCH_DEFAULT_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? SOURCE_FETCH_MAX_BODY_BYTES;
  const maxRedirects = options.maxRedirects ?? SOURCE_FETCH_MAX_REDIRECTS;
  const userAgent = options.userAgent ?? SOURCE_FETCH_USER_AGENT;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const hopped = await fetchWithRedirectGuard(gated.url, {
      fetchImpl,
      signal: controller.signal,
      maxRedirects,
      userAgent
    });
    if ("ok" in hopped && hopped.ok === false) {
      return hopped;
    }
    const { response, finalUrl } = hopped as { response: Response; finalUrl: URL };
    const hostClass = classifyHost(finalUrl.hostname);

    if (!response.ok) {
      return err("http_error", hostClass, response.status);
    }

    let html: string;
    try {
      html = await readBodyText(response, maxBodyBytes);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        return err("timeout", hostClass);
      }
      return err("network", hostClass);
    }

    if (!html.trim()) {
      return err("empty", hostClass);
    }

    const parsed = parseProductHtml(html, finalUrl.hostname);
    // Usable meta/JSON-LD wins; otherwise honest empty (anti-bot shells included).
    if (!parsed.hasUsableFields) {
      return err("blocked_or_empty", parsed.hostClass);
    }

    return {
      ok: true,
      fields: localizeFields(parsed.fields),
      hostClass: parsed.hostClass,
      message: null
    };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return err("timeout", hostClassGuess);
    }
    return err("network", hostClassGuess);
  } finally {
    clearTimeout(timer);
  }
}
