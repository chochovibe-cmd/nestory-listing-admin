/**
 * COPY-A 文案地基 verifier (written by Claude before construction; spec:
 * docs/COPY-A-文案地基-施工規格-2026-11-03.md).
 *
 * Part A1 = AI cost bookkeeping, AI health banner, model knobs (temperature / reasoning / usage.cost),
 *           Brief JSON tolerance, regen tone default.
 * Part A2 = three-stage copy (evidence → fact sheet v2 → writer writes 5 things → program checks + SEO template).
 *
 * Which part runs: `--part=a1` → A1 only; otherwise A2 runs too once src/lib/copyPipeline/ exists
 * (so verify:all stays green on the A1 branch). No network, no database (fetch is stubbed).
 * Run from repo root: npm run verify:copy-a   (or verify:copy-a1)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const exists = (name) => fs.existsSync(path.join(root, name));
register(pathToFileURL(path.join(root, "scripts/publish-guard-loader.mjs")).href);
const src = (name) => pathToFileURL(path.join(root, name)).href;
const load = (name) => import(src(name)).catch((err) => ({ __loadError: err }));

const onlyA1 = process.argv.includes("--part=a1") || process.env.COPY_A_PART === "a1";
const runA2 = !onlyA1 && exists("src/lib/copyPipeline");

// Model defaults are read at module load, so clear overrides before importing anything.
for (const name of [
  "OPENAI_COPY_MODEL",
  "OPENAI_BRIEF_MODEL",
  "OPENAI_VISION_MODEL",
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_COPY_TEMPERATURE",
  "TEXT_AI_REASONING_EFFORT",
  "NEXT_PUBLIC_VISION_MAX_IMAGES",
]) {
  delete process.env[name];
}

let passed = 0;
const failed = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  ✓ " + name);
  } catch (err) {
    failed.push({ name, err });
    console.error("  ✗ " + name + ": " + (err?.stack || err));
  }
}
const need = (mod, name) => {
  if (mod.__loadError) throw mod.__loadError;
  assert.equal(typeof mod[name], "function", `${name} 要是匯出的函式`);
  return mod[name];
};

function setKeys({ openai, openrouter }) {
  if (openai === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = openai;
  if (openrouter === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = openrouter;
}

/** Stub fetch, run fn, return calls + result (errors captured, not thrown). */
async function withFetch(reply, fn) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({
      url: String(url),
      headers: init.headers ?? {},
      body: typeof init.body === "string" ? JSON.parse(init.body) : null,
    });
    const r = typeof reply === "function" ? reply(String(url), calls.length) : reply;
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
  };
  let result;
  let error = null;
  try {
    result = await fn();
  } catch (err) {
    error = err;
  } finally {
    globalThis.fetch = realFetch;
  }
  return { calls, result, error };
}

const chat = (content, usage = {}) => ({
  status: 200,
  body: { choices: [{ message: { content }, finish_reason: "stop" }], usage },
});

