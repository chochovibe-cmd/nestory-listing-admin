// A23: description_html storage stays plain text; rich HTML is a render/publish boundary concern.
import { matchSectionHeader } from "./sectionHeaders";
import { saleStatusNoticeHtml } from "./saleStatusNotice";

const CHAOCHAO_SALES_TONE = "潮巢導購版";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const BULLET_PREFIX = /^[・･•➼]\s*/;

/** True when the string looks like markup (legacy rows / accidental HTML store). */
export function isLikelyHtml(text: string | null | undefined): boolean {
  if (!text) return false;
  return /<\/?(?:p|div|br|ul|ol|li|h[1-6]|strong|em|span|a|table|tr|td|th|section|article|header|footer)\b/i.test(
    text,
  );
}

/** Convert legacy HTML description blobs back to the plain textarea/storage contract. */
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

export function normalizeDescriptionToPlainText(text: string | null | undefined): string {
  if (!text) return "";
  return isLikelyHtml(text) ? htmlDescriptionToPlainText(text) : text;
}

/** Original six-tone formatter. COPY C1.1 deliberately leaves this contract unchanged. */
export function formatPlainTextAsHtml(text: string | null | undefined): string {
  if (!text) return "";
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
          flushBullets();
          paragraphLines.push(header.inlineContent);
          continue;
        }
        if (header) continue;

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

type ChaochaoSection = "intro" | "highlights" | "sales";

function looksLikeChaochaoSalesSource(text: string): boolean {
  const normalized = normalizeDescriptionToPlainText(text).replace(/◈/g, "");
  return (
    /^商品介紹\s*$/mu.test(normalized) &&
    /^收藏亮點\s*$/mu.test(normalized) &&
    /^(?:導購小標|導購標題)\s*[：:]/mu.test(normalized)
  );
}

/**
 * COPY C1.1 boss-format renderer.
 * Storage remains plain text; Preview and Shopify receive h2/p/ul/li semantics.
 * No inline typography styles are emitted: Shopify Theme owns visual typography.
 */
export function formatChaochaoSalesDescriptionHtml(
  text: string | null | undefined,
  saleStatus?: string | null,
): string {
  const plain = normalizeDescriptionToPlainText(text)
    .replace(/◈/g, "")
    .trim();

  const introParagraphs: string[] = [];
  const highlightItems: string[] = [];
  const salesParagraphs: string[] = [];
  let dynamicHeading = "這件商品為什麼有意思";
  let section: ChaochaoSection = "intro";
  let paragraphBuffer: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return;
    const joined = paragraphBuffer.join(" ").replace(/\s+/g, " ").trim();
    if (joined) {
      if (section === "highlights") highlightItems.push(joined.replace(BULLET_PREFIX, ""));
      else if (section === "sales") salesParagraphs.push(joined);
      else introParagraphs.push(joined);
    }
    paragraphBuffer = [];
  };

  for (const rawLine of plain.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    if (/^商品介紹$/u.test(line)) {
      flushParagraph();
      section = "intro";
      continue;
    }
    if (/^收藏亮點$/u.test(line)) {
      flushParagraph();
      section = "highlights";
      continue;
    }
    const salesHeading = line.match(/^(?:導購小標|導購標題)\s*[：:]\s*(.+)$/u);
    if (salesHeading) {
      flushParagraph();
      dynamicHeading = salesHeading[1].trim() || dynamicHeading;
      section = "sales";
      continue;
    }
    if (section === "highlights" && BULLET_PREFIX.test(line)) {
      flushParagraph();
      highlightItems.push(line.replace(BULLET_PREFIX, "").trim());
      continue;
    }
    paragraphBuffer.push(line);
  }
  flushParagraph();

  const introHtml = introParagraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
  const highlightsHtml = `<ul>${highlightItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  const salesHtml = salesParagraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");

  return (
    `<h2>商品介紹</h2>` +
    saleStatusNoticeHtml(saleStatus, CHAOCHAO_SALES_TONE) +
    introHtml +
    `<h2>收藏亮點</h2>` +
    highlightsHtml +
    `<h2>${escapeHtml(dynamicHeading)}</h2>` +
    salesHtml
  );
}

/**
 * ResultCard preview renderer.
 * `tone`/`saleStatus` can be passed by newer call sites; source-shape detection keeps
 * the current ResultCard call compatible without any UI/CSS redesign.
 */
export function descriptionPreviewHtml(
  text: string | null | undefined,
  tone?: string | null,
  saleStatus?: string | null,
): string {
  if (!text) return "<p>尚無內容</p>";
  const isChaochao = tone === CHAOCHAO_SALES_TONE || looksLikeChaochaoSalesSource(text);
  const html = isChaochao
    ? formatChaochaoSalesDescriptionHtml(text, saleStatus)
    : formatPlainTextAsHtml(text);
  return html || "<p>尚無內容</p>";
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, "").trim();
}

export interface FaqPair {
  question: string;
  answer: string;
}

export function extractFaqPairs(html: string | null | undefined): FaqPair[] {
  if (!html) return [];
  const pairs: FaqPair[] = [];
  const pattern = /<h3>\s*<strong>(.*?)<\/strong>\s*<\/h3>\s*<p>(.*?)<\/p>/gis;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    const question = stripHtmlTags(match[1]);
    const answer = stripHtmlTags(match[2]);
    if (question || answer) pairs.push({ question, answer });
  }
  return pairs;
}

export function htmlFaqToPlainText(html: string | null | undefined): string {
  return extractFaqPairs(html)
    .map(({ question, answer }) => `Q：${question}\nA：${answer}`)
    .join("\n\n");
}
