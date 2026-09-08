import { normalizeSaleStatusLabel } from "@/lib/saleStatus";
import type { CopyTone } from "@/lib/providers/copy";

/**
 * 文案呈現包 + P2-81：商品描述開頭的「到貨方式」小提醒。
 * 原五具體語氣維持既有句子；COPY C1.1 的潮巢導購版另走短資訊型四句。
 *
 * 鐵則：事實不可變——
 * - 海外代購：約 14 天
 * - 預購中：到貨時程以頁面說明為準
 * - 台灣現貨／二手現貨：約 1–3 個工作天出貨
 * - 二手：品況見商品資訊
 */

const CHAOCHAO_SALES_TONE = "潮巢導購版";
const CONCRETE_TONES = [
  "黑膠文藝收藏感",
  "日系選物店溫柔感",
  "可愛周邊輕鬆感",
  "中二熱血宣言",
  "小編聊天口吻",
] as const;

type ConcreteTone = (typeof CONCRETE_TONES)[number];

/** Fallback when generation_tone missing (old drafts) — P2 81-A. */
const DEFAULT_NOTICE_TONE: ConcreteTone = "小編聊天口吻";

const CHAOCHAO_NOTICE_BY_STATUS: Readonly<Record<string, string>> = {
  "海外代購（約14天）": "此為海外代購商品，預估約 14 天。",
  預購中: "此為預購商品，到貨時程以頁面說明為準。",
  台灣現貨: "此為台灣現貨商品，約 1–3 個工作天出貨。",
  二手現貨: "此為二手現貨商品，品況請見商品資訊，約 1–3 個工作天出貨。",
};

/**
 * 4 statuses × 5 legacy tones = 20 sentences.
 * COPY C1.1 adds a separate four-sentence informational branch without
 * changing the historical 20-row contract used by existing verifiers.
 */
const SALE_STATUS_NOTICES_BY_TONE: Record<
  string,
  Partial<Record<ConcreteTone, string>> & { default: string }
> = {
  "海外代購（約14天）": {
    default:
      "🕊️ 這件是海外代購商品，下單後大約 14 天抵達台灣——好東西值得等一下下，我們會幫你盯緊物流！",
    黑膠文藝收藏感:
      "這件走海外代購，約 14 天抵台。收藏本來就需要一點等候——我們會把物流進度顧好。",
    日系選物店溫柔感:
      "這是海外代購商品，下單後大約 14 天會到台灣。慢慢等它回家就好，我們會幫你留意物流。",
    可愛周邊輕鬆感:
      "✈️ 海外代購款，大約 14 天飛來台灣～好東西值得等一下，物流我們幫你盯！",
    中二熱血宣言:
      "此品為海外代購，約 14 天抵達台灣。等待是旅程的一部分——物流航線，我們與你並肩守望。",
    小編聊天口吻:
      "🕊️ 這件是海外代購商品，下單後大約 14 天抵達台灣——好東西值得等一下下，我們會幫你盯緊物流！",
  },
  預購中: {
    default:
      "⏳ 這件目前開放預購中，到貨時程以頁面說明為準；有任何進度我們都會誠實回報，敬請耐心等牠回家。",
    黑膠文藝收藏感:
      "目前開放預購。到貨時程以頁面說明為準；有進度會誠實更新，請安心等候。",
    日系選物店溫柔感:
      "這件正在預購中，到貨時程請以頁面說明為準。有消息我們會溫柔提醒你，一起等它到齊。",
    可愛周邊輕鬆感:
      "⏳ 預購開放中～到貨時間以頁面說明為準，有進度會跟你說，慢慢等牠回家！",
    中二熱血宣言:
      "預購開戰中。到貨時程以頁面說明為準——進度有變，必以誠實戰報告知。",
    小編聊天口吻:
      "⏳ 這件目前開放預購中，到貨時程以頁面說明為準；有任何進度我們都會誠實回報，敬請耐心等牠回家。",
  },
  台灣現貨: {
    default: "📦 台灣現貨，下單後約 1–3 個工作天出貨，很快就到你手上！",
    黑膠文藝收藏感: "台灣現貨。下單後約 1–3 個工作天出貨，讓它盡快進你的收藏序列。",
    日系選物店溫柔感: "台灣現貨喔。下單後大約 1–3 個工作天出貨，很快就會到你身邊。",
    可愛周邊輕鬆感: "📦 台灣現貨！下單後約 1–3 個工作天出貨，咻一下就到～",
    中二熱血宣言: "台灣現貨在庫。下單後約 1–3 個工作天出貨——速戰速決，盡快到手。",
    小編聊天口吻: "📦 台灣現貨，下單後約 1–3 個工作天出貨，很快就到你手上！",
  },
  二手現貨: {
    default:
      "💛 這件是精心挑選的二手好物（品況見商品資訊），台灣現貨、約 1–3 個工作天出貨。",
    黑膠文藝收藏感:
      "二手精選（品況見商品資訊）。台灣現貨，約 1–3 個工作天出貨，讓舊物繼續被好好對待。",
    日系選物店溫柔感:
      "這是我們挑過的二手好物（品況請看商品資訊）。台灣現貨，約 1–3 個工作天出貨。",
    可愛周邊輕鬆感:
      "💛 二手小好物（品況見商品資訊）～台灣現貨，約 1–3 個工作天出貨！",
    中二熱血宣言:
      "二手精銳入列（品況見商品資訊）。台灣現貨，約 1–3 個工作天出貨，再戰下一站收藏。",
    小編聊天口吻:
      "💛 這件是精心挑選的二手好物（品況見商品資訊），台灣現貨、約 1–3 個工作天出貨。",
  },
};

