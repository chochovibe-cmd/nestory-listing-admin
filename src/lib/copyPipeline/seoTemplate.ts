import { appendNestoryBrandSuffix } from "@/lib/contentGenerator/seoGenerator";
import { localizeBriefCopyText } from "./copyChecks";

const SECTION_TITLES = new Set(["商品介紹", "收藏亮點", "適合誰", "商品資訊", "購買前提醒", "購買提醒", "導購小標"]);
/** Deterministic SEO for Product Brief mode only. */
export function buildTemplateSeo(input: { title: string; descriptionText: string }): { seoTitle: string; metaDescription: string } {
  const source = input.descriptionText
    .replace(/<h[1-6]\b[^>]*>/giu, "\n")
    .replace(/<\/h[1-6]\s*>/giu, "\n")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/p\s*>/giu, "\n\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">");
  const lines = source.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const introParagraphs: string[] = [];
  let inIntro = false;
  for (const line of lines) {
    const heading = line.replace(/^#+\s*/u, "").replace(/[：:]$/u, "").trim();
    if (SECTION_TITLES.has(heading)) {
      if (inIntro) break;
      inIntro = heading === "商品介紹";
      continue;
    }
    if (!inIntro && /<h[1-6]\b/iu.test(line)) continue;
    if (inIntro || !lines.some((candidate) => SECTION_TITLES.has(candidate.replace(/^#+\s*/u, "").replace(/[：:]$/u, "").trim()))) {
      introParagraphs.push(line);
    }
  }
  let accumulated = "";
  for (const paragraph of introParagraphs) {
    const sentences = paragraph.match(/[^。！？!?]+[。！？!?]?/gu) ?? [];
    for (const sentence of sentences) {
      const complete = sentence.trim();
      if (!/[。！？!?]$/u.test(complete)) continue;
      accumulated += complete;
      if (Array.from(accumulated).length >= 80) break;
    }
    if (Array.from(accumulated).length >= 80) break;
  }
  const completeSentence = clampAtSentence(accumulated, 110);
  const safeTitleFallback = `${input.title.trim().replace(/[。！？.!?]+$/u, "")}。`;
  return { seoTitle: appendNestoryBrandSuffix(input.title), metaDescription: completeSentence || safeTitleFallback };
}

/** Clamp at a complete sentence when possible; never return a dangling fragment. */
export function clampAtSentence(value: string, maxLength: number): string {
  const text = value.trim();
  const prefix = Array.from(text).slice(0, maxLength).join("");
  const boundary = Math.max(prefix.lastIndexOf("。"), prefix.lastIndexOf("！"), prefix.lastIndexOf("？"), prefix.lastIndexOf("!"), prefix.lastIndexOf("?"));
  return boundary >= 0 ? prefix.slice(0, boundary + 1).trim() : "";
}

export function finalizeBriefSeo(input: { seoTitle: string; metaDescription: string; title: string; descriptionText: string }): { seoTitle: string; metaDescription: string } {
  const fallback = buildTemplateSeo({ title: input.title, descriptionText: input.descriptionText });
  // Same separator as the live store titles: " | ".
  const storeSuffix = " | 潮巢 Nestory";
  const stripStoreName = (value: string) => localizeBriefCopyText(value)
    .replace(/潮巢\s*Nestory/giu, "")
    .replace(/Nestory/giu, "")
    .replace(/潮巢/gu, "")
    .replace(/\s*[|｜]+\s*/gu, " | ")
    .replace(/^\s*\|\s*|\s*\|\s*$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const seoBase = stripStoreName(input.seoTitle);
  const fallbackBase = stripStoreName(fallback.seoTitle);
  const base = seoBase || fallbackBase;
  const suffixLength = Array.from(storeSuffix).length + 1;
  const allowedBaseLength = Math.max(0, 60 - suffixLength);
  const trimBase = (candidate: string) => {
    if (Array.from(candidate).length <= allowedBaseLength) return candidate;
    const prefix = Array.from(candidate).slice(0, allowedBaseLength).join("");
    // Cut at a separator, else at the last space, so an AI title is shortened rather than replaced.
    const boundary = Math.max(prefix.lastIndexOf(" | "), prefix.lastIndexOf("、"), prefix.lastIndexOf(" "));
    return boundary > 0 ? prefix.slice(0, boundary).trim() : "";
  };
  let boundedBase = trimBase(base);
  if (!boundedBase) boundedBase = trimBase(stripStoreName(input.title)) || Array.from(stripStoreName(input.title)).slice(0, allowedBaseLength).join("");
  let seoTitle = `${boundedBase}${storeSuffix}`.trim();
  if (Array.from(seoTitle).length > 60) seoTitle = Array.from(seoTitle).slice(-60).join("");
  const meta = clampAtSentence(localizeBriefCopyText(input.metaDescription), 110);
  return { seoTitle, metaDescription: Array.from(meta).length >= 50 ? meta : localizeBriefCopyText(fallback.metaDescription) };
}
