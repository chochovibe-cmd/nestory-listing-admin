/**
 * 4a-2 CAPTURE-SCROLL verifier (written by Claude before construction).
 * Before capturing a Taobao/Tmall page the extension scrolls to the bottom so lazy-rendered
 * description images / review blocks load, then scrolls back. Fake window + fake clock; no network.
 * Run from repo root with: npm run verify:capture-scroll
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const require = createRequire(import.meta.url);
const { parseHTML } = require("linkedom");
const LIBS = [
  "extension/lib/selectors.js", "extension/lib/domUtil.js", "extension/lib/parsePrice.js",
  "extension/lib/flattenSku.js", "extension/lib/adapters/generic.js", "extension/lib/adapters/shopee.js",
  "extension/lib/adapters/taobao.js", "extension/lib/interactSku.js", "extension/lib/autoScroll.js",
  "extension/lib/buildPayload.js"
];
globalThis.NestoryCap = {};
for (const name of LIBS) require(path.join(root, name));
const Cap = globalThis.NestoryCap;

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

/** Fake page: fixed or growing height, records every scrollTo, fake clock advanced by sleep(). */
function fakePage({ height = 3000, innerHeight = 800, startY = 0, grow = null, throwAt = null } = {}) {
  let h = height;
  let t = 0;
  let thrown = false;
  const calls = [];
  const sleeps = [];
  const win = {
    innerHeight,
    scrollY: startY,
    pageYOffset: startY,
    scrollTo(x, y) {
      if (throwAt != null && !thrown && calls.length === throwAt) {
        thrown = true;
        throw new Error("scroll blocked");
      }
      calls.push(y);
      win.scrollY = y;
      win.pageYOffset = y;
      if (grow) h = grow(h, y);
    }
  };
  const doc = {
    documentElement: { get scrollHeight() { return h; } },
    body: { get scrollHeight() { return h; } }
  };
  const opts = {
    now: () => t,
    sleep: async (ms) => { sleeps.push(ms); t += ms; }
  };
  return { win, doc, opts, calls, sleeps, height: () => h };
}

console.log("\n[S] lib/autoScroll.js");

await check("S1 有 NestoryCap.autoScrollForLazyContent 與預設值", () => {
  assert.equal(typeof Cap.autoScrollForLazyContent, "function");
  assert.deepEqual(Cap.AUTO_SCROLL_DEFAULTS, { stepWaitMs: 250, settleMs: 400, maxMs: 6000, maxSteps: 40 });
  const mod = require(path.join(root, "extension/lib/autoScroll.js"));
  assert.equal(typeof mod.autoScrollForLazyContent, "function");
});

await check("S2 一頁 3000 高：每步 720（視窗 90%）往下捲到底 → 底部停 400ms → 捲回原位", async () => {
  const p = fakePage();
  const r = await Cap.autoScrollForLazyContent(p.win, p.doc, p.opts);
  assert.deepEqual(p.calls, [720, 1440, 2160, 2200, 0]);
  assert.deepEqual(p.sleeps, [250, 250, 250, 250, 400]);
  assert.equal(r.reached_bottom, true);
  assert.equal(r.steps, 4);
  assert.equal(r.restored, true);
  assert.equal(r.ms, 1400);
  assert.equal(r.page_height, 3000);
  assert.equal(r.error, null);
});

await check("S3 小視窗時每步至少 600", async () => {
  const p = fakePage({ height: 2000, innerHeight: 400 });
  await Cap.autoScrollForLazyContent(p.win, p.doc, p.opts);
  assert.deepEqual(p.calls, [600, 1200, 1600, 0]);
});

await check("S4 捲動時頁面變長（詳情慢慢長出來）→ 繼續捲到新的底部", async () => {
  const p = fakePage({ height: 2000, grow: (h, y) => (y >= 1200 && h < 5000 ? h + 1500 : h) });
  const r = await Cap.autoScrollForLazyContent(p.win, p.doc, p.opts);
  assert.equal(r.reached_bottom, true);
  assert.equal(p.calls[p.calls.length - 2], p.height() - 800, "最後一步停在新的底部");
  assert.equal(p.calls[p.calls.length - 1], 0);
});

