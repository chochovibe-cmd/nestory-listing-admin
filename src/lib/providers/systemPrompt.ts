import { CopyLength, CopyRegenField, CopyTone } from "./copy";
import {
  EMOJI_TONES,
  buildCopySystemPrompt as buildProductionCopySystemPrompt,
  buildCopyUserMessage,
  buildFieldRegenSystemPrompt as buildProductionFieldRegenSystemPrompt,
  buildFieldRegenUserMessage,
  buildKnownIpBlock,
  resolveCopyTone,
} from "./systemPromptBase";
export type { SecondhandInfo } from "./systemPromptBase";

// R0A direct provider context stays delegated unchanged to the Production-derived base:
// rawTitle, variantSummary, imageDescription, specText, webSearchSummary, ipKnowledgePromptBlock.
export {
  EMOJI_TONES,
  buildCopyUserMessage,
  buildFieldRegenUserMessage,
  buildKnownIpBlock,
  resolveCopyTone,
};

const OWNER_TITLE_MINIMAL_FIX = `【COPY C1 Owner 標題最小修正】
- enriched_title 仍由 AI 一次產生完整標題，不改 Production 的標題內容架構、特色選擇或第三段寫法。
- 三段 separator 一律使用 ASCII pipe 並固定為「 | 」；不要輸出「｜」或無空格的 pipe。
- 第二段保留 AI 原本角色／聯名文字；只要把 detected_product_type 自然附加在第二段末尾。不要由後端或模型重建、排序第二段。
- 第三段照原本完整輸出；即使和第二段有部分字詞重複，也不要為了 cross-segment dedupe 刪字、改寫或重排。`;

const TAIWAN_TRADITIONAL_CUSTOMER_OUTPUT = `【顧客可見語言】
所有顧客可見 AI 產出使用台灣繁中與台灣慣用詞；包含 enriched_title、generated_description_html、generated_faq_html、seo_title、meta_description、why_we_chose_it、product_highlights、provider-generated spec。原始 taobao_title、original_title、raw OCR、raw web cache 保留原文，不改寫來源資料。`;

const CHAOCHAO_BOSS_LAYOUT = `【潮巢導購版 Boss description hierarchy｜此段優先於前文任何舊潮巢 description layout】
只輸出以下純文字三段 source contract，段落之間空一行；不要自己輸出 HTML，也禁止 ◈：

商品介紹
（正文 2–4 個短段落；可先用 1–2 句生活感破題，再自然吃進具體商品 evidence）

收藏亮點
・亮點一
・亮點二
・亮點三

導購小標：依這件商品自己取一個自然、有吸引力的小標題
（導購正文 1–2 個短段落）

後端會在 Shopify boundary deterministic 轉為 <h2>/<p>/<ul>/<li>，到貨狀態提醒也由後端插入。主 description 不要另寫「商品資訊」「購買提醒」，不要重複到貨提醒。
語氣維持潮巢：幽默、可愛、有生活感、有人味；可以角色梗或小吐槽，適合時少量中二。資訊與精確數字只能依 evidence，不得為了文筆補寫不存在的事實。`;

function sharedRecoverySuffix(tone: CopyTone): string {
  return [
    OWNER_TITLE_MINIMAL_FIX,
    TAIWAN_TRADITIONAL_CUSTOMER_OUTPUT,
    tone === "潮巢導購版" ? CHAOCHAO_BOSS_LAYOUT : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildCopySystemPrompt(
  tone: CopyTone,
  copyLength: CopyLength,
  secondhandInfo?: Parameters<typeof buildProductionCopySystemPrompt>[2],
): string {
  return `${buildProductionCopySystemPrompt(tone, copyLength, secondhandInfo)}\n\n${sharedRecoverySuffix(tone)}`;
}

export function buildFieldRegenSystemPrompt(
  field: CopyRegenField,
  tone: CopyTone,
  copyLength: CopyLength,
  secondhandInfo?: Parameters<typeof buildProductionFieldRegenSystemPrompt>[3],
): string {
  const extras = [TAIWAN_TRADITIONAL_CUSTOMER_OUTPUT];
  if (field === "enriched_title") extras.push(OWNER_TITLE_MINIMAL_FIX);
  if (field === "generated_description_html" && tone === "潮巢導購版") extras.push(CHAOCHAO_BOSS_LAYOUT);
  return `${buildProductionFieldRegenSystemPrompt(field, tone, copyLength, secondhandInfo)}\n\n${extras.join("\n\n")}`;
}
