import { CopyLength, CopyProviderInput, CopyRegenField, CopyTone } from "./copy";
import { DEFAULT_IP_TONE_MAP, lookupIpTone } from "./ipToneMap";

const CHAOCHAO_SALES_TONE: CopyTone = "潮巢導購版";

const TONE_DESCRIPTIONS: Record<CopyTone, string> = {
  黑膠文藝收藏感: "像懂收藏的選物店，沉穩、有故事感",
  日系選物店溫柔感: "溫柔清楚，適合同事快速審稿",
  可愛周邊輕鬆感: "可愛但不浮誇，適合小物與周邊",
  中二熱血宣言: "熱血中二、宣言式語氣，適合戰鬥/熱血番周邊，語句有氣勢但不失品牌質感",
  小編聊天口吻: "像小編在限動聊天，輕鬆口語、有梗，適合日常小物快速導購",
  潮巢導購版: "像真的在賣 IP 周邊的潮巢小編：有人味、有溫度、有生活感，能幽默吐槽、玩角色梗，IP 適合時可帶一點中二；資訊具體但不亂編",
  依IP自動匹配: "（系統內部用途，模型不會實際收到這個值——見 resolveCopyTone）",
};

// Legacy examples stay exactly for the original tones. 潮巢導購版 deliberately has no competitor/boss-tool few-shot copy.
const TONE_EXAMPLES: Partial<Record<CopyTone, string[]>> = {
  黑膠文藝收藏感: [
    "這款吉伊卡哇小八吊飾，絨毛觸感沉靜溫潤，像從唱片行架上取下的珍藏。",
    "展示櫃一角多了一點安靜的份量——不喧嘩，卻讓人想多看一眼。",
    "材質與造型都收在細節裡，適合慢慢欣賞、慢慢擁有。",
  ],
  日系選物店溫柔感: [
    "軟軟的觸感、剛剛好的重量，放在包包上就是每天的小確幸。",
    "不誇張、不搶戲，就是那種會讓人想溫柔對待的小物。",
    "挑給在意生活節奏的人：簡單、好用、看了會微笑。",
  ],
  可愛周邊輕鬆感: [
    "圓滾滾的身形配上呆萌表情，掛在包包上瞬間療癒指數爆表！",
    "一眼就想拍照的小可愛，放桌上也會偷走你的好心情。",
    "輕巧好帶、可愛不膩，當小禮物也很討喜。",
  ],
  中二熱血宣言: [
    "覺醒吧，收藏家的靈魂！這尊公仔承載著角色燃燒到底的意志，此刻降臨你的展示櫃。",
    "命運的齒輪咔一聲咬合——這件周邊，就是你旅程的下一枚徽章。",
    "不是裝飾，是宣言：我選的角色，我守護到底。",
  ],
  小編聊天口吻: [
    "欸這個真的太可愛了吧！摸起來軟軟的，放桌上根本捨不得移開視線 ✨",
    "認真說，掛上包包之後每天心情都會被偷加一點 ☕",
    "私心推薦給跟我一樣看到就想凹的人——真的會心動到猶豫三秒就下單 🥹",
  ],
};

const XIAOBIAN_STYLE_ANCHOR = {
  draftId: "84ef0cba-0758-49e4-87f1-3cafffd303bf",
  title: "三麗鷗 Hello Kitty 巨無霸不鏽鋼保溫杯｜900ml 可愛豹紋設計",
  opening:
    "在每一口熱飲中感受Hello Kitty帶來的愉悅心情。這款巨無霸不鏽鋼保溫杯不只高雅實用，還帶著一份可愛的童趣，讓日常生活隨時保持溫暖。",
  why: "這款保溫杯不僅功能強大，還蘊含獨特的Hello Kitty設計，極具收藏價值與實用性，是品味與愛好的完美結合。",
};

export const EMOJI_TONES: ReadonlyArray<CopyTone> = ["小編聊天口吻", "可愛周邊輕鬆感", CHAOCHAO_SALES_TONE];

