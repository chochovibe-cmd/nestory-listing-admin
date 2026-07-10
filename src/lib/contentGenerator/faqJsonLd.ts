// A21-2 (文案·三之五b item 2): FAQPage structured data (schema.org JSON-LD),
// built from the same generated_faq_html Q/A pairs as the custom.product_faq
// metafield (A22b) so the two never disagree. Appended into descriptionHtml
// at the Shopify publish boundary (payload.ts), same boundary A23/A21-3
// already use -- the DB column / FAQ tab UI are untouched.
import { extractFaqPairs } from './htmlFormat';

export interface FaqJsonLdSchema {
  '@context': 'https://schema.org';
  '@type': 'FAQPage';
  mainEntity: Array<{
    '@type': 'Question';
    name: string;
    acceptedAnswer: {
      '@type': 'Answer';
      text: string;
    };
  }>;
}

export function buildFaqJsonLd(faqHtml: string | null | undefined): FaqJsonLdSchema | null {
  const pairs = extractFaqPairs(faqHtml).filter((pair) => pair.question && pair.answer);
  if (pairs.length === 0) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: pairs.map((pair) => ({
      '@type': 'Question',
      name: pair.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: pair.answer,
      },
    })),
  };
}

// Escapes "<" so a FAQ answer that happens to contain literal "</script>"
// text can't prematurely close the tag -- standard practice for inline
// JSON-LD (< decodes back to "<" at parse time, JSON is unaffected).
function escapeForInlineScript(json: string): string {
  return json.replace(/</g, '\\u003c');
}

export function buildFaqJsonLdScriptTag(faqHtml: string | null | undefined): string {
  const schema = buildFaqJsonLd(faqHtml);
  if (!schema) return '';

  return `<script type="application/ld+json">${escapeForInlineScript(JSON.stringify(schema))}</script>`;
}
