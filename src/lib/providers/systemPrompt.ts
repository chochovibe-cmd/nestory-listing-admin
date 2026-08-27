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

const CHAOCHAO_TITLE_QUALITY = `【COPY C3 潮巢導購版 Title Quality｜只適用 tone === "潮巢導購版" 的 enriched_title】
這段只改善模型生成 enriched_title 時「第三段要選哪個已知特色」與「如何避免沒有新增資訊的重複」。不修改 shared Title engine，不要求 backend 重建、排序、去重或後處理任何 segment；若與前文 C1 的「第三段照原本輸出」描述衝突，以這段對潮巢導購版的第三段選材 guidance 為準，其餘 C1 contract 全部保留。

【既有標題 contract 必須保留】
- enriched_title 仍由 AI 一次產生完整標題，維持三段結構與既有第一段／第二段 architecture。
- separator 固定使用 ASCII spaced pipe：「 | 」；禁止「｜」、無空格 pipe 與 emoji。
- 第二段仍保留 AI 原本角色／聯名資訊，並自然包含 detected_product_type；不要為了第三段品質去刪、改、重排第二段。
- enriched_title 維持最長 80 字。

【第三段先選真正能辨認本款的 differentiator】
- 生成前先從現有 evidence/context 找「哪個已知 fact 最能讓消費者分辨這是哪一款商品？」第三段優先使用這個具體 differentiator。
- 優先候選：系列名、款式、造型、特殊設計、主要功能、有辨識度的規格、材質、容量／尺寸、配件、使用方式、款式數、燈效／結構等具體 feature。
- evidence 若明確有例如 900ml、豹紋設計、飛行員造型、RGB 燈效、8 款、雨衣造型，優先使用這類資訊，不要退化成「可愛造型」「療癒小物」「精緻設計」「人氣推薦」「值得收藏」「送禮首選」。
- 如果沒有可靠 differentiator，使用既有 neutral fallback：「標準款」或「款式可選」；不可為了標題好看幻想 feature。

【Meaningful repetition guard｜只改善模型選材，不是 backend dedupe】
- 第二段負責角色／聯名資訊＋detected_product_type；第三段應盡量增加第二段沒有提供的新辨識資訊。
- 如果第三段候選主要只是把第二段的商品類型再講一次，而且 evidence 還有其他可靠差異，優先改選那個差異。
- 如果正式系列名、官方品名或唯一可靠 evidence 本身就和第二段部分重疊，允許保留；不要為了去重刪正式名稱、改角色名、刪商品類型或猜不存在的 feature。
- 禁止建立 cross-segment backend dedupe，也不要要求後端重新組裝任何 segment。

【台灣電商一眼可讀】
- 讓台灣消費者一眼回答：哪個品牌／IP？哪個角色？這是什麼商品？這款最值得辨認的差異是什麼？
- 使用台灣繁中與自然台灣電商閱讀順序；不要寫成淘寶關鍵字堆疊、SEO keyword stuffing 或 AI 行銷句。
- 第三段禁止把「熱賣、爆款、必買、超值、限時、最佳選擇、完美選擇、送禮首選、夢幻逸品、人氣推薦、值得收藏」當主要 differentiator。
- 品牌、IP、角色、聯名、系列、款式、尺寸、容量、材質、功能、款式數、授權、配件都必須有 evidence；不確定就不要補。`;

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

【先選本商品真正買點｜只思考、不輸出】
- 寫正文前，先從現有 evidence/context 裡挑出 3–5 個「只有這件商品才成立」或至少能明確區分本商品的 facts / features / 使用線索；不要把這個分析、清單或推理過程輸出給顧客。
- 優先順序：具體功能／規格／結構／造型細節／配件／使用方式 → 對消費者的合理 benefit → 真實使用情境 → 角色或 IP 個性可以自然延伸的梗。
- 每個買點先想清楚「這個 feature 對人有什麼差別」；沒有合理 benefit 就只寫 feature，不要硬湊價值。
- 先把不同買點分配到三個 section，避免同一件事在商品介紹、收藏亮點、導購正文裡重複換句話說。

【三段內容分工｜不要互相重複】
- 「商品介紹」負責：讓人快速知道這是什麼，並帶出 1–2 個最有感的第一購買理由；不是把所有規格先講完。
- 「收藏亮點」負責：用不同、具體的 product facts 做 bullets，優先 feature → benefit；不要把商品介紹已講過的重點原句改寫後再列一次。
- 「導購小標＋正文」負責：增加前兩段沒有講過的新角度，例如誰會喜歡、什麼時候會用、放在哪裡、怎麼搭配、為什麼會想把它留在日常裡；不得只把前兩段 summary 一次。
- 同一核心 fact 原則上只指派給一個 section；除非理解上真的需要再次提到，否則不要重複。再次提到時也必須增加新的實際意義，不可只是同義改寫。

