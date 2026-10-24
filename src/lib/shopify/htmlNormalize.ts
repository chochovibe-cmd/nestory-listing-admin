// Shopify rewrites descriptionHtml on save (newline before <li> and </ul>, "<img ... />" -> "<img ...>").
// Readback compares both sides after this normalization so layout-only rewrites are not mismatches.
// Only whitespace BETWEEN tags and the self-closing slash of void tags are ignored; text, attributes,
// comments and tag case still have to match.
const VOID_SELF_CLOSING = /<(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)\b([^>]*?)\s*\/>/gi;

export function normalizeShopifyHtml(html: string | null | undefined): string {
  return (html ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(VOID_SELF_CLOSING, "<$1$2>")
    .replace(/>\s+</g, "><")
    .trim();
}

export function describeHtmlDifference(
  tool: string | null | undefined,
  shopify: string | null | undefined
): { index: number; tool: string; shopify: string } | null {
  const a = normalizeShopifyHtml(tool);
  const b = normalizeShopifyHtml(shopify);
  if (a === b) return null;
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
  const from = Math.max(0, index - 40);
  return { index, tool: a.slice(from, index + 80), shopify: b.slice(from, index + 80) };
}
