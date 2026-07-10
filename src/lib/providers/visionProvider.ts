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
const MAX_DESCRIBE_IMAGES = 6;
const MAX_OCR_IMAGES = 4;

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
