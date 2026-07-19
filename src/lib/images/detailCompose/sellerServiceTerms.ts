/**
 * SYN-1 R2 + P4 same-family terms: seller service / promo noise
 * that must not appear on composed detail images (or customer copy).
 * Shared list so verify-p4 / verify-syn1 stay aligned.
 */

/** Core terms (must appear in both P4 prompts and R2 render filter). */
export const SELLER_SERVICE_CORE_TERMS = [
  "保固",
  "售後",
  "退換",
  "贈品",
  "店鋪活動"
] as const;

/**
 * Broader match list for render-time hard filter (R2).
 * Key or value containing any of these → drop the row.
 */
export const SELLER_SERVICE_FILTER_TERMS: readonly string[] = [
  ...SELLER_SERVICE_CORE_TERMS,
  "七天無理由",
  "七天",
  "無理由",
  "退貨",
  "換貨",
  "售後服務",
  "保修",
  "質保",
  "三包",
  "滿額禮",
  "會員優惠",
  "店鋪優惠",
  "包郵",
  "免運",
  "運費",
  "物流",
  "發貨",
  "出貨",
  "優惠券",
  "立減",
  "滿減",
  "紅包",
  "銷量",
  "收藏",
  "好評",
  "店鋪評分",
  "評分",
  "發票",
  "開票",
  "售後保障",
  "無憂退"
];

/** Platform / Taobao param noise keys (exact-ish). */
export const TAOBAO_NOISE_SPEC_KEYS: readonly string[] = [
  "物流",
  "運費",
  "發貨",
  "出貨",
  "發票",
  "服務",
  "售後",
  "保固",
  "保修",
  "退換",
  "包郵",
  "優惠",
  "活動",
  "贈品",
  "銷量",
  "評分",
  "支付",
  "分期",
  "稅費"
];