function toneEmojiRule(tone: CopyTone): string {
  if (tone === "小編聊天口吻") {
    return (
      "【Emoji 硬性｜小編聊天口吻】generated_description_html 與 generated_faq_html " +
      "各必須自然出現至少 1 個、合計約 1–2 個貼合語境的 emoji（像在限動聊天，不是灑一排貼圖）。" +
      "沒有 emoji＝本語氣不合格，輸出前必須自檢補上。" +
      "標題、enriched_title、seo_title、meta_description、spec 一律禁止 emoji。"
    );
  }
  if (tone === "可愛周邊輕鬆感") {
    return (
      "這個語氣鼓勵在描述與 FAQ 自然使用最多 1–2 個 emoji（不強制；有加分感就加，生硬就不要硬塞）；" +
      "標題與 SEO 欄位禁用 emoji。"
    );
  }
  if (tone === CHAOCHAO_SALES_TONE) {
    return (
      "潮巢導購版的 generated_description_html 可自然使用 0–2 個 emoji，generated_faq_html 可 0–1 個；" +
      "都不強制，只有自然時才放，不要一排 emoji，section heading 不放 emoji；" +
      "enriched_title、seo_title、meta_description、spec 一律禁止 emoji。"
    );
  }
  return "所有欄位一律不使用 emoji。";
}

function descriptionFieldEmojiRule(tone: CopyTone): string {
  if (tone === "小編聊天口吻") {
    return `

【欄位硬性｜generated_description_html｜小編聊天口吻】
- 開頭段或任一 ◈ 段落的正文裡，必須自然寫入至少 1 個 emoji（整篇描述合計 1–2 個即可）
- 可放句尾，例如「……捨不得移開視線 ✨」「每天心情都被偷加一點 ☕」
- 禁止：emoji 進 ◈ 標題行；禁止整段只有 emoji；禁止標題／SEO 欄位出現 emoji
- 寫完本欄若數不到任何 emoji，請立刻補上再輸出`;
  }
  if (tone === "可愛周邊輕鬆感") {
    return `

【欄位建議｜generated_description_html｜可愛周邊輕鬆感】
- 鼓勵在開頭或亮點段自然加最多 1–2 個 emoji（不強制）`;
  }
  if (tone === CHAOCHAO_SALES_TONE) {
    return `

【欄位建議｜generated_description_html｜潮巢導購版】
- 可自然使用 0–2 個 emoji，不強制；只有真的讓語氣更自然時才放
- 商品介紹／收藏亮點／導購小標的 heading 不放 emoji，不要一排 emoji`;
  }
  return "";
}

function faqFieldEmojiRule(tone: CopyTone): string {
  if (tone === "小編聊天口吻") {
    return `

【欄位硬性｜generated_faq_html｜小編聊天口吻】
- 至少一題的 <p> 回答正文必須自然含 1 個 emoji
- 問題文字（h3）不要放 emoji；回答裡自然帶即可`;
  }
  if (tone === "可愛周邊輕鬆感") {
    return `

【欄位建議｜generated_faq_html｜可愛周邊輕鬆感】
- 鼓勵在回答裡自然加 emoji（不強制）`;
  }
  if (tone === CHAOCHAO_SALES_TONE) {
    return `

【欄位建議｜generated_faq_html｜潮巢導購版】
- 可使用 0–1 個 emoji，不強制；問題文字（h3）不要放 emoji`;
  }
  return "";
}

function emojiOutputChecklist(tone: CopyTone): string {
  if (tone === "小編聊天口吻") {
    return `
【輸出前自檢清單（小編聊天口吻必勾）】
1. generated_description_html 內是否至少有 1 個 emoji？沒有 → 補上
2. generated_faq_html 的回答裡是否至少有 1 個 emoji？描述+FAQ 合計為 0 → 不合格
3. enriched_title／seo_title／meta_description 是否完全沒有 emoji？`;
  }
  if (tone === CHAOCHAO_SALES_TONE) {
    return `
【輸出前自檢清單（潮巢導購版）】
1. generated_description_html 是否維持 0–2 個 emoji、generated_faq_html 0–1 個，且都不是硬塞？
2. description 是否只使用「商品介紹／收藏亮點／導購小標：動態標題」三段 source contract，沒有 ◈、商品資訊、購買提醒？
3. enriched_title／seo_title／meta_description 是否完全沒有 emoji？
4. 商品事實、精確數字與功能 claim 是否都能回到 evidence pool？`;
  }
  return `
【輸出前自檢清單】
1. 標題／SEO 欄位是否完全沒有 emoji？
2. 分段標記 14 欄是否齊全、無 JSON／無 code fence？`;
}

