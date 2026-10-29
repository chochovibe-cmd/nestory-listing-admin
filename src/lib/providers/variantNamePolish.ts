/**
 * VARIANT-CLEAN: AI polish layer of 款式名稱整理 (server only, button-click only, never at import).
 *
 * One call per draft: all variant names go in together and come back in the same shape.
 * The model only rewords into natural Taiwan usage; variantNameValidator throws away anything
 * that changes meaning, so a bad answer silently falls back to the rule layer.
 */
import {
  COPY_TIMEOUT_MS,
  externalTimeoutMessage,
  externalTimeoutSignal,
  isExternalTimeout
} from "@/lib/providers/externalTimeout";

import type { VariantPolishFn } from "@/lib/variants/variantNamePreview";
import { resolveTextAiEndpoint, textAiModelId, textAiErrorTag } from "./textAiEndpoint";

const SYSTEM_PROMPT = `你是台灣電商的商品款式名稱校稿員。我會給你一組款式名稱（二維陣列，每列一個款式，每欄一個選項軸）。
任務：把每個名稱改成自然的台灣用語，只調整措辭。
硬性規則：
1. 商品名、品牌、IP、角色名、英文、數字、單位一律原樣保留。
2. 不要新增原文沒有的資訊，不要加行銷用語，不要刪掉商品名來縮短。
3. 長度與原文相近（差距不超過 4 個字），空字串保持空字串。
4. 各款式改完後仍要互不相同。
5. 不確定就原樣回傳。
輸出 JSON：{"rows":[[...]]}，列數、欄數必須和輸入完全一致，只輸出 JSON。`;

export const polishVariantNamesWithOpenAI: VariantPolishFn = async (request) => {
  const endpoint = resolveTextAiEndpoint();
  const model = process.env.OPENAI_BRIEF_MODEL?.trim() || "gpt-4o-mini";
  if (!endpoint) {
    return { rows: null, model: "rules-only", warning: "OPENAI_API_KEY 不可用，只套用規則整理，沒有 AI 潤飾。" };
  }
  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${endpoint.apiKey}` },
      signal: externalTimeoutSignal(COPY_TIMEOUT_MS),
      body: JSON.stringify({
        model: textAiModelId(endpoint, model),
        max_tokens: 1200,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              productName: request.productName ?? "",
              axisNames: request.axisNames,
              rows: request.rows
            })
          }
        ]
      })
    });
    if (!response.ok) {
      throw new Error(`AI 潤飾失敗（${response.status}）${textAiErrorTag(endpoint)}：${(await response.text()).slice(0, 160)}`);
    }
    const payload = await response.json();
    const text = payload?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw new Error("AI 潤飾回應是空的");
    return { rows: JSON.parse(text)?.rows ?? null, model };
  } catch (error) {
    const message = isExternalTimeout(error)
      ? externalTimeoutMessage("copy")
      : error instanceof Error
        ? error.message
        : "unknown error";
    return { rows: null, model: "rules-only", warning: `AI 潤飾暫不可用，已只套用規則整理：${message}` };
  }
};
