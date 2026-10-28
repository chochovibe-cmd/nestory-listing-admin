/**
 * OPENROUTER 文字 AI 改道 verifier (written by Claude before construction).
 * OPENROUTER_API_KEY set → every chat/completions call (Writer, Brief, variant polish,
 * Vision ×2) goes to OpenRouter; unset → unchanged OpenAI-direct behaviour.
 * Image calls (images/edits, images/generations) stay on OpenAI.
 * No network, no database (fetch is stubbed). Run from repo root with: npm run verify:openrouter
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
register(pathToFileURL(path.join(root, "scripts/publish-guard-loader.mjs")).href);
const src = (name) => pathToFileURL(path.join(root, name)).href;

// Model defaults are read at module load, so clear overrides before importing.
for (const name of ["OPENAI_COPY_MODEL", "OPENAI_BRIEF_MODEL", "OPENAI_VISION_MODEL", "OPENROUTER_API_KEY", "OPENAI_API_KEY"]) {
  delete process.env[name];
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

let passed = 0;
const failed = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  ✓ " + name);
  } catch (err) {
    failed.push({ name, err });
    console.error("  ✗ " + name + ": " + (err.stack || err));
  }
}

function setKeys({ openai, openrouter }) {
  if (openai === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = openai;
  if (openrouter === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = openrouter;
}

/** Stub fetch, run fn, return the chat/completions calls it made (fn errors are swallowed). */
async function captureCalls(fn, reply = { status: 200, body: { choices: [{ message: { content: "{}" } }], usage: {} } }) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
  };
  let error = null;
  try {
    await fn();
  } catch (err) {
    error = err;
  } finally {
    globalThis.fetch = realFetch;
  }
  return { calls, error };
}

const authOf = (call) => call.headers.Authorization ?? call.headers.authorization;

console.log("\n[A] textAiEndpoint：選哪個服務、模型名稱怎麼寫");
// Missing module → every [A] check fails on its own instead of aborting the run.
const ep = await import(src("src/lib/providers/textAiEndpoint.ts")).catch(() => ({}));

await check("A1 兩把 key 都沒有 → null", () => {
  setKeys({});
  assert.equal(ep.resolveTextAiEndpoint(), null);
  setKeys({ openai: "   ", openrouter: "  " });
  assert.equal(ep.resolveTextAiEndpoint(), null, "只有空白的 key 當作沒設");
});
await check("A2 只有 OPENAI_API_KEY → 照舊打 OpenAI", () => {
  setKeys({ openai: " oa-test " });
  assert.deepEqual(ep.resolveTextAiEndpoint(), { url: OPENAI_URL, apiKey: "oa-test", via: "openai" });
});
await check("A3 有 OPENROUTER_API_KEY → 打 OpenRouter（兩把都有時 OpenRouter 優先）", () => {
  setKeys({ openrouter: "or-test" });
  assert.deepEqual(ep.resolveTextAiEndpoint(), { url: OPENROUTER_URL, apiKey: "or-test", via: "openrouter" });
  setKeys({ openai: "oa-test", openrouter: " or-test " });
  assert.deepEqual(ep.resolveTextAiEndpoint(), { url: OPENROUTER_URL, apiKey: "or-test", via: "openrouter" });
});
await check("A4 textAiModelId：OpenRouter 自動補 openai/，已有斜線的不動；OpenAI 直連不動", () => {
  const or = { url: OPENROUTER_URL, apiKey: "k", via: "openrouter" };
  const oa = { url: OPENAI_URL, apiKey: "k", via: "openai" };
  assert.equal(ep.textAiModelId(or, "gpt-4o"), "openai/gpt-4o");
  assert.equal(ep.textAiModelId(or, "gpt-4o-mini"), "openai/gpt-4o-mini");
  assert.equal(ep.textAiModelId(or, "anthropic/claude-sonnet-5.5"), "anthropic/claude-sonnet-5.5");
  assert.equal(ep.textAiModelId(oa, "gpt-4o"), "gpt-4o");
});
await check("A5 textAiErrorTag：OpenRouter 回 \" [openrouter]\"，OpenAI 回空字串", () => {
  assert.equal(ep.textAiErrorTag({ url: OPENROUTER_URL, apiKey: "k", via: "openrouter" }), " [openrouter]");
  assert.equal(ep.textAiErrorTag({ url: OPENAI_URL, apiKey: "k", via: "openai" }), "");
});

