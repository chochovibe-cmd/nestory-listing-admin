// A2: main+detail image description and spec-image OCR. Split out of the copy
// flow entirely (its own sync API route, see /api/analyze-images) so Vision's
// latency never eats into /api/generate's Vercel time budget (文案·一).
//
// Both calls use OpenAI's vision-capable chat completions endpoint directly
// (not the CopyProvider abstraction -- this is a different concern: raw visual
// facts in, not brand-voice copy out).

const DEFAULT_VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";

// Guards against a draft with an unreasonable number of uploaded images
// blowing up one request's payload/latency/cost.
export const MAX_DESCRIBE_IMAGES = 6;
const MAX_OCR_IMAGES = 4;

export type VisionImageCandidate = {
  imageType: "main" | "detail";
  url: string;
  sortOrder: number;
};

function uniqueVisionCandidates(
  candidates: readonly VisionImageCandidate[],
): VisionImageCandidate[] {
  const seen = new Set<string>();
  return candidates
    .filter((candidate) => candidate.url.trim())
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((candidate) => {
      const url = candidate.url.trim();
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });
}

function evenlySpaced<T>(items: readonly T[], count: number): T[] {
  if (count <= 0 || items.length === 0) return [];
  if (items.length <= count) return [...items];
  if (count === 1) return [items[0]!];
  return Array.from({ length: count }, (_, index) => {
    const sourceIndex = Math.round((index * (items.length - 1)) / (count - 1));
    return items[sourceIndex]!;
  });
}

/**
 * Keep one hero/main image, then sample detail images across the full ordered
 * set (front/middle/back). Remaining main images only fill unused slots.
 */
export function selectRepresentativeVisionImages(
  candidates: readonly VisionImageCandidate[],
  cap = MAX_DESCRIBE_IMAGES,
): VisionImageCandidate[] {
  const safeCap = Math.max(0, Math.min(MAX_DESCRIBE_IMAGES, Math.floor(cap)));
  if (safeCap === 0) return [];
  const unique = uniqueVisionCandidates(candidates);
  const mains = unique.filter((candidate) => candidate.imageType === "main");
  const details = unique.filter((candidate) => candidate.imageType === "detail");
  const selected: VisionImageCandidate[] = [];
  if (mains[0]) selected.push(mains[0]);
  selected.push(...evenlySpaced(details, safeCap - selected.length));
  for (const main of mains.slice(1)) {
    if (selected.length >= safeCap) break;
    selected.push(main);
  }
  return selected.slice(0, safeCap);
}

/** Non-cryptographic cache key; changes whenever the ordered evidence set changes. */
export function buildVisionSourceFingerprint(
  candidates: readonly VisionImageCandidate[],
): string {
  const source = uniqueVisionCandidates(candidates)
    .map((candidate) => `${candidate.imageType}:${candidate.sortOrder}:${candidate.url.trim()}`)
    .join("\n");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, "0")}-${source.length}`;
}

// B1 (Mockup差異備忘 差異2): 規格圖 OCR 廢棄後，詳情圖是圖上文字的主要來源。除了外觀
// 描述，這支 prompt 現在還要「轉錄詳情圖上實際印出來、看得到的文字」（廣告文案／賣點／
// 規格文字），給文案撰寫者當素材。仍禁止「憑外觀猜測數字」——數字只在圖上有印時才照抄。
const DESCRIBE_SYSTEM_PROMPT = `你是商品外觀描述＋圖上文字擷取助手，服務台灣日系動漫周邊選物店「潮巢 Nestory」。
你會收到一件商品的主圖與詳情圖（可能多張）。請用繁體中文輸出兩個部分：

【外觀描述】客觀描述你在照片中實際看到的：
- 顏色、材質觸感（絨毛／壓克力／塑膠／金屬等視覺可辨識的材質）
- 造型特徵、細節工藝（縫線、印花、配色分布等）
- 包裝或配件（如果照片中看得到）

