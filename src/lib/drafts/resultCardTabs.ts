/**
 * B9 / UX-M T64: internal underline tabs on ResultCard.
 * Order: 文案｜規格｜定價｜圖片｜Tags｜SEO
 * (Was 5 tabs without 規格; R85 adds specs = 款式／變體, not 規格圖.)
 * Stage pills filters are deferred to B12 (not here).
 */

export type ResultCardTabId =
  | "copy"
  | "specs"
  | "pricing"
  | "images"
  | "tags"
  | "seo";

export const RESULT_CARD_TABS: { id: ResultCardTabId; label: string }[] = [
  { id: "copy", label: "文案" },
  { id: "specs", label: "規格" },
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
  specs: [
    "variant_dimensions",
    "variant_rows",
    "variant_cost",
    "variant_sell_price",
    "variant_qty"
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
    value === "specs" ||
    value === "pricing" ||
    value === "images" ||
    value === "tags" ||
    value === "seo"
  );
}
