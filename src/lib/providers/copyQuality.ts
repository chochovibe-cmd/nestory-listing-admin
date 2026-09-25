import type { CopyProviderOutput } from "./copy";

/** Narrow, explainable checks. These are review signals, not an LLM claim verifier. */
export function reviewChaochaoCopy(copy: CopyProviderOutput, evidence: string): string[] {
  const fields: Array<[string, string]> = [
    ["商品介紹", copy.generatedDescriptionHtml],
    ["選品理由", copy.whyWeChoseIt],
    ["FAQ", copy.generatedFaqHtml],
    ["SEO 簡介", copy.metaDescription],
    ["亮點", copy.productHighlights.join("\n")],
  ];
  const warnings: string[] = [];
  const filler = /絕佳(?:的)?(?:收藏|選擇)|增添(?:生活|日常)|品質可靠|療癒日常|滿滿的驚喜|送禮首選|實用又美觀/;
  for (const [field, text] of fields) {
    if (filler.test(text)) warnings.push(`${field}含通用廣告句，請檢查是否能換成這件商品的具體資訊。`);
  }
  // Only flag claims with explicit units; a lack of matching source is a review
  // request, not proof the claim is wrong. Search snippets are deliberately
  // excluded from this authority set until an exact-product source is verified.
  const sourceNumbers = new Set((evidence.match(/\d+(?:\.\d+)?\s*(?:cm|mm|公分|公克|g|kg|ml|mAh|吋)/gi) ?? [])
    .map((value) => value.replace(/\s+/g, "").toLowerCase()));
  const output = fields.map(([, text]) => text).join("\n");
  const unsupported = [...new Set((output.match(/\d+(?:\.\d+)?\s*(?:cm|mm|公分|公克|g|kg|ml|mAh|吋)/gi) ?? [])
    .filter((value) => !sourceNumbers.has(value.replace(/\s+/g, "").toLowerCase())))];
  if (unsupported.length) warnings.push(`以下規格數字未在原始證據找到：${unsupported.slice(0, 5).join("、")}；發布前請核實。`);
  return warnings;
}