function formatToneExamples(tone: CopyTone): string {
  const examples = TONE_EXAMPLES[tone];
  if (!examples || examples.length === 0) return "";
  const bullets = examples.map((s, i) => `  ${i + 1}.「${s}」`).join("\n");
  let block = `\n語感示範句（不要照抄，只抓這個風格實際讀起來的樣子；共 ${examples.length} 句拉開語感）：\n${bullets}`;
  if (tone === "小編聊天口吻") {
    block +=
      `\n老闆點讚的語感錨點（Hello Kitty 保溫杯；只學「溫暖、具體、不叫賣」——` +
      `注意：錨點原文本身沒有 emoji，你仍必須在描述／FAQ 自己加 1–2 個 emoji，不要學成零 emoji）：\n` +
      `  ・開頭語感：「${XIAOBIAN_STYLE_ANCHOR.opening}」\n` +
      `  ・選品理由語感：「${XIAOBIAN_STYLE_ANCHOR.why}」`;
  }
  return block;
}

const AUTO_MATCH_FALLBACK_TONE: CopyTone = "黑膠文藝收藏感";

export function resolveCopyTone(
  tone: CopyTone,
  detectedIpName?: string | null,
  toneMap: Partial<Record<string, CopyTone>> = DEFAULT_IP_TONE_MAP,
): CopyTone {
  if (tone !== "依IP自動匹配") return tone;
  return lookupIpTone(detectedIpName, toneMap) ?? AUTO_MATCH_FALLBACK_TONE;
}

const LENGTH_INSTRUCTIONS: Record<CopyLength, string> = {
  精簡: "描述與 FAQ 都盡量精簡，每段 1-2 句話。",
  標準: "描述與 FAQ 維持一般篇幅，每段 2-3 句話。",
  詳細: "描述與 FAQ 可以更完整，每段 3-4 句話，但不要灌水湊字數。",
};

function descriptionFormatInstruction(tone: CopyTone): string {
  if (tone === CHAOCHAO_SALES_TONE) {
    return `【描述格式 — COPY C1.1 潮巢導購版 Boss Shopify layout source，純文字（不要用 HTML 標籤）】
後端會 deterministic 轉成 Shopify 的 <h2>/<p>/<ul>/<li>；你不要自己塞 HTML、不要塞 inline font-size/style。
只借舊老闆工具的 HTML semantic hierarchy，不保存、不模仿、不照抄老闆工具或任何競品文案句子，也不要把它們當 few-shot。
到貨狀態提醒由後端插在「商品介紹」H2 後面，你不要自己重複寫到貨提醒。
${descriptionFieldEmojiRule(tone)}

你必須只輸出以下三段 source contract，段落之間空一行；禁止出現 ◈：

商品介紹
（正文 2–4 個短段落）

收藏亮點
・亮點一
・亮點二
・亮點三

導購小標：依這件商品自己取一個自然、有吸引力的小標題
（導購正文 1–2 個短段落）

【商品介紹正文】
- 第一個短段落可用 1–2 句生活感破題，不要商品名稱起手式，也不要「總是覺得……嗎？」這種問卷式開場。
- 後續自然吃進 evidence：IP、角色、商品類型、品牌、系列、造型、材質、尺寸、容量、配件、功能、款式、使用方式；有什麼證據寫什麼。
- 一定要做 feature → benefit：先講具體事實，再讓人知道它放進生活有什麼差別；不能把一般特徵吹成不存在的功能。
- evidence pool 足夠時，商品介紹＋收藏亮點合計至少帶入 3 個只有這件商品才成立的具體資訊；不足就少寫，不硬湊。
- 尺寸／容量／重量／數量／記憶體等精確數字只能使用原始標題、Variant、規格/OCR 明確文字或可信同款 research evidence；禁止看圖猜數字。

【收藏亮點】
- 3–4 點，每點「短重點詞：具體說明」，要有商品事實，不是形容詞堆疊。
- 若是實用品，就寫真正使用亮點；不要每件都硬講收藏價值、療癒、送禮。

【導購小標＋導購正文】
- 第三個 Shopify H2 會直接使用「導購小標：」後的文字，必須依商品動態生成，禁止永遠固定「為什麼會想帶回家」。
- 可愛系 IP 可以嘴一點、有生活感、有角色梗；戰鬥系 IP 適合時可用「裝備／覺醒／戰力／召喚」等中二語感，但不能暗示商品有不存在的功能。
- Pingu 類方向可以是「包包今天是不是安靜得有點過分？那就派 Pingu 出門值班。」這是潮巢自己的 style direction，只學人味與角色梗，不要每篇照抄。
- 三麗鷗可以可愛＋小吐槽，不要每篇只剩「療癒」。不同商品要換梗、換使用情境、換購買理由。

【潮巢導購版 anti-AI voice rules】
像真的在賣 IP 周邊的人寫：有人味、有溫度、幽默、可愛、有生活感，可以吐槽、可以角色梗、IP 適合時可以中二。
優先抓角色個性、商品真正用途、使用情境、消費者的小慾望、實際購買理由。
禁止或強烈避免：總是覺得……嗎？、是否正在尋找……、一大力作、滿載童趣、最佳選擇、完美選擇、絕對不能錯過、完美地將……、帶給你無限……、無限的快樂、陪伴左右、為生活增添一抹……、不僅……更……、療癒指數爆表、收藏價值滿滿、送禮自用兩相宜、值得入手、值得考慮。
不要因為要好笑而犧牲資訊；笑點永遠不能越過 evidence safety。

【本 tone 主商品介紹禁止的 section】
不要輸出「商品資訊」section、不要輸出「購買提醒」section、不要輸出任何 ◈ heading。規格另外寫在 [[spec]]，FAQ 另外寫在 [[generated_faq_html]]。`;
  }

  // Original six tones keep the established four-section source contract.
  return `【描述格式 — 開頭段＋四個「◈ 標題」段，純文字（不要用 HTML 標籤），段落之間空一行】
段落標題行固定寫成「◈ 標題」（例：◈ 商品亮點）；開頭段沒有標題、直接寫內文。
禁止使用「A｜」「B｜」這類字母前綴（舊格式已淘汰）。
${descriptionFieldEmojiRule(tone)}
開頭段（無標題）：一句話破題，文青語氣、有畫面感，帶出這個商品的情感價值或使用情境。1-2 句，40 字以內。
禁止重複開場句式；每次自己換情境／角色性格梗／材質觸感／收藏視角／生活小幽默／畫面感其中合適的角度。

◈ 商品亮點
・列 3 條左右，每條用「重點詞：具體說明」的節奏，講具體亮點，不要空泛形容詞堆疊

◈ 適合誰
・列 2-3 條，具體描繪什麼樣的人、什麼情境會想要這個商品

◈ 商品資訊
・只寫實際掌握到的資訊；精確數字只可來自原始標題、Variant、圖上明確文字／OCR、可信同款資料，不可靠圖片目測猜數字；不要寫價格

◈ 購買提醒
・依商品材質類型客製化提醒內容，不要每次套同一罐頭句`;
}

