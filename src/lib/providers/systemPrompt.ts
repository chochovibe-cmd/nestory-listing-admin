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

const CHAOCHAO_BOSS_LAYOUT = `【潮巢導購版 Boss description hierarchy｜只適用 tone === "潮巢導購版"，且優先於前文任何舊潮巢 description layout】
generated_description_html 只輸出純文字，不輸出 HTML；第一行固定且只能是「商品介紹」，前面不得加任何開場標題、符號或正文。
整篇只能使用以下三個 section heading，段落之間正常空一行；括號內是寫作規則，不要照抄到輸出：

商品介紹
（正文 2–4 個短段落）

收藏亮點
・亮點一
・亮點二
・亮點三

導購小標：依這件商品動態產生自然、有吸引力的小標題
（導購正文 1–2 個短段落）

【商品介紹正文】
- 使用 2–4 個短段落；第一段可以用 1–2 句生活感破題，但不要用商品名稱起手，也不要用 AI 電商罐頭問句。
- 自然帶入這件商品的具體 evidence；不可只寫角色很可愛、很療癒等任何商品都能套用的空話。
- 優先寫角色個性、商品真正用途、使用情境、消費者的小慾望與實際購買理由；不要強迫購買或 AI 叫賣。

【收藏亮點 bullets】
- 「收藏亮點」heading 後立刻使用「・」bullets，不插入引言；evidence 足夠時至少 3 點，資料不足時寧可少寫，不得幻想補滿。
- 每一點優先使用只有這件商品才成立的資訊；不要三點都只寫可愛、收藏、送禮等抽象形容。
- 一定要盡量做到 feature → benefit：先寫商品實際特色，再寫消費者合理得到的使用或收藏價值。例如 evidence 明確有 900ml 容量，才可寫「900ml 大容量，長時間放在辦公桌上也不用一直補水」。
- benefit 必須由已知 feature 合理延伸，不得把一般特徵吹成不存在的功能或效果。

【bullets → 導購小標硬性銜接】
- 收藏亮點最後一個 bullet 結束後，下一個非空白行必須直接是「導購小標：<動態標題>」。
- bullets 後禁止插入無標題正文、總結、「如果你正在尋找……」或任何額外導購 paragraph；不得先補一段話才進第三段。

【導購小標＋導購正文】
- 「導購小標：」後的文字必須依商品動態生成，不可固定套用同一標題；下方寫 1–2 個短段落。
- 聚焦使用情境、收藏理由或真正購買理由；可以幽默、可愛、有生活感，可以角色梗、小吐槽，IP 適合時可少量使用裝備／覺醒／戰力／召喚等中二語感。
- 像真的潮巢小編在介紹這件商品，不要像 AI 在寫萬用電商模板；幽默不能犧牲資訊或越過 evidence safety。

【潮巢導購版 anti-AI boilerplate｜只限本 tone】
強烈避免：總是覺得……嗎？、是否正在尋找……、每天都在尋找……嗎？、或許是你的解答、一大力作、滿載童趣、最佳選擇、完美選擇、完美良伴、夢幻逸品、絕對不能錯過、完美地將……、帶給你無限……、無限的快樂、陪伴左右、為生活增添一抹……、不僅……更……、療癒指數爆表、收藏價值滿滿、送禮自用兩相宜、值得入手、值得考慮。

【evidence safety｜只限本 tone 的加強提醒】
- 精確尺寸、材質、容量、款式數、功能、授權、配件與特殊 claim，只能來自現有 evidence/context；不知道就不要編，也不得看圖猜精確數字。
- evidence 足夠時，商品介紹＋收藏亮點合計至少自然使用 3 個本商品專屬 facts；evidence 不足時寧可少寫、少列 bullet，也不要幻想補齊。

【本 tone 主 description 禁止輸出】
禁止 ◈、商品資訊、購買提醒與重複到貨提醒。後端既有 formatter 與 sale-status 行為會自行處理 HTML hierarchy 與到貨狀態，不要在 source 重複生成。

【潮巢導購版輸出前自檢】
1. 第一行是不是「商品介紹」？
2. 是否只有「商品介紹」「收藏亮點」「導購小標：動態標題」三段 hierarchy？
3. 「收藏亮點」下方是不是直接使用「・」bullets？
4. bullets 後是否直接進「導購小標：」，中間沒有正文？
5. 是否沒有任何無標題插入段落？
6. 是否完全沒有 ◈？
7. 是否沒有「商品資訊」section？
8. 是否沒有「購買提醒」section或重複到貨提醒？
9. 是否避開上述 anti-AI boilerplate，讀起來像真的潮巢小編？
10. 所有商品 facts、精確數字與功能 claim 是否都有 evidence？沒有就刪除。`;

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
