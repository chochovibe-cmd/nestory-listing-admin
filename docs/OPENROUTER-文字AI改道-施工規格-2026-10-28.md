# OPENROUTER 文字 AI 改道｜施工規格（2026-10-28，Claude）

> 驗收測試：`scripts/verify-openrouter.mjs`（24 項，Claude 先寫；在現行程式上跑是 8 過 16 不過，施工後要 24/24）。
> 規格分支：`docs/openrouter-spec`。GPT 施工分支：`gpt/openrouter-text-ai`，Draft PR 進 `handoff/20261008-golive-spec`。

## 0. 一句話

OpenAI 儲值用完了，所以文案 Writer、Product Brief、看圖（Vision）、款式名稱潤飾全部停擺。這包新增一個環境變數 `OPENROUTER_API_KEY`：
- **有設**：這 5 個「文字類」呼叫改送 OpenRouter。模型照舊是 gpt-4o／gpt-4o-mini，只是換個門口，程式會自動在名稱前加 `openai/`。
- **沒設**：跟現在一模一樣。

圖片 AI（去字、轉繁、重生圖、詳情圖合成）**不動**，因為 OpenRouter 沒有 `images/edits`。

插隊理由：符合 CURRENT_STATUS §6 的插隊門檻「上架失敗」，因為沒有 AI 就產不出文案。

## 1. 做法（寫死）

### 1.1 新檔 `src/lib/providers/textAiEndpoint.ts`（照抄）

```ts
/**
 * OPENROUTER (2026-10-28): every text-model call (Writer, Product Brief, variant-name
 * polish, Vision ×2) speaks OpenAI's chat/completions format, which OpenRouter accepts
 * as-is. OPENROUTER_API_KEY set → those calls go to OpenRouter; unset → OpenAI direct,
 * exactly as before. Image calls (images/edits, images/generations) have no OpenRouter
 * equivalent and stay on OPENAI_API_KEY in openai-image-provider.ts.
 */

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

export type TextAiEndpoint = {
  url: string;
  apiKey: string;
  via: "openrouter" | "openai";
};

/** OpenRouter wins when both keys are set; null when neither is. */
export function resolveTextAiEndpoint(): TextAiEndpoint | null {
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  if (openRouterKey) return { url: OPENROUTER_CHAT_URL, apiKey: openRouterKey, via: "openrouter" };
  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  if (openAiKey) return { url: OPENAI_CHAT_URL, apiKey: openAiKey, via: "openai" };
  return null;
}

/** OpenRouter names models "vendor/model"; bare OpenAI names get "openai/". */
export function textAiModelId(endpoint: TextAiEndpoint, model: string): string {
  return endpoint.via === "openrouter" && !model.includes("/") ? `openai/${model}` : model;
}

/** Appended right after "(status)" in error text so humanizeAiError can tell OpenRouter apart. */
export function textAiErrorTag(endpoint: TextAiEndpoint): string {
  return endpoint.via === "openrouter" ? " [openrouter]" : "";
}
```

### 1.2 五個呼叫點：只換「門口、鑰匙、模型名、錯誤標記」

| 檔案 | 函式 | 原本的錯誤字串 → 改成 |
|---|---|---|
| `src/lib/providers/openai-copy-provider.ts` | `OpenAICopyProvider.generate` | `` `OpenAI copy generation failed (${response.status})${textAiErrorTag(endpoint)}: ${errorText}` `` |
| `src/lib/providers/productBrief.ts` | `buildProductBrief` | `` `Product Brief failed (${response.status})${textAiErrorTag(endpoint)}: ${(await response.text()).slice(0, 240)}` `` |
| `src/lib/providers/variantNamePolish.ts` | `polishVariantNamesWithOpenAI` | `` `AI 潤飾失敗（${response.status}）${textAiErrorTag(endpoint)}：${(await response.text()).slice(0, 160)}` `` |
| `src/lib/providers/visionProvider.ts` | `callVision` | `` `OpenAI vision call failed (${response.status})${textAiErrorTag(endpoint)}: ${errorText}` `` |
| `src/lib/providers/visionProvider.ts` | `recognizeProductScreenshots` | 同上 |

每個呼叫點都只做這四件事：
1. 把 `const apiKey = process.env.OPENAI_API_KEY`（有的有 `?.trim()`）和 `if (!apiKey)` 改成 `const endpoint = resolveTextAiEndpoint();` 和 `if (!endpoint)`。**if 裡面的內容一字不改**：Writer、Vision 照舊丟「OPENAI_API_KEY is not configured on the server.」，Brief、潤飾照舊走保守版，warning 文字也不改。
2. `fetch("https://api.openai.com/v1/chat/completions", …)` 改成 `fetch(endpoint.url, …)`；`Authorization` 改成 `` `Bearer ${endpoint.apiKey}` ``。
3. body 的 `model` 改成 `textAiModelId(endpoint, <原本的模型變數>)`。`DEFAULT_MODEL`、`DEFAULT_VISION_MODEL`、`OPENAI_BRIEF_MODEL` 的預設值不動。**回傳和寫進資料庫的 model 名稱維持原本，不帶 `openai/`**，所以 `generateWithParseRetry(…, "openai", DEFAULT_MODEL, …)` 和成本估算都不改。
4. 錯誤字串照上表改。

