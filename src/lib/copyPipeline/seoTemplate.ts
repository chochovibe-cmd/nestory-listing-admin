import { appendNestoryBrandSuffix } from "@/lib/contentGenerator/seoGenerator";

const SECTION_TITLES = new Set(["商品介紹", "收藏亮點", "適合誰", "商品資訊", "購買提醒", "導購小標"]);
/** Deterministic SEO for Product Brief mode only. */
export function buildTemplateSeo(input: { title: string; descriptionText: string }): { seoTitle: string; metaDescription: string } {
  const paragraphs = input.descriptionText.split(/\n\s*\n/).map((p) => p.split(/\n/).map((line) => line.trim()).filter(Boolean));
  const first = paragraphs.map((lines) => lines.filter((line) => !SECTION_TITLES.has(line)).join(" ").trim()).find(Boolean) ?? "";
  const completeSentence = clampAtSentence(first, 90);
  const safeTitleFallback = `${input.title.trim().replace(/[。！？.!?]+$/u, "")}。`;
  return { seoTitle: appendNestoryBrandSuffix(input.title), metaDescription: completeSentence || safeTitleFallback };
}

/** Clamp at a complete sentence when possible; never return a dangling fragment. */
export function clampAtSentence(value: string, maxLength: number): string {
  const text = value.trim();
  if (Array.from(text).length <= maxLength) return text;
  const prefix = Array.from(text).slice(0, maxLength).join("");
  const boundary = Math.max(prefix.lastIndexOf("。"), prefix.lastIndexOf("！"), prefix.lastIndexOf("？"));
  return boundary >= 0 ? prefix.slice(0, boundary + 1).trim() : "";
}

export function finalizeBriefSeo(input: { seoTitle: string; metaDescription: string; title: string; descriptionText: string }): { seoTitle: string; metaDescription: string } {
  const fallback = buildTemplateSeo({ title: input.title, descriptionText: input.descriptionText });
  // Same separator as the live store titles: " | ".
  const storeSuffix = " | 潮巢 Nestory";
  const stripStoreName = (value: string) => value
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
    const boundary = Math.max(prefix.lastIndexOf(" | "), prefix.lastIndexOf("、"));
    return boundary > 0 ? prefix.slice(0, boundary).trim() : "";
  };
  let boundedBase = trimBase(base);
  if (!boundedBase) boundedBase = trimBase(stripStoreName(input.title)) || Array.from(stripStoreName(input.title)).slice(0, allowedBaseLength).join("");
  let seoTitle = `${boundedBase} ${storeSuffix}`.trim();
  if (Array.from(seoTitle).length > 60) seoTitle = Array.from(seoTitle).slice(-60).join("");
  const meta = clampAtSentence(input.metaDescription, 90);
  return { seoTitle, metaDescription: Array.from(meta).length >= 30 ? meta : fallback.metaDescription };
}
