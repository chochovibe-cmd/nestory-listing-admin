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

const DESCRIBE_SYSTEM_PROMPT = `你是商品外觀描述助手，服務台灣日系動漫周邊選物店「潮巢 Nestory」。
你會收到一件商品的主圖與詳情圖（可能多張）。請用繁體中文寫一段客觀的商品外觀描述，重點寫：
- 顏色、材質觸感（絨毛／壓克力／塑膠／金屬等視覺可辨識的材質）
- 造型特徵、細節工藝（縫線、印花、配色分布等）
- 包裝或配件（如果照片中看得到）

規則：
- 只寫你在照片中「實際看到」的事實，不要形容詞堆疊、不要行銷語氣
- 絕對不要猜測或寫出任何尺寸、重量等數字規格——這些只能來自規格圖文字，不是你的工作
- 100-200 字，純文字，不要條列、不要 Markdown
- 這段描述是寫給文案撰寫者參考用的素材，不是最終文案`;

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

export async function ocrSpecImages(imageUrls: string[]): Promise<string> {
  return callVision(
    OCR_SYSTEM_PROMPT,
    "請辨識以下規格圖中的文字：",
    imageUrls.slice(0, MAX_OCR_IMAGES),
  );
}