【圖上文字】把詳情圖上「實際印出來、看得到的文字」逐字轉錄出來，包含：
- 廣告文案、賣點標語、商品特色說明
- 圖上印的規格文字（材質／尺寸／產地等）
簡體字可轉成繁體；不要翻譯成別的語言、不要摘要、不要補寫看不清楚的字。若圖上沒有可見文字就寫「（無）」。

規則：
- 外觀描述只寫實際看到的事實，不要形容詞堆疊、不要行銷語氣
- 尺寸、重量等數字規格：只有在圖上「有印出來」時才照抄進【圖上文字】；絕對不要憑外觀猜測或自己編造數字
- 【P4 賣家服務／促銷排除】圖上若有保固、售後、退換貨承諾、贈品、店鋪活動、優惠券／立減／滿減／紅包、運費／包郵、店鋪評分／銷量等「賣家服務或行銷」文字，一律不要轉錄進【圖上文字】或外觀描述（與平台促銷同族）。商品材質／尺寸／功能等物理事實仍要照抄
- 純文字，兩段各用上面的【標題】分隔，總長約 150-300 字，不要 Markdown
- 這是寫給文案撰寫者參考用的素材，不是最終文案`;

const OCR_SYSTEM_PROMPT = `你是商品規格圖文字辨識助手。你會收到一張或多張商品規格圖（通常包含商品名稱、材質、尺寸、產地等文字資訊，原文可能是簡體中文）。

請逐字辨識圖片中所有可讀的文字內容，依照圖片上的視覺順序轉錄出來，不要摘要、不要翻譯成別的語言、不要自己補充或推測看不清楚的字。如果有多張圖，依序列出各張的文字內容。辨識不出來的部分可以省略，不要用「無法辨識」之類的字眼填充。

只輸出辨識到的原始文字內容，不要加任何說明或前言。`;

type VisionContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

async function callVision(systemPrompt: string, userText: string, imageUrls: string[]): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured on the server.");
  }

  const content: VisionContentBlock[] = [
    { type: "text", text: userText },
    ...imageUrls.map((url): VisionContentBlock => ({ type: "image_url", image_url: { url } })),
  ];

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_VISION_MODEL,
      max_tokens: 700,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI vision call failed (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  const text = payload?.choices?.[0]?.message?.content;

  if (typeof text !== "string" || !text.trim()) {
    throw new Error("OpenAI vision response did not include message content.");
  }

  return text.trim();
}

export async function describeProductImages(imageUrls: string[]): Promise<string> {
  return callVision(
    DESCRIBE_SYSTEM_PROMPT,
    "請描述以下商品圖片：",
    imageUrls.slice(0, MAX_DESCRIBE_IMAGES),
  );
}

// Reserved for B3 (截圖／網址自動辨識). Not called by /api/analyze-images anymore
// -- 規格圖 OCR 路徑已廢棄 (Mockup差異備忘 差異2)，但辨識引擎保留給 B3 沿用。
export async function ocrSpecImages(imageUrls: string[]): Promise<string> {
  return callVision(
    OCR_SYSTEM_PROMPT,
    "請辨識以下規格圖中的文字：",
    imageUrls.slice(0, MAX_OCR_IMAGES),
  );
}

// B3: 商品頁／規格表截圖 → 結構化欄位（標題／¥成本／特色／規格／款式列）。
// 底層仍走 vision chat completions；輸出要求 JSON 方便回填表單。
const RECOGNIZE_PRODUCT_SYSTEM = `你是電商商品頁截圖辨識助手，服務台灣選物店「潮巢 Nestory」。
你會收到 1–4 張商品頁或詳情截圖（可能含簡體中文）。請從圖上「實際看得到的文字」抽出欄位，輸出**純 JSON**（不要 Markdown、不要前言）：

