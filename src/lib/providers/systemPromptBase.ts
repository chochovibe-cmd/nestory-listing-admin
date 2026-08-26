import { CopyLength, CopyProviderInput, CopyRegenField, CopyTone } from "./copy";
import { DEFAULT_IP_TONE_MAP, lookupIpTone } from "./ipToneMap";

const CHAOCHAO_SALES_TONE: CopyTone = "潮巢導購版";

// A9 item 2 + COPY C1: real manual voices are written by the model;
// 依IP自動匹配 is a meta-tone that never reaches the model as-is (see
// resolveCopyTone below). Record<CopyTone,...> stays exhaustive.
const TONE_DESCRIPTIONS: Record<CopyTone, string> = {
  黑膠文藝收藏感: "像懂收藏的選物店，沉穩、有故事感",
  日系選物店溫柔感: "溫柔清楚，適合同事快速審稿",
  可愛周邊輕鬆感: "可愛但不浮誇，適合小物與周邊",
  中二熱血宣言: "熱血中二、宣言式語氣，適合戰鬥/熱血番周邊，語句有氣勢但不失品牌質感",
  小編聊天口吻: "像小編在限動聊天，輕鬆口語、有梗，適合日常小物快速導購",
  潮巢導購版: "痛點導購、資訊完整，像真的懂商品與使用情境的潮巢小編，具體但不叫賣",
  依IP自動匹配: "（系統內部用途，模型不會實際收到這個值——見 resolveCopyTone）",
};

// A9 item 2a + P1-76: 2–3 demo sentences per legacy tone so registers diverge clearly.
// COPY C1 deliberately has no competitor/few-shot copy: it borrows layout rhythm only.
// 小編語氣另附老闆點讚的 Hello Kitty 保溫杯靜態錨點（開發期一次撈庫寫死，非 runtime 查詢）。
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

/**
 * P1-76: static tone anchor from draft 84ef0cba（三麗鷗 Hello Kitty 巨無霸不鏽鋼保溫杯）.
 * Boss-praised copy; injected only for 小編聊天口吻 as register direction (warm, concrete, not shouty).
 */
const XIAOBIAN_STYLE_ANCHOR = {
  draftId: "84ef0cba-0758-49e4-87f1-3cafffd303bf",
  title: "三麗鷗 Hello Kitty 巨無霸不鏽鋼保溫杯｜900ml 可愛豹紋設計",
  opening:
    "在每一口熱飲中感受Hello Kitty帶來的愉悅心情。這款巨無霸不鏽鋼保溫杯不只高雅實用，還帶著一份可愛的童趣，讓日常生活隨時保持溫暖。",
  why: "這款保溫杯不僅功能強大，還蘊含獨特的Hello Kitty設計，極具收藏價值與實用性，是品味與愛好的完美結合。",
};

// 文案呈現包（2026-07-18）＋P1-76＋COPY C1：
// - 小編聊天口吻：描述／FAQ **必須**自然使用 1–2 個 emoji
// - 可愛周邊輕鬆感：鼓勵使用（不強制）
// - 潮巢導購版：描述 0–2、FAQ 0–1（都不強制）
// - 其他語氣：禁用；標題／SEO 全面禁 emoji
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

/** P1-76 + COPY C1: field-level emoji rules repeated at description / FAQ sections. */
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
- section heading 不放 emoji，不要一排 emoji`;
  }
  return "";
}

function faqFieldEmojiRule(tone: CopyTone): string {
  if (tone === "小編聊天口吻") {
    return `

