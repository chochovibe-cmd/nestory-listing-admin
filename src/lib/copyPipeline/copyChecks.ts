import { COPY_REGEN_FIELDS, type CopyRegenField } from "@/lib/providers/copy";

export type CopyIssue = { code: string; field: string; message: string };
export type CopyCheckInput = {
  title: string; descriptionText: string; highlights: string[]; whyWeChoseIt: string; faqHtml: string;
  evidenceText: string;
  facts: { requiresVoltage: boolean; voltage: string; taiwanRisks: string[] };
};
export const SIMPLIFIED_ONLY_CHARS = "这们说时会对发为产品质经国过长东买卖电网体软点规务关与亚乐样风车书动开实应该还边见没无问爱觉话选内习处产";
export const MAINLAND_TERMS: Readonly<Record<string, string>> = {
  視頻: "影片", 信息: "資訊", 軟件: "軟體", 屏幕: "螢幕", 充電寶: "行動電源",
  鼠標: "滑鼠", 內存: "記憶體", 默認: "預設", 質量: "品質", 網絡: "網路",
  數據線: "傳輸線", U盤: "隨身碟", 激光: "雷射", 寶貝: "商品", 爆款: "熱門款",
};
export const FORBIDDEN_COPY_TERMS = [
  "完美", "神器", "不容錯過", "高品質", "獨特魅力", "SPA 般", "必入手", "絕佳收藏",
  "品質有保證", "經久耐用", "夢幻逸品", "完美良伴", "最佳選擇", "療癒指數爆表",
  "無限的快樂", "送禮自用兩相宜", "或許是你的解答", "滿載童趣",
];
export const FAQ_PLACEHOLDER_HEADINGS = ["問題", "問題1", "問題一", "問題？", "Q", "Q1", "這是什麼商品？"];
export const AUTO_FIX_PRIORITY = ["empty_field", "number_not_in_evidence", "faq_unknown", "faq_format", "ai_tone"] as const;
/** 每件最多花到 NT$1.5 才會自動補寫（留空間不超過 NT$2 上限）。 */
export const AI_AUTO_FIX_BUDGET_TWD = 1.5;

const FIELDS: ReadonlyArray<{ field: CopyRegenField; label: string; text: (i: CopyCheckInput) => string }> = [
  { field: "enriched_title", label: "標題", text: (i) => i.title },
  { field: "generated_description_html", label: "正文", text: (i) => i.descriptionText },
  { field: "product_highlights", label: "亮點", text: (i) => i.highlights.join("、") },
  { field: "why_we_chose_it", label: "為什麼選它", text: (i) => i.whyWeChoseIt },
  { field: "generated_faq_html", label: "FAQ", text: (i) => stripTags(i.faqHtml) },
];
function stripTags(s: string): string { return s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(); }
function fieldWith(i: CopyCheckInput, match: (t: string) => boolean): string | null {
  return FIELDS.find((item) => match(item.text(i)))?.field ?? null;
}
function exactNumberInEvidence(value: string, evidence: string): boolean {
  const escape = value.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&");
  return new RegExp("(^|[^\\d.])" + escape + "(?![\\d.])").test(evidence);
}
export function checkCopy(input: CopyCheckInput): CopyIssue[] {
  const issues: CopyIssue[] = [];
  const add = (code: string, field: string, message: string) => { if (!issues.some((i) => i.code === code)) issues.push({ code, field, message: "【文案檢查】" + message }); };
  const simpl = [...new Set(FIELDS.flatMap((f) => [...f.text(input)].filter((ch) => SIMPLIFIED_ONLY_CHARS.includes(ch))))];
  if (simpl.length) add("simplified", fieldWith(input, (s) => [...s].some((ch) => SIMPLIFIED_ONLY_CHARS.includes(ch))) ?? "generated_description_html", "還有簡體字「" + simpl.join("、") + "」：請改繁體");
  for (const [term, replacement] of Object.entries(MAINLAND_TERMS)) {
    const field = fieldWith(input, (s) => s.includes(term));
    if (field) { add("mainland_term", field, "「" + term + "」是大陸用語，台灣說「" + replacement + "」"); break; }
  }
  const bad = [...new Set(FORBIDDEN_COPY_TERMS.filter((word) => FIELDS.some((f) => f.text(input).includes(word))))];
  if (bad.length) add("ai_tone", fieldWith(input, (s) => bad.some((word) => s.includes(word))) ?? "generated_description_html", "有空泛詞「" + bad.join("、") + "」：換成這件商品的具體細節");
  const headings = [...input.faqHtml.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)].map((m) => stripTags(m[1] ?? ""));
  if (headings.length < 2 || headings.length > 5 || headings.some((h) => FAQ_PLACEHOLDER_HEADINGS.includes(h))) {
    add("faq_format", "generated_faq_html", "FAQ 格式不對：應有 2–5 題且不能用範本問題");
  }
  if (/似乎|建議查看實物|資料未提及|未提到|不確定/.test(stripTags(input.faqHtml))) {
    add("faq_unknown", "generated_faq_html", "FAQ 在回答「我們不知道」：答不出來的題目拿掉，改補資料");
  }
  const numeric = /(\d+(?:\.\d+)?)\s*(cm|mm|公分|ml|毫升|kg|公斤|mAh|W|V|g|克|吋|寸|款|入|個|張|小時|分鐘)\b?/gi;
  for (const item of FIELDS) {
    const matches = [...item.text(input).matchAll(numeric)];
    const missing = matches.find((m) => !exactNumberInEvidence(m[1]!, input.evidenceText));
    if (missing) {
      add("number_not_in_evidence", item.field, "文案寫了「" + missing[0].replace(/\s+/g, "") + "」，但資料裡找不到 " + missing[1] + "：請確認");
      break;
    }
  }
  if (input.facts.requiresVoltage && !input.facts.voltage.trim()) {
    add("voltage_missing", "facts", "⚡ 插電商品沒有電壓資料：上架前確認台灣 110V 能不能用");
  }
  if (input.facts.taiwanRisks.some((risk) => /220\s*V/i.test(risk)) && !/220\s*V|110\s*V/i.test(input.descriptionText + stripTags(input.faqHtml))) {
    add("voltage_220", "facts", "⚡ 這件是 220V，文案沒有提醒台灣不能直接用");
  }
  for (const item of FIELDS) {
    if (!item.text(input).trim()) { add("empty_field", item.field, "「" + item.label + "」是空的"); break; }
  }
  return issues;
}
/** Highest-priority fixable issue decides the field; returns every issue on that field (for the rewrite prompt). */
export function pickAutoFixField(issues: CopyIssue[]): { field: CopyRegenField; issues: CopyIssue[] } | null {
  for (const code of AUTO_FIX_PRIORITY) {
    const hit = issues.find((issue) => issue.code === code && (COPY_REGEN_FIELDS as readonly string[]).includes(issue.field));
    if (hit) {
      const field = hit.field as CopyRegenField;
      return { field, issues: issues.filter((issue) => issue.field === field) };
    }
  }
  return null;
}