console.log("\n[B] 五個呼叫點實際送出的請求（fetch 假裝回應，不連網）");
const copyMod = await import(src("src/lib/providers/openai-copy-provider.ts"));
const briefMod = await import(src("src/lib/providers/productBrief.ts"));
const polishMod = await import(src("src/lib/providers/variantNamePolish.ts"));
const visionMod = await import(src("src/lib/providers/visionProvider.ts"));

const copyInput = { rawTitle: "測試商品", saleStatus: "預購", tone: "潮巢導購版", copyLength: "標準" };
const briefInput = { rawTitle: "測試商品", saleStatus: "預購" };
const polishInput = { productName: "測試", axisNames: ["顏色"], rows: [["红色"]] };
const sites = [
  { name: "文案 Writer", model: "gpt-4o", run: () => new copyMod.OpenAICopyProvider().generate(copyInput) },
  { name: "Product Brief", model: "gpt-4o-mini", run: () => briefMod.buildProductBrief(briefInput) },
  { name: "款式名稱潤飾", model: "gpt-4o-mini", run: () => polishMod.polishVariantNamesWithOpenAI(polishInput) },
  { name: "Vision 看圖描述", model: "gpt-4o-mini", run: () => visionMod.describeProductImages(["https://example.com/a.jpg"]) },
  { name: "Vision 截圖辨識", model: "gpt-4o-mini", run: () => visionMod.recognizeProductScreenshots(["https://example.com/a.jpg"], "product") },
];

for (const site of sites) {
  await check(`B ${site.name}：有 OpenRouter key → openrouter.ai、Bearer or-test、model openai/${site.model}`, async () => {
    setKeys({ openai: "oa-test", openrouter: "or-test" });
    const { calls } = await captureCalls(site.run);
    assert.ok(calls.length >= 1, "應該送出至少一次請求");
    assert.equal(calls[0].url, OPENROUTER_URL);
    assert.equal(authOf(calls[0]), "Bearer or-test");
    assert.equal(calls[0].body.model, `openai/${site.model}`);
  });
  await check(`B ${site.name}：只有 OpenAI key → 跟改之前一模一樣`, async () => {
    setKeys({ openai: "oa-test" });
    const { calls } = await captureCalls(site.run);
    assert.ok(calls.length >= 1, "應該送出至少一次請求");
    assert.equal(calls[0].url, OPENAI_URL);
    assert.equal(authOf(calls[0]), "Bearer oa-test");
    assert.equal(calls[0].body.model, site.model);
  });
}

await check("B6 兩把 key 都沒有：Writer／Vision 照舊報「OPENAI_API_KEY is not configured」，Brief／潤飾照舊走保守版，都不送請求", async () => {
  setKeys({});
  for (const site of sites) {
    const { calls, error } = await captureCalls(site.run);
    assert.equal(calls.length, 0, `${site.name} 不該送請求`);
    if (["文案 Writer", "Vision 看圖描述", "Vision 截圖辨識"].includes(site.name)) {
      assert.match(String(error?.message), /OPENAI_API_KEY is not configured/);
    }
  }
  const brief = await briefMod.buildProductBrief(briefInput);
  assert.equal(brief.fallback, true);
  const polish = await polishMod.polishVariantNamesWithOpenAI(polishInput);
  assert.equal(polish.model, "rules-only");
});

console.log("\n[C] 錯誤訊息：OpenRouter 點數用完要講中文");
const aiErr = await import(src("src/lib/drafts/aiErrorMessage.ts"));
const fail = await import(src("src/lib/drafts/failReasons.ts"));

