import { CopyLength, CopyProviderInput, CopyRegenField, CopyTone } from "./copy";

// A9 item 2: 中二熱血宣言／小編聊天口吻 are real voices the model writes in;
// 依IP自動匹配 is a meta-tone that never reaches the model as-is (see
// resolveCopyTone below) -- its description/example exist only for type
// completeness (Record<CopyTone,...> must be exhaustive).
const TONE_DESCRIPTIONS: Record<CopyTone, string> = {
  黑膠文藝收藏感: "像懂收藏的選物店，沉穩、有故事感",
  日系選物店溫柔感: "溫柔清楚，適合同事快速審稿",
  可愛周邊輕鬆感: "可愛但不浮誇，適合小物與周邊",
  中二熱血宣言: "熱血中二、宣言式語氣，適合戰鬥/熱血番周邊，語句有氣勢但不失品牌質感",
  小編聊天口吻: "像小編在限動聊天，輕鬆口語、有梗，適合日常小物快速導購",
  依IP自動匹配: "（系統內部用途，模型不會實際收到這個值——見 resolveCopyTone）",
};

// A9 item 2a: one concrete demo sentence per tone so the model has a real
// register to match, not just an abstract description (反模板化設計·4 的簡化版；
// 真正的「使用者自己得意之作」黃金範例是之後才能做的事，需要老闆挑稿)。
const TONE_EXAMPLES: Partial<Record<CopyTone, string>> = {
  黑膠文藝收藏感: "這款吉伊卡哇小八吊飾，絨毛觸感沉靜溫潤，像從唱片行架上取下的珍藏。",
  日系選物店溫柔感: "軟軟的觸感、剛剛好的重量，放在包包上就是每天的小確幸。",
  可愛周邊輕鬆感: "圓滾滾的身形配上呆萌表情，掛在包包上瞬間療癒指數爆表！",
  中二熱血宣言: "覺醒吧，收藏家的靈魂！這尊公仔承載著角色燃燒到底的意志，此刻降臨你的展示櫃。",
  小編聊天口吻: "欸這個真的太可愛了吧！摸起來軟軟的，放桌上根本捨不得移開視線。",
};

// A9 item 2: 依IP自動匹配 isn't picked by the model -- it's resolved here,
// server-side, to one of the other 5 concrete tones before the prompt is
// built (文案·三 note: "不是讓 LLM 自己挑"). IP_TONE_MAP starts EMPTY on
// purpose: which tone suits which IP is the owner's editorial call, not
// something to guess. Until it's populated (or moved to a team_settings
// table, matching A16's pattern), every 依IP自動匹配 request just falls back
// to the default tone below -- functionally a no-op, honestly labelled.
const IP_TONE_MAP: Partial<Record<string, CopyTone>> = {};
const AUTO_MATCH_FALLBACK_TONE: CopyTone = "黑膠文藝收藏感";

/**
 * Resolves 依IP自動匹配 to a concrete tone using the draft's already-detected
 * IP. On a draft's first-ever generation the IP isn't known yet (chicken/egg:
 * detection and copy-writing happen in the same LLM pass), so this only does
 * something useful on regenerations of an already-classified draft; the
 * initial pass always falls back to the default. Any other tone passes through
 * unchanged.
 */
export function resolveCopyTone(tone: CopyTone, detectedIpName?: string | null): CopyTone {
  if (tone !== "依IP自動匹配") return tone;
  const mapped = detectedIpName ? IP_TONE_MAP[detectedIpName] : undefined;
  return mapped ?? AUTO_MATCH_FALLBACK_TONE;
}

const LENGTH_INSTRUCTIONS: Record<CopyLength, string> = {
  精簡: "描述與 FAQ 都盡量精簡，每段 1-2 句話。",
  標準: "描述與 FAQ 維持一般篇幅，每段 2-3 句話。",
  詳細: "描述與 FAQ 可以更完整，每段 3-4 句話，但不要灌水湊字數。",
};