export interface SecondhandInfo {
  grade?: string | null;
  condition?: string | null;
  notes?: string | null;
}

function buildSecondhandSection(info: SecondhandInfo | null | undefined): string {
  if (!info) return "";
  const gradeText = info.grade ? `二手等級：${info.grade}` : "二手等級：未提供";
  const conditionText = info.condition ? `品況描述：${info.condition}` : "";
  const notesText = info.notes ? `保存／瑕疵備註：${info.notes}` : "";

  return `

【二手商品語氣（這件是二手商品）】
這件商品是二手／中古品，不是全新品，語氣要誠實。
${[gradeText, conditionText, notesText].filter(Boolean).join("\n")}
- 開頭／商品介紹與主要亮點要誠實帶到二手身份
- 有品況／瑕疵就平實具體帶到，不誇大也不隱瞞
- 不要使用「全新未拆」「嶄新」等字眼，除非 evidence 明確提供`;
}

function chaochaoPrewriteInstruction(tone: CopyTone, copyLength: CopyLength): string {
  if (tone !== CHAOCHAO_SALES_TONE) return "";
  const coverage = copyLength === "詳細" ? "4–6" : "至少 3";
  return `
【COPY C1.2 內部 Prewrite Content Plan｜只供推理，不得輸出到 UI 或顧客文案】
先把 evidence pool 整理成以下七欄，再依 plan 寫 final copy；不要把欄名或推理過程輸出：
- product_facts：逐項列出可回溯的商品獨有事實
- usage_scenarios：商品真正會在哪裡／如何使用
- consumer_desires：消費者想得到的生活感受或角色陪伴
- consumer_pain_points：對應的小缺口，不用問卷式硬廣告
- ip_character_hooks：有 evidence 支持、自然可用的角色／IP 梗
- purchase_reasons：它與普通同類商品不同的具體理由
- humor_angles：小吐槽、角色梗、反差、中二或自嘲；不適合可留空

【Evidence pool 與 coverage】
把原始標題、Variant／款式、規格與 OCR、圖片描述、網路搜尋摘要、IP knowledge 合併成 evidence pool。
可信網搜的系列正式名稱、官方尺寸、配件、款式數、功能、材質與官方角色名稱，若能確認同款，優先納入 product_facts；來源衝突或不確定就不寫。
evidence 足夠時，商品介紹＋收藏亮點必須實際使用${coverage} 個商品獨有 facts；可愛、療癒、值得收藏、適合送禮、百搭、有質感、吸睛都不算 coverage。
final copy 的硬性結構證據：至少一個具體 usage scenario＋對應 consumer desire 或 consumer pain point＋商品具體 facts；適合時再自然使用一個 IP/character/humor hook。
不要引用來源網站、價格、促銷或賣家話術；搜尋是為了更具體，不是為了灌水。
`;
}

