import { appendNestoryBrandSuffix, clampMetaDescription } from "@/lib/contentGenerator/seoGenerator";

const SECTION_TITLES = new Set(["商品介紹", "收藏亮點", "適合誰", "商品資訊", "購買提醒", "導購小標"]);
/** Deterministic SEO for Product Brief mode only. */
export function buildTemplateSeo(input: { title: string; descriptionText: string }): { seoTitle: string; metaDescription: string } {
  const paragraphs = input.descriptionText.split(/\n\s*\n/).map((p) => p.split(/\n/).map((line) => line.trim()).filter(Boolean));
  const first = paragraphs.map((lines) => lines.filter((line) => !SECTION_TITLES.has(line)).join(" ").trim()).find(Boolean) ?? "";
  return { seoTitle: appendNestoryBrandSuffix(input.title), metaDescription: clampMetaDescription(first) };
}