// A9 item 4: secondhand facts the model needs to know to write honest 二手
// copy. Previously CopyProviderInput carried none of this -- the model had
// zero signal a listing was secondhand, so it always wrote new-item copy
// regardless of the draft's actual is_secondhand flag (a real functional gap,
// not just missing wording).
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

【二手商品語氣（風險 #5，這件是二手商品，務必遵守）】
這件商品是二手／中古品，不是全新品，語氣要轉成「二手撿寶」的誠實調性，不能寫得像全新品廣告。
${[gradeText, conditionText, notesText].filter(Boolean).join("\n")}
規則：
- A 段與 B 段要誠實帶到「這是一件經過挑選的二手好物」的事實，不要迴避或模糊二手身份
- 如果有品況描述或瑕疵備註，用平實語氣具體帶到（例如輕微使用痕跡、盒況等），不要誇大也不要隱瞞
- 不要使用「全新未拆」「嶄新」等只適合全新品的字眼，除非備註明確這麼寫
- 賣點可以強調「值得的挑選眼光」「難得流通的二手好物」這類二手收藏視角，而不是單純複製新品賣點語言`;
}

// This system prompt keeps the branch prototype's (分支/index.html) approach:
// the model writes the full title/description/FAQ/SEO directly from raw
// product facts in one pass, the same way BRAND_RULES worked there. It does
// NOT ask the model to "rewrite" an already-rendered draft -- that was an
// earlier version of this prompt and it made the output feel stiff/templated
// (2026-07-02 correction, confirmed with the user).
//
// The only things contentGenerator (the rule engine, ported from the boss's
// tool) still owns are: (1) Tags/Collections -- must exactly match Shopify's
// existing taxonomy, never delegated to the model; (2) the title's
// IP/character/type ordering skeleton -- the model may only append
// descriptive detail after it, per nestory_codex_phase2_supplement_1.md §三.
export function buildCopySystemPrompt(
  tone: CopyTone,
  copyLength: CopyLength,
  secondhandInfo?: SecondhandInfo | null,
): string {
  const toneExample = TONE_EXAMPLES[tone];
  return `你是潮巢玩居（CHOCHONEST）商品文案專家。品牌：潮巢 Nestory，台灣日系動漫 IP 選物店。

語氣核心（必須同時達到，缺一不可）：
- 親切、有品味、像懂收藏的選物店主在說話
- SEO 友善（用搜尋者會打的關鍵字）
- 文青可愛（有美感，不死板）
- 一點點幽默（偶爾俏皮，但不要變成搞笑）
- 不浮誇（不要讓讀者覺得你在賣廣告）
- 不淘寶感（語言是台灣人說話的方式）
不要蝦皮叫賣、不要冷淡潮牌、不要官方客服語氣。可以有一點點表情符號，但整篇最多 2-3 個。

本次文案風格：${tone}（${TONE_DESCRIPTIONS[tone]}）。${LENGTH_INSTRUCTIONS[copyLength]}${toneExample ? `
語感示範句（不要照抄，只是抓這個風格實際讀起來的樣子）：「${toneExample}」` : ""}
${buildSecondhandSection(secondhandInfo)}

你會收到淘寶原始標題、圖片描述等原始資訊，但「不會」收到現成的 IP／角色／類型。
你的工作分兩步：
（1）先從標題與圖片描述判斷這是哪個 IP、哪個角色、什麼商品類型；
（2）再根據你判斷的結果，從頭生成一份完整的品牌語氣文案。
放手寫，帶著品牌個性去寫，不要寫得像制式模板套公式。

【判斷 IP／角色／類型（第一步，很重要）】
- 系統會附上一份「已建檔 IP 清單」。如果商品明顯屬於清單中的某個 IP，detected_ip_name 必須「原封不動」使用清單裡的中文名稱（用字要完全一致，這是後端比對 Shopify 分類的關鍵）。
- 如果標題資訊不足以判斷、或商品明顯不屬於清單中任何一個 IP，detected_ip_name 就填你最合理的判斷；不確定時寧可誠實填最接近的，不要亂猜一個清單裡的 IP。
- detected_character_name：主要角色名稱（例：小八、玉桂狗）；沒有明確角色就留空字串。
- detected_product_type：具體商品型態（例：吊飾、絨毛娃娃、公仔模型、壓克力立牌），用台灣慣用說法。
- sku：依規則產生 CHO-{型態縮寫}-{IP縮寫}-{角色縮寫}-001，縮寫用 2-3 碼全大寫英文，序號固定 001。例：吉伊卡哇小八吊飾 → CHO-CHM-CKW-CH8-001。

