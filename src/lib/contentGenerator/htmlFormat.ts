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

type ChaochaoSection = "intro" | "highlights" | "audience" | "info" | "care";

const CHAOCHAO_KNOWN_SECTION_HEADING =
  /^(?:商品介紹|收藏亮點|商品亮點|適合誰|為什麼會想帶回家|商品資訊|購買提醒|常見問題|FAQ|導購小標|導購標題)$/iu;
const CHAOCHAO_SENTENCE_PUNCTUATION = /[。！？!?；;：:]/u;

function isKnownChaochaoSectionHeading(line: string): boolean {
  return CHAOCHAO_KNOWN_SECTION_HEADING.test(line) || matchSectionHeader(line) !== null;
}

function isConservativeMissingSalesHeadingCandidate(line: string): boolean {
  const length = Array.from(line).length;
  return (
    length >= 2 &&
    length <= 24 &&
    !BULLET_PREFIX.test(line) &&
    !isKnownChaochaoSectionHeading(line) &&
    !CHAOCHAO_SENTENCE_PUNCTUATION.test(line)
  );
}

function looksLikeChaochaoSalesBody(line: string | undefined): boolean {
  if (!line || BULLET_PREFIX.test(line) || isKnownChaochaoSectionHeading(line)) return false;
  if (/^(?:導購小標|導購標題|適合誰)\s*[：:]/u.test(line)) return false;
  return Array.from(line).length >= 12 || CHAOCHAO_SENTENCE_PUNCTUATION.test(line);
}

function looksLikeChaochaoSalesSource(text: string): boolean {
  const normalized = normalizeDescriptionToPlainText(text).replace(/◈/g, "");
  return (
    /^商品介紹\s*$/mu.test(normalized) &&
    /^收藏亮點\s*$/mu.test(normalized) &&
    (
      /^(?:導購小標|導購標題)\s*[：:]/mu.test(normalized) ||
      /^適合誰(?:\s*[：:].*)?$/mu.test(normalized) ||
      /^商品資訊\s*$/mu.test(normalized)
    )
  );
}

function renderParagraphs(values: string[]): string {
  return values.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
}

