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
  const lb = await load("src/lib/copyPipeline/lengthBudget.ts");
  await check("I3 證據偏少一律寫精簡；三種字數提示", () => {
    const resolve = need(lb, "resolveCopyLength");
    assert.equal(resolve("詳細", "thin"), "精簡");
    assert.equal(resolve("詳細", "rich"), "詳細");
    assert.equal(resolve("標準", "normal"), "標準");
    const line = need(lb, "lengthBudgetLine");
    assert.match(line("精簡"), /120–200 字/);
    assert.match(line("標準"), /250–400 字/);
    assert.match(line("詳細"), /450–600 字/);
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
    for (const label of ["品牌官方英文", "商品原型", "款式怎麼選", "買前會猶豫", "台灣使用注意", "買家評價重點", "台灣常見叫法"]) {
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
  await check("K4 寫手 prompt：只寫 6 個標記（標題兩段＋4 樣），不再寫 SEO；字數真的有用", () => {
    const build = need(chaochao, "buildChaochaoBriefWriterSystemPrompt");
    const p = build("精簡");
    for (const k of ["title_item", "title_diff", "generated_description_html", "generated_faq_html", "why_we_chose_it", "product_highlights"]) {
      assert.ok(p.includes(`[[${k}]]`), k);
    }
    for (const k of ["seo_title", "meta_description", "enriched_title"]) assert.ok(!p.includes(`[[${k}]]`), `不該有 ${k}`);
    assert.match(p, /120–200 字/);
    assert.match(build("詳細"), /450–600 字/);
    assert.ok(!/_copyLength/.test(read("src/lib/providers/chaochaoPrompt.ts").match(/export function buildChaochaoBriefWriterSystemPrompt\([\s\S]*?\)/)[0]), "copyLength 要真的用");
  });
  await check("K5 /api/generate 接線：證據、事實表、檢查、SEO 模板、偏少提醒", () => {
    const route = read("src/app/api/generate/route.ts");
    for (const name of ["buildVariantStructure", "buildReviewEvidence", "scoreEvidence", "resolveCopyLength", "buildTemplateSeo", "checkCopy", "resolveArchetype", "readSourceReviews"]) {
      assert.ok(route.includes(name), name);
    }
    assert.match(route, /raw_capture/);
    assert.match(route, /factSheet/);
    assert.ok(route.includes("📉 資料偏少：這件只找到"), "偏少提醒照抄");
    assert.ok(route.includes("文案已自動寫短。想寫完整，先在備註補尺寸／材質／玩法，或在圖片區勾「文案參考」再重新生成。"));
    assert.match(route, /brandEnglish/);
  });
  await check("K6 單欄重生讀最新一筆事實表", () => {
    const route = read("src/app/api/generate/route.ts");
    const regen = route.slice(route.indexOf("async function handleFieldRegen"), route.indexOf("export async function POST"));
    assert.match(regen, /generation_runs/);
    assert.match(regen, /factSheet/);
    assert.match(regen, /productBrief/);
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
    assert.doesNotMatch(script, /\.(insert|update|upsert|delete|rpc)\(/);
    assert.doesNotMatch(script, /method:\s*["'](PATCH|PUT|DELETE)["']/);
    assert.doesNotMatch(script, /\/api\/generate/);
    assert.doesNotMatch(script, /\/rest\/v1[^"'`]*["'`][^)]*method:\s*["']POST/);
    assert.match(script, /key\.json/);
    assert.match(script, /score-sheet\.html/);
    assert.match(script, /results\.json/);
    assert.match(script, /understand-scores\.json/);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
setKeys({});
console.log(`\nCOPY-A verifier: ${passed} passed, ${failed.length} failed${runA2 ? "" : "（A2 未跑）"}`);
if (failed.length > 0) process.exit(1);