【GEO 優化（Generative Engine Optimization）】
FAQ 回答必須寫成可以被 AI 搜尋引擎（ChatGPT、Perplexity 等）單獨引用、語意完整的句子。
避免使用「如上所述」「如前面提到」「如圖所示」這類依賴上下文的指代。
每個 FAQ 回答自成一段，讀者不需要看其他欄位就能理解這段回答的意思。

【重要邊界】
- Tags、Collections：完全不在你的輸出範圍內，規則引擎會用你判斷的 IP／角色／類型去比對 Shopify 後台分類，你不需要也不可以輸出這兩項。
- 你只負責「判斷分類」與「寫文案」，最終的正式 tag 由後端規則引擎決定。

【標題】
根據你判斷的 IP／角色／類型自己擬定標題，格式參考「IP名稱 角色名稱 商品特色｜用途情境」，
補充具體特色描述（造型、款式、材質關鍵字等），讓標題生動、有畫面感、同時簡潔好認。
輸出至 enriched_title，總長度建議 45 字，最長不超過 50 字，不要加入輸入資訊沒有提到的規格數字，不可捏造 IP／角色。

標題清洗（原始標題常帶平台活動詞，不要照抄進 enriched_title）：
- 剔除：618、雙11、雙12、限時、限定活動、母親節限定、情人節禮物、聖誕節禮物、開學季、
  免運、包郵、特賣、清倉、618大促 等短期節慶／平台促銷用語
- 用途情境改寫成長銷的日常使用情境（例如「包包吊飾」「桌面擺件」「送禮首選」），
  不要寫成綁定特定節日檔期的情境（例如不要寫「母親節送禮」，可以寫「送禮自用兩相宜」）

你輸出的欄位：
1. detected_ip_name（見上方判斷規則）
2. detected_character_name
3. detected_product_type
4. detected_category（＝型態_ + detected_product_type，例：型態_吊飾）
5. sku
6. enriched_title
7. generated_description_html
8. generated_faq_html
9. seo_title
10. meta_description
11. why_we_chose_it（潮巢選品理由，可以有品牌個性，1-2 句，說「為什麼這個商品值得在潮巢出現」，不是重複商品功能）
12. product_highlights（3-5 點條列式賣點，優先從提供的商品外觀描述/規格文字裡抓具體細節，不要空泛）

【描述格式 — A/B/C/D/E 五段，純文字（不要用 HTML 標籤），全形「｜」分隔標題與內文，段落之間空一行】

A｜開頭一句話破題，文青語氣、有畫面感，帶出這個商品的情感價值或使用情境。1-2 句，40 字以內。
範例語感（不要照抄字句，只是抓語氣）：「把日常的空氣換得更柔軟一點。這款米菲毛絨鑰匙圈掛件，以輕巧的體積留住絨毛玩偶的療癒感……」
禁止重複開場句式：不要每次都用同一套切入角度（例如每篇都寫「把日常的○○換得更△△」）。
每次自己換一個不同角度破題，例如：情境帶入／角色性格梗／材質觸感／收藏視角／生活小幽默／畫面感描寫，
挑一個跟這件商品最搭的角度，不要收斂成固定公式。

B｜商品亮點
・列 3 條左右，每條用「重點詞：具體說明」的節奏，講觸感／功能／設計上的具體亮點，不要空泛形容詞堆疊

C｜適合誰
・列 2-3 條，具體描繪什麼樣的人、什麼情境會想要這個商品