await check("S5 無限長的頁面 → 6 秒（假時鐘）就停、還是捲回原位、reached_bottom=false", async () => {
  const p = fakePage({ height: 2000, grow: (h) => h + 5000 });
  const r = await Cap.autoScrollForLazyContent(p.win, p.doc, p.opts);
  assert.equal(r.reached_bottom, false);
  assert.ok(r.ms <= 6000 + 400, "總時間不超過 maxMs＋settle：" + r.ms);
  assert.equal(r.steps, 24);
  assert.equal(p.calls[p.calls.length - 1], 0);
});

await check("S6 從使用者目前位置開始捲，結束回到那個位置", async () => {
  const p = fakePage({ startY: 1000 });
  const r = await Cap.autoScrollForLazyContent(p.win, p.doc, p.opts);
  assert.equal(p.calls[0], 1720);
  assert.equal(p.calls[p.calls.length - 1], 1000);
  assert.equal(r.restored, true);
});

await check("S7 已經在底部（或頁面比視窗短）→ 不捲、不等", async () => {
  const p = fakePage({ height: 600 });
  const r = await Cap.autoScrollForLazyContent(p.win, p.doc, p.opts);
  assert.equal(r.steps, 0);
  assert.equal(r.reached_bottom, true);
  assert.deepEqual(p.sleeps, []);
});

await check("S8 捲動出錯不會丟例外：回傳 error、仍嘗試捲回", async () => {
  const p = fakePage({ throwAt: 1 });
  const r = await Cap.autoScrollForLazyContent(p.win, p.doc, p.opts);
  assert.equal(r.error, "scroll blocked");
  assert.equal(p.calls[p.calls.length - 1], 0, "還是要捲回原位");
  const bad = await Cap.autoScrollForLazyContent(null, null, p.opts);
  assert.equal(typeof bad.error, "string");
  assert.equal(bad.steps, 0);
});

await check("S9 maxSteps 上限 40", async () => {
  const p = fakePage({ height: 2000, grow: (h) => h + 5000 });
  const r = await Cap.autoScrollForLazyContent(p.win, p.doc, { ...p.opts, maxMs: 999999 });
  assert.equal(r.steps, 40);
});

console.log("\n[W] 接線");

await check("W1 background.js 載入順序：interactSku → autoScroll → buildPayload", () => {
  const bg = read("extension/background.js");
  const a = bg.indexOf('"lib/interactSku.js"');
  const b = bg.indexOf('"lib/autoScroll.js"');
  const c = bg.indexOf('"lib/buildPayload.js"');
  assert.ok(a > 0 && b > a && c > b, "順序不對");
});

await check("W2 capture.js：淘寶／天貓先捲動再擷取、有防呆、記在 capture_meta.auto_scroll", () => {
  const cap = read("extension/content/capture.js");
  assert.ok(cap.includes('typeof NestoryCap.autoScrollForLazyContent === "function"'));
  assert.ok(cap.includes("⏳ 捲動頁面載入詳情圖…"));
  assert.ok(cap.includes("capture_meta.auto_scroll"));
  assert.ok(cap.indexOf("autoScrollForLazyContent(") < cap.indexOf("var payload = buildNow();"), "要在第一次 buildNow 之前捲");
  assert.ok(cap.includes("detail_image_urls: 已自動捲到底仍偏少，可能這頁本來就沒有詳情圖，或請手動捲到底再抓一次"));
  assert.ok(!cap.includes("等待 lazy-load 後仍偏少"), "舊警告文字要換掉");
});

await check("W3 版本 0.2.3、CAPTURE_BUILD、權限不變、沒有 content_scripts", () => {
  const manifest = JSON.parse(read("extension/manifest.json"));
  assert.equal(manifest.version, "0.2.3");
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "storage"]);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(Cap.CAPTURE_BUILD, "capture-20261025-scroll");
});

