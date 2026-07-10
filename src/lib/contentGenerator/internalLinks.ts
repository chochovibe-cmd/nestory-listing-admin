// A21-3 (文案·三之五b item 3): rule-based internal link appended at the end
// of the description -- "更多{IP} → 專區連結". The URL comes from
// team_settings key `internal_link_urls_by_ip` (migration 017), same
// override pattern as A16's scenario_keywords_by_type: a code change wires
// the mechanism, but the actual Shopify collection URLs are a business
// decision (and AGENTS.md forbids guessing URLs) so the seed ships empty.
// An IP with no entry in the map simply gets no link -- never a guessed
// URL, since a wrong/404 internal link is worse for SEO than no link.
export type InternalLinkMap = Record<string, string>;

export const DEFAULT_INTERNAL_LINK_URLS: InternalLinkMap = {};

function normalize(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').trim();
}

export function mergeInternalLinkMap(override: InternalLinkMap | null | undefined): InternalLinkMap {
  if (!override) return DEFAULT_INTERNAL_LINK_URLS;
  return { ...DEFAULT_INTERNAL_LINK_URLS, ...override };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildInternalLinkHtml(ip: string | null | undefined, linkMap: InternalLinkMap): string {
  const key = normalize(ip);
  const url = key ? linkMap[key] : undefined;
  if (!key || !url) return '';

  return `<p>更多${escapeHtml(key)}周邊 → <a href="${escapeHtml(url)}">看看還有什麼</a></p>`;
}