function resolveNoticeTone(tone: string | null | undefined): ConcreteTone {
  const t = (tone ?? "").trim();
  if ((CONCRETE_TONES as readonly string[]).includes(t)) {
    return t as ConcreteTone;
  }
  return DEFAULT_NOTICE_TONE;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 純文字版提醒（無則空字串）。 */
export function saleStatusNoticeText(
  saleStatus: string | null | undefined,
  tone?: string | null | CopyTone,
): string {
  const normalized = normalizeSaleStatusLabel(saleStatus);
  if ((tone ?? "").trim() === CHAOCHAO_SALES_TONE) {
    return CHAOCHAO_NOTICE_BY_STATUS[normalized] ?? "";
  }
  const bucket = SALE_STATUS_NOTICES_BY_TONE[normalized];
  if (!bucket) return "";
  const resolved = resolveNoticeTone(tone ?? null);
  return bucket[resolved] ?? bucket.default ?? "";
}

/** Shopify/Preview 描述用的 HTML 段落（無則空字串）。 */
export function saleStatusNoticeHtml(
  saleStatus: string | null | undefined,
  tone?: string | null | CopyTone,
): string {
  const text = saleStatusNoticeText(saleStatus, tone);
  if (!text) return "";
  return (tone ?? "").trim() === CHAOCHAO_SALES_TONE
    ? `<p>${escapeHtml(text)}</p>`
    : `<p><em>${escapeHtml(text)}</em></p>`;
}

/** 供 verify／報告列出既有 20 句全文。 */
export function listAllSaleStatusNotices(): Array<{
  saleStatus: string;
  tone: ConcreteTone;
  text: string;
}> {
  const rows: Array<{ saleStatus: string; tone: ConcreteTone; text: string }> = [];
  for (const [saleStatus, bucket] of Object.entries(SALE_STATUS_NOTICES_BY_TONE)) {
    for (const tone of CONCRETE_TONES) {
      rows.push({
        saleStatus,
        tone,
        text: bucket[tone] ?? bucket.default,
      });
    }
  }
  return rows;
}
