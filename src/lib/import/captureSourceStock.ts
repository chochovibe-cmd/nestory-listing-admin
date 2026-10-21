/** CAPTURE-FIX: warnings for source-sold-out variants at capture import. */
export const WARNING_ALL_SOURCE_SOLD_OUT =
  "來源網站上所有款式都已售完，這次沒有排除任何款式；請確認這件商品還要不要上架";

/** 已排除 2 款來源售完：「A」「B」（可在規格頁籤加回）；超過 6 款只列前 6 款再加「…」 */
export function formatSoldOutExcludedWarning(labels: string[]): string {
  return `已排除 ${labels.length} 款來源售完：${labels.slice(0, 6).map((l) => `「${l}」`).join("")}${labels.length > 6 ? "…" : ""}（可在規格頁籤加回）`;
}