await check("C1 Writer 經 OpenRouter 回 402 → 錯誤帶 (402) [openrouter] → 卡片顯示 OpenRouter 點數用完", async () => {
  setKeys({ openrouter: "or-test" });
  const { error } = await captureCalls(() => new copyMod.OpenAICopyProvider().generate(copyInput), {
    status: 402,
    body: { error: { code: 402, message: "Insufficient credits. Add more using https://openrouter.ai/settings/credits" } },
  });
  assert.match(String(error?.message), /\(402\) \[openrouter\]/);
  assert.equal(aiErr.humanizeAiError(error.message), aiErr.OPENROUTER_CREDITS_EXHAUSTED_MESSAGE);
  assert.equal(aiErr.OPENROUTER_CREDITS_EXHAUSTED_MESSAGE, "OpenRouter 點數用完了：請到 OpenRouter 儲值，再重新生成");
  assert.equal(fail.formatDraftFailSummary({ generation_status: "failed", generation_error: error.message }), aiErr.OPENROUTER_CREDITS_EXHAUSTED_MESSAGE);
});
await check("C2 Vision 經 OpenRouter 回 429 → OpenRouter 太忙", async () => {
  setKeys({ openrouter: "or-test" });
  const { error } = await captureCalls(() => visionMod.describeProductImages(["https://example.com/a.jpg"]), {
    status: 429,
    body: { error: { code: 429, message: "Rate limit exceeded" } },
  });
  assert.match(String(error?.message), /\(429\) \[openrouter\]/);
  assert.equal(aiErr.humanizeAiError(error.message), aiErr.OPENROUTER_RATE_LIMITED_MESSAGE);
  assert.equal(aiErr.OPENROUTER_RATE_LIMITED_MESSAGE, "OpenRouter 暫時太忙（429）：稍等一兩分鐘再重新生成");
});
await check("C3 OpenAI 直連的錯誤：不帶 [openrouter]，4a-3 的中文提示照舊", async () => {
  setKeys({ openai: "oa-test" });
  const { error } = await captureCalls(() => new copyMod.OpenAICopyProvider().generate(copyInput), {
    status: 429,
    body: { error: { code: "insufficient_quota", message: "You exceeded your current quota" } },
  });
  assert.doesNotMatch(String(error?.message), /openrouter/i);
  assert.equal(aiErr.humanizeAiError(error.message), aiErr.AI_QUOTA_EXHAUSTED_MESSAGE);
  assert.equal(aiErr.humanizeAiError("OpenAI copy generation failed (500) [openrouter]: boom"), "OpenAI copy generation failed (500) [openrouter]: boom");
});

console.log("\n[D] 範圍：圖片 AI 不動、狀態列、設定範本");
const TEXT_FILES = [
  "src/lib/providers/openai-copy-provider.ts",
  "src/lib/providers/productBrief.ts",
  "src/lib/providers/variantNamePolish.ts",
  "src/lib/providers/visionProvider.ts",
];
await check("D1 四個文字檔不再寫死 api.openai.com，也不再直接讀 OPENAI_API_KEY", () => {
  for (const file of TEXT_FILES) {
    const text = read(file);
    assert.doesNotMatch(text, /api\.openai\.com/, file);
    assert.doesNotMatch(text, /process\.env\.OPENAI_API_KEY/, file);
    assert.match(text, /resolveTextAiEndpoint\(\)/, file);
  }
});
await check("D2 圖片 AI（openai-image-provider.ts）完全沒改：照舊直連 OpenAI、不用 textAiEndpoint", () => {
  const text = read("src/lib/providers/openai-image-provider.ts");
  assert.match(text, /https:\/\/api\.openai\.com\/v1\/images\/edits/);
  assert.match(text, /https:\/\/api\.openai\.com\/v1\/images\/generations/);
  assert.match(text, /process\.env\.OPENAI_API_KEY/);
  assert.doesNotMatch(text, /textAiEndpoint|OPENROUTER/);
});
await check("D3 /api/status 的 aiProvider.openai 用 resolveTextAiEndpoint 判斷（有 OpenRouter key 也算已設定）", () => {
  const text = read("src/app/api/status/route.ts");
  assert.match(text, /openai:\s*resolveTextAiEndpoint\(\)\s*!==\s*null/);
});
await check("D4 .env.example 有 OPENROUTER_API_KEY（上一行是中文註解）；STAGING 範本不動", () => {
  const lines = read(".env.example").split(/\r?\n/);
  const i = lines.findIndex((line) => /^OPENROUTER_API_KEY=\s*$/.test(line));
  assert.ok(i > 0, ".env.example 要有空值的 OPENROUTER_API_KEY=");
  assert.match(lines[i - 1], /^#.*[一-鿿]/);
  assert.doesNotMatch(read("scripts/staging/env-template.txt"), /OPENROUTER/);
});
await check("D5 package.json 有 verify:openrouter，verify-all 有跑這支", () => {
  assert.equal(JSON.parse(read("package.json")).scripts["verify:openrouter"], "node scripts/verify-openrouter.mjs");
  assert.match(read("scripts/verify-all.mjs"), /"scripts\/verify-openrouter\.mjs"/);
});

setKeys({});
console.log(`\n${passed} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