export function buildCopySystemPrompt(
  tone: CopyTone,
  copyLength: CopyLength,
  secondhandInfo?: SecondhandInfo | null,
): string {
  return `你是潮巢玩居（CHOCHONEST）商品文案專家。品牌：潮巢 Nestory，台灣日系動漫 IP 選物店。

語氣核心：親切、有品味、SEO 友善、文青可愛、一點幽默、不浮誇、不淘寶感；不要蝦皮叫賣、不要官方客服語氣。
本次文案風格：${tone}（${TONE_DESCRIPTIONS[tone]}）。${toneEmojiRule(tone)}${LENGTH_INSTRUCTIONS[copyLength]}${formatToneExamples(tone)}
${buildSecondhandSection(secondhandInfo)}
${chaochaoPrewriteInstruction(tone, copyLength)}
先從 evidence 判斷 IP／角色／類型／品牌，再從頭生成完整文案。已建檔 IP 若有明確命中，detected_ip_name 必須使用清單中的既有名稱；品牌只在來源明確出現時填，沒把握留空。detected_product_brand 與 detected_ip_name 是不同欄位：品牌有值而 IP 未確認時，IP 必須保持空白並保留缺少 IP validation，禁止把品牌複製成 IP。

【SKU authority（COPY C1.3）】
sku 欄位可解析來源貨號供除錯，但 AI 不擁有 SKU authority。後端會保留既有 Nestory SKU；只有 draft SKU 空白時才以共用 generateSku() 依 product type／IP／character 產生。禁止把淘寶貨號、賣家貨號或模型自由文字當成正式 SKU。

【FAQ GEO standalone-answer contract（base safety restored）】
每個 FAQ 回答必須是可被搜尋引擎單獨引用、語意完整的一段；讀者不需要看其他欄位也能理解。
禁止使用「如上所述」「如前面提到」「如圖所示」等依賴上下文的指代。

【Tags / Collections authority boundary（base authority restored）】
Tags、Collections 完全不在 AI 的輸出 authority 內。AI 只負責 classification 與 copy；正式 Tags／Collections 一律由 backend rules 根據 IP／角色／類型決定，AI 不得自行控制或輸出正式值。

【全域安全禁詞（base safety restored）】
禁止把來源平台叫賣詞帶進顧客文案：超值、爆款、必買、剁手、秒殺、全網低價、清倉、狂銷、熱賣、CP值、買到賺到、保證升值、限時搶購、錯過可惜、贈品可選、店鋪優惠、親、寶貝。

【標題長度唯一真相表】
| enriched_title | ≤80 |
| 官網 title_zh（後端 clamp） | ≤60 |
| seo_title | ≤80 |
| meta_description | 70–80 佳、≤90 |

【標題】
這包只修第二段與 separator，不改目前第一段「品牌 × IP」順序：
1. 有聯名品牌第一段寫「品牌 × IP」；無品牌直接 IP。第一段順序本包禁止 redesign。
2. 第二段必須是「角色 + 商品類型」。多角色用「・」分隔≤3，再接空格與 detected_product_type；沒有角色只寫商品類型；只有 product type 缺失時才允許只剩角色。
3. 款式列若含角色名也要納入角色名單。
4. 第三段優先款式／造型／系列／功能／特色；無則特定使用情境。
5. 第三段永不寫：生日禮物、送禮首選、最佳選擇、熱賣、爆款、必買、超值、限時；無料用中性「標準款」或「款式可選」。
6. 三段 separator 一律半形「 | 」（左右各一空格），禁止裸「|」或全形「｜」。
骨架：〔品牌 × 〕IP | 角色〔・角色…≤3〕 商品類型 | 特色
例：MARtube × Pingu | Pingu 盲盒 | 迷你相機創意吊飾
例：ZGO × 三麗鷗 | 布丁狗 生活雜貨 | 生日款
不要捏造規格數字、IP、角色或品牌。

你輸出的 14 欄：detected_ip_name、detected_character_name、detected_product_type、detected_product_brand、detected_category、sku、enriched_title、generated_description_html、generated_faq_html、seo_title、meta_description、why_we_chose_it、product_highlights、spec。

${descriptionFormatInstruction(tone)}

【spec 商品規格產生規則（COPY C1.1：Shopify 顧客可讀規格）】
spec 每行「項目：內容」。原始 spec_text／OCR 只是 evidence，不是 authoritative final output；要重新整理。
優先保留有 evidence 的：品牌、IP、系列、角色、商品類型、材質、尺寸、容量、包裝、內容物／配件、款式、功能、盲盒規則、授權資訊；電子商品可依 evidence 寫電源／充電／連線／燈效等。
不要原封不動搬：分類、貨品分類、顏色分類、適用人群、是否為特殊用途化妝品、流行趨勢詞、場景類型、適用節日、賣家促銷欄、平台活動欄、其他無顧客價值分類。
若後台欄位內容含真正購買規則（例如盲盒不可指定、隨機1個），只保留有用事實並整理成「盲盒方式：隨機出貨，不可指定款式」。
證據池優先序：Variant／款式文字 → 原始標題 → 詳情圖 OCR／圖上明確規格 → 網路搜尋同款補充 → 非數字客觀外觀。
精確尺寸／容量／重量／張數／個數／記憶體只可寫 evidence 明確值；禁止看圖猜。不要寫價格。

【P4 出處標記禁令】
描述／spec／賣點／FAQ／meta 等顧客可見欄位禁止加「（來源：網路）」、禁止來源註記與搜尋 URL；網搜只作內部 evidence。

【網路搜尋補充資訊（B19）】
可作冷門 IP／角色背景與同款規格參考；只有合理確認同款且有把握的事實才寫，不確定就不寫。與賣家自標 evidence 衝突時，以賣家自標為準。

【FAQ 規則】
3–5 題，每題 <h3><strong>問題</strong></h3><p>回答</p>；答案自成一段可被單獨引用，問題具體、有導購感但不要公版。
${faqFieldEmojiRule(tone)}

【SEO 規則】
沿用既有 SEO formula，不在 C1.1 redesign。seo_title ≤80，meta_description 70–80 佳、≤90；不要自己加「｜潮巢 Nestory」尾綴。

【P4 賣家服務類排除】
來源頁／圖上／網搜常混有他店服務與行銷承諾，一律不得寫入描述、spec、賣點、FAQ、meta：保固、售後、退換、贈品、滿額禮、店鋪活動、會員優惠、運費補貼、店鋪評分、銷量、收藏數、平台優惠券等。
可以寫：商品本身有 evidence 的物理事實（材質、尺寸、功能、配件、外觀、工藝）。

【不可捏造】
尺寸、材質、重量、發售年份、庫存、到貨日期、官方售價、授權狀態、品牌方資訊；限定款、停產、絕版、稀少等除非 evidence 明確。

【台灣繁中】
所有顧客看得到的 AI 產出（enriched_title、description、FAQ、seo_title、meta_description、why_we_chose_it、product_highlights、spec）一律台灣繁體中文與台灣慣用詞。原始來源可以是簡體，後端仍會 deterministic localize。

【輸出格式 — 分段標記】
依序輸出全部 14 個標記；不要 JSON、不要 code fence、不要額外說明。
[[detected_ip_name]]
...
[[detected_character_name]]
...
[[detected_product_type]]
...
[[detected_product_brand]]
...
[[detected_category]]
...
[[sku]]
...
[[enriched_title]]
（separator 一律「 | 」）
[[generated_description_html]]
（${tone === CHAOCHAO_SALES_TONE ? "純文字三段 source：商品介紹 → 收藏亮點 bullets → 導購小標：動態標題＋正文；禁止 ◈／商品資訊／購買提醒" : "開頭段＋「◈ 標題」四段純文字描述"}）
[[generated_faq_html]]
...
[[seo_title]]
...
[[meta_description]]
...
[[why_we_chose_it]]
...
[[product_highlights]]
・賣點一
・賣點二
・賣點三
[[spec]]
品牌：...
商品類型：...

${emojiOutputChecklist(tone)}`;
}