const WRITER_TEXT = [
  "[[enriched_title]]",
  "銀魂 × BOOMCOMIC | 徽章 | 12款系列",
  "[[generated_description_html]]",
  "商品介紹",
  "坂田銀時的死魚眼被做成徽章，掛在包包上剛好。",
  "[[generated_faq_html]]",
  "Q：一共有幾款？",
  "A：共 12 款。",
  "[[seo_title]]",
  "銀魂徽章",
  "[[meta_description]]",
  "銀魂徽章 12 款。",
  "[[why_we_chose_it]]",
  "因為很銀魂。",
  "[[product_highlights]]",
  "・12 款角色",
].join("\n");

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\nCOPY-A verifier — 跑 ${runA2 ? "A1＋A2" : "A1"}`);

console.log("\n[A] aiCost：每一步記成本、上限 NT$2");
const cost = await load("src/lib/ai/aiCost.ts");
const copyMod = await load("src/lib/providers/copy.ts");

await check("A1 常數：1 美元 32 台幣、上限 NT$2、目標 NT$1", () => {
  if (cost.__loadError) throw cost.__loadError;
  assert.equal(cost.AI_COST_TWD_PER_USD, 32);
  assert.equal(cost.AI_COST_CAP_TWD, 2);
  assert.equal(cost.AI_COST_TARGET_TWD, 1);
  assert.equal(need(cost, "usdToTwd")(0.05), 1.6);
});
await check("A2 OpenRouter 回報的實際花費優先", () => {
  const c = need(cost, "stageCost")({
    stage: "writer",
    model: "openai/gpt-4o",
    via: "openrouter",
    usage: { inputTokens: 1000, outputTokens: 500 },
    reportedCostUsd: 0.0123,
  });
  assert.equal(c.costUsd, 0.0123);
  assert.equal(c.reported, true);
  assert.equal(c.stage, "writer");
  assert.equal(c.inputTokens, 1000);
  assert.equal(c.outputTokens, 500);
});
await check("A3 沒回報 → 用 providers/copy.ts 的牌價估算", () => {
  const usage = { inputTokens: 1000, outputTokens: 500 };
  const c = need(cost, "stageCost")({ stage: "understand", model: "gpt-4o", via: "openai", usage, reportedCostUsd: null });
  assert.equal(c.reported, false);
  assert.equal(c.costUsd, need(copyMod, "estimateCopyCostUsd")("gpt-4o", usage));
  assert.equal(c.costUsd, 0.0075);
  const neg = need(cost, "stageCost")({ stage: "vision", model: "gpt-4o-mini", via: "openai", usage, reportedCostUsd: -1 });
  assert.equal(neg.reported, false, "負數回報當作沒回報");
});
await check("A4 加總超過 NT$2 → overCap＋黃字列出每一段", () => {
  const stages = [
    { stage: "vision", model: "m", via: "openrouter", inputTokens: 1, outputTokens: 1, costUsd: 0.02, reported: true },
    { stage: "understand", model: "m", via: "openrouter", inputTokens: 1, outputTokens: 1, costUsd: 0.03, reported: true },
    { stage: "writer", model: "m", via: "openrouter", inputTokens: 1, outputTokens: 1, costUsd: 0.02, reported: true },
  ];
  const record = need(cost, "buildCostRecord")(stages);
  assert.equal(record.version, "copy-a-cost-1");
  assert.equal(record.totalUsd, 0.07);
  assert.equal(record.totalTwd, 2.24);
  assert.equal(record.capTwd, 2);
  assert.equal(record.overCap, true);
  const warning = need(cost, "costOverCapWarning")(record);
  assert.equal(
    warning,
    "💸 這件 AI 花費約 NT$2.24，超過每件上限 NT$2（看圖 NT$0.64／看懂商品 NT$0.96／寫文案 NT$0.64）",
  );
});
await check("A5 沒超過 → 沒有黃字", () => {
  const record = need(cost, "buildCostRecord")([
    { stage: "writer", model: "m", via: "openai", inputTokens: 1, outputTokens: 1, costUsd: 0.02, reported: false },
  ]);
  assert.equal(record.overCap, false);
  assert.equal(record.totalTwd, 0.64);
  assert.equal(need(cost, "costOverCapWarning")(record), null);
  assert.equal(need(cost, "buildCostRecord")([]).totalUsd, 0);
});
await check("A6 瀏覽器轉送的看圖花費：只收 vision、夾上限", () => {
  const sanitize = need(cost, "sanitizeRelayedStageCost");
  assert.equal(sanitize(null), null);
  assert.equal(sanitize({ stage: "writer", model: "x", costUsd: 0.1 }), null, "只收 vision");
  assert.equal(sanitize({ stage: "vision", model: "  ", costUsd: 0.1 }), null, "沒模型名不收");
  const big = sanitize({ stage: "vision", model: "gpt-4o-mini", via: "hacker", costUsd: 5, inputTokens: -3, outputTokens: "x", reported: true });
  assert.equal(big.costUsd, 1, "上限 1 美元");
  assert.equal(big.via, "none");
  assert.equal(big.inputTokens, 0);
  assert.equal(big.outputTokens, 0);
  assert.equal(big.reported, true);
  const ok = sanitize({ stage: "vision", model: "gpt-4o-mini", via: "openrouter", costUsd: 0.0042, inputTokens: 9000, outputTokens: 400 });
  assert.equal(ok.costUsd, 0.0042);
  assert.equal(ok.reported, false);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[B] textAiEndpoint：OpenRouter 回報花費、推理強度");
const ep = await load("src/lib/providers/textAiEndpoint.ts");

await check("B1 直連 OpenAI → 不加任何欄位（行為不變）", () => {
  assert.deepEqual(need(ep, "textAiExtraBody")({ url: "u", apiKey: "k", via: "openai" }), {});
});
await check("B2 OpenRouter → 一律要 usage.cost；沒設推理強度就不送 reasoning", () => {
  delete process.env.TEXT_AI_REASONING_EFFORT;
  assert.deepEqual(need(ep, "textAiExtraBody")({ url: "u", apiKey: "k", via: "openrouter" }), { usage: { include: true } });
});
await check("B3 TEXT_AI_REASONING_EFFORT：合法才送、大小寫空白容錯", () => {
  process.env.TEXT_AI_REASONING_EFFORT = " LOW ";
  assert.deepEqual(need(ep, "textAiExtraBody")({ url: "u", apiKey: "k", via: "openrouter" }), {
    usage: { include: true },
    reasoning: { effort: "low" },
  });
  process.env.TEXT_AI_REASONING_EFFORT = "turbo";
  assert.deepEqual(need(ep, "textAiExtraBody")({ url: "u", apiKey: "k", via: "openrouter" }), { usage: { include: true } });
  process.env.TEXT_AI_REASONING_EFFORT = "low";
  assert.deepEqual(need(ep, "textAiExtraBody")({ url: "u", apiKey: "k", via: "openai" }), {}, "直連 OpenAI 不送");
  delete process.env.TEXT_AI_REASONING_EFFORT;
});
await check("B4 readChatUsage：拆快取、讀 usage.cost", () => {
  const readUsage = need(ep, "readChatUsage");
  assert.deepEqual(
    readUsage({ usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 300 }, cost: 0.0031 } }),
    { inputTokens: 700, outputTokens: 200, cachedInputTokens: 300, cacheCreationTokens: 0, reportedCostUsd: 0.0031 },
  );
  assert.equal(readUsage({ usage: { prompt_tokens: 10, completion_tokens: 5 } }).reportedCostUsd, null);
  assert.equal(readUsage({ usage: { cost: 0 } }).reportedCostUsd, 0, "0 元也是回報");
  assert.equal(readUsage(null).inputTokens, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[C] Writer：temperature 用環境變數、花費帶回來");
const writerMod = await load("src/lib/providers/openai-copy-provider.ts");
const writerInput = { rawTitle: "銀魂 徽章", saleStatus: "預購中", tone: "潮巢導購版", copyLength: "標準" };
const runWriter = async () => {
  const Provider = writerMod.OpenAICopyProvider;
  if (!Provider) throw writerMod.__loadError ?? new Error("OpenAICopyProvider 沒匯出");
  return new Provider().generate(writerInput);
};

await check("C1 沒設任何新變數、直連 OpenAI → body 跟現在一樣（沒有 temperature／usage／reasoning）", async () => {
  setKeys({ openai: "oa-test" });
  const { calls, error } = await withFetch(chat(WRITER_TEXT, { prompt_tokens: 100, completion_tokens: 50 }), runWriter);
  assert.equal(error, null, String(error));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.model, "gpt-4o");
  assert.equal("temperature" in calls[0].body, false);
  assert.equal("usage" in calls[0].body, false);
  assert.equal("reasoning" in calls[0].body, false);
  assert.equal(calls[0].body.max_tokens, 3000);
});
await check("C2 OpenRouter＋OPENAI_COPY_TEMPERATURE=0.7 → 送 0.7＋usage.include", async () => {
  setKeys({ openai: "oa-test", openrouter: "or-test" });
  process.env.OPENAI_COPY_TEMPERATURE = "0.7";
  const { calls, error } = await withFetch(chat(WRITER_TEXT, { prompt_tokens: 100, completion_tokens: 50, cost: 0.004 }), runWriter);
  delete process.env.OPENAI_COPY_TEMPERATURE;
  assert.equal(error, null, String(error));
  assert.equal(calls[0].body.temperature, 0.7);
  assert.deepEqual(calls[0].body.usage, { include: true });
  assert.equal(calls[0].body.model, "openai/gpt-4o");
});
await check("C3 不合法的 temperature（abc、3、-1）不送", async () => {
  setKeys({ openai: "oa-test" });
  for (const bad of ["abc", "3", "-1"]) {
    process.env.OPENAI_COPY_TEMPERATURE = bad;
    const { calls } = await withFetch(chat(WRITER_TEXT), runWriter);
    assert.equal("temperature" in (calls[0]?.body ?? {}), false, `「${bad}」不該送`);
  }
  process.env.OPENAI_COPY_TEMPERATURE = "0";
  const { calls } = await withFetch(chat(WRITER_TEXT), runWriter);
  assert.equal(calls[0].body.temperature, 0, "0 是合法值");
  delete process.env.OPENAI_COPY_TEMPERATURE;
});
await check("C4 OpenRouter 回報的花費成為 usage.costUsd，output.via＝openrouter", async () => {
  setKeys({ openrouter: "or-test" });
  const { result, error } = await withFetch(chat(WRITER_TEXT, { prompt_tokens: 100, completion_tokens: 50, cost: 0.004 }), runWriter);
  assert.equal(error, null, String(error));
  assert.equal(result.usage.costUsd, 0.004);
  assert.equal(result.usage.reportedCostUsd, 0.004);
  assert.equal(result.via, "openrouter");
  assert.equal(result.model, "gpt-4o", "記錄的模型名不帶 openai/");
});
await check("C5 直連 OpenAI 沒回報 → 照牌價估算、via＝openai", async () => {
  setKeys({ openai: "oa-test" });
  const { result, error } = await withFetch(chat(WRITER_TEXT, { prompt_tokens: 1000, completion_tokens: 500 }), runWriter);
  assert.equal(error, null, String(error));
  assert.equal(result.usage.costUsd, 0.0075);
  assert.equal(result.via, "openai");
});

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[D] Brief：別家模型的 JSON 也讀得懂、記看懂商品的花費");
const briefMod = await load("src/lib/providers/productBrief.ts");
const BRIEF_JSON = JSON.stringify({
  identity: { ip: "銀魂", character: "坂田銀時", productType: "吊飾徽章", brand: "BOOMCOMIC", category: "", sku: "" },
  title: { enrichedTitle: "銀魂 × BOOMCOMIC | 徽章 | 12款系列", ip: "銀魂", brand: "BOOMCOMIC", item: "徽章", diff: "12款系列" },
  confirmedFacts: ["共 12 款"],
  specLines: ["材質：馬口鐵"],
});

await check("D1 parseBriefJson：去掉 ```json 圍欄、前面多一句話也讀得到", () => {
  const parse = need(briefMod, "parseBriefJson");
  assert.equal(parse("```json\n" + BRIEF_JSON + "\n```").identity.ip, "銀魂");
  assert.equal(parse("好的，以下是 JSON：\n" + BRIEF_JSON + "\n以上").identity.brand, "BOOMCOMIC");
  assert.throws(() => parse("完全沒有 JSON"));
});
await check("D2 buildProductBrief：包圍欄的回覆不再退回保守版；花費記成 understand", async () => {
  setKeys({ openrouter: "or-test" });
  const { calls, result, error } = await withFetch(
    chat("```json\n" + BRIEF_JSON + "\n```", { prompt_tokens: 2000, completion_tokens: 300, cost: 0.0006 }),
    () => briefMod.buildProductBrief({ rawTitle: "银魂 徽章", saleStatus: "預購中" }),
  );
  assert.equal(error, null, String(error));
  assert.equal(result.fallback, false, result.warning);
  assert.equal(result.brief.identity.ip, "銀魂");
  assert.deepEqual(calls[0].body.usage, { include: true });
  assert.equal(calls[0].body.temperature, 0.1, "Brief 的 temperature 不動");
  assert.equal(result.cost.stage, "understand");
  assert.equal(result.cost.costUsd, 0.0006);
  assert.equal(result.cost.reported, true);
  assert.equal(result.cost.via, "openrouter");
  assert.equal(result.cost.model, "gpt-4o-mini");
});

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[E] 看圖：回傳花費");
const visionMod = await load("src/lib/providers/visionProvider.ts");