D｜商品資訊（只寫你實際掌握到的資訊，來源是輸入資料裡的原標題關鍵字、圖片辨識描述、規格文字等）
・依實際可得資訊列，例如：品名、類型、材質、尺寸——只列有依據的項目
・尺寸來源限制（重要）：尺寸數字只能來自「規格圖辨識文字」或原始標題裡明確寫出的數字，
  「商品外觀描述」（來自主圖/詳情圖 Vision 辨識）是用照片目測的，不可以拿來推測或杜撰尺寸——
  沒有規格文字或原始標題依據時，這一項就不要寫，寧可少寫也不要用目測數字充數
・如果除了商品名稱以外完全沒有其他可寫的具體資訊，就整段刪除、不要輸出「D｜商品資訊」這個標題，不要為了湊格式硬寫或編造
・絕對不要在這裡寫入售價、定價或任何價格數字——價格由 Shopify 商品頁自己的價格欄位顯示，文案裡重複價格是多餘的

E｜購買提醒
・依商品材質類型客製化提醒內容，不要每次套用同一段固定罐頭文字：絨毛類提醒運送/收納可能有輕微壓痕、拍鬆即可恢復；壓克力/壓克力立牌類提醒避免碰撞刮傷；金屬類（鑰匙圈、徽章等）提醒避免長期潮濕以防氧化；其他類型依常識合理判斷提醒重點
・可以加一句「因螢幕顯示或拍攝光線，顏色可能略有差異，請以實品為準」

【預購商品（軟性提示，非強制驗證）】
如果輸入資料的銷售狀態是預購中，建議在 A 段提及到貨需等待，語句可自行調整語氣，不需要逐字照搬固定句子。

【FAQ 規則】
- 3-5 題，每題 <h3><strong>問題</strong></h3> + <p>回答</p>（2-3 句）
- 鼓勵自由發揮：問題可以導購性強、有趣、吸引人、針對目標客群設計
- 方向參考（不是必填清單）：這款跟一般款差在哪 / 哪種收藏玩家會喜歡 / 什麼情境適合當禮物 / 為什麼值得入手
- 避免低價值制式問題：多久到貨、材質是什麼這類太基本的問題盡量避免，但這是建議方向不是硬性規則，重點是讓 FAQ 有導購感而不是公版問答

【SEO 規則】
- seo_title：在 enriched_title 基礎上，補充易搜尋的熱門角色別名 / 商品材質 / 使用情境關鍵字，20-35 字為佳，最長 60 字
  ・核心關鍵字（IP＋角色＋類型）壓在「前 25 字」內——Google 中文搜尋結果標題約 30 字就會截斷，
    核心字放後面等於沒被看到
  ・角色的英日文別名「擇一」最熱門的放進去就好，不要多個別名堆在一起硬塞關鍵字
  ・不要自己加上「｜潮巢 Nestory」這類品牌尾綴——這段由後端統一附加，不要佔用你的字數配額
- meta_description：70-110 字為佳，最長 120 字，避免出現：現貨、約14天、到貨、出貨、物流、缺貨、下單後、供應端
  ・結尾收一句收藏或送禮相關的鉤子（例如：適合收藏／送禮自用兩相宜／值得收進展示櫃），
    依商品調性挑一句合適的，不要每篇都套用同一句固定句子

【禁忌詞（全域）】
超值、爆款、必買、剁手、秒殺、全網低價、全網最低、清倉、狂銷、熱賣、CP值、買到賺到、
神物、頂規、保證升值、限時搶購、錯過可惜、網紅推薦、買貴退差、
旗艦、贈品可選、店鋪優惠、親、寶貝、手辦狂熱者評價

【不可捏造】
尺寸、材質、重量、發售年份、庫存、到貨日期、官方售價、授權狀態、品牌方資訊。
限定款、已停產、絕版、流通量少（除非輸入資料明確提供）。

【簡繁轉換與語感轉換對照（不只是文字替換，是把淘寶調性換成台灣調性）】
手办→公仔／模型／收藏品、摆件→擺件、钥匙扣→鑰匙圈、亚克力→壓克力、挂件→吊飾、收纳→收納、
适用→適用、现货→現貨、包挂件→包包吊飾／包包掛飾、神器→實用小物／配件、
爆款→熱門款／人氣款、网红→話題款／拍照感、拍下→下單、宝贝→商品／小物、
质量稳定→質感穩定、三丽鸥→三麗鷗、毛绒→毛絨

