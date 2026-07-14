/**
 * D10-open: YouTube video_urls helpers (string[], max 3).
 * - Form / DB: store trimmed URL strings (no file upload).
 * - Shopify: EXTERNAL_VIDEO CreateMediaInput at productCreate boundary.
 * - Showmore: append plain links at export boundary only (never write DB description).
 * - Phase 2 (YouTube Data API / native upload): out of scope.
 */

export const MAX_VIDEO_URLS = 3;

export type ExternalVideoMediaInput = {
  originalSource: string;
  mediaContentType: "EXTERNAL_VIDEO";
  alt?: string;
};

export type VideoMediaBuildResult = {
  /** Accepted YouTube URLs (canonical when possible). */
  accepted: string[];
  /** Raw entries that were not usable YouTube links. */
  skipped: string[];
  media: ExternalVideoMediaInput[];
  /** Yellow warnings for draft.warnings (publish path). */
  warnings: string[];
};

/** Hosts Shopify EXTERNAL_VIDEO accepts for YouTube. */
function isYouTubeHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtu.be" ||
    host.endsWith(".youtube.com")
  );
}

/**
 * True when the string looks like a YouTube watch / share / embed URL.
 * Does not network-check the video id.
 */
export function isYouTubeUrl(raw: string): boolean {
  return canonicalizeYouTubeUrl(raw) != null;
}

/**
 * Normalize to a stable https watch URL when possible.
 * Returns null for non-YouTube or unparseable input.
 */
export function canonicalizeYouTubeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    // Allow paste without protocol
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    url = new URL(withProtocol);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!isYouTubeHost(url.hostname)) return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  // youtu.be/<id>
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    if (!id || !/^[\w-]{6,}$/i.test(id)) return null;
    return `https://www.youtube.com/watch?v=${id}`;
  }

  // /watch?v=
  const v = url.searchParams.get("v");
  if (v && /^[\w-]{6,}$/i.test(v)) {
    return `https://www.youtube.com/watch?v=${v}`;
  }

  // /embed/<id> or /shorts/<id> or /live/<id> or /v/<id>
  const pathMatch = url.pathname.match(/\/(?:embed|shorts|live|v)\/([\w-]{6,})/i);
  if (pathMatch?.[1]) {
    return `https://www.youtube.com/watch?v=${pathMatch[1]}`;
  }

  // Accept other youtube.com paths only if they still carry a video id we found
  return null;
}

/**
 * Coerce DB / form raw into string[]: trim, drop empty, dedupe (case-sensitive), max 3.
 * Does **not** drop non-YouTube — that happens at publish / export boundaries.
 */
export function normalizeVideoUrls(raw: unknown): string[] {
  const list: string[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") list.push(item);
      else if (item && typeof item === "object" && "url" in item) {
        const u = (item as { url?: unknown }).url;
        if (typeof u === "string") list.push(u);
      }
    }
  } else if (typeof raw === "string") {
    list.push(...raw.split(/\r?\n/));
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const t = item.trim();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_VIDEO_URLS) break;
  }
  return out;
}

/** Form textarea: one URL per line → normalized string[]. */
export function parseVideoUrlsFromTextarea(text: string): string[] {
  return normalizeVideoUrls(text);
}

/** string[] → textarea value. */
export function formatVideoUrlsForTextarea(urls: string[]): string {
  return normalizeVideoUrls(urls).join("\n");
}

/**
 * Build Shopify CreateMediaInput EXTERNAL_VIDEO list + skip warnings.
 * Only accepted YouTube URLs become media.
 */
export function buildExternalVideoMedia(
  raw: unknown,
  altBase?: string | null
): VideoMediaBuildResult {
  const normalized = normalizeVideoUrls(raw);
  const accepted: string[] = [];
  const skipped: string[] = [];
  const media: ExternalVideoMediaInput[] = [];
  const alt =
    (altBase && altBase.trim()) || "Nestory product video";

  for (const entry of normalized) {
    const canonical = canonicalizeYouTubeUrl(entry);
    if (!canonical) {
      skipped.push(entry);
      continue;
    }
    // Dedupe by canonical watch URL
    if (accepted.includes(canonical)) continue;
    accepted.push(canonical);
    media.push({
      originalSource: canonical,
      mediaContentType: "EXTERNAL_VIDEO",
      alt
    });
  }

  const warnings: string[] = [];
  if (skipped.length > 0) {
    const preview = skipped
      .map((s) => (s.length > 48 ? `${s.slice(0, 45)}…` : s))
      .join("、");
    warnings.push(
      `影片連結略過 ${skipped.length} 筆（僅支援 YouTube）：${preview}`
    );
  }

  return { accepted, skipped, media, warnings };
}

/**
 * Append light video links to HTML body (Showmore export boundary).
 * Only valid YouTube URLs; no-op when none.
 */
export function appendVideoLinksHtml(html: string, raw: unknown): string {
  const { accepted } = buildExternalVideoMedia(raw);
  if (!accepted.length) return html;

  const blocks = accepted
    .map(
      (url) =>
        `<p>▶ 商品影片：<a href="${escapeHtmlAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtmlAttr(url)}</a></p>`
    )
    .join("");

  const base = html ?? "";
  if (!base.trim()) return blocks;
  return `${base}${blocks}`;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