function renderList(values: string[]): string {
  if (values.length === 0) return "<ul></ul>";
  return `<ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

/**
 * Chaochao renderer: 商品介紹 / 收藏亮點 / 適合誰 / 商品資訊 / 購買提醒.
 * Old three-section 導購小標 source remains readable.
 */
export function formatChaochaoSalesDescriptionHtml(
  text: string | null | undefined,
  saleStatus?: string | null,
  tolerateMissingSalesHeading = false,
): string {
  const plain = normalizeDescriptionToPlainText(text)
    .replace(/◈/g, "")
    .trim();

  const introParagraphs: string[] = [];
  const highlightItems: string[] = [];
  const audienceParagraphs: string[] = [];
  const audienceItems: string[] = [];
  const infoItems: string[] = [];
  const infoParagraphs: string[] = [];
  const careItems: string[] = [];
  const careParagraphs: string[] = [];
  let audienceHeading = "這件商品為什麼有意思";
  let sawAudienceHeading = false;
  let sawInfoHeading = false;
  let sawLegacySalesHeading = false;
  let section: ChaochaoSection = "intro";
  let paragraphBuffer: string[] = [];
  let previousContentWasHighlightBullet = false;

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return;
    const joined = paragraphBuffer.join(" ").replace(/\s+/g, " ").trim();
    if (joined) {
      if (section === "highlights") highlightItems.push(joined.replace(BULLET_PREFIX, ""));
      else if (section === "audience") audienceParagraphs.push(joined.replace(BULLET_PREFIX, ""));
      else if (section === "info") infoParagraphs.push(joined.replace(BULLET_PREFIX, ""));
      else if (section === "care") careParagraphs.push(joined.replace(BULLET_PREFIX, ""));
      else introParagraphs.push(joined);
    }
    paragraphBuffer = [];
  };

  const lines = plain.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    if (/^商品介紹$/u.test(line)) {
      flushParagraph();
      section = "intro";
      previousContentWasHighlightBullet = false;
      continue;
    }
    if (/^(?:收藏亮點|商品亮點)$/u.test(line)) {
      flushParagraph();
      section = "highlights";
      previousContentWasHighlightBullet = false;
      continue;
    }
    const audienceNamed = line.match(/^適合誰\s*[：:]\s*(.+)$/u);
    if (line === "適合誰" || audienceNamed) {
      flushParagraph();
      audienceHeading = audienceNamed?.[1]?.trim() || "適合誰";
      section = "audience";
      sawAudienceHeading = true;
      previousContentWasHighlightBullet = false;
      continue;
    }
    if (/^商品資訊$/u.test(line)) {
      flushParagraph();
      section = "info";
      sawInfoHeading = true;
      previousContentWasHighlightBullet = false;
      continue;
    }
    if (/^購買提醒$/u.test(line)) {
      flushParagraph();
      section = "care";
      previousContentWasHighlightBullet = false;
      continue;
    }
    const salesHeading = line.match(/^(?:導購小標|導購標題)\s*[：:]\s*(.+)$/u);
    if (salesHeading) {
      flushParagraph();
      audienceHeading = salesHeading[1].trim() || audienceHeading;
      section = "audience";
      sawAudienceHeading = true;
      sawLegacySalesHeading = true;
      previousContentWasHighlightBullet = false;
      continue;
    }
    if (section === "highlights" && BULLET_PREFIX.test(line)) {
      flushParagraph();
      highlightItems.push(line.replace(BULLET_PREFIX, "").trim());
      previousContentWasHighlightBullet = true;
      continue;
    }
    if (section === "audience" && BULLET_PREFIX.test(line)) {
      flushParagraph();
      audienceItems.push(line.replace(BULLET_PREFIX, "").trim());
      continue;
    }
    if (section === "info" && BULLET_PREFIX.test(line)) {
      flushParagraph();
      infoItems.push(line.replace(BULLET_PREFIX, "").trim());
      continue;
    }
    if (section === "care" && BULLET_PREFIX.test(line)) {
      flushParagraph();
      careItems.push(line.replace(BULLET_PREFIX, "").trim());
      continue;
    }
    if (
      tolerateMissingSalesHeading &&
      !sawAudienceHeading &&
      !sawInfoHeading &&
      section === "highlights" &&
      highlightItems.length > 0 &&
      previousContentWasHighlightBullet &&
      paragraphBuffer.length === 0 &&
      isConservativeMissingSalesHeadingCandidate(line)
    ) {
      const nextContent = lines
        .slice(index + 1)
        .map((nextLine) => nextLine.trim())
        .find(Boolean);
      if (looksLikeChaochaoSalesBody(nextContent)) {
        audienceHeading = line;
        section = "audience";
        sawAudienceHeading = true;
        sawLegacySalesHeading = true;
        previousContentWasHighlightBullet = false;
        continue;
      }
    }
    if (section === "highlights") {
      previousContentWasHighlightBullet = false;
    }
    paragraphBuffer.push(line);
  }
  flushParagraph();

  let html =
    `<h2>商品介紹</h2>` +
    saleStatusNoticeHtml(saleStatus, CHAOCHAO_SALES_TONE) +
    renderParagraphs(introParagraphs) +
    `<h2>收藏亮點</h2>` +
    renderList(highlightItems);

  const audienceBody = renderList(audienceItems).replace("<ul></ul>", "") + renderParagraphs(audienceParagraphs);
  const infoBody = renderList(infoItems).replace("<ul></ul>", "") + renderParagraphs(infoParagraphs);
  const careBody = renderList(careItems).replace("<ul></ul>", "") + renderParagraphs(careParagraphs);

  const isNewFour = sawInfoHeading || (sawAudienceHeading && !sawLegacySalesHeading);
  if (isNewFour) {
    if (sawAudienceHeading || audienceBody) {
      html += `<h2>${escapeHtml(audienceHeading)}</h2>` + audienceBody;
    }
    if (sawInfoHeading || infoBody) {
      html += `<h2>商品資訊</h2>` + (infoBody || renderList([]));
    }
    if (careBody) {
      html += `<h2>購買提醒</h2>` + careBody;
    }
    return html;
  }

  html += `<h2>${escapeHtml(audienceHeading)}</h2>`;
  html += audienceItems.length > 0
    ? renderList(audienceItems) + renderParagraphs(audienceParagraphs)
    : renderParagraphs(audienceParagraphs);
  if (careBody) {
    html += `<h2>購買提醒</h2>` + careBody;
  }
  return html;
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
    ? formatChaochaoSalesDescriptionHtml(
        text,
        saleStatus,
        tone === CHAOCHAO_SALES_TONE,
      )
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
