// A23 (2026-07-10, A14 finding): the copy system prompt deliberately generates
// generated_description_html as PLAIN TEXT (blank-line-separated paragraphs,
// "・" bullet lines) -- see systemPrompt.ts's 描述格式 section. That's correct
// for ResultCard.tsx, which edits description_html in a plain <textarea> on
// purpose (so operators review readable Chinese, not HTML soup). The mismatch
// only bites at the Shopify boundary: Shopify's rich-text descriptionHtml
// field doesn't render raw "\n" as a line break, so the five A/B/C/D/E
// sections collapsed into one run-on paragraph on the product page.
//
// Fix is scoped to that boundary only: payload.ts calls this right before
// building the Shopify product input. The DB column and the app's own
// textarea are untouched.

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// A17: "➼" marks the rule-engine-appended "適用情境" line (scenarioKeywords.ts)
// alongside the model's own "・" bullets in the D段 block -- both render as
// <li> in the same list.
const BULLET_PREFIX = /^[・･•➼]\s*/;

export function formatPlainTextAsHtml(text: string | null | undefined): string {
  if (!text) return "";

  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks
    .map((block) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const bulletLines = lines.filter((line) => BULLET_PREFIX.test(line));
      const headingLines = lines.filter((line) => !BULLET_PREFIX.test(line));

      if (bulletLines.length > 0) {
        const heading = headingLines.length > 0 ? `<p>${headingLines.map(escapeHtml).join("<br>")}</p>` : "";
        const items = bulletLines.map((line) => `<li>${escapeHtml(line.replace(BULLET_PREFIX, ""))}</li>`).join("");
        return `${heading}<ul>${items}</ul>`;
      }

      return `<p>${lines.map(escapeHtml).join("<br>")}</p>`;
    })
    .join("");
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, "").trim();
}

// A22b: the reverse direction -- generated_faq_html is real HTML
// (<h3><strong>Q</strong></h3><p>A</p> pairs, per systemPrompt.ts's FAQ
// rules), but Shopify's custom.product_faq metafield is a plain
// multi_line_text_field, not a rich-text field. Used only when building that
// metafield's value; the FAQ tab in the app keeps rendering the real HTML.
export function htmlFaqToPlainText(html: string | null | undefined): string {
  if (!html) return "";

  const pairs: string[] = [];
  const pattern = /<h3>\s*<strong>(.*?)<\/strong>\s*<\/h3>\s*<p>(.*?)<\/p>/gis;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    const question = stripHtmlTags(match[1]);
    const answer = stripHtmlTags(match[2]);
    if (question || answer) {
      pairs.push(`Q：${question}\nA：${answer}`);
    }
  }

  return pairs.join("\n\n");
}