await check("E1 describeProductImagesWithCost 回 { text, cost(vision) }", async () => {
  setKeys({ openrouter: "or-test" });
  const fn = need(visionMod, "describeProductImagesWithCost");
  const { calls, result, error } = await withFetch(
    chat("【外觀描述】黃色\n【圖上文字】（無）", { prompt_tokens: 9000, completion_tokens: 300, cost: 0.0021 }),
    () => fn(["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"]),
  );
  assert.equal(error, null, String(error));
  assert.match(result.text, /外觀描述/);
  assert.equal(result.cost.stage, "vision");
  assert.equal(result.cost.costUsd, 0.0021);
  assert.equal(result.cost.model, "gpt-4o-mini");
  assert.deepEqual(calls[0].body.usage, { include: true });
});
await check("E2 describeProductImages 照舊只回文字", async () => {
  setKeys({ openai: "oa-test" });
  const { result, error } = await withFetch(chat("【外觀描述】黃色"), () => visionMod.describeProductImages(["https://cdn.example/a.jpg"]));
  assert.equal(error, null, String(error));
  assert.equal(typeof result, "string");
});

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[F] 頁面頂端紅色提醒");
const health = await load("src/lib/ai/aiHealth.ts");
const NOW = new Date("2026-11-03T08:00:00Z"); // 台北 16:00