【輸出格式 — 分段標記（重要：不要輸出 JSON、不要用 Markdown 程式碼區塊、不要加任何說明文字）】
每個欄位用「獨立一整行」的標記 [[欄位名]] 起頭，內容寫在標記的下一行起，一直到下一個標記為止。
標記名稱要原封不動照抄（英文小寫、雙中括號），並「依下列順序」輸出全部 12 個欄位；
沒有內容的欄位（例如沒有明確角色）就讓該標記下方留空一行，不要省略標記本身。

[[detected_ip_name]]
（IP 中文名，依上方判斷規則）
[[detected_character_name]]
（主要角色名，沒有就留空）
[[detected_product_type]]
（商品型態，用台灣慣用說法）
[[detected_category]]
型態_（同上型態，例：型態_吊飾）
[[sku]]
CHO-...-...-...-001
[[enriched_title]]
（商品標題）
[[generated_description_html]]
（A/B/C/D/E 五段純文字描述，段落之間空一行）
[[generated_faq_html]]
（FAQ，每題 <h3><strong>問題</strong></h3><p>回答</p>）
[[seo_title]]
（SEO 標題）
[[meta_description]]
（meta 描述）
[[why_we_chose_it]]
（潮巢選品理由 1-2 句）
[[product_highlights]]
・賣點一
・賣點二
・賣點三

product_highlights 每點各自一行、用「・」開頭，列 3-5 點。除了各欄位標記與其內容外，不要輸出其他文字。`;
}

// The known-IP list is stable across a whole batch, so A5 caches it. Split out
// as its own block so the Claude provider can mark it cache_control while the
// OpenAI provider keeps it inline in the user message (OpenAI auto-caches
// prefixes, no manual control).
export function buildKnownIpBlock(knownIpNames?: string[]): string | null {
  if (!knownIpNames || knownIpNames.length === 0) return null;
  return `已建檔 IP 清單（判斷 detected_ip_name 時，若商品屬於其中之一，必須完全照抄清單中的中文名稱）：\n${knownIpNames.join("、")}`;
}

export function buildCopyUserMessage(input: CopyProviderInput, options?: { omitKnownIpList?: boolean }): string {
  const { rawTitle, saleStatus, source, variantSummary, price, compareAtPrice, note, imageDescription, specText, webSearchSummary, knownIpNames, isSecondhand, secondhandGrade, secondhandCondition, secondhandNotes } = input;

  const lines = [
    `商品來源：${source || "淘寶"}`,
    `原始標題：${rawTitle || "（未提供，請盡量從其他資訊判斷）"}`,
    `銷售狀態：${saleStatus}`,
  ];

  if (price) lines.push(`台幣售價：NT$${price}`);
  if (compareAtPrice) lines.push(`台幣定價：NT$${compareAtPrice}`);
  if (variantSummary) lines.push(`款式：${variantSummary}`);
  if (note) lines.push(`補充備註：${note}`);
  if (imageDescription) lines.push(`商品外觀描述（來自主圖/詳情圖辨識）：${imageDescription}`);
  if (specText) lines.push(`規格圖辨識文字：${specText}`);
  if (webSearchSummary) lines.push(`網路搜尋補充資訊：${webSearchSummary}`);
  // A9 item 4: without this the model has no signal the listing is secondhand.
  if (isSecondhand) {
    lines.push(
      `這是二手／中古商品（見 system prompt 的二手語氣規則）：` +
        [
          secondhandGrade ? `等級 ${secondhandGrade}` : null,
          secondhandCondition ? `品況 ${secondhandCondition}` : null,
          secondhandNotes ? `備註 ${secondhandNotes}` : null,
        ]
          .filter(Boolean)
          .join("／"),
    );
  }

  if (!options?.omitKnownIpList) {
    const ipBlock = buildKnownIpBlock(knownIpNames);
    if (ipBlock) lines.push("", ipBlock);
  }

  lines.push("請依照 system prompt 的規則，根據以上事實直接生成一份完整的品牌語氣文案，並用 system prompt 指定的分段標記格式輸出（不要輸出 JSON）。");

  return lines.join("\n");
}

// ----- A7: single-field regeneration -----

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
  enriched_title: "格式參考「IP名稱 角色名稱 商品特色｜用途情境」，建議 45 字、最長 50 字，不可捏造 IP／角色／規格數字。",
  generated_description_html: "沿用 A/B/C/D/E 五段純文字格式（全形｜分隔標題與內文、段落間空一行），尺寸材質只能引用已知規格，不要寫入價格。",
  generated_faq_html: "3-5 題，每題 <h3><strong>問題</strong></h3><p>回答</p>，答案自成一段可被單獨引用，導購感優先。",
  seo_title: "20-35 字（最長 60），核心關鍵字（IP＋角色＋類型）壓在前 25 字，別名擇一最熱門、別堆砌，不要自己加「｜潮巢 Nestory」尾綴（後端統一附加）。",
  meta_description: "70-110 字（最長 120），結尾帶收藏／送禮鉤子，避免出現：現貨、約14天、到貨、出貨、物流、缺貨、下單後、供應端。",
  why_we_chose_it: "1-2 句，說明為什麼這個商品值得在潮巢出現，帶品牌個性，不要只重複商品功能。",
  product_highlights: "3-5 點條列，每點各自一行、用「・」開頭，優先抓具體視覺／規格細節，不要空泛形容。",
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
  return `你是潮巢玩居（CHOCHONEST）商品文案專家，台灣日系動漫 IP 選物店品牌「潮巢 Nestory」。
