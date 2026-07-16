import { normalizeSaleStatusLabel } from "@/lib/saleStatus";

/**
 * 文案呈現包（2026-07-18 老闆需求）：商品描述開頭的「到貨方式」小提醒。
 * 對照老闆工具的「此為海外代購商品，預估約 14 天。」但改成潮巢的
 * 溫暖貼心小編語氣＋一個 emoji（老闆 2026-07-18 拍板方向）。
 *
 * 只在 Shopify 邊界（payload.ts）注入，不寫回 DB 描述欄；
 * Showmore 端已有既有的【交貨方式說明】結尾段，不重複。
 */
const SALE_STATUS_NOTICES: Record<string, string> = {
  "海外代購（約14天）":
    "🕊️ 這件是海外代購商品，下單後大約 14 天抵達台灣——好東西值得等一下下，我們會幫你盯緊物流！",
  預購中:
    "⏳ 這件目前開放預購中，到貨時程以頁面說明為準；有任何進度我們都會誠實回報，敬請耐心等牠回家。",
  台灣現貨:
    "📦 台灣現貨，下單後約 1–3 個工作天出貨，很快就到你手上！",
  二手現貨:
    "💛 這件是精心挑選的二手好物（品況見商品資訊），台灣現貨、約 1–3 個工作天出貨。"
};

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 純文字版提醒（無則空字串）。 */
export function saleStatusNoticeText(saleStatus: string | null | undefined): string {
  const normalized = normalizeSaleStatusLabel(saleStatus);
  return SALE_STATUS_NOTICES[normalized] ?? "";
}

/** Shopify 描述開頭用的 HTML 段落（無則空字串）。 */
export function saleStatusNoticeHtml(saleStatus: string | null | undefined): string {
  const text = saleStatusNoticeText(saleStatus);
  return text ? `<p><em>${escapeHtml(text)}</em></p>` : "";
}
