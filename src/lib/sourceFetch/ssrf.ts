/**
 * B3-fetch-open: URL validation + SSRF guards (private / metadata / loopback).
 * Pure helpers — safe to unit-test without network.
 */

export type UrlGateOk = { ok: true; url: URL };
export type UrlGateErr = { ok: false; reason: "invalid" | "ssrf" | "scheme" };
export type UrlGateResult = UrlGateOk | UrlGateErr;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
  "0.0.0.0"
]);

/** IPv4 dotted-quad → 32-bit int, or null if not a valid IPv4 literal. */
export function parseIpv4(host: string): number | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map((p) => Number(p));
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inCidr(ip: number, base: number, maskBits: number): boolean {
  if (maskBits <= 0) return true;
  if (maskBits >= 32) return ip === base;
  const mask = (0xffffffff << (32 - maskBits)) >>> 0;
  return (ip & mask) === (base & mask);
}

/** True for loopback, RFC1918, link-local, CGNAT, cloud metadata, etc. */
export function isBlockedIpv4(ip: number): boolean {
  return (
    inCidr(ip, parseIpv4("0.0.0.0")!, 8) || // 0.0.0.0/8
    inCidr(ip, parseIpv4("10.0.0.0")!, 8) || // 10/8
    inCidr(ip, parseIpv4("127.0.0.0")!, 8) || // 127/8
    inCidr(ip, parseIpv4("169.254.0.0")!, 16) || // link-local + AWS metadata 169.254.169.254
    inCidr(ip, parseIpv4("172.16.0.0")!, 12) || // 172.16/12
    inCidr(ip, parseIpv4("192.168.0.0")!, 16) || // 192.168/16
    inCidr(ip, parseIpv4("100.64.0.0")!, 10) || // CGNAT
    inCidr(ip, parseIpv4("192.0.0.0")!, 24) ||
    inCidr(ip, parseIpv4("192.0.2.0")!, 24) || // TEST-NET
    inCidr(ip, parseIpv4("198.18.0.0")!, 15) ||
    inCidr(ip, parseIpv4("198.51.100.0")!, 24) ||
    inCidr(ip, parseIpv4("203.0.113.0")!, 24) ||
    inCidr(ip, parseIpv4("224.0.0.0")!, 4) || // multicast
    inCidr(ip, parseIpv4("240.0.0.0")!, 4) // reserved
  );
}

/** True for IPv6 loopback / ULA / link-local / IPv4-mapped private. */
export function isBlockedIpv6Literal(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "::" || h === "::1") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // ULA fc00::/7
  if (h.startsWith("fe80")) return true; // link-local
  // IPv4-mapped :ffff:x.x.x.x
  const mapped = h.match(/:ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) {
    const ip = parseIpv4(mapped[1]);
    if (ip != null && isBlockedIpv4(ip)) return true;
  }
  return false;
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }

  const ipv4 = parseIpv4(host);
  if (ipv4 != null) return isBlockedIpv4(ipv4);

  // URL.hostname strips brackets for IPv6
  if (host.includes(":")) return isBlockedIpv6Literal(host);

  return false;
}

/**
 * Gate a user-supplied product URL before server fetch.
 * Only http(s); blocks private/metadata hosts. Port is allowed as long as host is public.
 */
export function gateSourceUrl(raw: string): UrlGateResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, reason: "invalid" };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "scheme" };
  }

  // Credentials in URL are unnecessary for product pages and smell like SSRF tricks.
  if (url.username || url.password) {
    return { ok: false, reason: "ssrf" };
  }

  if (isBlockedHostname(url.hostname)) {
    return { ok: false, reason: "ssrf" };
  }

  return { ok: true, url };
}