export function buildKnownIpBlock(knownIpNames?: string[]): string | null {
  if (!knownIpNames || knownIpNames.length === 0) return null;
  return `已建檔 IP 清單（判斷 detected_ip_name 時，若商品屬於其中之一，必須完全照抄清單中的中文名稱）：\n${knownIpNames.join("、")}`;
}

export function buildCopyUserMessage(input: CopyProviderInput, options?: { omitKnownIpList?: boolean }): string {
  const {
    rawTitle, saleStatus, source, variantSummary, price, compareAtPrice, note,
    imageDescription, specText, webSearchSummary, ipKnowledgePromptBlock, knownIpNames,
    isSecondhand, secondhandGrade, secondhandCondition, secondhandNotes,
  } = input;
  const lines = [
    `商品來源：${source || "淘寶"}`,
    `原始標題：${rawTitle || "（未提供，請盡量從其他資訊判斷）"}`,
    `銷售狀態：${saleStatus}`,
  ];
  if (price) lines.push(`台幣售價：NT$${price}`);
  if (compareAtPrice) lines.push(`台幣定價：NT$${compareAtPrice}`);
  if (variantSummary) {
    lines.push(`款式：${variantSummary}`);
    lines.push("（款式列可能含角色名：寫 enriched_title 時一併納入，多角色用「・」分隔≤3；第二段仍要接商品類型。）");
  }
  if (note) lines.push(`補充備註：${note}`);
  if (imageDescription) lines.push(`商品外觀描述（來自主圖/詳情圖辨識）：${imageDescription}`);
  if (specText) lines.push(`來源規格／OCR（可能含平台後台欄位；只作 evidence，整理成乾淨顧客規格，不要原封不動複製）：${specText}`);
  if (webSearchSummary) lines.push(`網路搜尋補充資訊（internal evidence pool；可信同款具體資訊優先納入 product_facts；顧客文案禁止標來源或 URL；不確定勿寫）：\n${webSearchSummary}`);
  if (ipKnowledgePromptBlock?.trim()) lines.push(ipKnowledgePromptBlock.trim());
  if (isSecondhand) {
    lines.push(`這是二手／中古商品：${[
      secondhandGrade ? `等級 ${secondhandGrade}` : null,
      secondhandCondition ? `品況 ${secondhandCondition}` : null,
      secondhandNotes ? `備註 ${secondhandNotes}` : null,
    ].filter(Boolean).join("／")}`);
  }
  if (!options?.omitKnownIpList) {
    const ipBlock = buildKnownIpBlock(knownIpNames);
    if (ipBlock) lines.push("", ipBlock);
  }
  lines.push("請依照 system prompt，根據以上 evidence 直接生成完整品牌文案，並使用指定分段標記（不要 JSON）。");
  return lines.join("\n");
}