console.log("\n[E] 整段擷取（真的 capture.js，詳情圖要捲到才長出來）");

await check("E1 天貓頁：捲到 1500 以下詳情圖才出現 → 抓到 6 張、auto_scroll 有紀錄、最後捲回 0", async () => {
  const { document } = parseHTML(`<html><body><div class="ItemTitle--x"><span class="mainTitle--y">测试商品</span></div>
<div class="description--z"><div class="desc-root"><div class="descV8-container" id="lazy"></div></div></div></body></html>`);
  let height = 3200;
  Object.defineProperty(document.documentElement, "scrollHeight", { get: () => height, configurable: true });
  const calls = [];
  let rendered = false;
  const win = {
    innerHeight: 800,
    scrollY: 0,
    scrollTo(_x, y) {
      calls.push(y);
      win.scrollY = y;
      if (y >= 1500 && !rendered) {
        rendered = true;
        height = 5200;
        const box = document.getElementById("lazy");
        for (let i = 1; i <= 6; i++) {
          const img = document.createElement("img");
          img.setAttribute("class", "descV8-singleImage-image");
          img.setAttribute("src", `https://img.alicdn.com/imgextra/i1/2218808631338/O1CN01lazy${String(i).padStart(14, "x")}_!!2218808631338.jpg`);
          box.appendChild(img);
        }
      }
    }
  };
  const NestoryCapCopy = Object.assign({}, Cap, {
    autoScrollForLazyContent: (w, d, o) => Cap.autoScrollForLazyContent(w, d, { ...(o || {}), stepWaitMs: 1, settleMs: 1 })
  });
  const ctx = {
    document,
    location: { href: "https://detail.tmall.com/item.htm?id=900000000001", hostname: "detail.tmall.com" },
    chrome: { runtime: { onMessage: { addListener() {} }, sendMessage(_m, cb) { if (cb) cb(); }, lastError: null } },
    setTimeout, clearTimeout,
    NestoryCap: NestoryCapCopy,
    scrollTo: win.scrollTo,
    get innerHeight() { return win.innerHeight; },
    get scrollY() { return win.scrollY; },
    get pageYOffset() { return win.scrollY; }
  };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  const payload = await vm.runInNewContext(read("extension/content/capture.js"), ctx);
  assert.ok(!payload.__nestory_error, JSON.stringify(payload));
  assert.equal(payload.detail_image_urls.length, 6);
  assert.equal(payload.capture_meta.auto_scroll.reached_bottom, true);
  assert.equal(calls[calls.length - 1], 0);
});

await check("E2 不是淘寶／天貓（蝦皮）→ 不捲動", async () => {
  const { document } = parseHTML("<html><body><h1>x</h1></body></html>");
  let scrolled = 0;
  const ctx = {
    document,
    location: { href: "https://shopee.tw/x-i.1.2", hostname: "shopee.tw" },
    chrome: { runtime: { onMessage: { addListener() {} }, sendMessage(_m, cb) { if (cb) cb(); }, lastError: null } },
    setTimeout, clearTimeout,
    NestoryCap: Cap,
    scrollTo() { scrolled++; },
    innerHeight: 800, scrollY: 0
  };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  const payload = await vm.runInNewContext(read("extension/content/capture.js"), ctx);
  assert.equal(scrolled, 0);
  assert.ok(!payload.capture_meta || payload.capture_meta.auto_scroll === undefined);
});

await check("G1 已註冊：package.json verify:capture-scroll、verify-all 有跑", () => {
  assert.equal(JSON.parse(read("package.json")).scripts["verify:capture-scroll"], "node scripts/verify-capture-scroll.mjs");
  assert.ok(read("scripts/verify-all.mjs").includes("scripts/verify-capture-scroll.mjs"));
});

console.log(`\nverify-capture-scroll: ${passed} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
