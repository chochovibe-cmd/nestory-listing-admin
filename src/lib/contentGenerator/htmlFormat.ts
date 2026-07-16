// A23 (2026-07-10, A14 finding): the copy system prompt deliberately generates
// generated_description_html as PLAIN TEXT (blank-line-separated paragraphs,
// "・" bullet lines) -- see systemPrompt.ts's 描述格式 section. That's correct
// for ResultCard.tsx, which edits description_html in a plain <textarea> on
// purpose (so operators review readable Chinese, not HTML soup). The mismatch
// only bites at the Shopify boundary: Shopify's rich-text descriptionHtml
// field doesn't render raw "\n" as a line break, so the five A/B/C/D/E
// sections collapsed into one run-on paragraph on the product page.
//
// fix(B10): rule-engine / test-mode previously wrote real HTML into the same
// column. Storage contract is now plain text everywhere; isLikelyHtml guards
// payload conversion so legacy HTML rows are not double-wrapped.

import { matchSectionHeader } from "./sectionHeaders";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// A17: "➼" marks the rule-engine-appended "適用情境" line (scenarioKeywords.ts)
// alongside the model's own "・" bullets in the D段 block -- both render as
// <li> in the same list.
const BULLET_PREFIX = /^[・･•➼]\s*/;

/** True when the string looks like markup (legacy rows / accidental HTML store). */
export function isLikelyHtml(text: string | null | undefined): boolean {
  if (!text) return false;
  return /<\/?(?:p|div|br|ul|ol|li|h[1-6]|strong|em|span|a|table|tr|td|th|section|article|header|footer)\b/i.test(
    text,
  );
}

/**
 * Convert legacy HTML description blobs back to plain paragraphs so the
 * textarea / storage contract stays readable Chinese, not markup soup.
 * Block tags become blank-line separators; <br> / list items become newlines.
 */
export function htmlDescriptionToPlainText(html: string | null | undefined): string {
  if (!html) return "";
  let text = html
    .replace(/\r\n?/g, "\n")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*(?:p|div|h[1-6]|section|article|li|tr)\s*>/gi, "\n\n")
    .replace(/<\s*li\b[^>]*>/gi, "・")
    .replace(/<\/\s*ul\s*>/gi, "\n\n")
    .replace(/<\/\s*ol\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

/** Normalize any description (plain or legacy HTML) to the plain-text store form. */
export function normalizeDescriptionToPlainText(text: string | null | undefined): string {
  if (!text) return "";
  return isLikelyHtml(text) ? htmlDescriptionToPlainText(text) : text;
}

/**
 * Shopify-boundary converter: plain text → HTML paragraphs / lists.
 * If input is already HTML (legacy DB row), return as-is — never double-wrap.
 */
export function formatPlainTextAsHtml(text: string | null | undefined): string {
  if (!text) return "";

  // fix(B10): already-HTML content must not be escaped into another <p> layer.
  if (isLikelyHtml(text)) return text;

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

      // 文案呈現包：段落標題行升級為真正的 <h3> 標題（視覺層級），
      // 新制「◈ 商品亮點」與舊制「B｜商品亮點」都認得；
      // 舊制「A｜開頭句…」帶內文的字母行 → 去前綴當一般段落。
      const htmlParts: string[] = [];
      const paragraphLines: string[] = [];
      const bulletLines: string[] = [];

      const flushParagraph = () => {
        if (paragraphLines.length === 0) return;
        htmlParts.push(`<p>${paragraphLines.map(escapeHtml).join("<br>")}</p>`);
        paragraphLines.length = 0;
      };
      const flushBullets = () => {
        if (bulletLines.length === 0) return;
        const items = bulletLines
          .map((line) => `<li>${escapeHtml(line.replace(BULLET_PREFIX, ""))}</li>`)
          .join("");
        htmlParts.push(`<ul>${items}</ul>`);
        bulletLines.length = 0;
      };

      for (const line of lines) {
        const header = matchSectionHeader(line);
        if (header && header.title) {
          flushParagraph();
          flushBullets();
          htmlParts.push(`<h3><strong>◈ ${escapeHtml(header.title)}</strong></h3>`);
          continue;
        }
        if (header && header.inlineContent) {
          // legacy "A｜開頭句…": strip the letter prefix, keep the sentence
          flushBullets();
          paragraphLines.push(header.inlineContent);
          continue;
        }
        if (header) continue; // bare letter header with no title/content — drop

        if (BULLET_PREFIX.test(line)) {
          flushParagraph();
          bulletLines.push(line);
        } else {
          flushBullets();
          paragraphLines.push(line);
        }
      }
      flushParagraph();
      flushBullets();

      return htmlParts.join("");
    })
    .join("");
}

/**
 * Preview renderer for the ResultCard description toggle:
 * plain → convert; legacy HTML → use as stored (same boundary helper).
 */
export function descriptionPreviewHtml(text: string | null | undefined): string {
  if (!text) return "<p>尚無內容</p>";
  const html = formatPlainTextAsHtml(text);
  return html || "<p>尚無內容</p>";
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, "").trim();
}

export interface FaqPair {
  question: string;
  answer: string;
}

// Shared by htmlFaqToPlainText (below) and faqJsonLd.ts's FAQPage schema
// builder (A21-2) -- both need the same <h3><strong>Q</strong></h3><p>A</p>
// pairs out of generated_faq_html, per systemPrompt.ts's FAQ rules. Keeping
// one regex avoids the two call sites silently drifting apart.
export function extractFaqPairs(html: string | null | undefined): FaqPair[] {
  if (!html) return [];

  const pairs: FaqPair[] = [];
  const pattern = /<h3>\s*<strong>(.*?)<\/strong>\s*<\/h3>\s*<p>(.*?)<\/p>/gis;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    const question = stripHtmlTags(match[1]);
    const answer = stripHtmlTags(match[2]);
    if (question || answer) {
      pairs.push({ question, answer });
    }
  }

  return pairs;
}

// A22b: the reverse direction -- generated_faq_html is real HTML, but
// Shopify's custom.product_faq metafield is a plain multi_line_text_field,
// not a rich-text field. Used only when building that metafield's value; the
// FAQ tab in the app keeps rendering the real HTML.
export function htmlFaqToPlainText(html: string | null | undefined): string {
  return extractFaqPairs(html)
    .map(({ question, answer }) => `Q：${question}\nA：${answer}`)
    .join("\n\n");
}