其他一律不動：`max_tokens`、`temperature`、`response_format`、`messages`、timeout、usage 解析、retry。

### 1.3 `src/lib/drafts/aiErrorMessage.ts`

新增兩個常數，並在 `humanizeAiError` 裡、`if (!raw) return raw;` 之後插入 OpenRouter 分支。原本的 OpenAI 判斷不動。檔頭註解改成「OpenAI 429 and OpenRouter 402/429 texts are rewritten」。

```ts
export const OPENROUTER_CREDITS_EXHAUSTED_MESSAGE = "OpenRouter 點數用完了：請到 OpenRouter 儲值，再重新生成";
export const OPENROUTER_RATE_LIMITED_MESSAGE = "OpenRouter 暫時太忙（429）：稍等一兩分鐘再重新生成";

// 在 humanizeAiError 內：
  // OPENROUTER: errors from the OpenRouter route carry " [openrouter]" (textAiEndpoint.ts).
  if (/\[openrouter\]/i.test(raw)) {
    if (/\b402\b/.test(raw)) return OPENROUTER_CREDITS_EXHAUSTED_MESSAGE;
    if (/\b429\b/.test(raw)) return OPENROUTER_RATE_LIMITED_MESSAGE;
    return raw;
  }
```

### 1.4 `src/app/api/status/route.ts`

`openai: Boolean(process.env.OPENAI_API_KEY),` 改成 `openai: resolveTextAiEndpoint() !== null,`，再加上 import。這樣只設 OpenRouter key 時，狀態列也會顯示 AI 已設定。

### 1.5 `.env.example`

在 `OPENAI_COPY_MODEL=` 那一行後面加上：

```
# OpenRouter 金鑰（選填）：有填，文案／Brief／看圖／款式潤飾改走 OpenRouter（模型照舊，自動加 openai/）；圖片 AI 仍用 OPENAI_API_KEY
OPENROUTER_API_KEY=
```

### 1.6 `package.json`、`scripts/verify-all.mjs`

- `package.json` 的 scripts 加 `"verify:openrouter": "node scripts/verify-openrouter.mjs"`。
- `verify-all.mjs` 清單在 `"scripts/verify-4e.mjs"` 後面加上註解 `// OPENROUTER: text AI calls via OpenRouter when OPENROUTER_API_KEY is set.` 和 `"scripts/verify-openrouter.mjs"`。

## 2. 禁止

- 不動 `openai-image-provider.ts`、`runAiProcess.ts`、`detailCompose/**`（圖片 AI）。
- 不動 `scripts/staging/env-template.txt`（`verify-staging-fence` 把清單鎖死了）。
- 不改任何 UI。設定頁、DeploymentStatus 上的「OpenAI」字樣照舊。
- 不改模型預設值、prompt、`max_tokens`、`temperature`。
- 不加 OpenRouter 的額外 header（`HTTP-Referer`、`X-Title`），也不加 provider 路由參數。
- 不碰 Claude provider（`claude-copy-provider.ts`）。
- 不改 `scripts/verify-openrouter.mjs`。覺得測試有錯，就在 PR 裡寫出來給 Claude。

## 3. 驗收

1. `npm run verify:openrouter` 24/24。
2. CI：verify:all → typecheck → build 全綠。
3. Claude 逐行審 diff，然後老闆貼「Claude 審查 PASS」。
4. 上線後實機（Claude）：老闆照常生成 1 件 → Claude 唯讀查 `product_drafts`：`generation_model` 是 gpt-4o、tokens 有值、`generation_error` 是空的。老闆在 OpenRouter 後台 Activity 看得到 `openai/gpt-4o` 和 `openai/gpt-4o-mini` 的呼叫。

## 4. 上線順序（重要）

1. **老闆先在 Vercel Production 加 `OPENROUTER_API_KEY`**。金鑰只有老闆經手，GPT 和 Claude 都不碰。
2. GPT 合併 → 等預覽 READY → Redeploy 成 Production。環境變數是在部署那一刻才帶進去的，所以**一定要在加好 key 之後才部署**。
3. 驗 `/login` 200 和 githubCommitSha，再確認 `/api/status` 的 `aiProvider.openai` 是 `true`。

回退方法：
- 在 Vercel 刪掉 `OPENROUTER_API_KEY` 再 Redeploy，就回到直連 OpenAI，程式不用退。
- 或 Redeploy 回 `dpl_5GPdjhKMs6YLjNaHKC4EjXoqzg8A`（fb0efea）。

## 5. 不在這包（記到總表 7 COPY-A）

- 三段式分工：程式整理資料 → 便宜模型看懂商品 → 好模型只寫文案 → 程式檢查。外加寫手盲測和每件成本上限。
- 有了這包以後，換模型測試只要改環境變數，例如 `OPENAI_COPY_MODEL=anthropic/claude-sonnet-5.5`。但 prompt 和解析跟其他模型相不相容，要在 COPY-A 盲測時一起驗。
