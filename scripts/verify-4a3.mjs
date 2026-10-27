/**
 * 4a-3 小修合集-1 verifier (written by Claude before construction).
 * ① 商品庫搜尋全形／半形「｜」 ② OpenAI 429 中文提示 (detail images moved to 4e).
 * No network, no database. Run from repo root with: npm run verify:4a3
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
const library = await import(src("src/lib/library/productLibrary.ts"));
const aiErr = await import(src("src/lib/drafts/aiErrorMessage.ts"));
const fail = await import(src("src/lib/drafts/failReasons.ts"));

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

console.log("\n[A] 商品庫搜尋：全形／半形一樣找得到");

const row = (title) => ({ title_zh: title, original_title: null, taobao_title: null, ip_name: null, character_name: null, shopify_product_id: null });
await check("A1 normalizeLibrarySearchText：全形轉半形、轉小寫、｜和 | 當空白、空白合併", () => {
  assert.equal(library.normalizeLibrarySearchText("七龍珠｜球拍"), "七龍珠 球拍");
  assert.equal(library.normalizeLibrarySearchText("  七龍珠 | 球拍  "), "七龍珠 球拍");
  assert.equal(library.normalizeLibrarySearchText("ＨＯＬＬＹ　ＢＯＸ１２３"), "holly box123");
  assert.equal(library.normalizeLibrarySearchText(null), "");
});

await check("A2 matchesLibraryQuery：「七龍珠｜球拍」「七龍珠|悟空」都找得到「七龍珠 | 球拍 悟空」", () => {
  const r = row("七龍珠 | 球拍 悟空");
  for (const q of ["七龍珠｜球拍", "七龍珠|球拍", "七龍珠 | 球拍", "七龍珠|悟空", "  ", ""]) {
    assert.equal(library.matchesLibraryQuery(r, q), true, q);
  }
  assert.equal(library.matchesLibraryQuery(row("Hello Kitty 貼紙"), "ｈｅｌｌｏ　ｋｉｔｔｙ"), true);
  assert.equal(library.matchesLibraryQuery(row("海賊王｜草帽"), "海賊王 | 草帽"), true);
  assert.equal(library.matchesLibraryQuery(r, "海賊王"), false);
});

console.log("\n[B] OpenAI 429 改中文");

const QUOTA_RAW = `OpenAI copy generation failed (429): {
    "error": {
        "message": "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.",
        "type": "insufficient_quota",
        "param": null,
        "code": "credit_balance_exhausted"
    }
}`;
await check("B1 正式資料庫 10-22 那 3 筆原文 → 額度用完", () => {
  assert.equal(aiErr.humanizeAiError(QUOTA_RAW), aiErr.AI_QUOTA_EXHAUSTED_MESSAGE);
  assert.equal(aiErr.AI_QUOTA_EXHAUSTED_MESSAGE, "OpenAI 額度用完了：請到 OpenAI 後台儲值，再重新生成");
  assert.equal(aiErr.humanizeAiError('OpenAI vision call failed (429): {"error":{"code":"insufficient_quota"}}'), aiErr.AI_QUOTA_EXHAUSTED_MESSAGE);
});

await check("B2 OpenAI 其他 429（太忙）→ 稍後再試", () => {
  const busy = 'OpenAI copy generation failed (429): {"error":{"type":"requests","code":"rate_limit_exceeded"}}';
  assert.equal(aiErr.humanizeAiError(busy), aiErr.AI_RATE_LIMITED_MESSAGE);
  assert.equal(aiErr.AI_RATE_LIMITED_MESSAGE, "OpenAI 暫時太忙（429）：稍等一兩分鐘再重新生成");
  assert.equal(aiErr.humanizeAiError("Product Brief failed (429): openai rate limit"), aiErr.AI_RATE_LIMITED_MESSAGE);
});

await check("B3 不是 OpenAI 429 的訊息原樣不動", () => {
  for (const t of [
    "Anthropic copy generation failed (429): overloaded",
    "OpenAI vision call failed (500): server error",
    "缺成本，請先確認",
    "OpenAI copy generation failed (4290)"
  ]) assert.equal(aiErr.humanizeAiError(t), t);
  assert.equal(aiErr.humanizeAiError(null), "");
  assert.equal(aiErr.humanizeAiError("  x  "), "x");
});

await check("B4 卡片失敗原因（formatDraftFailSummary）：舊的英文 generation_error 也顯示中文", () => {
  assert.equal(fail.formatDraftFailSummary({ generation_status: "failed", generation_error: QUOTA_RAW }), aiErr.AI_QUOTA_EXHAUSTED_MESSAGE);
  assert.equal(fail.formatDraftFailSummary({ status: "api_failed", generation_error: null, error_message: QUOTA_RAW }), aiErr.AI_QUOTA_EXHAUSTED_MESSAGE);
  assert.equal(fail.formatDraftFailSummary({ generation_status: "failed", generation_error: "Copy regen failed" }), "Copy regen failed");
  assert.equal(fail.formatDraftFailSummary({ generation_status: "completed", generation_error: QUOTA_RAW }), null);
});

await check("B5 GenerationQueueRunner：toast／進度顯示用中文，回報伺服器的 errorText 保持原文", () => {
  const s = read("src/components/listing/GenerationQueueRunner.tsx");
  assert.match(s, /import \{ humanizeAiError \} from "@\/lib\/drafts\/aiErrorMessage";/);
  assert.ok(s.includes("showToast(`${title}：${humanizeAiError(errorText)}`, \"error\")"), "重生 toast");
  assert.ok(s.includes("error: humanizeAiError(errorText),"), "重生狀態");
  assert.ok(s.includes("showToast(`${title}：${humanizeAiError(errorText)}（可單件重試）`, \"error\")"), "生成 toast");
  assert.ok(s.includes('["done", imageStep, "error", "pending"], humanizeAiError(errorText))'), "生成進度");
  assert.equal((s.match(/reportNetworkFailure\(job, errorText\)/g) || []).length, 2, "回報伺服器仍用原文");
  for (const f of ["src/lib/providers/openai-copy-provider.ts", "src/app/api/generate/route.ts"]) {
    assert.ok(!read(f).includes("humanizeAiError"), f + " 不改（資料庫保留原文）");
  }
});

console.log("\n[C] 接線");
await check("C1 package.json 有 verify:4a3、verify-all 有跑這支", () => {
  assert.match(read("package.json"), /"verify:4a3": "node scripts\/verify-4a3\.mjs"/);
  assert.ok(read("scripts/verify-all.mjs").includes('"scripts/verify-4a3.mjs"'));
});

console.log(`\n4a-3: ${passed} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
