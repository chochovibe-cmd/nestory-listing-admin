/**
 * B9: internal underline tabs on ResultCard.
 * Mockup: 5 tabs — 文案／定價／圖片／Tags／SEO.
 * (Was temporarily 4 with SEO folded into 文案; boss reconfirmed 5 after use.)
 * Stage pills filters are deferred to B12 (not here).
 */

export type ResultCardTabId = "copy" | "pricing" | "images" | "tags" | "seo";

export const RESULT_CARD_TABS: { id: ResultCardTabId; label: string }[] = [
  { id: "copy", label: "文案" },
  { id: "pricing", label: "定價" },
  { id: "images", label: "圖片" },
  { id: "tags", label: "Tags" },
  { id: "seo", label: "SEO" }
];

/**
 * Field keys that must appear in each tab (only-add contract for verify script).
 * Footer actions stay outside tabs.
 */
export const RESULT_CARD_TAB_FIELDS: Record<ResultCardTabId, readonly string[]> = {
  copy: [
    "quick_status",
    "original_title",
    "title_zh",
    "description",
    "faq",
    "ai_detect"
  ],
  pricing: ["cost_profit", "sell_price", "compare_at_price"],
  images: ["process_marks", "detail_thumbs", "unmarked_warn"],
  tags: ["tags_chips", "tags_input", "warnings_list", "quick_add_character"],
  seo: ["seo_title", "seo_description"]
};

/** Always visible under any tab (must not disappear when refactoring layout). */
export const RESULT_CARD_FOOTER_ACTIONS = [
  "publish_mode",
  "save",
  "regenerate",
  "request_revision",
  "send_images",
  "approve_and_publish",
  "export_csv"
] as const;

export function tabLabelWithWarn(id: ResultCardTabId, warnCount: number): string {
  if (id === "tags" && warnCount > 0) return `Tags ⚠`;
  return RESULT_CARD_TABS.find((tab) => tab.id === id)?.label ?? id;
}

export function isResultCardTabId(value: unknown): value is ResultCardTabId {
  return (
    value === "copy" ||
    value === "pricing" ||
    value === "images" ||
    value === "tags" ||
    value === "seo"
  );
}