await check("F1 常數：餘額低於 US$2、失敗 48 小時內", () => {
  if (health.__loadError) throw health.__loadError;
  assert.equal(health.AI_HEALTH_LOW_BALANCE_USD, 2);
  assert.equal(health.AI_HEALTH_FAILURE_WINDOW_HOURS, 48);
});
await check("F2 isAiProviderFailure：只認 AI 服務端的錯，不認逾時／網路", () => {
  const is = need(health, "isAiProviderFailure");
  for (const yes of [
    "OpenAI copy generation failed (402) [openrouter]: {\"error\":\"Insufficient credits\"}",
    "OpenAI copy generation failed (429): insufficient_quota",
    "Product Brief failed (401) [openrouter]: no auth",
    "OpenAI copy generation failed (503) [openrouter]: upstream",
    "OPENAI_API_KEY is not configured on the server.",
  ]) assert.equal(is(yes), true, yes);
  for (const no of ["文案 AI 逾時，請再試一次，或改用另一個模型。", "fetch failed", "OpenAI copy generation failed (400): bad", "", null]) {
    assert.equal(is(no), false, String(no));
  }
});
await check("F3 沒有金鑰 → 停擺提醒（最優先）", () => {
  const text = need(health, "aiHealthBannerText")({
    hasTextAiKey: false,
    lastRun: { status: "failed", error: "OpenAI copy generation failed (402) [openrouter]: x", finishedAt: "2026-11-03T06:05:00Z" },
    openRouterRemainingUsd: 0.5,
    now: NOW,
  });
  assert.equal(text, "AI 文案停擺：伺服器沒有設定 OPENROUTER_API_KEY（或 OPENAI_API_KEY），新商品產不出文案。");
});
await check("F4 最近一次因 AI 服務失敗 → 失敗提醒（台北時間＋中文原因）", () => {
  const text = need(health, "aiHealthBannerText")({
    hasTextAiKey: true,
    lastRun: { status: "failed", error: "OpenAI copy generation failed (402) [openrouter]: x", finishedAt: "2026-11-03T06:05:00Z" },
    openRouterRemainingUsd: 0.5,
    now: NOW,
  });
  assert.match(text, /^AI 文案生成失敗（/);
  assert.match(text, /11\/03/);
  assert.match(text, /14:05/);
  assert.match(text, /OpenRouter 點數用完了/);
  assert.match(text, /修好前新商品產不出文案。$/);
});
await check("F5 失敗超過 48 小時、或最近一次成功 → 不提失敗", () => {
  const fn = need(health, "aiHealthBannerText");
  const old = { status: "failed", error: "OpenAI copy generation failed (402) [openrouter]: x", finishedAt: "2026-10-30T06:05:00Z" };
  assert.equal(fn({ hasTextAiKey: true, lastRun: old, openRouterRemainingUsd: null, now: NOW }), null);
  const ok = { status: "completed", error: null, finishedAt: "2026-11-03T07:00:00Z" };
  assert.equal(fn({ hasTextAiKey: true, lastRun: ok, openRouterRemainingUsd: 50, now: NOW }), null);
  const timeout = { status: "failed", error: "文案 AI 逾時，請再試一次，或改用另一個模型。", finishedAt: "2026-11-03T07:00:00Z" };
  assert.equal(fn({ hasTextAiKey: true, lastRun: timeout, openRouterRemainingUsd: null, now: NOW }), null, "逾時不算");
});
await check("F6 餘額低於 US$2 → 儲值提醒；剛好 2 不提醒；查不到餘額不提醒", () => {
  const fn = need(health, "aiHealthBannerText");
  const ok = { status: "completed", error: null, finishedAt: "2026-11-03T07:00:00Z" };
  assert.equal(
    fn({ hasTextAiKey: true, lastRun: ok, openRouterRemainingUsd: 1.37, now: NOW }),
    "OpenRouter 餘額剩 US$1.37（約 NT$44），快用完了：請到 OpenRouter 儲值。",
  );
  assert.equal(fn({ hasTextAiKey: true, lastRun: ok, openRouterRemainingUsd: 2, now: NOW }), null);
  assert.equal(fn({ hasTextAiKey: true, lastRun: null, openRouterRemainingUsd: null, now: NOW }), null);
  assert.match(fn({ hasTextAiKey: true, lastRun: null, openRouterRemainingUsd: -0.4, now: NOW }), /US\$0\.00（約 NT\$0）/);
});
await check("F7 fetchOpenRouterRemainingUsd：GET /api/v1/credits、算剩多少、出錯回 null", async () => {
  const fn = need(health, "fetchOpenRouterRemainingUsd");
  const good = await withFetch({ status: 200, body: { data: { total_credits: 10, total_usage: 8.634 } } }, () => fn("or-key"));
  assert.equal(good.result, 1.37);
  assert.equal(good.calls[0].url, "https://openrouter.ai/api/v1/credits");
  const auth = good.calls[0].headers.Authorization ?? good.calls[0].headers.authorization;
  assert.equal(auth, "Bearer or-key");
  assert.equal((await withFetch({ status: 401, body: {} }, () => fn("k"))).result, null);
  assert.equal((await withFetch({ status: 200, body: { data: {} } }, () => fn("k"))).result, null);
  const thrown = await withFetch(new Error("network"), () => fn("k"));
  assert.equal(thrown.error, null, "不可以往外丟錯");
  assert.equal(thrown.result, null);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[G] 接線（讀原始碼）");
await check("G1 layout：<AiHealthBanner /> 緊接在 <EnvironmentBanner /> 下一行", () => {
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /<EnvironmentBanner \/>\s*\n\s*<AiHealthBanner \/>/);
  assert.match(layout, /import \{ AiHealthBanner \} from "@\/components\/AiHealthBanner"/);
});
await check("G2 AiHealthBanner：沿用 env-banner--danger、role=alert、不新增 CSS", () => {
  const banner = read("src/components/AiHealthBanner.tsx");
  assert.match(banner, /className="env-banner env-banner--danger"/);
  assert.match(banner, /role="alert"/);
  assert.match(banner, /aiHealthBannerText/);
  assert.match(banner, /\.from\("generation_runs"\)/);
  assert.doesNotMatch(banner, /\.(insert|update|upsert|delete)\(/, "提醒列只能讀");
  for (const css of fs.readdirSync(path.join(root, "src/app")).filter((f) => f.endsWith(".css"))) {
    assert.doesNotMatch(read(`src/app/${css}`), /ai-health/, `${css} 不准加 ai-health 樣式`);
  }
});
await check("G3 analyze-images 回傳 visionCost；佇列轉送給 /api/generate", () => {
  const analyze = read("src/app/api/analyze-images/route.ts");
  assert.match(analyze, /describeProductImagesWithCost/);
  assert.match(analyze, /visionCost/);
  const runner = read("src/components/listing/GenerationQueueRunner.tsx");
  assert.ok((runner.match(/visionCost/g) ?? []).length >= 3, "整頁生成和重生兩條路都要轉送");
});
await check("G4 /api/generate：收轉送花費、建帳、超標黃字、寫進 generation_runs", () => {
  const route = read("src/app/api/generate/route.ts");
  assert.match(route, /sanitizeRelayedStageCost\(body\.visionCost\)/);
  assert.match(route, /buildCostRecord\(/);
  assert.match(route, /costOverCapWarning\(/);
  assert.match(route, /cost:\s*costRecord/);
  assert.match(route, /\bcost_estimate\b/, "generation_runs.cost_estimate 要寫");
  assert.match(route, /generation_cost_estimate:\s*costRecord\.totalUsd/);
});
await check("G5 語氣預設：API 和重生視窗都不再預設黑膠", () => {
  const route = read("src/app/api/generate/route.ts");
  assert.doesNotMatch(route, /:\s*"黑膠文藝收藏感";/, "body.tone 不合法時不可再預設黑膠");
  const card = read("src/components/listing/ResultCard.tsx");
  assert.doesNotMatch(card, /useState<CopyTone>\(COPY_TONES\[0\]\)/);
  assert.match(card, /useState<CopyTone>\("潮巢導購版"\)/);
  assert.match(card, /draft\.generation_tone/);
});
await check("G6 .env.example、package.json、verify-all 都登記了", () => {
  const env = read(".env.example");
  assert.match(env, /^OPENAI_COPY_TEMPERATURE=/m);
  assert.match(env, /^TEXT_AI_REASONING_EFFORT=/m);
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["verify:copy-a"], "node scripts/verify-copy-a.mjs");
  assert.equal(pkg.scripts["verify:copy-a1"], "node scripts/verify-copy-a.mjs --part=a1");
  assert.match(read("scripts/verify-all.mjs"), /"scripts\/verify-copy-a\.mjs"/);
});
await check("G7 沒有新增 migration（成本只寫現有欄位）", () => {
  const files = fs.readdirSync(path.join(root, "supabase/migrations"));
  assert.equal(files.filter((f) => /copy_a|ai_cost|ai_usage|ai_health/i.test(f)).length, 0, files.join(", "));
});
await check("G8 圖片 AI、Claude provider 沒被動到", () => {
  for (const file of ["src/lib/providers/openai-image-provider.ts", "src/lib/providers/claude-copy-provider.ts"]) {
    assert.doesNotMatch(read(file), /textAiExtraBody|readChatUsage|aiCost/, file);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
if (runA2) {
  console.log("\n[H] A2 ① 程式整理資料 evidence.ts");
  const ev = await load("src/lib/copyPipeline/evidence.ts");
  const chars = ["睡衣小新", "動感超人", "妮妮", "風間", "正男", "阿呆", "小白"];
  const rows = chars.flatMap((c) => ["單拍", "禮盒"].map((p) => ({ option1_value: c, option2_value: p, option3_value: null })));

  await check("H1 款式結構：兩軸、照出現順序、不截斷", () => {
    const vs = need(ev, "buildVariantStructure")(rows);
    assert.equal(vs.count, 14);
    assert.deepEqual(vs.axes, [chars, ["單拍", "禮盒"]]);
    assert.equal(
      vs.text,
      ["款式共 14 款", `- 第 1 軸（7 種）：${chars.join("、")}`, "- 第 2 軸（2 種）：單拍、禮盒"].join("\n"),
    );
  });
  await check("H2 只有一軸 → 寫「款式（N 種）」", () => {
    const vs = need(ev, "buildVariantStructure")([{ option1_value: "紅" }, { option1_value: "藍" }, { option1_value: "紅 " }]);
    assert.equal(vs.count, 3);
    assert.equal(vs.text, "款式共 3 款\n- 款式（2 種）：紅、藍");
  });
  await check("H3 一軸超過 60 個值 → 「…等 N 種」，整段 ≤ 2500 字", () => {
    const many = Array.from({ length: 70 }, (_, i) => ({ option1_value: `角色${i + 1}號很長的名字` }));
    const vs = need(ev, "buildVariantStructure")(many);
    assert.match(vs.text, /…等 70 種/);
    assert.ok(vs.text.length <= 2500, String(vs.text.length));
    assert.equal(need(ev, "buildVariantStructure")([]).count, 0);
  });
  await check("H4 買家評價區塊：固定標題、沒有的行不寫、短評最多 5 則 120 字", () => {
    const fn = need(ev, "buildReviewEvidence");
    assert.equal(fn(null), "");
    const text = fn({
      source: "ice",
      total_text: "2000+",
      good_rate_text: "99%",
      tags: [{ text: "尺寸剛好", count: 23 }, { text: "做工精細", count: null }],
      samples: Array.from({ length: 7 }, (_, i) => ({ text: "做工很好比想像中小一點".repeat(i === 0 ? 20 : 1), sku: i === 1 ? "小新睡衣款" : null, date: null })),
      signals: [],
    });
    const lines = text.split("\n");
    assert.equal(lines[0], "買家評價（淘寶原頁；只能用來理解商品，不可寫成「買家說」、不可引用原句）");
    assert.equal(lines[1], "- 評價數：2000+；好評率：99%");
    assert.equal(lines[2], "- 印象標籤：尺寸剛好(23)、做工精細");
    const samples = lines.filter((l) => l.startsWith("- 短評："));
    assert.equal(samples.length, 5);
    assert.ok(samples[0].length <= "- 短評：".length + 120, "每則 120 字");
    assert.match(samples[1], /（款式：小新睡衣款）$/);
    assert.equal(lines.some((l) => l.startsWith("- 店鋪訊號")), false, "沒有訊號就不寫");
  });
  await check("H5 證據量公式與門檻（<6 偏少、≥14 豐富）", () => {
    const fn = need(ev, "scoreEvidence");
    const base = { factCount: 0, specCount: 0, visionTextChars: 0, hasReviews: false, noteChars: 0 };
    assert.deepEqual(fn({ ...base, factCount: 5 }), { score: 5, level: "thin" });
    assert.deepEqual(fn({ ...base, factCount: 6 }), { score: 6, level: "normal" });
    assert.deepEqual(fn({ ...base, specCount: 9, factCount: 12 }), { score: 20, level: "rich" });
    assert.deepEqual(fn({ factCount: 3, specCount: 2, visionTextChars: 80, hasReviews: true, noteChars: 20 }), { score: 12, level: "normal" });
    assert.deepEqual(fn({ ...base, specCount: 3, factCount: 2, visionTextChars: 79, noteChars: 19 }), { score: 8, level: "normal" });
  });

  console.log("\n[I] A2 原型表、字數、SEO 模板");
  const arch = await load("src/lib/copyPipeline/archetype.ts");
  const tax = await load("src/lib/shopify/taxonomyCategory.ts");
  await check("I1 每個型態都有原型（跟 Shopify 類別表同一組 key）", () => {
    if (arch.__loadError) throw arch.__loadError;
    const missing = Object.keys(tax.SHOPIFY_CATEGORY_BY_TYPE).filter((k) => !(k in arch.ARCHETYPE_BY_TYPE));
    assert.deepEqual(missing, []);
    assert.deepEqual(arch.ARCHETYPES, ["角色收藏", "機能用品", "生活日用", "穿搭配件"]);
    assert.equal(arch.ARCHETYPE_BY_TYPE["盲盒"], "角色收藏");
    assert.equal(arch.ARCHETYPE_BY_TYPE["鍵盤"], "機能用品");
    assert.equal(arch.ARCHETYPE_BY_TYPE["保溫杯瓶"], "生活日用");
    assert.equal(arch.ARCHETYPE_BY_TYPE["包包"], "穿搭配件");
  });
  await check("I2 resolveArchetype：事實表優先、不合法退回查表、都沒有回空", () => {
    const fn = need(arch, "resolveArchetype");
    assert.equal(fn("機能用品", "盲盒"), "機能用品");
    assert.equal(fn("收藏品", "盲盒"), "角色收藏");
    assert.equal(fn("", "羽毛球拍"), "");
    assert.equal(fn(null, null), "");
  });
  await check("I3 A2b 寫手模式不再使用字數預算提示", () => {
    const prompt = read("src/lib/providers/chaochaoPrompt.ts");
    const start = prompt.indexOf("export function buildChaochaoBriefWriterSystemPrompt");
    const end = prompt.indexOf("const CHAOCHAO_REGEN_FIELD_RULES", start);
    assert.ok(start >= 0 && end > start);
    assert.doesNotMatch(prompt.slice(start, end), /lengthBudgetLine|CHAOCHAO_OWNER_VOICE_SAMPLES/);
  });
  const seo = await load("src/lib/copyPipeline/seoTemplate.ts");
  await check("I4 SEO 套模板：標題＋店名尾巴；描述取正文第一段（去掉段落標題）", () => {
    const out = need(seo, "buildTemplateSeo")({
      title: "銀魂 × BOOMCOMIC | 徽章 | 12款系列",
      descriptionText: "商品介紹\n坂田銀時的死魚眼被做成徽章，掛在包包上剛好。第二句也在。\n\n收藏亮點\n別的段落",
    });
    assert.match(out.seoTitle, /^銀魂 × BOOMCOMIC \| 徽章/);
    assert.match(out.seoTitle, /\| 潮巢 Nestory$/);
    assert.match(out.metaDescription, /^坂田銀時的死魚眼被做成徽章/);
    assert.doesNotMatch(out.metaDescription, /商品介紹|收藏亮點|別的段落/);
  });

  console.log("\n[J] A2 ④ 文案檢查 copyChecks.ts");
  const cc = await load("src/lib/copyPipeline/copyChecks.ts");
  const clean = {
    title: "銀魂 × BOOMCOMIC | 徽章 | 銀時・神樂等",
    descriptionText: "坂田銀時的死魚眼被做成徽章，共 12 款，直徑 5.8cm。",
    highlights: ["12 款角色", "直徑 5.8cm"],
    whyWeChoseIt: "銀魂迷會懂的表情。",
    faqHtml: "<h3><strong>一共有幾款？</strong></h3><p>共 12 款，隨機出貨。</p><h3><strong>多大？</strong></h3><p>直徑約 5.8cm。</p>",
    evidenceText: "银魂 徽章 款式共 12 款 直径5.8cm 马口铁",
    facts: { requiresVoltage: false, voltage: "", taiwanRisks: [] },
  };
  const codes = (issues) => issues.map((i) => i.code).sort();
  const SIMPLIFIED_SAMPLE = "这们说时会对发";

  await check("J1 乾淨的文案 → 沒有問題", () => {
    assert.deepEqual(need(cc, "checkCopy")(clean), []);
  });
  await check("J2 每一種問題都抓得到，訊息都以【文案檢查】開頭，同一種只出一條", () => {
    const issues = need(cc, "checkCopy")({
      ...clean,
      descriptionText: `${SIMPLIFIED_SAMPLE}這是神器，完美的視頻教學，共 35 款。`,
      highlights: ["高品質", "完美"],
      whyWeChoseIt: "",
      faqHtml: "<h3><strong>問題</strong></h3><p>似乎可以，建議查看實物。</p>",
      facts: { requiresVoltage: true, voltage: "", taiwanRisks: [] },
    });
    assert.deepEqual(codes(issues), [
      "ai_tone",
      "empty_field",
      "faq_format",
      "faq_unknown",
      "mainland_term",
      "number_not_in_evidence",
      "simplified",
      "voltage_missing",
    ]);
    for (const issue of issues) {
      assert.match(issue.message, /^【文案檢查】/);
      assert.equal(typeof issue.field, "string");
    }
    const sim = issues.find((i) => i.code === "simplified").message;
    for (const ch of SIMPLIFIED_SAMPLE) assert.ok(sim.includes(ch), `簡體字「${ch}」要列出來`);
    assert.match(issues.find((i) => i.code === "mainland_term").message, /「視頻」是大陸用語，台灣說「影片」/);
    assert.match(issues.find((i) => i.code === "number_not_in_evidence").message, /35/);
    assert.match(issues.find((i) => i.code === "empty_field").message, /為什麼選它/);
  });
  await check("J3 220V：事實表有 220V 風險但正文／FAQ 沒提 → 提醒；有提就不提醒", () => {
    const fn = need(cc, "checkCopy");
    const facts = { requiresVoltage: true, voltage: "220V", taiwanRisks: ["220V，台灣 110V 不能直接用"] };
    const evidenceText = clean.evidenceText + " 220V 台灣 110V";
    assert.deepEqual(codes(fn({ ...clean, evidenceText, facts })), ["voltage_220"]);
    const ok = fn({ ...clean, evidenceText, facts, faqHtml: clean.faqHtml + "<h3><strong>台灣能用嗎？</strong></h3><p>這是 220V，台灣 110V 要變壓器。</p>" });
    assert.deepEqual(codes(ok), []);
  });
  await check("J4 數字比對：小數、同數字不同寫法都算有；FAQ 超過 5 題算格式錯", () => {
    const fn = need(cc, "checkCopy");
    assert.deepEqual(codes(fn({ ...clean, descriptionText: "直徑 5.8 公分。" })), []);
    const six = Array.from({ length: 6 }, (_, i) => `<h3><strong>問${i}嗎？</strong></h3><p>是。</p>`).join("");
    assert.deepEqual(codes(fn({ ...clean, faqHtml: six })), ["faq_format"]);
    assert.deepEqual(codes(fn({ ...clean, faqHtml: "<h3><strong>只有一題？</strong></h3><p>是。</p>" })), ["faq_format"]);
  });

  console.log("\n[K] A2 ② 事實表 v2、③ 寫手只寫 5 樣（讀程式＋原始碼）");
  await check("K1 事實表新欄位都有預設值；原型、旗標只收清單內的值", () => {
    if (briefMod.__loadError) throw briefMod.__loadError;
    assert.equal(briefMod.PRODUCT_BRIEF_VERSION, "pb2.0-copya-20261103");
    const parse = need(briefMod, "normalizeBrief");
    const empty = parse({}, { rawTitle: "x", saleStatus: "預購中" });
    assert.equal(empty.identity.brandEnglish, "");
    assert.equal(empty.identity.ipEnglish, "");
    assert.equal(empty.archetype, "");
    assert.deepEqual(empty.archetypeFlags, []);
    assert.deepEqual(empty.variantGuide, []);
    assert.deepEqual(empty.buyerHesitations, []);
    assert.deepEqual(empty.taiwanRisks, []);
    assert.equal(empty.requiresVoltage, false);
    assert.equal(empty.voltage, "");
    assert.deepEqual(empty.reviewInsights, []);
    assert.equal(empty.taiwanNaming, "");
    const full = parse(
      { identity: { brandEnglish: "MINISO" }, archetype: "收藏品", archetypeFlags: ["隨機盲盒", "限量", "預購"], requiresVoltage: "yes" },
      { rawTitle: "x", saleStatus: "預購中" },
    );
    assert.equal(full.identity.brandEnglish, "MINISO");
    assert.equal(full.archetype, "");
    assert.deepEqual(full.archetypeFlags, ["隨機盲盒", "預購"]);
    assert.equal(full.requiresVoltage, false, "只有 true 才算");
  });
  await check("K2 交給寫手的事實表印出新段落", () => {
    const parse = need(briefMod, "normalizeBrief");
    const brief = parse(
      {
        identity: { brandEnglish: "MINISO", ipEnglish: "Dragon Ball" },
        archetype: "角色收藏",
        buyerHesitations: ["會不會重複？"],
        taiwanRisks: ["220V，台灣 110V 不能直接用"],
        reviewInsights: ["多位買家說比想像中小"],
        variantGuide: ["7 個角色，單盒隨機"],
        taiwanNaming: "鍵帽盲盒",
      },
      { rawTitle: "x", saleStatus: "預購中" },
    );
    const text = need(briefMod, "serializeProductBriefForWriter")(brief);
    for (const label of ["品牌官方英文", "商品原型", "款式怎麼選", "可當 FAQ 題材", "台灣使用", "買家評價重點", "台灣常見叫法"]) {
      assert.ok(text.includes(label), `少了「${label}」`);
    }
    assert.match(text, /MINISO/);
  });
  await check("K3 Brief 規則 14–21 與款式上限 2500 字", () => {
    const s = read("src/lib/providers/productBrief.ts");
    for (const key of ["brandEnglish", "ipEnglish", "archetypeFlags", "variantGuide", "buyerHesitations", "requiresVoltage", "reviewInsights", "taiwanNaming"]) {
      assert.ok(s.includes(key), key);
    }
    assert.match(s, /14\. identity\.brandEnglish/);
    assert.match(s, /21\. taiwanNaming/);
    assert.match(s, /clamp\(input\.variantSummary, 2500\)/);
  });
  const chaochao = await load("src/lib/providers/chaochaoPrompt.ts");
  await check("K4 A2b 寫手 prompt：8 組標記、兩段正文、SEO 描述由寫手產生且不帶舊樣板", () => {
    const build = need(chaochao, "buildChaochaoBriefWriterSystemPrompt");
    const p = build("精簡");
    for (const k of ["title_item", "title_diff", "generated_description_html", "generated_faq_html", "why_we_chose_it", "product_highlights", "seo_title", "seo_description"]) {
      assert.ok(p.includes(`[[${k}]]`), k);
    }
    assert.doesNotMatch(p, /收藏亮點|3–5 題|商品資料標示為|CHAOCHAO_OWNER_VOICE_SAMPLES/);
    assert.match(p, /純文字兩段/);
    assert.match(p, /適合誰/);
  });
  await check("K5 /api/generate 接線：Brief 成功走共用 pipeline，其他路徑保留舊流程", () => {
    const route = read("src/app/api/generate/route.ts");
    for (const name of ["buildVariantStructure", "buildReviewEvidence", "scoreEvidence", "resolveArchetype", "readSourceReviews", "runBriefWriterPipeline"]) {
      assert.ok(route.includes(name), name);
    }
    assert.match(route, /raw_capture/);
    assert.match(route, /factSheet/);
    assert.ok(read("src/lib/copyPipeline/briefWriterPipeline.ts").includes("runBriefWriterPipeline"));
    assert.match(route, /brandEnglish/);
  });
  await check("K6 單欄重生讀最新一筆事實表", () => {
    const route = read("src/app/api/generate/route.ts");
    const regen = route.slice(route.indexOf("async function handleFieldRegen"), route.indexOf("export async function POST"));
    assert.match(regen, /generation_runs/);
    assert.match(regen, /factSheet/);
    assert.match(regen, /productBrief/);
  });

  console.log("\n[M] A2 自動補寫一欄（老闆 11-03 同意）、標題品牌在前（老闆 11-03 定 A）");
  await check("M1 pickAutoFixField：照優先順序挑一欄、帶上那一欄全部問題；電壓／簡體不自動補", () => {
    const pick = need(cc, "pickAutoFixField");
    assert.deepEqual(cc.AUTO_FIX_PRIORITY, ["empty_field", "number_not_in_evidence", "faq_unknown", "faq_format", "ai_tone"]);
    assert.equal(cc.AI_AUTO_FIX_BUDGET_TWD, 1.5);
    const issues = [
      { code: "ai_tone", field: "generated_description_html", message: "【文案檢查】a" },
      { code: "faq_format", field: "generated_faq_html", message: "【文案檢查】b" },
      { code: "faq_unknown", field: "generated_faq_html", message: "【文案檢查】c" },
      { code: "voltage_missing", field: "facts", message: "【文案檢查】d" },
    ];
    const got = pick(issues);
    assert.equal(got.field, "generated_faq_html");
    assert.deepEqual(got.issues.map((i) => i.code), ["faq_format", "faq_unknown"]);
    assert.equal(pick([issues[3], { code: "simplified", field: "generated_description_html", message: "x" }]), null);
    assert.equal(pick([]), null);
    assert.equal(pick([{ code: "empty_field", field: "why_we_chose_it", message: "x" }, ...issues]).field, "why_we_chose_it");
  });
  await check("M2 checkCopy 的 field 都是固定值（可重生欄位或 facts）", () => {
    const allowed = ["enriched_title", "generated_description_html", "generated_faq_html", "why_we_chose_it", "product_highlights", "facts"];
    const issues = need(cc, "checkCopy")({
      ...clean,
      title: "",
      descriptionText: "这是神器，視頻共 35 款。",
      highlights: [],
      whyWeChoseIt: "",
      faqHtml: "",
      facts: { requiresVoltage: true, voltage: "", taiwanRisks: [] },
    });
    for (const issue of issues) assert.ok(allowed.includes(issue.field), `${issue.code} 的 field「${issue.field}」不在清單`);
    assert.equal(issues.find((i) => i.code === "voltage_missing").field, "facts");
  });
  await check("M3 aiCost 多一段「自動補寫」", () => {
    const record = need(cost, "buildCostRecord")([
      { stage: "writer", model: "m", via: "openrouter", inputTokens: 1, outputTokens: 1, costUsd: 0.06, reported: true },
      { stage: "fix", model: "m", via: "openrouter", inputTokens: 1, outputTokens: 1, costUsd: 0.01, reported: true },
    ]);
    assert.match(need(cost, "costOverCapWarning")(record), /自動補寫 NT\$0\.32/);
  });
  await check("M4 Brief pipeline 自動補寫接線：預算與只一次", () => {
    const route = read("src/app/api/generate/route.ts");
    const pipeline = read("src/lib/copyPipeline/briefWriterPipeline.ts");
    assert.match(pipeline, /AI_AUTO_FIX_BUDGET_TWD/);
    assert.match(pipeline, /retries \+= 1/);
    assert.match(pipeline, /stageCost\(\{ stage, model: call\.model/);
    assert.match(route, /runBriefWriterPipeline/);
  });
  const tc = await load("src/lib/contentGenerator/titleContract.ts");
  await check("M5 assembleIpBrandSegment：品牌在前、同名只寫一次", () => {
    const fn = need(tc, "assembleIpBrandSegment");
    assert.equal(fn("三麗鷗 Sanrio", "Bandai"), "Bandai × 三麗鷗 Sanrio");
    assert.equal(fn("銀魂 Gintama", "BOOMCOMIC"), "BOOMCOMIC × 銀魂 Gintama");
    assert.equal(fn("三麗鷗 Sanrio", "Sanrio"), "三麗鷗 Sanrio");
    assert.equal(fn("", "VICTOR"), "VICTOR");
    assert.equal(fn("七龍珠Z", ""), "七龍珠Z");
    const title = need(tc, "finalizeProductTitle")({ rawTitle: "x", titleIp: "銀魂 Gintama", titleBrand: "BOOMCOMIC", titleItem: "徽章", titleDiff: "銀時・神樂等" });
    assert.match(title, /^BOOMCOMIC × 銀魂 Gintama \| 徽章/);
  });
  await check("M6 標題規則文字都改成品牌在前；IP 英文由事實表補", () => {
    assert.ok(read("src/lib/providers/titlePrompt.ts").includes("品牌官方英文 × IP中文＋英文"));
    assert.ok(read("src/lib/providers/titlePrompt.ts").includes("Bandai × 三麗鷗 Sanrio | 家族米粒公仔吊飾盲盒 | 隨機單盒"));
    assert.ok(read("src/lib/providers/productBrief.ts").includes("12. title.enrichedTitle 依「品牌官方英文 × IP中文＋英文 | 精準品項 | 重要差異」整理"));
    assert.match(read("src/lib/contentGenerator/titleGeneratorBase.ts"), /productBrand \+ ' × ' \+ ipDisplayName/);
    assert.match(read("src/app/api/generate/route.ts"), /ipEnglish/);
  });

  console.log("\n[L] A2 看圖張數、盲測腳本");
  const cref = await load("src/lib/images/copyReference.ts");
  await check("L1 NEXT_PUBLIC_VISION_MAX_IMAGES：1–10 才算，否則 6；自動挑照這個數", () => {
    const cap = need(cref, "autoVisionImageCap");
    assert.equal(cref.MAX_AUTO_VISION_IMAGES, 10);
    assert.equal(cref.MAX_COPY_REFERENCE_IMAGES, 6, "手動勾選上限不變");
    delete process.env.NEXT_PUBLIC_VISION_MAX_IMAGES;
    assert.equal(cap(), 6);
    for (const [raw, want] of [["10", 10], ["1", 1], ["0", 6], ["11", 6], ["abc", 6], ["8.5", 6]]) {
      process.env.NEXT_PUBLIC_VISION_MAX_IMAGES = raw;
      assert.equal(cap(), want, raw);
    }
    process.env.NEXT_PUBLIC_VISION_MAX_IMAGES = "10";
    const candidates = [
      { imageType: "main", url: "m", sortOrder: 0 },
      ...Array.from({ length: 20 }, (_, i) => ({ imageType: "detail", url: `d${i}`, sortOrder: i + 1 })),
    ];
    assert.equal(cref.selectRepresentativeVisionImages(candidates).length, 10);
    delete process.env.NEXT_PUBLIC_VISION_MAX_IMAGES;
    assert.equal(cref.selectRepresentativeVisionImages(candidates).length, 6);
  });
  await check("L2 盲測腳本存在、只讀資料庫、不打 /api/generate、字母對照另存", () => {
    const script = read("scripts/copy-a-blindtest.mjs");
    // Supabase 寫入一律從 .from(...) 開始；一般 Map/Set 的 .delete() 不算。
    assert.doesNotMatch(script, /\.from\([^)]*\)[\s\S]{0,120}?\.(insert|update|upsert|delete)\(/);
    assert.doesNotMatch(script, /\.rpc\(/);
    assert.doesNotMatch(script, /method:\s*["'](PATCH|PUT|DELETE)["']/);
    assert.doesNotMatch(script, /\/api\/generate/);
    assert.doesNotMatch(script, /\/rest\/v1[^"'`]*["'`][^)]*method:\s*["']POST/);
    assert.match(script, /key\.json/);
    assert.match(script, /score-sheet\.html/);
    assert.match(script, /results\.json/);
    assert.match(script, /understand-scores\.json/);
  });

  console.log("\n[N] COPY-A2b 離線驗收（純函式＋假 provider）");
  const bp = await load("src/lib/copyPipeline/briefWriterPipeline.ts");
  const cc2 = await load("src/lib/copyPipeline/copyChecks.ts");
  const seo2 = await load("src/lib/copyPipeline/seoTemplate.ts");
  const html = await load("src/lib/contentGenerator/htmlFormat.ts");
  const a2Output = {
    enrichedTitle: "徽章", titleItem: "徽章", titleDiff: "佐助等角色", titleIp: "", titleBrand: "",
    generatedDescriptionHtml: "商品介紹\n佐助戴著斗笠的畫面很有趣，放在桌上陪你工作。這款徽章讓日常多一點火影氣氛。讓熟悉的角色走出展示櫃，在每次工作空檔抬頭時，都能遇到喜歡的表情與顏色。\n\n適合誰\n・想收藏火影周邊的人\n・送給喜歡佐助的朋友",
    generatedFaqHtml: "Q：有多大？\nA：直徑 5 公分。\n\nQ：款式能指定嗎？\nA：不能指定。",
    seoTitle: "火影忍者佐助徽章｜潮巢 Nestory", metaDescription: "佐助徽章，放在桌上陪你工作，送給火影迷也很適合。",
    whyWeChoseIt: "佐助的斗笠造型很有辨識度。", productHighlights: ["・佐助斗笠造型", "・適合桌面收藏"],
    detectedIpName: "火影忍者", detectedCharacterName: "佐助", detectedProductType: "徽章", detectedProductBrand: "",
    detectedCategory: "", sku: "", provider: "test", model: "test",
  };
  const a2Brief = { identity: { brand: "", ip: "火影忍者", brandEnglish: "", ipEnglish: "" }, archetypeFlags: [], voltage: "", requiresVoltage: false, taiwanRisks: [] };
  await check("A2b-1 清理不確定／出貨句：只移除整句", () => {
    const clean = need(bp, "cleanBriefCopy")({ ...a2Output, generatedDescriptionHtml: "商品介紹\n畫面很可愛。預購約需 14 個工作天。\n\n適合誰\n・送給朋友。" });
    assert.match(clean.generatedDescriptionHtml, /畫面很可愛。/);
    for (const char of "商品品質") assert.ok(!cc2.SIMPLIFIED_ONLY_CHARS.includes(char), char + " 繁簡共用字不可誤報簡體");
    const quality = need(bp, "cleanBriefCopy")({ ...a2Output, generatedDescriptionHtml: "商品介紹\n品質有保證，絕佳收藏。\n\n適合誰\n・送給朋友。" });
    assert.match(quality.generatedDescriptionHtml, /品質有保證，絕佳收藏/ , "一般商品品質行銷句不得當成物流／未知句刪除");
    assert.doesNotMatch(clean.generatedDescriptionHtml, /預購|工作天/);
  });
  await check("A2b-2 全形標點：轉標點但保留數字、尺寸、網址", () => {
    const fn = need(cc2, "normalizeCustomerPunctuation");
    const got = fn("好看,可愛! 1,000 29×8 cm https://a.b/c?d=1");
    assert.match(got, /好看，可愛！/); assert.match(got, /1,000/); assert.match(got, /29×8 cm/); assert.match(got, /https:\/\/a\.b\/c\?d=1/);
  });
  await check("A2b-3 大陸詞替換成台灣用語", () => {
    const clean = need(bp, "cleanBriefCopy")({ ...a2Output, generatedDescriptionHtml: "商品介紹\n塑料材質的翻轉屏很好看。\n\n適合誰\n・送朋友。" });
    assert.match(clean.generatedDescriptionHtml, /塑膠材質的翻轉螢幕/);
  });
  await check("A2b-4 禁止句移除且保留同段其他內容", () => {
    const fn = need(cc2, "removeDisallowedBriefSentences");
    assert.equal(fn("畫面很可愛。資料未提供，約需 14 個工作天。放在桌上也很適合。"), "畫面很可愛。放在桌上也很適合。");
  });
  await check("A2b-5 標題品牌/IP 頭去重，並由 assembler 排序", () => {
    const title = need(bp, "assembleBriefTitle");
    assert.equal(title({ ...a2Output, titleItem: "徽章", titleDiff: "佐助等角色" }, { ...a2Brief, identity: { brand: "三麗鷗", ip: "三麗鷗", brandEnglish: "Sanrio", ipEnglish: "Sanrio" } }), "三麗鷗 | 徽章 | 佐助等角色");
    assert.equal(title({ ...a2Output, titleDiff: "" }, { ...a2Brief, identity: { brand: "VICTOR", ip: "七龍珠", brandEnglish: "", ipEnglish: "" } }), "VICTOR × 七龍珠 | 徽章");
  });
  await check("A2b-6 正文只組商品介紹＋適合誰；盲盒提醒條件式、現貨才有出貨句", async () => {
    const format = need(html, "formatBriefDescriptionHtml");
    const base = { intro: "畫面很可愛。", suitableFor: ["自己收藏", "送給朋友"] };
    assert.equal((format(base).match(/<h2>/g) ?? []).length, 2);
    const stockPlain = need(html, "normalizeDescriptionToPlainText")(format({ ...base, saleStatus: "台灣現貨" }));
    const stockHtml = need(html, "formatChaochaoSalesDescriptionHtml")(stockPlain, "台灣現貨");
    assert.equal((stockHtml.match(/工作天出貨/g) ?? []).length, 1, "持久化及重新組裝不得重複現貨出貨句");
    assert.doesNotMatch(stockHtml, /收藏亮點|商品資訊/);
    const boxed = format({ ...base, archetypeFlags: ["隨機盲盒"] });
    assert.equal((boxed.match(/<h2>/g) ?? []).length, 3);
    assert.match(boxed, /商品介紹|適合誰|購買前提醒/); assert.match(boxed, /盲盒為隨機出貨/);
    assert.doesNotMatch(format({ ...base, saleStatus: "非台灣現貨" }), /出貨|到貨/);
    assert.match(format({ ...base, saleStatus: "台灣現貨" }), /台灣現貨/);
  });
  await check("A2b-7 審稿可刪有效句／FAQ／詞，壞 JSON 原文保留並標記 review_failed", async () => {
    const apply = need(bp, "applyBriefReview");
    const reviewed = apply(a2Output, { sentences: [2, 999], faq: [1, 999], terms: [{ field: "title", term: "佐助" }, { field: "seo_title", term: "不存在" }] });
    assert.equal(reviewed.review.failed, false); assert.match(reviewed.output.generatedDescriptionHtml, /佐助戴著斗笠/); assert.doesNotMatch(reviewed.output.generatedDescriptionHtml, /這款徽章讓日常多一點火影氣氛/);
    assert.equal(reviewed.output.generatedFaqHtml.includes("有多大"), false);
    assert.doesNotMatch(reviewed.output.titleDiff, /佐助/);
    const failedReview = apply(a2Output, "not-json"); assert.equal(failedReview.review.failed, true); assert.equal(failedReview.output, a2Output);
    const pipeline = need(bp, "runBriefWriterPipeline"); let calls = 0; const regenFields = [];
    const result = await pipeline({
      input: { rawTitle: "火影徽章", saleStatus: "預購中", tone: "潮巢導購版", copyLength: "標準" }, brief: a2Brief,
      provider: { generate: async (input) => { calls++; regenFields.push(input.regenerateField); return calls === 1 ? { ...a2Output, productHighlights: ["・佐助斗笠造型"] } : { ...a2Output, productHighlights: ["・佐助斗笠造型", "・適合桌面收藏"] }; } },
      review: async (_input, _brief, output) => ({ output, review: { failed: true, deleted: { sentences: [], faq: [], terms: [] } } }),
    });
    assert.equal(result.checks.some((x) => x.code === "review_failed"), true);
    assert.equal(result.retries, 1); assert.equal(calls, 2, "自動補寫只呼叫一次，不能循環");
    assert.deepEqual(regenFields, [undefined, "product_highlights"], "只補寫審稿後不足的亮點欄位");
  });
  await check("A2b-8 審稿後亮點不足會產生 product_highlights 補寫候選", () => {
    const candidates = need(bp, "briefAutoFixCandidates")({ ...a2Output, productHighlights: ["・只剩一行"] });
    assert.ok(candidates.some((x) => x.field === "product_highlights"));
  });
  await check("A2b-9 SEO 去重品牌、在句界截斷並用完整句 fallback", () => {
    const finalize = need(seo2, "finalizeBriefSeo");
    const longTitle = "火影忍者徽章｜" + "更多款式｜其他內容｜再加一段｜額外尾巴｜".repeat(8);
    const out = finalize({ seoTitle: "火影忍者徽章｜潮巢 Nestory", metaDescription: "超長內容。".repeat(30), title: longTitle, descriptionText: "商品介紹\n這是一段完整描述。" });
    assert.equal((out.seoTitle.match(/潮巢 Nestory/g) ?? []).length, 1); assert.ok(Array.from(out.seoTitle).length <= 60);
    assert.ok(out.metaDescription.length <= 90); assert.ok(out.metaDescription.endsWith("。"));
    assert.equal(need(seo2, "clampAtSentence")("沒有句號".repeat(20), 10), "");
    const bounded = finalize({ seoTitle: longTitle, metaDescription: "", title: "火影徽章", descriptionText: "介紹" });
    assert.ok(Array.from(bounded.seoTitle).length <= 60); assert.ok(bounded.seoTitle.endsWith(" | 潮巢 Nestory")); assert.ok(!bounded.seoTitle.includes("額外尾巴｜".repeat(8)));
  });
  await check("A2b-10 Brief 寫手 prompt 有兩條線與 SEO description，沒有舊 FAQ/亮點樣板", () => {
    const prompt = read("src/lib/providers/chaochaoPrompt.ts");
    const start = prompt.indexOf("export function buildChaochaoBriefWriterSystemPrompt"); const end = prompt.indexOf("const CHAOCHAO_REGEN_FIELD_RULES", start); const block = prompt.slice(start, end);
    assert.match(block, /兩條線/); assert.match(block, /\[\[seo_description\]\]/); assert.doesNotMatch(block, /收藏亮點|3–5 題|商品資料標示為|CHAOCHAO_OWNER_VOICE_SAMPLES/);
    const envExample = read(".env.example");
    assert.match(envExample, /^OPENAI_REVIEW_MODEL=gpt-4o-mini$/m);
    assert.match(envExample, /^OPENAI_COPY_FALLBACK_MODEL=$/m);
  });
  await check("A2b-11 Brief 序列化不暴露未知／銷售狀態，保留款式清單", async () => {
    const briefModule = await load("src/lib/providers/productBrief.ts");
    const brief = need(briefModule, "normalizeBrief")({ variantNames: ["佐助", "鳴人"], unknowns: ["仍未知"], saleStatus: "預購中" }, { rawTitle: "火影徽章", variantRows: [{ option1_value: "【正版授權】佐助+鳴人" }], saleStatus: "預購中" });
    const serialized = need(briefModule, "serializeProductBriefForWriter")(brief);
    assert.match(serialized, /款式清單/); assert.doesNotMatch(serialized, /仍未知|未確認|銷售狀態|預購中/);
  });
  await check("A2b-12 OpenAI Writer 空內容會重試一次（fetch 全 stub）", async () => {
    setKeys({ openai: "oa-test" });
    const mod = await load("src/lib/providers/openai-copy-provider.ts"); const Provider = mod.OpenAICopyProvider;
    const calls = []; const realFetch = globalThis.fetch;
    globalThis.fetch = async (_url, init = {}) => {
      calls.push(JSON.parse(init.body));
      const content = calls.length === 1 ? null : "[[title_item]]\n徽章\n[[title_diff]]\n\n[[generated_description_html]]\n商品介紹\n" + "佐助徽章讓桌面多一點角色陪伴，打開包裹時看見熟悉的表情，工作空檔也能得到一點輕鬆感。掛在包包上出門，讓喜歡的作品自然加入日常。細節造型讓收藏不只待在盒子裡，也能成為每天看得到的小風景。\n\n適合誰\n・想收藏火影周邊的人\n・送給喜歡火影的朋友\n[[product_highlights]]\n・角色徽章\n・桌面收藏\n[[why_we_chose_it]]\n斗笠造型辨識度高\n[[generated_faq_html]]\n\n[[seo_title]]\n火影徽章\n[[seo_description]]\n火影徽章，適合收藏也適合送禮。";
      return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    try {
      const provider = new Provider(); await provider.generate({ rawTitle: "火影徽章", saleStatus: "預購中", tone: "潮巢導購版", copyLength: "標準", productBrief: "款式清單：佐助" });
      assert.equal(calls.length, 2, "空內容後必須重試一次");
    } finally { globalThis.fetch = realFetch; setKeys({}); }
  });
  await check("A2b-13 截斷只重試一次、fallback 一次，所有已付呼叫都記帳", async () => {
    setKeys({ openai: "oa-test" });
    const mod = await load("src/lib/providers/openai-copy-provider.ts");
    const valid = [["title_item", "徽章"], ["title_diff", ""], ["generated_description_html", a2Output.generatedDescriptionHtml], ["product_highlights", "・角色造型\n・指定款式"], ["why_we_chose_it", ""], ["generated_faq_html", ""], ["seo_title", "火影徽章"], ["seo_description", "火影徽章，帶著熟悉的角色進入每天的工作與生活。"]].map(([key, value]) => "[[" + key + "]]\n" + value).join("\n");
    const original = globalThis.fetch; const fallback = process.env.OPENAI_COPY_FALLBACK_MODEL;
    const requests = [];
    globalThis.fetch = async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: requests.length <= 2 ? "[[title_item]]\n徽章" : valid } }], usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0.01 } }), { status: 200 });
    };
    try {
      process.env.OPENAI_COPY_FALLBACK_MODEL = "fallback-model";
      const output = await new mod.OpenAICopyProvider().generate({ rawTitle: "徽章", saleStatus: "預購中", tone: "潮巢導購版", copyLength: "標準", productBrief: "事實表" });
      assert.equal(requests.length, 3); assert.equal(requests[2].model, "fallback-model");
      assert.equal(output.writerRetries, 2); assert.equal(output.callCosts.length, 3); assert.equal(output.usage.costUsd, 0.03);
      requests.length = 0; delete process.env.OPENAI_COPY_FALLBACK_MODEL;
      await assert.rejects(() => new mod.OpenAICopyProvider().generate({ rawTitle: "徽章", saleStatus: "預購中", tone: "潮巢導購版", copyLength: "標準", productBrief: "事實表" }), /文案解析失敗/);
      assert.equal(requests.length, 2);
    } finally { globalThis.fetch = original; if (fallback === undefined) delete process.env.OPENAI_COPY_FALLBACK_MODEL; else process.env.OPENAI_COPY_FALLBACK_MODEL = fallback; setKeys({}); }
  });
  await check("A2b-14 寫手與審稿 prompt 逐字等於規格原文", async () => {
    const spec = read("docs/COPY-A2b-瘦身施工規格-2026-11-11.md");
    const exact = (section) => spec.split(section)[1].split("\x60\x60\x60")[1].trim().replace(/\r\n/g, "\n");
    const prompt = await load("src/lib/providers/chaochaoPrompt.ts");
    assert.equal(prompt.buildChaochaoBriefWriterSystemPrompt("標準").replace(/\r\n/g, "\n"), exact("## 1."));
    assert.equal(bp.BRIEF_REVIEW_SYSTEM_PROMPT.replace(/\r\n/g, "\n"), exact("## 4."));
  });

}

// ─────────────────────────────────────────────────────────────────────────────
setKeys({});
console.log(`\nCOPY-A verifier: ${passed} passed, ${failed.length} failed${runA2 ? "" : "（A2 未跑）"}`);
if (failed.length > 0) process.exit(1);