{
  "title": "商品標題字串或 null",
  "costCny": 人民幣成本數字或 null,
  "features": "特色／賣點小標，用・或、連接，或 null",
  "specText": "規格文字，一行一項，用換行分隔，或 null",
  "variants": [{"name":"款式名","costCny":數字或null}]
}

規則：
- 只抽圖上真實文字，不要編造；看不清就填 null 或省略該款式
- 標題：商品名主標，去掉「包郵／618／滿減」等活動詞若明顯是廣告貼片
- costCny：人民幣售價／成本，只要數字（不要 ¥ 符號）；多價取主商品價或最低可見價
- features：圖上的特色小標、賣點短句（不是長文描述）
- specText：**參數表要抄全**——作者／品牌、材質、大小／尺寸、款式、功能、工藝、顏色分類等
  每一列都要收，一行一項「項目：內容」；不要只挑兩三項
- variants：規格選擇列（顏色／角色／尺寸＋價格）；沒有就 []
- 【促銷＋賣家服務排除，重要｜P4】平台促銷與他店服務資訊一律不擷取，不得混入任何欄位：
  優惠券／立減／滿減／紅包／支付宝優惠／618／雙11／運費／包郵、
  退貨說明／退換貨承諾／七天無理由、保固條款／售後服務、贈品／滿額禮、
  店鋪活動／會員優惠、店鋪評分／銷量／收藏數
  （商品本身的材質、尺寸、功能等物理事實不受影響，參數表仍要抄全）
- 角色名逐字抄寫，不要改字（例：烏薩奇不要寫成鳥薯奇）；不確定的字寧可保留簡體原字
- 只輸出一個 JSON 物件`;

const RECOGNIZE_SPEC_SYSTEM = `你是商品規格表／SKU 截圖辨識助手。你會收到 1–4 張規格彈窗或 SKU 表截圖。
請從圖上實際文字抽出 JSON（不要 Markdown、不要前言）：

{
  "title": null,
  "costCny": 若有單一總價則填數字否則 null,
  "features": null,
  "specText": "規格名與選項整理，一行一項",
  "variants": [{"name":"選項值（如角色名或尺寸）","costCny":數字或null}]
}

規則：只抄圖上文字，不要編造；簡體可轉繁體；沒有的欄位用 null 或 []；
【P4】促銷與他店服務資訊一律不擷取：優惠券／立減／滿減／紅包／運費／包郵、
退換貨／保固／售後／贈品／店鋪活動／評分銷量；角色名逐字抄寫不改字；
規格表商品參數列要抄全（材質尺寸功能等物理事實不受影響）；只輸出一個 JSON 物件`;

export type ScreenshotRecognizeMode = "product" | "spec";

/**
 * B3 主引擎：截圖 → 結構化 JSON 字串（呼叫端再 parse + 簡轉繁）。
 * 沿用 ocr 的多圖上限；max_tokens 略高以容納多款式。
 */
export async function recognizeProductScreenshots(
  imageUrls: string[],
  mode: ScreenshotRecognizeMode = "product"
): Promise<string> {
  const urls = imageUrls.slice(0, MAX_OCR_IMAGES);
  if (urls.length === 0) {
    throw new Error("至少需要一張截圖網址");
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured on the server.");
  }

  const systemPrompt = mode === "spec" ? RECOGNIZE_SPEC_SYSTEM : RECOGNIZE_PRODUCT_SYSTEM;
  const userText =
    mode === "spec"
      ? "請辨識以下規格截圖，輸出 JSON："
      : "請辨識以下商品頁截圖，輸出 JSON：";

  const content: VisionContentBlock[] = [
    { type: "text", text: userText },
    ...urls.map((url): VisionContentBlock => ({ type: "image_url", image_url: { url } })),
  ];

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_VISION_MODEL,
      max_tokens: 1200,
      temperature: 0.1,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI vision call failed (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  const text = payload?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("OpenAI vision response did not include message content.");
  }
  return text.trim();
}