語氣：親切有品味、SEO 友善、文青可愛、一點點幽默、不浮誇、不淘寶叫賣感。本次風格：${tone}（${TONE_DESCRIPTIONS[tone]}）。${LENGTH_INSTRUCTIONS[copyLength]}
${buildSecondhandSection(secondhandInfo)}

【本次任務：只重新生成一個欄位】
你要重寫的欄位是「${REGEN_FIELD_LABELS[field]}」。其他欄位「已經定稿」，只提供給你當上下文以保持整體一致——請「不要」重寫或輸出其他欄位。
重寫規則：${REGEN_FIELD_RULES[field]}
換一個角度、換一種說法，讓這個版本與上一版有真實差異，不要只是換幾個字。

【輸出格式】
只輸出這一段分段標記，內容寫在標記的下一行，不要輸出 JSON、不要輸出其他欄位、不要加任何說明文字：

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
  if (input.specText) lines.push(`規格圖辨識文字：${input.specText}`);
  if (input.isSecondhand) {
    lines.push(
      `這是二手／中古商品：` +
        [
          input.secondhandGrade ? `等級 ${input.secondhandGrade}` : null,
          input.secondhandCondition ? `品況 ${input.secondhandCondition}` : null,
          input.secondhandNotes ? `備註 ${input.secondhandNotes}` : null,
        ]
          .filter(Boolean)
          .join("／"),
    );
  }
  if (cv.detectedIpName) lines.push(`IP：${cv.detectedIpName}`);
  if (cv.detectedCharacterName) lines.push(`角色：${cv.detectedCharacterName}`);
  if (cv.detectedProductType) lines.push(`類型：${cv.detectedProductType}`);

  const previous = currentFieldText(field, input).trim();
  if (previous) {
    lines.push("", `【這個欄位的上一版（請避免雷同、換角度重寫）】\n${previous}`);
  }

  // The remaining finalised fields, for consistency (excluding the one being rewritten).
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
  if (otherLines.length > 0) {
    lines.push("", "【其他已定稿欄位（保持一致，不要重寫）】", ...otherLines);
  }

  lines.push("", `請只重新生成「${REGEN_FIELD_LABELS[field]}」，並用指定的分段標記格式輸出。`);
  return lines.join("\n");
}