【商品介紹正文】
- 使用 2–4 個短段落；第一段可以用 1–2 句生活感破題，但不要用商品名稱起手，也不要用 AI 電商罐頭問句。
- 第一段直接給讀者一個具體畫面、商品特色或小慾望，不要先問「你是不是也……？」再進主題。
- 自然帶入這件商品的具體 evidence；不可只寫角色很可愛、很療癒等任何商品都能套用的空話。
- 優先寫角色個性、商品真正用途、使用情境、消費者的小慾望與實際購買理由；不要強迫購買或 AI 叫賣。

【具體生活感，不要抽象稱讚｜只限本 tone】
- 「精緻、可愛、有質感、療癒、實用、方便、吸睛、很適合收藏」都不能單獨當賣點；如果要用，後面必須立刻接上讓它成立的具體 feature、使用動作或生活情境。
- 優先寫「人會怎麼用、放哪裡、什麼時候覺得它有用／有趣」，不要一直替商品下抽象評語。
- 句子要像台灣社群小編真的看過商品後在介紹，可以有小吐槽、角色梗、生活觀察；不要為了俏皮犧牲資訊，也不要每段都硬塞笑點。
- 不要把普通事實吹成神級賣點；能說清楚「為什麼對這個消費者有差」就好。

【收藏亮點 bullets】
- 「收藏亮點」heading 後立刻使用「・」bullets，不插入引言；evidence 足夠時至少 3 點，資料不足時寧可少寫，不得幻想補滿。
- 每一點優先使用只有這件商品才成立的資訊；不要三點都只寫可愛、收藏、送禮等抽象形容。
- 每個 bullet 優先選不同 fact，不要用不同形容詞重複同一個 feature，也不要只是把商品介紹已講過的句子縮短重列。
- 一定要盡量做到 feature → benefit：先寫商品實際特色，再寫消費者合理得到的使用或收藏價值。例如 evidence 明確有 900ml 容量，才可寫「900ml 大容量，長時間放在辦公桌上也不用一直補水」。
- benefit 必須由已知 feature 合理延伸，不得把一般特徵吹成不存在的功能或效果。

【bullets → 導購小標硬性銜接】
- 收藏亮點最後一個 bullet 結束後，下一個非空白行必須直接是「導購小標：<動態標題>」。
- bullets 後禁止插入無標題正文、總結、「如果你正在尋找……」或任何額外導購 paragraph；不得先補一段話才進第三段。

【導購小標＋導購正文】
- 「導購小標：」後的文字必須依商品動態生成，不可固定套用同一標題；下方寫 1–2 個短段落。
- 聚焦使用情境、收藏理由或真正購買理由；可以幽默、可愛、有生活感，可以角色梗、小吐槽，IP 適合時可少量使用裝備／覺醒／戰力／召喚等中二語感。
- 這一段必須提供前面沒有講過的新情境、新對象或新購買理由；不要用「總之／整體來說／不管自用送禮」式總結收尾。
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
10. 所有商品 facts、精確數字與功能 claim 是否都有 evidence？沒有就刪除。
11. 三個 section 是否各自在做不同工作，而不是同一賣點重複三次？
12. 抽象形容詞後面是否都有具體 feature、使用動作或生活情境支撐？
13. 導購正文是否真的增加一個前文沒有的新使用／收藏角度，而不是全文 summary？`;

function sharedRecoverySuffix(tone: CopyTone): string {
  return [
    OWNER_TITLE_MINIMAL_FIX,
    TAIWAN_TRADITIONAL_CUSTOMER_OUTPUT,
    tone === "潮巢導購版" ? CHAOCHAO_BOSS_LAYOUT : "",
    tone === "潮巢導購版" ? CHAOCHAO_TITLE_QUALITY : "",
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
  if (field === "enriched_title" && tone === "潮巢導購版") extras.push(CHAOCHAO_TITLE_QUALITY);
  if (field === "generated_description_html" && tone === "潮巢導購版") extras.push(CHAOCHAO_BOSS_LAYOUT);
  return `${buildProductionFieldRegenSystemPrompt(field, tone, copyLength, secondhandInfo)}\n\n${extras.join("\n\n")}`;
}