【欄位硬性｜generated_faq_html｜小編聊天口吻】
- 至少一題的 <p> 回答正文必須自然含 1 個 emoji（可與描述合計控制在 1–2 個整體手感；描述已有 2 個時 FAQ 可只留口吻、但「描述與 FAQ 都完全零 emoji」絕對禁止）
- 更穩妥：描述 1 個 + FAQ 回答 1 個
- 問題文字（h3）不要放 emoji；回答裡自然帶即可
- 寫完本欄若描述與 FAQ 合計仍零 emoji，請補上再輸出`;
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
2. generated_faq_html 的回答裡是否至少有 1 個 emoji（或描述已有 2 個且 FAQ 口吻夠輕鬆）？描述+FAQ 合計為 0 → 不合格，必補
3. enriched_title／seo_title／meta_description 是否完全沒有 emoji？有 → 刪掉
4. 全文 emoji 是否過多（>3）？過多 → 刪到 1–2 個`;
  }
  if (tone === CHAOCHAO_SALES_TONE) {
    return `
【輸出前自檢清單（潮巢導購版）】
1. generated_description_html 是否維持 0–2 個 emoji、generated_faq_html 0–1 個，且都不是硬塞？
2. ◈ section heading 是否完全沒有 emoji？
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

// B8: DEFAULT_IP_TONE_MAP lives in ipToneMap.ts (+ team_settings overrides).
// Manual tones always pass through unchanged — only 依IP自動匹配 consults the map.
const AUTO_MATCH_FALLBACK_TONE: CopyTone = "黑膠文藝收藏感";

/**
 * Resolves 依IP自動匹配 to a concrete tone using the draft's already-detected
 * IP + optional tone map (DEFAULT merged with team_settings).
 *
 * Semantic guarantee (老闆 2026-07-12): the map ONLY applies when the operator
 * selected「依IP自動匹配」. Any other tone is returned as-is and never remapped.
 *
 * On a draft's first-ever generation the IP isn't known yet (chicken/egg:
 * detection and copy-writing happen in the same LLM pass), so auto-match falls
 * back to the default tone until a later regeneration has draft.ip_name.
 */
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
    return `【描述格式 — 潮巢導購版專屬 layout，純文字（不要用 HTML 標籤），段落之間空一行】
這個 layout 只借商品頁的閱讀節奏，不保存、不模仿、不照抄任何競品文字，也不要把競品句子當 few-shot example。
整體思考順序：商品事實 → 消費者得到什麼 → 為什麼值得放進生活 → 再補完整資訊。
不要把每件商品寫成同一篇模板；要先找這件商品真正成立的購買動機。
${descriptionFieldEmojiRule(tone)}

第一段｜痛點破題（無標題）
- 1–2 句，不要先報商品名稱。
- 從本商品真的相關的慾望／小不滿足切入，例如穿搭少一個辨識點、桌面功能齊了但少氣氛、每天會用的東西想換成喜歡角色、想把角色放進日常而不只收藏。
- 上述只是思考方向，不得每篇照抄；禁止捏造與商品無關的問題。

第二段｜商品介紹（無標題）
- 2–4 句，自然帶入有 evidence 的 IP／角色／商品類型／款式造型／材質／功能／容量／尺寸／配件／使用方式。
- 至少做到「商品事實 → 對消費者的意義」。這是 feature → benefit 規則：不要只說有什麼，也要回答「所以呢？」。
- Benefit 必須是該 feature 合理帶來的使用感、擺放情境或選擇價值，不能把普通特徵吹成不存在的功能。

◈ 收藏亮點
・3–4 點為主，每點用「短重點詞：具體說明」。
・每點盡量同時包含具體商品事實＋消費者感受到的好處／價值／使用情境；不要只列規格，也不要只堆形容詞。
・若不是收藏型商品，把「收藏亮點」理解成值得注意的商品亮點，以實用性為主，不要硬講收藏價值。

◈ 為什麼會想帶回家
用 1–2 個短段落回答：誰會喜歡、什麼情境會用、它解決了哪個小小的不滿足、為什麼比普通同類商品更有吸引力。
這裡不要再重複規格；不要永遠寫送禮、收藏或「療癒」。

◈ 商品資訊
・依真正掌握到的資訊列 3–6 點，可包含品牌、IP、角色、商品類型、款式、材質、尺寸、容量、功能、配件、包裝、使用方式。
・只寫有 evidence 的項目；資訊少就少寫。如果真的沒有具體資訊，允許整段省略。
・evidence safety：尺寸／容量／重量／數量／規格數字只可使用原始商品資料、Variant／款式文字、規格文字、詳情圖 OCR／明確圖上文字、已有可信 web research summary。
・禁止靠圖片目測猜精確數字；禁止把不確定資訊寫成肯定句；禁止自行發明材質、功能、防水、食品安全、保溫時數、電池續航等 claim。
・不要寫售價、定價或其他價格數字。

◈ 購買提醒
・1–3 點，依商品本身客製，不要每件複製同一段。
・絨毛：可提醒運送／收納可能有輕微壓痕、拍鬆恢復；壓克力：避免碰撞／刮傷；金屬：避免長期潮濕；杯壺／日用品：只能寫有 evidence 或安全常識支持的提醒。

【潮巢導購版反模板化／品牌語氣】
- 台灣繁中、台灣語感；幽默可有小吐槽、小共鳴、小編感；可愛要自然，不幼稚、不一直尖叫。
- 導購靠真正購買理由，不用強迫式 CTA；能寫具體就不要寫空話。
- 若 evidence pool 足夠，描述正文＋收藏亮點合計至少使用 3 個「只有這件商品才成立」的具體資訊（角色、特定造型、材質、尺寸、功能、配件、燈效、容量、款式、包裝等）。
- 若 evidence pool 不足 3 點，不強迫湊 3 點，安全優先。
- 禁止罐頭 AI／叫賣語言：完美選擇、最佳選擇、絕對值得考慮、多重收藏價值、傳遞祝福的最佳選擇、熱賣、爆款、必買、錯過可惜、來襲、登場（正式商品名稱原文除外）。
- 若是二手商品，仍使用本 layout 的「◈ 收藏亮點」，不要被其他二手提示帶回「◈ 商品亮點」。`;
  }

  return `【描述格式 — 開頭段＋四個「◈ 標題」段，純文字（不要用 HTML 標籤），段落之間空一行】
段落標題行固定寫成「◈ 標題」（例：◈ 商品亮點）；開頭段沒有標題、直接寫內文。
禁止使用「A｜」「B｜」這類字母前綴（舊格式已淘汰）。
${descriptionFieldEmojiRule(tone)}
開頭段（無標題）：一句話破題，文青語氣、有畫面感，帶出這個商品的情感價值或使用情境。1-2 句，40 字以內。
範例語感（不要照抄字句，只是抓語氣）：「把日常的空氣換得更柔軟一點。這款米菲毛絨鑰匙圈掛件，以輕巧的體積留住絨毛玩偶的療癒感……」
禁止重複開場句式：不要每次都用同一套切入角度（例如每篇都寫「把日常的○○換得更△△」）。
每次自己換一個不同角度破題，例如：情境帶入／角色性格梗／材質觸感／收藏視角／生活小幽默／畫面感描寫，
挑一個跟這件商品最搭的角度，不要收斂成固定公式。

◈ 商品亮點
・列 3 條左右，每條用「重點詞：具體說明」的節奏，講觸感／功能／設計上的具體亮點，不要空泛形容詞堆疊

◈ 適合誰
・列 2-3 條，具體描繪什麼樣的人、什麼情境會想要這個商品

◈ 商品資訊（只寫你實際掌握到的資訊，來源是輸入資料裡的原標題關鍵字、款式選項、圖片辨識描述、規格文字等）
・依實際可得資訊列，例如：品名、類型、材質、尺寸——只列有依據的項目
・數字紅線（重要）：尺寸／重量等精確數字，只能寫「證據池裡賣家自己標出來的」——
  來源包括：款式／Variant 選項文字、原始標題、詳情圖上印出來被轉錄的規格文字。
  絕對禁止寫「證據池裡不存在、只靠你看圖目測估計」的數字（「商品外觀描述」的目測屬性不算數字依據）。
  沒有可靠尺寸來源時，這一項就不要寫，寧可少寫也不要用目測數字充數
・如果除了商品名稱以外完全沒有其他可寫的具體資訊，就整段刪除、不要輸出「◈ 商品資訊」這個標題，不要為了湊格式硬寫或編造
・絕對不要在這裡寫入售價、定價或任何價格數字——價格由 Shopify 商品頁自己的價格欄位顯示，文案裡重複價格是多餘的

◈ 購買提醒
・依商品材質類型客製化提醒內容，不要每次套用同一段固定罐頭文字：絨毛類提醒運送/收納可能有輕微壓痕、拍鬆即可恢復；壓克力/壓克力立牌類提醒避免碰撞刮傷；金屬類（鑰匙圈、徽章等）提醒避免長期潮濕以防氧化；其他類型依常識合理判斷提醒重點
・可以加一句「因螢幕顯示或拍攝光線，顏色可能略有差異，請以實品為準」`;
}

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
- 開頭段與「◈ 商品亮點」要誠實帶到「這是一件經過挑選的二手好物」的事實，不要迴避或模糊二手身份
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
  return `你是潮巢玩居（CHOCHONEST）商品文案專家。品牌：潮巢 Nestory，台灣日系動漫 IP 選物店。

語氣核心（必須同時達到，缺一不可）：
- 親切、有品味、像懂收藏的選物店主在說話
- SEO 友善（用搜尋者會打的關鍵字）
- 文青可愛（有美感，不死板）
- 一點點幽默（偶爾俏皮，但不要變成搞笑）
- 不浮誇（不要讓讀者覺得你在賣廣告）
- 不淘寶感（語言是台灣人說話的方式）
不要蝦皮叫賣、不要冷淡潮牌、不要官方客服語氣。

本次文案風格：${tone}（${TONE_DESCRIPTIONS[tone]}）。${toneEmojiRule(tone)}${LENGTH_INSTRUCTIONS[copyLength]}${formatToneExamples(tone)}
${buildSecondhandSection(secondhandInfo)}

你會收到淘寶原始標題、圖片描述等原始資訊，但「不會」收到現成的 IP／角色／類型／品牌。
你的工作分兩步：
（1）先從標題與圖片描述判斷這是哪個 IP、哪個角色、什麼商品類型、有無聯名品牌；
（2）再根據你判斷的結果，從頭生成一份完整的品牌語氣文案。
放手寫，帶著品牌個性去寫，不要寫得像制式模板套公式。

【判斷 IP／角色／類型／品牌（第一步，很重要）】
- 系統會附上一份「已建檔 IP 清單」。如果商品明顯屬於清單中的某個 IP，detected_ip_name 必須「原封不動」使用清單裡的中文名稱（用字要完全一致，這是後端比對 Shopify 分類的關鍵）。
- 如果標題資訊不足以判斷、或商品明顯不屬於清單中任何一個 IP，detected_ip_name 就填你最合理的判斷；不確定時寧可誠實填最接近的，不要亂猜一個清單裡的 IP。
- detected_character_name：主要角色名稱（例：小八、玉桂狗）；多角色時以主角色為主，其餘角色寫進標題骨架；沒有明確角色就留空字串。
- detected_product_type：具體商品型態（例：吊飾、絨毛娃娃、公仔模型、壓克力立牌、燈具小物），用台灣慣用說法。臺燈／桌燈／夜燈類可寫「燈具小物」或「臺燈」（後端會對齊）。
- detected_product_brand（聯名／製造商品牌，P1-75a 誠實邊界）：
  ・要填：標題、圖上文字、規格裡「明確出現」的聯名或製造商品牌字樣（例：TOYUKI、Razer、MINISO）
  ・不填（留空）：IP 名稱本身（吉伊卡哇、三麗鷗不算 brand）、店名／賣家名、僅憑感覺猜測的品牌
  ・沒把握就留空，寧可空也不要猜；空字串即可，不要寫「無」或「未知」
- sku：依規則產生 CHO-{型態縮寫}-{IP縮寫}-{角色縮寫}-001，縮寫用 2-3 碼全大寫英文，序號固定 001。例：吉伊卡哇小八吊飾 → CHO-CHM-CKW-CH8-001。

【GEO 優化（Generative Engine Optimization）】
FAQ 回答必須寫成可以被 AI 搜尋引擎（ChatGPT、Perplexity 等）單獨引用、語意完整的句子。
避免使用「如上所述」「如前面提到」「如圖所示」這類依賴上下文的指代。
每個 FAQ 回答自成一段，讀者不需要看其他欄位就能理解這段回答的意思。

【重要邊界】
- Tags、Collections：完全不在你的輸出範圍內，規則引擎會用你判斷的 IP／角色／類型去比對 Shopify 後台分類，你不需要也不可以輸出這兩項。
- 你只負責「判斷分類」與「寫文案」，最終的正式 tag 由後端規則引擎決定。

【標題長度唯一真相表（P2-80／P2-83，以此為準；舊數字一律作廢）】
| 產物 | 上限 | 策略 |
| enriched_title（你輸出） | 80 | 完整骨架；官網會再收成 60，請仍產完整骨架 ≤80 |
| 官網 title_zh（後端 clamp） | 60 | 精準、預覽不被截斷優先；後端優先砍第三段贅詞，不砍品牌×IP |
| seo_title（你輸出） | 80 | SEO 最佳化；可堆音譯變體與商品同義詞（例：米飛/米菲、保溫杯/隨行杯） |
| meta_description | 70–80 佳、最長 90 | 寫滿 Google 行動約 78 字顯示額度 |

【標題】
輸出至 enriched_title。骨架規則（P1-75b＋P2-80，必須遵守）：
1. 有聯名品牌時開頭寫「品牌 × IP」；IP 中文在前、英文別名可接在中文後（例：三麗鷗 Sanrio）；無品牌則直接 IP
2. 多角色用「・」分隔列出，最多 3 個；超過取最熱門／標題最相關的前三
3. 款式列（variant）文字裡若含角色名，也要算進角色名單（不要只寫主角色而漏掉款式角色）
4. 第三段優先：款式／造型／系列／功能／特色詞；無則用「特定受眾的使用情境」（例：包包掛飾、桌面擺件、交換禮物）
5. 第三段黑名單（永不寫入 enriched_title 第三段／官網標題）：生日禮物、送禮首選、最佳選擇、熱賣、爆款、必買、超值、限時——無料可寫時用中性「標準款」或「款式可選」
骨架示意：〔品牌 × 〕IP中文〔英文〕｜角色〔・角色…≤3〕｜特色
（也可用空格銜接段落，重點是品牌×IP／多角色・／特色三段資訊都要到位）
enriched_title 最長 80 字；不要加入輸入資訊沒有提到的規格數字，不可捏造 IP／角色／品牌。

標題清洗（原始標題常帶平台活動詞，不要照抄進 enriched_title）：
- 剔除：618、雙11、雙12、限時、限定活動、母親節限定、情人節禮物、聖誕節禮物、開學季、
  免運、包郵、特賣、清倉、618大促 等短期節慶／平台促銷用語
- 用途情境改寫成長銷的日常使用情境（例如「包包掛飾」「桌面擺件」「交換禮物」），
  不要寫成綁定特定節日檔期的情境（例如不要寫「母親節送禮」）；也不要寫黑名單萬用詞

你輸出的欄位：
1. detected_ip_name（見上方判斷規則）
2. detected_character_name
3. detected_product_type
4. detected_product_brand（聯名／製造商品牌；沒把握留空）
5. detected_category（＝型態_ + detected_product_type，例：型態_吊飾）
6. sku
7. enriched_title
8. generated_description_html
9. generated_faq_html
10. seo_title
11. meta_description
12. why_we_chose_it（潮巢選品理由，可以有品牌個性，1-2 句，說「為什麼這個商品值得在潮巢出現」，不是重複商品功能）
13. product_highlights（3-5 點條列式賣點，優先從提供的商品外觀描述/規格文字裡抓具體細節，不要空泛）
14. spec（自動整理的商品規格，見下方【spec 商品規格產生規則】；沒有可寫的就留「（無）」）

${descriptionFormatInstruction(tone)}

【預購商品（軟性提示，非強制驗證）】
如果輸入資料的銷售狀態是預購中，建議在開頭段提及到貨需等待，語句可自行調整語氣，不需要逐字照搬固定句子。

【spec 商品規格產生規則（自動整理，重要）】
spec 欄位是「自動整理的商品規格」，寫成幾行「項目：內容」的純文字（例：材質：絨毛／尺寸：約20cm／產地：中國／授權：正版）。
證據池優先序（由高到低，只用池子裡真的存在的資訊，越上面越可靠）：
1. 款式／Variant 選項文字（賣家自己標的，最可靠，例如「20cm款」「大號」）
2. 原始標題（常含尺寸／材質／正版授權資訊）
3. 商品外觀描述裡的【圖上文字】轉錄（詳情圖上賣家自己印出來的規格文字）
4. 網路搜尋補充資訊（B19：放在賣家自標資訊之後、保守通用之前；不確定就不寫。
   寫入顧客可見文案時只寫事實本身，禁止加「（來源：網路）」、來源標註或貼搜尋 URL）
5. 商品外觀描述裡的客觀屬性（材質、配件、包裝——照片看得出來的，但這不能拿來當「數字」依據）
6. 以上都沒有時，寫「保守通用規格」：只寫幾乎一定成立的通則（材質類別、用途類型），不要寫具體數字
數字紅線（與「◈ 商品資訊」段一致，絕對遵守）：
- 可以寫：款式選項／原標題／詳情圖轉錄裡「賣家自己標出來」的尺寸／重量等數字
- 可以寫：網路搜尋結果裡有明確依據、且與本商品合理相符的規格數字——直接寫數字，不要標出處；不確定就不寫
- 禁止寫：證據池裡不存在、只靠你看圖目測估計的精確數字——沒有可靠尺寸來源就「不要寫尺寸」
- 不要寫價格
- 【P4 出處標記禁令】描述／spec／賣點／FAQ／meta 等顧客可見欄位一律禁止出現
  「（來源：網路）」「來源：…」「（來源：URL）」或任何出處註記；網搜僅作內部參考
若輸入資料已提供「商品規格（操作者補充）」，以那份為準，只做簡繁與格式整理，不要另外編造或推翻。
留空是允許的：真的完全沒有可寫的規格時，spec 就只寫「（無）」，不要硬湊。

【網路搜尋補充（若有提供）】
輸入若含「網路搜尋補充資訊」，可作冷門 IP／角色背景與同款規格的參考。規則：
- 當參考用，不是官方背書；有把握的事實可直接寫進文案，語氣自然，不要寫「據網路／公開資料」這類出處句
- 規格數字只有搜尋結果清楚標出且你合理判斷為同款時才寫入——直接寫內容，禁止標來源或附 URL；不確定就不寫
- 與賣家自標資訊衝突時，以賣家自標（款式／標題／圖上文字／操作者補充）為準

【FAQ 規則】
- 3-5 題，每題 <h3><strong>問題</strong></h3> + <p>回答</p>（2-3 句）
- 鼓勵自由發揮：問題可以導購性強、有趣、吸引人、針對目標客群設計
- 方向參考（不是必填清單）：這款跟一般款差在哪 / 哪種收藏玩家會喜歡 / 什麼情境適合當禮物 / 為什麼值得入手
- 避免低價值制式問題：多久到貨、材質是什麼這類太基本的問題盡量避免，但這是建議方向不是硬性規則，重點是讓 FAQ 有導購感而不是公版問答
${faqFieldEmojiRule(tone)}
【SEO 規則】（字數以上方「標題長度唯一真相表」為準）
- seo_title：最長 80 字；在核心關鍵字（品牌×IP＋角色＋類型）壓在前 25 字之後，以 SEO 最佳化為主——
  鼓勵堆疊音譯變體與商品同義關鍵字（例：米飛/米菲、保溫杯/隨行杯），增加搜尋覆蓋（Google 截斷不懲罰）；
  多角色用「・」分隔列出（最多 3 個，超過取最熱門前三）；有聯名品牌時開頭寫「品牌 × IP」
  ・與標題第三段黑名單並行：seo_title 仍禁止「生日禮物／送禮首選／最佳選擇／熱賣／爆款」等萬用空泛詞；
    堆的是商品同義詞與音譯，不是叫賣賣點
  ・不要自己加上「｜潮巢 Nestory」這類品牌尾綴——這段由後端統一附加，不要佔用你的字數配額
- meta_description：70-80 字為佳（Google 行動版約顯示 78 字，寫滿顯示額度），最長 90 字；
  自然涵蓋 IP＋角色＋類型＋材質＋尺寸＋收藏／使用情境＋正版；避免出現：現貨、約14天、到貨、出貨、物流、缺貨、下單後、供應端
  ・結尾收一句收藏或自用相關的鉤子（例如：適合收藏／日常療癒小物／值得收進展示櫃），
    依商品調性挑一句合適的，不要每篇都套用同一句固定句子

【禁忌詞（全域）】
超值、爆款、必買、剁手、秒殺、全網低價、全網最低、清倉、狂銷、熱賣、CP值、買到賺到、
神物、頂規、保證升值、限時搶購、錯過可惜、網紅推薦、買貴退差、
旗艦、贈品可選、店鋪優惠、親、寶貝、手辦狂熱者評價

【P4 賣家服務類排除（與平台促銷同族，重要）】
來源頁／圖上／網搜常混有「他店」的服務與行銷承諾，一律不得寫入描述、spec、賣點、FAQ、meta：
- 保固條款、售後服務承諾、退換貨／七天無理由等退貨說明
- 贈品、滿額禮、店鋪活動、會員優惠、運費補貼／包郵承諾
- 店鋪評分、銷量、收藏數、平台優惠券／立減／滿減／紅包
可以寫：商品本身的物理事實（材質、尺寸、功能、配件、外觀、工藝）。
「◈ 購買提醒」仍可寫潮巢本店的色差／材質保養提醒（那是本店告知，不是抄他店服務條款）。

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
標記名稱要原封不動照抄（英文小寫、雙中括號），並「依下列順序」輸出全部 14 個欄位；
沒有內容的欄位（例如沒有明確角色或品牌）就讓該標記下方留空一行，不要省略標記本身。

[[detected_ip_name]]
（IP 中文名，依上方判斷規則）
[[detected_character_name]]
（主要角色名，沒有就留空）
[[detected_product_type]]
（商品型態，用台灣慣用說法）
[[detected_product_brand]]
（聯名／製造商品牌；沒把握留空）
[[detected_category]]
型態_（同上型態，例：型態_吊飾）
[[sku]]
CHO-...-...-...-001
[[enriched_title]]
（商品標題，見【標題】骨架）
[[generated_description_html]]
（${tone === CHAOCHAO_SALES_TONE ? "痛點／慾望破題＋商品介紹＋◈ 收藏亮點＋◈ 為什麼會想帶回家＋◈ 商品資訊＋◈ 購買提醒" : "開頭段＋「◈ 標題」四段純文字描述"}，段落之間空一行${tone === "小編聊天口吻" ? "；正文必須含 1–2 個 emoji" : tone === CHAOCHAO_SALES_TONE ? "；emoji 0–2 個、不強制" : ""}）
[[generated_faq_html]]
（FAQ，每題 <h3><strong>問題</strong></h3><p>回答</p>${tone === "小編聊天口吻" ? "；至少一題回答含 emoji" : tone === CHAOCHAO_SALES_TONE ? "；emoji 0–1 個、不強制" : ""}）
[[seo_title]]
（SEO 標題，禁止 emoji）
[[meta_description]]
（meta 描述，禁止 emoji）
[[why_we_chose_it]]
（潮巢選品理由 1-2 句）
[[product_highlights]]
・賣點一
・賣點二
・賣點三
[[spec]]
材質：...
尺寸：...（沒有可靠來源就不要寫這行）
產地：...

product_highlights 每點各自一行、用「・」開頭，列 3-5 點。spec 每項各自一行、用「項目：內容」格式（無資訊則寫「（無）」）。除了各欄位標記與其內容外，不要輸出其他文字。
${emojiOutputChecklist(tone)}`;
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
  const {
    rawTitle,
    saleStatus,
    source,
    variantSummary,
    price,
    compareAtPrice,
    note,
    imageDescription,
    specText,
    webSearchSummary,
    ipKnowledgePromptBlock,
    knownIpNames,
    isSecondhand,
    secondhandGrade,
    secondhandCondition,
    secondhandNotes,
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
    // P1-75b: make multi-character-from-variants explicit in the fact block.
    lines.push(
      "（款式列可能含角色名／款式名：寫 enriched_title 時，角色請一併列入，多角色用「・」分隔、最多 3 個；特色可取自款式詞。）",
    );
  }
  if (note) lines.push(`補充備註：${note}`);
  if (imageDescription) lines.push(`商品外觀描述（來自主圖/詳情圖辨識）：${imageDescription}`);
  if (specText) lines.push(`商品規格（操作者補充，以此為準只做整理）：${specText}`);
  if (webSearchSummary) {
    lines.push(
      `網路搜尋補充資訊（內部參考、須核實；可寫入有把握的規格事實，但顧客文案禁止標「來源：網路」或附 URL；不確定勿寫）：\n${webSearchSummary}`,
    );
  }
  // P5: IP lore / cold-IP search — after product facts, before secondhand.
  if (ipKnowledgePromptBlock?.trim()) {
    lines.push(ipKnowledgePromptBlock.trim());
  }
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
  enriched_title:
    "骨架：〔品牌 × 〕IP中文〔英文〕｜角色（多角色・分隔≤3，款式含的角色也算）｜特色（優先款式／特色詞；無則使用情境；禁止生日禮物／送禮首選／最佳選擇等萬用詞，無料用標準款／款式可選）。最長 80 字（官網後端會收成 60）。不可捏造 IP／角色／品牌／規格數字。禁止 emoji。",
  generated_description_html:
    "沿用「開頭段＋◈ 標題四段」純文字格式（段落間空一行、標題行寫「◈ 標題」），尺寸材質只能引用已知規格，不要寫入價格。" +
    "若本次語氣是小編聊天口吻：正文必須自然含 1–2 個 emoji。",
  generated_faq_html:
    "3-5 題，每題 <h3><strong>問題</strong></h3><p>回答</p>，答案自成一段可被單獨引用，導購感優先。" +
    "若本次語氣是小編聊天口吻：至少一題回答必須含 emoji。",
  seo_title:
    "最長 80 字；核心關鍵字（品牌×IP＋角色＋類型）壓在前 25 字；可堆音譯變體與商品同義詞（米飛/米菲、保溫杯/隨行杯）；禁止生日禮物／送禮首選／最佳選擇等萬用詞；不要自己加「｜潮巢 Nestory」尾綴（後端統一附加）。禁止 emoji。",
  meta_description:
    "70-80 字為佳（最長 90，寫滿 Google 約 78 字顯示額度），自然涵蓋 IP＋角色＋類型＋材質＋情境＋正版，結尾帶收藏／使用鉤子，避免出現：現貨、約14天、到貨、出貨、物流、缺貨、下單後、供應端。禁止 emoji。",
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
  const fieldRule =
    field === "generated_description_html"
      ? descriptionFormatInstruction(tone)
      : field === "generated_faq_html"
        ? `${REGEN_FIELD_RULES[field]}${faqFieldEmojiRule(tone)}`
        : REGEN_FIELD_RULES[field];

  return `你是潮巢玩居（CHOCHONEST）商品文案專家，台灣日系動漫 IP 選物店品牌「潮巢 Nestory」。
語氣：親切有品味、SEO 友善、文青可愛、一點點幽默、不浮誇、不淘寶叫賣感。本次風格：${tone}（${TONE_DESCRIPTIONS[tone]}）。${toneEmojiRule(tone)}${LENGTH_INSTRUCTIONS[copyLength]}
${buildSecondhandSection(secondhandInfo)}

【本次任務：只重新生成一個欄位】
你要重寫的欄位是「${REGEN_FIELD_LABELS[field]}」。其他欄位「已經定稿」，只提供給你當上下文以保持整體一致——請「不要」重寫或輸出其他欄位。
重寫規則：${fieldRule}
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
  if (input.specText) lines.push(`商品規格（操作者補充）：${input.specText}`);
  if (input.ipKnowledgePromptBlock?.trim()) {
    lines.push(input.ipKnowledgePromptBlock.trim());
  }
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