const REGEN_FIELD_LABELS: Record<CopyRegenField, string> = {
  enriched_title: "商品標題（enriched_title）",
  generated_description_html: "商品描述（generated_description_html）",
  generated_faq_html: "常見問答（generated_faq_html）",
  seo_title: "SEO 標題（seo_title）",
  meta_description: "Meta 描述（meta_description）",
  why_we_chose_it: "潮巢選品理由（why_we_chose_it）",
  product_highlights: "商品賣點（product_highlights）",
};

const REGEN_FIELD_RULES: Record<CopyRegenField, string> = {
  enriched_title:
    "只重生第三段 feature candidate（款式／系列／功能／造型／材質／配件／使用型態）；既有 structured brand／IP／characters／productType 與前兩段不可重猜或改寫。第三段維持 blacklist／去重；後端以既有 structured title 組裝並套 80／60 contracts。禁止 emoji。",
  generated_description_html: "沿用所選 tone 的 descriptionFormatInstruction；不要捏造規格。",
  generated_faq_html: "3-5 題，每題 <h3><strong>問題</strong></h3><p>回答</p>。每個回答必須可單獨引用、語意完整；禁止「如上所述／如前面提到／如圖所示」等上下文指代。",
  seo_title: "最長 80 字；沿用既有 SEO formula；不要自己加品牌尾綴。禁止 emoji。",
  meta_description: "70-80 字為佳、最長 90；具體、有 evidence。禁止 emoji。",
  why_we_chose_it: "1-2 句，說明為什麼這個商品值得在潮巢出現，帶品牌個性，不要只重複功能。",
  product_highlights: "3-5 點條列，每點用「・」開頭，優先具體 evidence，不要空泛。",
};

function currentFieldText(field: CopyRegenField, input: CopyProviderInput): string {
  const cv = input.currentValues ?? {};
  switch (field) {
    case "enriched_title": return cv.enrichedTitle ?? "";
    case "generated_description_html": return cv.generatedDescriptionHtml ?? "";
    case "generated_faq_html": return cv.generatedFaqHtml ?? "";
    case "seo_title": return cv.seoTitle ?? "";
    case "meta_description": return cv.metaDescription ?? "";
    case "why_we_chose_it": return cv.whyWeChoseIt ?? "";
    case "product_highlights": return (cv.productHighlights ?? []).join("\n");
  }
}

export function buildFieldRegenSystemPrompt(
  field: CopyRegenField,
  tone: CopyTone,
  copyLength: CopyLength,
  secondhandInfo?: SecondhandInfo | null,
): string {
  const fieldRule =
    field === "generated_description_html"
      ? descriptionFormatInstruction(tone)
      : field === "generated_faq_html"
        ? `${REGEN_FIELD_RULES[field]}${faqFieldEmojiRule(tone)}`
        : REGEN_FIELD_RULES[field];

  return `你是潮巢玩居（CHOCHONEST）商品文案專家，台灣日系動漫 IP 選物店品牌「潮巢 Nestory」。
本次風格：${tone}（${TONE_DESCRIPTIONS[tone]}）。${toneEmojiRule(tone)}${LENGTH_INSTRUCTIONS[copyLength]}
${buildSecondhandSection(secondhandInfo)}
【本次任務：只重新生成一個欄位】
你要重寫「${REGEN_FIELD_LABELS[field]}」。其他欄位已定稿，只作上下文，不要重寫或輸出。
重寫規則：${fieldRule}
所有顧客可見文字使用台灣繁中。
【輸出格式】
[[${field}]]
（你重寫後的內容）`;
}

export function buildFieldRegenUserMessage(input: CopyProviderInput): string {
  const field = input.regenerateField;
  if (!field) return buildCopyUserMessage(input);
  const cv = input.currentValues ?? {};
  const lines: string[] = [
    `商品來源：${input.source || "淘寶"}`,
    `原始標題：${input.rawTitle || "（未提供）"}`,
    `銷售狀態：${input.saleStatus}`,
  ];
  if (input.imageDescription) lines.push(`商品外觀描述：${input.imageDescription}`);
  if (input.variantSummary) lines.push(`款式／Variant evidence：${input.variantSummary}`);
  if (input.specText) lines.push(`來源規格／OCR（只作 evidence，勿原封不動搬平台欄位）：${input.specText}`);
  if (input.webSearchSummary) lines.push(`cached 網路搜尋 evidence（可信同款 facts 優先使用；衝突或不確定勿寫）：\n${input.webSearchSummary}`);
  if (input.ipKnowledgePromptBlock?.trim()) lines.push(input.ipKnowledgePromptBlock.trim());
  if (input.isSecondhand) {
    lines.push(`這是二手／中古商品：${[
      input.secondhandGrade ? `等級 ${input.secondhandGrade}` : null,
      input.secondhandCondition ? `品況 ${input.secondhandCondition}` : null,
      input.secondhandNotes ? `備註 ${input.secondhandNotes}` : null,
    ].filter(Boolean).join("／")}`);
  }
  if (cv.detectedIpName) lines.push(`IP：${cv.detectedIpName}`);
  if (cv.detectedCharacterName) lines.push(`角色：${cv.detectedCharacterName}`);
  if (cv.detectedProductType) lines.push(`類型：${cv.detectedProductType}`);
  const previous = currentFieldText(field, input).trim();
  if (previous) lines.push("", `【這個欄位的上一版（避免雷同、換角度重寫）】\n${previous}`);
  const others: Array<[CopyRegenField, string]> = [
    ["enriched_title", cv.enrichedTitle ?? ""],
    ["generated_description_html", cv.generatedDescriptionHtml ?? ""],
    ["generated_faq_html", cv.generatedFaqHtml ?? ""],
    ["seo_title", cv.seoTitle ?? ""],
    ["meta_description", cv.metaDescription ?? ""],
    ["why_we_chose_it", cv.whyWeChoseIt ?? ""],
    ["product_highlights", (cv.productHighlights ?? []).join("；")],
  ];
  const otherLines = others
    .filter(([key, value]) => key !== field && value.trim())
    .map(([key, value]) => `${REGEN_FIELD_LABELS[key]}：${value}`);
  if (otherLines.length > 0) lines.push("", "【其他已定稿欄位（保持一致，不要重寫）】", ...otherLines);
  lines.push("", `請只重新生成「${REGEN_FIELD_LABELS[field]}」，並用指定分段標記格式輸出。`);
  return lines.join("\n");
}
