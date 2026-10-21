/**
 * CAPTURE-FIX verifier: real taobao/tmall fixtures (scripts/fixtures/capture-fix) + linkedom click
 * simulation with a fake clock, real import / restore / refresh modules, no external I/O.
 * Run from repo root with: npm run verify:capture-fix
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { register, createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const require = createRequire(import.meta.url);
const { parseHTML } = require("linkedom");
const scripts = [
  "extension/lib/selectors.js", "extension/lib/domUtil.js",
  "extension/lib/parsePrice.js", "extension/lib/flattenSku.js",
  "extension/lib/adapters/taobao.js", "extension/lib/interactSku.js",
  "extension/lib/buildPayload.js"
];
globalThis.NestoryCap = {};
for (const name of scripts) require(path.join(root, name));
const Cap = globalThis.NestoryCap;
register(pathToFileURL(path.join(root, "scripts/publish-guard-loader.mjs")).href);
const src = (name) => pathToFileURL(path.join(root, name)).href;
const { mapCaptureToDraftFields } = await import(src("src/lib/import/mapCaptureFields.ts"));
const hidden = await import(src("src/lib/import/captureHiddenPrices.ts"));
const sourceStock = await import(src("src/lib/variants/sourceStock.ts"));
const soldOutText = await import(src("src/lib/import/captureSourceStock.ts"));
const restore = await import(src("src/lib/variants/restoreExcludedVariant.ts"));
const refresh = await import(src("src/lib/import/refreshCapture.ts"));

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

// ───────────────────────── fixtures → pages ─────────────────────────
const FIX = "scripts/fixtures/capture-fix/";
const PAGES = {
  taobao1: {
    host: "item.taobao.com", href: "https://item.taobao.com/item.htm?id=1076251328835",
    priceByVid: { 120435789: 49.9, 3910076: 55.5, 59400361: 60.1 }
  },
  tmall1: {
    host: "detail.tmall.com", href: "https://detail.tmall.com/item.htm?id=915722142018",
    priceByVid: null // 12 non-sold-out vids → 10..21, filled below
  }
};
function readIce(tag) {
  return JSON.parse(fs.readFileSync(path.join(root, FIX + tag + "-ice-subset.json"), "utf8"));
}
{
  const ice = readIce("tmall1");
  const quantity = ice.skuCore.sku2info;
  const vids = {};
  ice.skuBase.skus.forEach((s) => {
    vids[s.skuId] = s.propPath.split(":")[1];
  });
  const map = {};
  let next = 10;
  ice.skuBase.skus.forEach((s) => {
    if (quantity[s.skuId].quantity > 0) map[vids[s.skuId]] = next++;
  });
  PAGES.tmall1.priceByVid = map;
}
function buildPage(tag, mutate, iceOverride) {
  let panel = fs.readFileSync(path.join(root, FIX + tag + "-sku-panel.html"), "utf8");
  if (mutate) panel = mutate(panel);
  const ice = iceOverride || readIce(tag);
  const body = { appData: null, loaderData: { home: { data: { res: ice } } } };
  return "<!doctype html><html><body>" + panel +
    "<script>!(function () {var a = window.__ICE_APP_CONTEXT__ || {};var b = " + JSON.stringify(body) + ";})();</script></body></html>";
}
/** Click simulation: one selected value per axis, price changes `delay` ms after a click. */
function installClickSim(document, { priceByVid = {}, delay = 200 } = {}) {
  const proto = document.createElement("div").constructor.prototype;
  if (typeof proto.click !== "function") {
    proto.click = function () { this.dispatchEvent(new document.defaultView.Event("click", { bubbles: true })); };
  }
  const clicks = {}, pending = [];
  let time = 0, sequence = 0;
  const SELECTED = "isSelected--_a9zOp7C", DISABLED = "isDisabled--BhZbtUdR";
  const nodes = Array.from(document.querySelectorAll("[class*='valueItem--']"));
  const vidOf = (node) => node.getAttribute("data-vid") || node.getAttribute("data-sim-vid");
  function show(value) {
    const set = (selector, v) => {
      for (const el of document.querySelectorAll(selector)) {
        const spans = el.querySelectorAll("[class*='text--']");
        const last = spans[spans.length - 1];
        if (last) last.textContent = String(v);
      }
    };
    set(".subPrice--KfQ0yn4v", value);
    set(".highlightPrice--LlVWiXXs", Number((value - 1).toFixed(2)));
  }
  for (const node of nodes) {
    node.addEventListener("click", () => {
      const vid = vidOf(node);
      clicks[vid] = (clicks[vid] || 0) + 1;
      if ((node.getAttribute("class") || "").includes(DISABLED)) return;
      const already = node.classList.contains(SELECTED);
      for (const other of nodes) other.classList.remove(SELECTED);
      if (already) return;
      node.classList.add(SELECTED);
      pending.push({ at: time + delay, value: priceByVid[vid], id: ++sequence });
    });
  }
  async function wait(ms) {
    time += ms;
    const due = pending.filter((p) => p.at <= time).sort((a, b) => a.at - b.at);
    for (const task of due) {
      if (!due.some((other) => other.at === task.at && other.id > task.id)) show(task.value);
    }
    for (const task of due) pending.splice(pending.indexOf(task), 1);
  }
  return { clicks, wait, now: () => time };
}
function loadPage(tag, { panel, dom, delay } = {}) {
  const meta = PAGES[tag];
  const { document } = parseHTML(buildPage(tag, panel));
  if (dom) dom(document);
  const sim = installClickSim(document, { priceByVid: meta.priceByVid, delay });
  const payload = Cap.buildCapturePayload(document, { href: meta.href, host: meta.host });
  return { document, sim, payload, host: meta.host };
}
async function runInteract(page, limits) {
  return Cap.interactSkuPrices(page.document, page.payload, {
    host: page.host, wait: page.sim.wait, now: page.sim.now, ...(limits ? { limits } : {})
  });
}
const statuses = (r) => r.rows.map((row) => row.status);
const valueNodes = (document) => Array.from(document.querySelectorAll("[class*='valueItem--']"));
const SOLD_OUT_TMALL = new Set(["5784136669441", "5784136669442", "5802933752746"]);

console.log("verify-capture-fix: 32 cases");

// ───────────────────────── extension ─────────────────────────
await check("CF01 fixtures exist, are scrubbed, keep the translated DOM and hidden prices", () => {
  const forbidden = ["mi_id", "cartParam", "buyExParams", "旗舰店", "nick", "sign="];
  for (const tag of ["taobao1", "tmall1"]) {
    for (const suffix of ["sku-panel.html", "ice-subset.json"]) {
      const text = read(FIX + tag + "-" + suffix);
      for (const word of forbidden) assert.ok(!text.includes(word), tag + "-" + suffix + " contains " + word);
    }
    const ice = readIce(tag);
    assert.equal(ice.skuCore.skuItem.hideOtherPrice, "true");
    for (const [skuId, info] of Object.entries(ice.skuCore.sku2info)) {
      for (const key of Object.keys(info)) assert.ok(!/price/i.test(key), tag + " sku2info[" + skuId + "] has " + key);
      assert.ok(!/price/i.test(skuId));
    }
  }
  const panel = read(FIX + "taobao1-sku-panel.html");
  assert.ok(panel.includes('<font dir="auto"'));
  assert.ok(panel.includes("顏色分類"));
});
await check("CF02 buildCapturePayload: source_quantity / source_stock_status per variant", () => {
  const t = loadPage("taobao1").payload.variants_flat;
  assert.equal(t.length, 4);
  assert.deepEqual(t.map((r) => r.source_stock_status), ["in_stock", "sold_out", "in_stock", "in_stock"]);
  assert.deepEqual(t.map((r) => r.source_quantity), [2, 0, 2, 2]);
  assert.ok(t.every((r) => r.cny_price == null));
  const m = loadPage("tmall1").payload.variants_flat;
  assert.equal(m.length, 15);
  const soldOut = m.filter((r) => r.source_stock_status === "sold_out");
  assert.equal(soldOut.length, 3);
  assert.deepEqual(new Set(soldOut.map((r) => r.sku)), SOLD_OUT_TMALL);
  assert.equal(m.find((r) => r.sku === "5784136669434").source_quantity, 200);
  assert.equal(m.find((r) => r.sku === "5802933752744").source_quantity, 29);
  assert.ok(m.every((r) => r.cny_price == null));
});
await check("CF03 taobaoSkuNodes: data-vid, disabled, selected; DOM vids equal ICE vids", () => {
  const taobao = loadPage("taobao1");
  const axesT = Cap.adapters.taobaoSkuNodes(taobao.document, taobao.host);
  assert.equal(axesT.length, 1);
  assert.equal(axesT[0].label, "顏色分類");
  assert.equal(axesT[0].values.length, 4);
  assert.ok(axesT[0].values.every((v) => v.vid));
  assert.equal(axesT[0].values.find((v) => v.text === "貝吉塔").disabled, true);
  assert.equal(axesT[0].values.find((v) => v.text === "賽亞人孫悟空").selected, true);
  const tmall = loadPage("tmall1");
  const axesM = Cap.adapters.taobaoSkuNodes(tmall.document, tmall.host);
  assert.equal(axesM.length, 1);
  assert.equal(axesM[0].values.length, 15);
  assert.equal(axesM[0].values.filter((v) => v.disabled).length, 3);
  assert.ok(axesM[0].values.find((v) => v.selected).text.includes("瑞希"));
  assert.deepEqual(axesT[0].values.map((v) => v.vid), readIce("taobao1").skuBase.props[0].values.map((v) => v.vid));
  assert.deepEqual(axesM[0].values.map((v) => v.vid), readIce("tmall1").skuBase.props[0].values.map((v) => v.vid));
});
await check("CF04 taobao1 (translated DOM): vid matching reads 3 prices, sold-out never clicked", async () => {
  const page = loadPage("taobao1");
  const r = await runInteract(page);
  assert.equal(r.ok, 3); assert.equal(r.sold_out, 1); assert.equal(r.readable, 3);
  assert.equal(r.status, "complete"); assert.deepEqual(r.reasons, []);
  assert.equal(r.requires_confirmation, false);
  assert.deepEqual(statuses(r), ["ok", "sold_out", "ok", "ok"]);
  assert.deepEqual(r.rows.map((row) => row.base), [49.9, null, 55.5, 60.1]);
  assert.equal(page.sim.clicks["15854208"], undefined);
  const priced = page.payload.variants_flat.filter((row) => row.cny_price != null);
  assert.equal(priced.length, 3);
  assert.ok(priced.every((row) => row.price_source === "interact.selected_sku"));
});
await check("CF05 tmall1: 12 readable + 3 sold-out, complete, no sold-out click", async () => {
  const page = loadPage("tmall1");
  const r = await runInteract(page);
  assert.equal(r.targets, 15); assert.equal(r.ok, 12); assert.equal(r.sold_out, 3); assert.equal(r.readable, 12);
  assert.equal(r.status, "complete"); assert.deepEqual(r.reasons, []);
  const soldOutVids = readIce("tmall1").skuBase.skus
    .filter((s) => SOLD_OUT_TMALL.has(s.skuId)).map((s) => s.propPath.split(":")[1]);
  assert.equal(soldOutVids.length, 3);
  for (const vid of soldOutVids) assert.equal(page.sim.clicks[vid], undefined);
  assert.ok(r.elapsed_ms < 90000, "elapsed " + r.elapsed_ms);
});
await check("CF06 vid beats text: every option text is '?' and it still resolves", async () => {
  const page = loadPage("taobao1", {
    dom(document) {
      for (const node of valueNodes(document)) {
        for (const el of node.querySelectorAll("[title]")) el.setAttribute("title", "?");
        for (const el of node.querySelectorAll("[class*='cornerText--']")) el.remove();
        for (const el of node.querySelectorAll("[class*='valueItemText--']")) el.textContent = "?";
      }
    }
  });
  const r = await runInteract(page);
  assert.equal(r.ok, 3);
});
await check("CF07 position matching: no data-vid but DOM count equals ICE count", async () => {
  const page = loadPage("taobao1", { panel: (html) => html.replace(/data-vid=/g, "data-sim-vid=") });
  assert.ok(Cap.adapters.taobaoSkuNodes(page.document, page.host)[0].values.every((v) => !v.vid));
  const r = await runInteract(page);
  assert.equal(r.ok, 3); assert.equal(r.status, "complete");
  assert.deepEqual(r.rows.map((row) => row.base), [49.9, null, 55.5, 60.1]);
});

// Simplified-Chinese two-axis fixture (no vid, no skuBase) from verify-capture-interact.mjs.
function makeFixture({ colors = ["A", "B", "C"], sizes = ["1", "2"], delay = 200 } = {}) {
  const variants = [], amounts = {};
  colors.forEach((color, ci) => sizes.forEach((size, si) => {
    const sku = "sku-" + ci + "-" + si;
    variants.push({ sku, option1_name: "顏色分類", option1_value: color,
      option2_name: "尺寸", option2_value: size, cny_price: null });
    amounts[sku] = 10 + ci * 10 + si;
  }));
  const info = {};
  for (const row of variants) info[row.sku] = { quantity: 10 };
  const ice = { loaderData: { home: { data: { res: { skuCore: {
    sku2info: info, skuItem: { hideOtherPrice: "true" } } } } } } };
  const options = (items, axis) => items.map((item) =>
    '<div class="valueItem--x" data-value="' + item + '" data-axis="' + axis + '">' + item + "</div>").join("");
  const html = '<html><body><div id="SkuPanel_tbpcDetail_ssr2025">' +
    '<div class="skuItem--x"><span class="ItemLabel--x">顏色分類</span>' + options(colors, 1) + "</div>" +
    '<div class="skuItem--x"><span class="ItemLabel--x">尺寸</span>' + options(sizes, 2) + "</div></div>" +
    '<div class="subPrice--x">优惠前 ¥999</div>' +
    '<div class="highlightPrice--x"><span class="text--x">券后 ¥998</span></div>' +
    "<script>window.__ICE_APP_CONTEXT__=" + JSON.stringify(ice) + ";</script></body></html>";
  const { document } = parseHTML(html);
  const proto = document.createElement("div").constructor.prototype;
  if (typeof proto.click !== "function") {
    proto.click = function () { this.dispatchEvent(new document.defaultView.Event("click", { bubbles: true })); };
  }
  const choices = [null, null], pending = [];
  let time = 0, sequence = 0;
  const source = document.querySelector(".subPrice--x");
  const promo = document.querySelector(".highlightPrice--x span");
  for (const node of document.querySelectorAll("[data-axis]")) {
    node.addEventListener("click", () => {
      const value = node.getAttribute("data-value");
      const axis = Number(node.getAttribute("data-axis")) - 1;
      const already = node.classList.contains("isSelected--x");
      for (const other of document.querySelectorAll('[data-axis="' + (axis + 1) + '"]'))
        other.classList.remove("isSelected--x");
      if (already) choices[axis] = null;
      else { node.classList.add("isSelected--x"); choices[axis] = value; }
      if (choices[0] != null && choices[1] != null) {
        const row = variants.find((v) => v.option1_value === choices[0] && v.option2_value === choices[1]);
        pending.push({ at: time + delay, value: amounts[row.sku], id: ++sequence });
      }
    });
  }
  async function wait(ms) {
    time += ms;
    const due = pending.filter((p) => p.at <= time).sort((a, b) => a.at - b.at);
    for (const task of due) {
      if (!due.some((other) => other.at === task.at && other.id > task.id)) {
        source.textContent = "优惠前 ¥" + task.value;
        promo.textContent = "券后 ¥" + (task.value - 1);
      }
    }
    for (const task of due) pending.splice(pending.indexOf(task), 1);
  }
  const payload = { source_platform: "taobao", price_cny: Math.min(...Object.values(amounts)),
    variants_flat: variants, capture_meta: { warnings_from_client: [
      "sku: 個別未優惠價未完整取得；未以商品價假裝 SKU 價格"] } };
  return { document, payload, variants, amounts, wait, now: () => time,
    opts: { host: "item.taobao.com", wait, now: () => time } };
}
await check("CF08 text matching still works without vid / skuBase (same as CI02)", async () => {
  const f = makeFixture();
  const r = await Cap.interactSkuPrices(f.document, f.payload, f.opts);
  assert.equal(r.ok, 6); assert.equal(r.status, "complete");
  assert.equal(r.requires_confirmation, false);
  for (const row of f.variants) {
    assert.equal(row.cny_price, f.amounts[row.sku]);
    assert.equal(row.price_source, "interact.selected_sku");
  }
});

/** taobao1 with every vid renamed (so the simulator still prices clicks) and the first node removed. */
const noVidMismatch = {
  panel: (html) => html.replace(/data-vid=/g, "data-sim-vid="),
  dom(document) { valueNodes(document)[0].remove(); }
};
await check("CF09 dom_mismatch: 0 of the readable variants resolve → abort, nothing clicked", async () => {
  const page = loadPage("taobao1", noVidMismatch);
  const r = await runInteract(page);
  assert.equal(r.status, "aborted"); assert.equal(r.abort_reason, "dom_mismatch");
  assert.equal(r.ok, 0);
  assert.deepEqual(page.sim.clicks, {});
  assert.deepEqual(statuses(r), ["node_not_found", "sold_out", "node_not_found", "node_not_found"]);
  assert.ok(r.reasons.includes("incomplete"));
  assert.equal(r.requires_confirmation, true);
  const s = r.dom_sample;
  for (const key of ["labels", "values", "ice_labels", "ice_values"]) {
    assert.ok(Array.isArray(s[key]) && s[key].length <= 5, key);
    assert.ok(s[key].every((t) => typeof t === "string" && t.length <= 40), key);
  }
  assert.deepEqual(s.ice_labels, ["颜色分类"]);
  assert.deepEqual(s.labels, ["顏色分類"]);
});
await check("CF10 partly resolvable page is not aborted: partial with per-row node_not_found", async () => {
  const page = loadPage("taobao1", {
    ...noVidMismatch,
    dom(document) {
      noVidMismatch.dom(document);
      const node = valueNodes(document).find((n) => n.textContent.includes("孫悟空") && !n.textContent.includes("賽亞人"));
      for (const el of node.querySelectorAll("[title]")) el.setAttribute("title", "孙悟空");
      for (const el of node.querySelectorAll("[class*='valueItemText--']")) el.textContent = "孙悟空";
    }
  });
  const r = await runInteract(page);
  assert.equal(r.status, "partial"); assert.equal(r.abort_reason, null);
  const byLabel = Object.fromEntries(r.rows.map((row) => [row.label, row.status]));
  assert.equal(byLabel["孙悟空"], "ok");
  assert.equal(byLabel["弗利萨"], "node_not_found");
  assert.equal(byLabel["赛亚人孙悟空"], "node_not_found");
  assert.equal(byLabel["贝吉塔"], "sold_out");
});
await check("CF11 status rules: sold-out is not incomplete; unread prices are; all sold-out is complete", async () => {
  // (a) sold-out + everything else ok
  const a = await runInteract(loadPage("taobao1"));
  assert.equal(a.status, "complete"); assert.ok(!a.reasons.includes("incomplete"));
  // (b) price text keeps the 「起」 → every readable variant times out
  const bPage = loadPage("taobao1", {
    dom(document) {
      for (const el of document.querySelectorAll(".subPrice--KfQ0yn4v")) el.textContent = "優惠前 ￥49.9 起";
    }
  });
  const b = await runInteract(bPage);
  assert.deepEqual(statuses(b), ["timeout", "sold_out", "timeout", "timeout"]);
  assert.equal(b.ok, 0); assert.equal(b.status, "partial");
  assert.deepEqual(b.reasons, ["incomplete"]);
  assert.equal(b.requires_confirmation, true);
  // (c) every variant sold out
  const cPage = loadPage("taobao1");
  cPage.payload.variants_flat.forEach((row) => { row.source_stock_status = "sold_out"; });
  const c = await runInteract(cPage);
  assert.equal(c.status, "complete"); assert.equal(c.ok, 0); assert.equal(c.readable, 0);
  assert.equal(c.sold_out, cPage.payload.variants_flat.length);
  assert.deepEqual(cPage.sim.clicks, {});
});
await check("CF12 shouldInteractSkuPrices ignores sold-out rows", () => {
  const row = (extra) => ({ cny_price: null, ...extra });
  const make = (rows, platform = "taobao") => ({ source_platform: platform, variants_flat: rows });
  assert.equal(Cap.shouldInteractSkuPrices(make([row({ source_stock_status: "sold_out" }),
    row({ source_stock_status: "sold_out" })])), false);
  assert.equal(Cap.shouldInteractSkuPrices(make([row({ source_stock_status: "sold_out" }),
    row({ source_stock_status: "in_stock" })])), true);
  assert.equal(Cap.shouldInteractSkuPrices(make([row({ source_stock_status: "sold_out" }), row({})])), true);
  assert.equal(Cap.shouldInteractSkuPrices(make([row({}), row({})], "shopee")), false);
  assert.equal(Cap.shouldInteractSkuPrices(make([row({})])), false);
  assert.equal(Cap.shouldInteractSkuPrices(make([row({ cny_price: 5 }), row({ cny_price: 6 })])), false);
});
await check("CF13 promo label 平台加补后／平台加補後 is recognised", () => {
  for (const title of ["平台加补后", "平台加補後"]) {
    const ice = {
      skuBase: {}, skuCore: { sku2info: {}, skuItem: {} },
      componentsVO: { priceVO: {
        price: { priceUnit: "￥", priceTitle: "优惠前", priceText: "10", priceMoney: "1000" },
        extraPrice: { priceUnit: "￥", priceTitle: title, priceText: "9.7", priceMoney: "970" }
      } }
    };
    const { document } = parseHTML(buildPage("taobao1", () => "", ice));
    const payload = Cap.buildCapturePayload(document, PAGES.tmall1);
    const promo = (payload.capture_meta.price_candidates || []).find((c) => c.kind === "promo");
    assert.ok(promo, title + ": no promo candidate");
    assert.equal(promo.source, "ice.componentsVO.priceVO.extraPrice");
    assert.equal(payload.capture_meta.promo_price_cny, 9.7);
  }
});

async function captureWith(fakeResult, initial) {
  const { document } = parseHTML("<html><body></body></html>");
  const ctx = {
    document, location: { href: "https://item.taobao.com/item.htm?id=test", hostname: "item.taobao.com" },
    chrome: { runtime: { onMessage: { addListener() {} },
      sendMessage(_msg, cb) { if (cb) cb(); }, lastError: null } },
    setTimeout() { return 1; }, clearTimeout() {},
    NestoryCap: {
      buildCapturePayload() { return initial; },
      shouldInteractSkuPrices: Cap.shouldInteractSkuPrices,
      async interactSkuPrices(_doc, body) {
        Object.assign(body, fakeResult.payload || {});
        return fakeResult.result;
      }
    }
  };
  ctx.globalThis = ctx;
  return await vm.runInNewContext(read("extension/content/capture.js"), ctx);
}
await check("CF14 capture.js warnings: dom_mismatch, sold-out ignored, legacy summary kept", async () => {
  const withImages = (f) => { f.payload.detail_image_urls = Array.from({ length: 5 }, (_, i) => String(i)); return f; };
  const warningsOf = (out) => out.capture_meta.warnings_from_client;
  // (a)
  const a = withImages(makeFixture());
  const outA = await captureWith({ result: { status: "aborted", abort_reason: "dom_mismatch", targets: 4, ok: 0,
    sold_out: 1, readable: 3, rows: [{ status: "node_not_found" }, { status: "node_not_found" },
      { status: "node_not_found" }, { status: "sold_out" }] } }, a.payload);
  assert.ok(warningsOf(outA).some((w) => w.includes("逐款讀價中止：頁面上的款式文字和資料對不上")));
  assert.ok(!warningsOf(outA).some((w) => w.includes("款沒讀到價格")));
  // (b)
  const b = withImages(makeFixture());
  const filled = b.payload.variants_flat.map((v, i) => ({ ...v, cny_price: 10 + i }));
  filled[5] = { ...b.payload.variants_flat[5], cny_price: null, source_stock_status: "sold_out" };
  const outB = await captureWith({ payload: { variants_flat: filled },
    result: { version: 2, status: "complete", targets: 6, ok: 5, sold_out: 1, readable: 5,
      rows: [{ status: "ok" }, { status: "ok" }, { status: "ok" }, { status: "ok" }, { status: "ok" },
        { status: "sold_out" }], reasons: [] } }, b.payload);
  assert.ok(!warningsOf(outB).some((w) => w.includes("個別未優惠價未完整取得")));
  assert.ok(!warningsOf(outB).some((w) => w.includes("沒讀到價格")));
  // (c)
  const c = withImages(makeFixture());
  const outC = await captureWith({ result: { version: 1, status: "partial", targets: 6, ok: 3,
    rows: [{ status: "sold_out" }, { status: "timeout" }, { status: "over_limit" },
      { status: "ok" }, { status: "ok" }, { status: "ok" }], reasons: ["incomplete"] } }, c.payload);
  assert.ok(warningsOf(outC).some((w) => w.includes("3 款沒讀到價格（來源缺貨 1、頁面沒反應 1、超過上限 1）")));
});
await check("CF15 background.js / selectors.js / manifest.json", () => {
  const bg = read("extension/background.js");
  assert.ok(bg.includes('status === "refreshed"'));
  assert.ok(bg.includes("json.message"));
  assert.ok(bg.includes("款式全部來源售完"));
  assert.ok(bg.includes("頁面文字對不上"));
  assert.ok(read("extension/lib/selectors.js").includes('CAPTURE_BUILD = "capture-20261020-capturefix1"'));
  const manifestText = read("extension/manifest.json");
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.version, "0.2.1");
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "storage"]);
  assert.equal(manifest.content_scripts, undefined);
  // No `world` setting anywhere (e.g. "world": "MAIN"). The host pattern *://world.taobao.com/* is
  // an existing permission and must stay, so look for the KEY, not the substring.
  const hasWorldKey = (node) => !!node && typeof node === "object" &&
    Object.entries(node).some(([key, value]) => key.toLowerCase() === "world" || hasWorldKey(value));
  assert.equal(hasWorldKey(manifest), false);
  assert.ok(!/"world"\s*:/i.test(manifestText));
});

// ───────────────────────── import ─────────────────────────
const NOW = "2026-10-21T00:00:00.000Z";
const OWNER = { userId: "u1", receivedAt: NOW };
const flatRow = (sku, value, extra = {}) => ({
  sku, option1_name: "颜色分类", option1_value: value, cny_price: null,
  source_stock_status: "in_stock", source_quantity: 5, ...extra
});
const taobaoBody = (over = {}) => {
  const payload = loadPage("taobao1").payload;
  return { source_url: "https://item.taobao.com/item.htm?id=1076251328835", source_platform: "taobao",
    title: "測試商品", price_cny: 49.9, variants_flat: payload.variants_flat,
    capture_meta: { warnings_from_client: [] }, ...over };
};
await check("CF16 sourceStock helpers", () => {
  const T = "2026-10-21T00:00:00Z";
  assert.deepEqual(sourceStock.parseFlatSourceStock({ source_stock_status: "sold_out", source_quantity: 0 }, T),
    { status: "sold_out", quantity: 0, checked_at: T });
  assert.equal(sourceStock.parseFlatSourceStock({ source_stock_status: "x" }, T), null);
  assert.equal(sourceStock.parseFlatSourceStock({ source_stock_status: 5 }, T), null);
  assert.equal(sourceStock.parseFlatSourceStock({}, T), null);
  assert.equal(sourceStock.parseFlatSourceStock(null, T), null);
  for (const bad of [-1, 1.5, "3", null, undefined]) {
    assert.equal(sourceStock.parseFlatSourceStock({ source_stock_status: "in_stock", source_quantity: bad }, T).quantity, null);
  }
  const stock = { status: "in_stock", quantity: 3, checked_at: T };
  assert.deepEqual(sourceStock.readSourceStock({ names: [], values: [], stock }), stock);
  assert.equal(sourceStock.readSourceStock({ stock: { status: "nope" } }), null);
  assert.equal(sourceStock.readSourceStock(null), null);
  assert.equal(sourceStock.readSourceStock("x"), null);
  assert.equal(sourceStock.readSourceStock({ stock: { status: "in_stock", quantity: -2 } }).quantity, null);
  assert.equal(sourceStock.isSourceSoldOut({ sourceOptions: { stock: { status: "sold_out" } } }), true);
  assert.equal(sourceStock.isSourceSoldOut({ sourceOptions: { stock } }), false);
  assert.equal(sourceStock.isSourceSoldOut({}), false);
  assert.equal(sourceStock.isSourceSoldOut(null), false);
  assert.deepEqual(sourceStock.withSourceStock(null, stock, ["a", null, null], ["b", null, null]),
    { names: ["a", null, null], values: ["b", null, null], stock });
  assert.deepEqual(sourceStock.withSourceStock({ names: ["n"], values: ["v"] }, stock, ["x"], ["y"]),
    { names: ["n"], values: ["v"], stock });
});
await check("CF17 import excludes the sold-out variant and warns", () => {
  const out = mapCaptureToDraftFields(taobaoBody(), OWNER);
  assert.equal(out.variantRows.length, 3);
  assert.equal(out.excludedVariants.length, 1);
  assert.equal(out.excludedVariants[0].reason, "source_sold_out");
  assert.equal(out.excludedVariants[0].label, "贝吉塔");
  assert.equal(out.rawCapture.server.excluded_variants[0].row.source_options.stock.status, "sold_out");
  assert.ok(!out.variantDimensions[0].values.join().includes("贝吉塔"));
  assert.ok(out.variantRows.every((row) => !String(row.option1_value).includes("贝吉塔")));
  assert.ok(out.warnings.includes("已排除 1 款來源售完：「贝吉塔」（可在規格頁籤加回）"));
  assert.ok(!out.warnings.some((w) => w.includes("非商品款式")));
  assert.equal(soldOutText.formatSoldOutExcludedWarning(["a", "b", "c", "d", "e", "f", "g"]),
    "已排除 7 款來源售完：「a」「b」「c」「d」「e」「f」…（可在規格頁籤加回）");
});
await check("CF18 kept variants carry stock; legacy payloads are unchanged", () => {
  const out = mapCaptureToDraftFields(taobaoBody(), OWNER);
  for (const row of out.variantRows) {
    assert.deepEqual(row.source_options.stock, { status: "in_stock", quantity: 2, checked_at: NOW });
  }
  const legacyFlats = taobaoBody().variants_flat.map((v) => {
    const { source_quantity, source_stock_status, ...rest } = v;
    return rest;
  });
  const legacy = mapCaptureToDraftFields(taobaoBody({ variants_flat: legacyFlats }), OWNER);
  assert.equal(legacy.variantRows.length, 4);
  assert.equal(legacy.excludedVariants.length, 0);
  for (const row of legacy.variantRows) {
    assert.ok(!("stock" in row.source_options));
    assert.deepEqual(row.source_options, {
      names: [row.source_options.names[0], null, null],
      values: [row.source_options.values[0], null, null]
    });
  }
});
await check("CF19 all variants sold out: nothing excluded, warning added", () => {
  const body = taobaoBody();
  body.variants_flat = body.variants_flat.map((v) => ({ ...v, source_stock_status: "sold_out", source_quantity: 0 }));
  const out = mapCaptureToDraftFields(body, OWNER);
  assert.equal(out.variantRows.length, 4);
  assert.equal(out.excludedVariants.length, 0);
  assert.ok(out.warnings.includes(soldOutText.WARNING_ALL_SOURCE_SOLD_OUT));
  assert.ok(out.variantRows.every((row) => row.source_options.stock.status === "sold_out"));
});
await check("CF20 fake option wins over sold-out; mixed warnings stay separate", () => {
  const flats = [
    flatRow("1", "红色"), flatRow("2", "勿拍", { source_stock_status: "sold_out", source_quantity: 0 }),
    flatRow("3", "蓝色", { source_stock_status: "sold_out", source_quantity: 0 })
  ];
  const out = mapCaptureToDraftFields(taobaoBody({ variants_flat: flats }), OWNER);
  const byLabel = Object.fromEntries(out.excludedVariants.map((e) => [e.label, e.reason]));
  assert.equal(byLabel["勿拍"], "non_product_option");
  assert.equal(byLabel["蓝色"], "source_sold_out");
  assert.equal(out.warnings.filter((w) => w.includes("非商品款式")).length, 1);
  assert.equal(out.warnings.filter((w) => w.includes("來源售完")).length, 1);
  assert.ok(!out.warnings.find((w) => w.includes("非商品款式")).includes("蓝色"));
  assert.ok(!out.warnings.find((w) => w.includes("來源售完")).includes("勿拍"));
});
await check("CF21 interactRequiresConfirmation matrix", () => {
  const f = (interact) => hidden.interactRequiresConfirmation(interact === undefined ? {} : { interact });
  assert.equal(f({ status: "complete", targets: 15, ok: 12, sold_out: 3, readable: 12, reasons: [], requires_confirmation: false }), false);
  const legacyRows = (extra) => [{ status: "sold_out" }, { status: extra }, { status: "ok" }, { status: "ok" }];
  assert.equal(f({ status: "partial", targets: 4, ok: 3, reasons: ["incomplete"], requires_confirmation: true,
    rows: [{ status: "sold_out" }, { status: "ok" }, { status: "ok" }, { status: "ok" }] }), false);
  assert.equal(f({ status: "partial", targets: 4, ok: 2, reasons: ["incomplete"], requires_confirmation: true,
    rows: legacyRows("timeout") }), true);
  assert.equal(f({ status: "aborted", abort_reason: "dom_mismatch" }), true);
  assert.equal(f({ status: "complete", reasons: ["all_identical"] }), true);
  assert.equal(f({ status: "partial", targets: 2, ok: 1, requires_confirmation: true }), true);
  assert.equal(f({ status: "complete", targets: 2, ok: 2, requires_confirmation: false }), false);
  assert.equal(f(undefined), false);
});

function hiddenBody({ prices, interact, range } = {}) {
  return { source_url: "https://item.taobao.com/item.htm?id=9002", source_platform: "taobao",
    title: "sold-out verification", price_cny: 10,
    variants_flat: prices.map((p, i) => ({
      sku: "v" + i, option1_name: "款式", option1_value: "Option" + i,
      cny_price: p.price, price_source: p.price == null ? null : "interact.selected_sku",
      price_confidence: p.price == null ? "unknown" : "interact_verified",
      source_stock_status: p.soldOut ? "sold_out" : "in_stock", source_quantity: p.soldOut ? 0 : 3
    })),
    capture_meta: { price_confidence: "high", warnings_from_client: [], interact,
      price_debug: { price_paths: [
        { path: "res.skuCore.skuItem.hideOtherPrice", value: true },
        ...(range ? [{ path: "res.price.priceText", value: range }] : [])
      ] } } };
}
await check("CF22 confirmation flag ignores excluded sold-out variants", () => {
  const prices = [{ price: 10 }, { price: 20 }, { price: null, soldOut: true }, { price: null, soldOut: true },
    { price: null, soldOut: true }];
  const done = mapCaptureToDraftFields(hiddenBody({ prices, interact: { version: 2, status: "complete",
    targets: 5, ok: 2, sold_out: 3, readable: 2, reasons: [], requires_confirmation: false } }), OWNER);
  assert.equal(done.excludedVariants.length, 3);
  assert.equal(done.rawCapture.server.price_requires_confirmation, false);
  assert.ok(!done.warnings.includes(hidden.WARNING_HIDDEN_VARIANT_PRICES));
  assert.ok(!done.warnings.includes(hidden.WARNING_INTERACT_NEEDS_CONFIRMATION));
  const missing = mapCaptureToDraftFields(hiddenBody({
    prices: [{ price: 10 }, { price: null }, ...prices.slice(2)],
    interact: { version: 2, status: "partial", targets: 5, ok: 1, sold_out: 3, readable: 2,
      reasons: ["incomplete"], requires_confirmation: true } }), OWNER);
  assert.equal(missing.rawCapture.server.price_requires_confirmation, true);
});
await check("CF23 price range check tolerates excluded sold-out variants", () => {
  const complete = (n) => ({ version: 2, status: "complete", targets: n, ok: n, sold_out: 0, readable: n,
    reasons: [], requires_confirmation: false });
  const soldOut = { price: null, soldOut: true };
  const withSoldOut = (kept) => mapCaptureToDraftFields(hiddenBody({
    prices: [...kept.map((price) => ({ price })), soldOut], range: "¥10-25",
    interact: { ...complete(kept.length), targets: kept.length + 1, sold_out: 1 } }), OWNER);
  const inside = withSoldOut([20, 25]);
  assert.equal(inside.rawCapture.server.price_requires_confirmation, false);
  assert.ok(!inside.warnings.some((w) => w.includes("頁面價格區間")));
  const outside = withSoldOut([20, 30]);
  assert.equal(outside.rawCapture.server.price_requires_confirmation, true);
  assert.ok(outside.warnings.some((w) => w.includes("頁面價格區間")));
  const legacy = mapCaptureToDraftFields(hiddenBody({
    prices: [{ price: 20 }, { price: 25 }], range: "¥10-25", interact: complete(2) }), OWNER);
  assert.equal(legacy.rawCapture.server.price_requires_confirmation, true);
  assert.ok(legacy.warnings.some((w) => w.includes("頁面價格區間")));
});

const DRAFT = "11111111-1111-4111-8111-111111111111";
await check("CF24 restore: sold-out entries come back on product cost, one or all", () => {
  const mapped = mapCaptureToDraftFields(taobaoBody(), OWNER);
  const excluded = restore.readExcludedVariants(mapped.rawCapture);
  assert.equal(excluded.length, 1);
  const existing = mapped.variantRows.map((row, i) => ({
    id: "v" + i, sku: row.sku ?? null, sort_order: i,
    option1_value: row.option1_value, option2_value: null, option3_value: null }));
  const one = restore.planRestoreExcludedVariant({ draftId: DRAFT, excluded, index: 0, existing,
    dimensions: mapped.variantDimensions });
  assert.equal(one.ok, true);
  assert.equal(one.row.cny_price, null);
  assert.equal(one.row.cost_is_inherited, true);
  assert.equal(one.row.source_options.stock.status, "sold_out");
  assert.ok(typeof one.row.sku === "string" && one.row.sku.length > 0);
  assert.equal(one.remaining.length, 0);

  const entry = (value, reason, sku) => ({ label: value, reason, row: {
    option1_name: "款式", option1_value: value, option2_name: null, option2_value: null,
    option3_name: null, option3_value: null, sku: null, source_sku_id: sku, cny_price: 12,
    cost_is_inherited: false, sort_order: 0, inventory_quantity: 0, inventory_policy: "continue",
    source_options: { names: ["款式", null, null], values: [value, null, null],
      stock: { status: "sold_out", quantity: 0, checked_at: NOW } } } });
  const list = [entry("A款", "source_sold_out", "1"), entry("勿拍", "non_product_option", "2"),
    entry("B款", "source_sold_out", "3")];
  const base = { draftId: DRAFT, excluded: list, reason: "source_sold_out",
    existing: [{ id: "x", sku: null, sort_order: 0, option1_value: "C款" }],
    dimensions: [{ name: "款式", values: ["C款"] }] };
  const all = restore.planRestoreAllExcludedVariants(base);
  assert.equal(all.ok, true);
  assert.equal(all.rows.length, 2);
  assert.ok(all.rows.every((r) => r.cny_price === null && r.cost_is_inherited === true));
  assert.equal(new Set(all.rows.map((r) => r.sku)).size, 2);
  assert.deepEqual(all.remaining.map((e) => e.reason), ["non_product_option"]);
  assert.deepEqual(all.dimensions[0].values, ["C款", "A款", "B款"]);
  const dup = restore.planRestoreAllExcludedVariants({ ...base,
    existing: [{ id: "x", sku: null, sort_order: 0, option1_value: "B款" }] });
  assert.equal(dup.ok, false); assert.equal(dup.status, 409);
  assert.equal("rows" in dup, false);
  const none = restore.planRestoreAllExcludedVariants({ ...base, excluded: [list[1]] });
  assert.equal(none.ok, false); assert.equal(none.status, 404);
});
await check("CF25 restore route source", () => {
  const route = read("src/app/api/drafts/[id]/excluded-variants/restore/route.ts");
  const exported = [...route.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(exported.filter((n) => n !== "runtime"), ["POST"]);
  for (const word of ["source_sold_out", "price_requires_confirmation", "variant_price_confirmed_at",
      "restored", "price_unconfirmed", "不支援的加回類型"]) {
    assert.ok(route.includes(word), word);
  }
});

// ───────────────────────── refresh ─────────────────────────
function makeFakeDb({ draft, variants, readDraftError = false, readVariantsError = false,
  failVariantWriteAt = null, failDraftWrite = false, throwOnRead = false }) {
  const updates = [];
  let variantWrites = 0;
  const db = {
    from(table) {
      return {
        select() {
          const q = {
            eq() { return q; },
            maybeSingle() {
              if (throwOnRead) throw new Error("boom");
              return Promise.resolve(readDraftError ? { data: null, error: { message: "x" } }
                : { data: table === "product_drafts" ? draft : null, error: null });
            },
            then(resolve) {
              if (throwOnRead) throw new Error("boom");
              resolve(readVariantsError ? { data: null, error: { message: "x" } }
                : { data: variants, error: null });
            }
          };
          return q;
        },
        update(patch) {
          return {
            eq(_column, id) {
              if (table === "product_variants") {
                const fail = failVariantWriteAt === variantWrites++;
                if (fail) return Promise.resolve({ error: { message: "x" } });
              } else if (failDraftWrite) {
                return Promise.resolve({ error: { message: "x" } });
              }
              updates.push({ table, id, patch });
              return Promise.resolve({ error: null });
            }
          };
        }
      };
    }
  };
  return { db, updates };
}
const W_HIDDEN = hidden.WARNING_HIDDEN_VARIANT_PRICES;
const W_INTERACT = hidden.WARNING_INTERACT_NEEDS_CONFIRMATION;
const W_ROW = "逐款讀價：2 款沒讀到價格（頁面沒反應 2），請逐款確認";
const W_SKU = "sku: 個別未優惠價未完整取得；未以商品價假裝 SKU 價格";
const mkDraft = (over = {}, server = {}) => ({
  id: "d1", shopify_product_id: null, cny_price: 50,
  warnings: [W_HIDDEN, W_INTERACT, W_ROW, W_SKU, "其他警告"],
  raw_capture: { client_meta: { keep: 1 }, server: {
    price_requires_confirmation: true, price_confidence: "needs_confirmation",
    warnings: [W_HIDDEN, W_INTERACT, "server-keep"], ...server } },
  ...over
});
const mkVariant = (id, sku, over = {}) => ({
  id, source_sku_id: sku, option1_name: "款式", option1_value: "V" + id,
  option2_name: null, option2_value: null, option3_name: null, option3_value: null,
  cny_price: null, twd_price: null, compare_at_price: null, cost_is_inherited: true,
  sell_price_locked: null, compare_at_locked: null, price_locked: null, source_options: null, ...over
});
const mkFlat = (sku, price, over = {}) => ({ sku, cny_price: price, price_source: "interact.selected_sku", ...over });
const plan = (draft, variants, flats) => refresh.planCaptureRefresh({ draft, variants, flats, now: NOW });
const patchOf = (p, id) => p.variantUpdates.find((u) => u.id === id)?.patch;

await check("CF26 refresh prices: only unconfirmed, inherited, real-source costs; locks respected", () => {
  const variants = [
    mkVariant("v1", "s1"),
    mkVariant("v2", "s2", { cost_is_inherited: false, cny_price: 30 }),
    mkVariant("v3", "s3", { sell_price_locked: true, twd_price: 777 }),
    mkVariant("v4", "s4")
  ];
  const p = plan(mkDraft(), variants, [mkFlat("s1", 20), mkFlat("s2", 25), mkFlat("s3", 40),
    mkFlat("s4", 50, { price_source: "dom.selected_sku" }), mkFlat("zzz", 9)]);
  assert.equal(p.prices, 2);
  assert.deepEqual(patchOf(p, "v1"), { cny_price: 20, cost_is_inherited: false, twd_price: null, compare_at_price: null });
  assert.equal(patchOf(p, "v2"), undefined);
  const v3 = patchOf(p, "v3");
  assert.equal(v3.cny_price, 40); assert.equal(v3.cost_is_inherited, false);
  assert.ok(!("twd_price" in v3));
  assert.equal(patchOf(p, "v4"), undefined);
});
await check("CF27 refresh skips prices for published / confirmed drafts, stock still updates", () => {
  const variants = [mkVariant("v1", "s1")];
  const flats = [mkFlat("s1", 20, { source_stock_status: "in_stock", source_quantity: 4 })];
  const published = plan(mkDraft({ shopify_product_id: "gid://shopify/Product/1" }), variants, flats);
  assert.equal(published.prices, 0); assert.equal(published.priceSkippedReason, "published");
  assert.equal(published.stock, 1);
  assert.ok(!("cny_price" in patchOf(published, "v1")));
  const confirmed = plan(mkDraft({}, { variant_price_confirmed_at: NOW }), variants, flats);
  assert.equal(confirmed.prices, 0); assert.equal(confirmed.priceSkippedReason, "confirmed");
  const nothing = plan(mkDraft({ shopify_product_id: "gid://shopify/Product/1" }),
    [mkVariant("v1", "s1", { cost_is_inherited: false })], flats);
  assert.equal(nothing.priceSkippedReason, null);
});
await check("CF28 refresh stock state: preserved names/values, unknown ignored, no-op when unchanged", () => {
  const stockOf = (status, quantity) => ({ status, quantity, checked_at: "old" });
  const variants = [
    mkVariant("v1", "s1"),
    mkVariant("v2", "s2", { source_options: { names: ["款式", null, null], values: ["原值", null, null],
      stock: stockOf("in_stock", 2) } }),
    mkVariant("v3", "s3", { source_options: { names: ["款式", null, null], values: ["x", null, null],
      stock: stockOf("in_stock", 2) } }),
    mkVariant("v4", "s4", { source_options: { names: ["款式", null, null], values: ["y", null, null],
      stock: stockOf("sold_out", 0) } })
  ];
  const p = plan(mkDraft({ shopify_product_id: "gid://shopify/Product/1" }), variants, [
    mkFlat("s1", null, { source_stock_status: "sold_out", source_quantity: 0 }),
    mkFlat("s2", null, { source_stock_status: "sold_out", source_quantity: 0 }),
    mkFlat("s3", null, { source_stock_status: "in_stock", source_quantity: 2 }),
    mkFlat("s4", null, { source_stock_status: "unknown", source_quantity: null })
  ]);
  assert.equal(p.stock, 2);
  const v1 = patchOf(p, "v1").source_options;
  assert.deepEqual(v1.names, ["款式", null, null]); assert.deepEqual(v1.values, ["Vv1", null, null]);
  assert.deepEqual(v1.stock, { status: "sold_out", quantity: 0, checked_at: NOW });
  assert.deepEqual(patchOf(p, "v2").source_options.values, ["原值", null, null]);
  assert.equal(patchOf(p, "v3"), undefined);
  assert.equal(patchOf(p, "v4"), undefined);
});
await check("CF29 refresh confirmation flag: only ever cleared, and only when safe", () => {
  const variants = (extra = []) => [mkVariant("v1", "s1"), mkVariant("v2", "s2", { cost_is_inherited: false }), ...extra];
  const flats = [mkFlat("s1", 20)];
  const cleared = plan(mkDraft(), variants(), flats);
  const server = cleared.draftPatch.raw_capture.server;
  assert.equal(server.price_requires_confirmation, false);
  assert.deepEqual(server.warnings, ["server-keep"]);
  assert.deepEqual(cleared.draftPatch.warnings, ["其他警告"]);
  assert.deepEqual(cleared.draftPatch.raw_capture.client_meta, { keep: 1 });
  assert.deepEqual(server.price_refresh.source_sku_ids, ["s1"]);
  assert.deepEqual(refresh.readPriceRefreshSkuIds(cleared.draftPatch.raw_capture), ["s1"]);
  assert.equal(server.last_refresh.prices, 1);
  const kept = plan(mkDraft(), variants([mkVariant("v3", "s3")]), flats);
  assert.equal(kept.draftPatch.raw_capture.server.price_requires_confirmation, true);
  assert.equal(kept.draftPatch.warnings, undefined);
  assert.deepEqual(kept.draftPatch.raw_capture.server.warnings, [W_HIDDEN, W_INTERACT, "server-keep"]);
  const soldOutRest = mkVariant("v3", "s3", { source_options: { names: [], values: [],
    stock: { status: "sold_out", quantity: 0, checked_at: "old" } } });
  assert.equal(plan(mkDraft(), variants([soldOutRest]), flats).draftPatch.raw_capture.server.price_requires_confirmation, false);
  assert.equal(plan(mkDraft({ cny_price: 0.01 }), variants(), flats).draftPatch.raw_capture.server.price_requires_confirmation, true);
  assert.equal(plan(mkDraft({}, { price_confidence: "conflict" }), variants(), flats).draftPatch.raw_capture.server.price_requires_confirmation, true);
  const stockOnly = plan(mkDraft(), variants(), [mkFlat("s1", null, { source_stock_status: "in_stock", source_quantity: 1 })]);
  assert.equal(stockOnly.prices, 0);
  assert.equal(stockOnly.draftPatch.raw_capture.server.price_requires_confirmation, true);
  assert.ok(!("price_refresh" in stockOnly.draftPatch.raw_capture.server));
  assert.equal(stockOnly.draftPatch.warnings, undefined);
  assert.deepEqual(refresh.readPriceRefreshSkuIds(null), []);
  assert.deepEqual(refresh.readPriceRefreshSkuIds({ server: { price_refresh: { source_sku_ids: "x" } } }), []);
});
await check("CF30 refresh messages, DB writes (variants then draft), failures return null, source guards", async () => {
  const fmt = (prices, stock, skipped = null) => refresh.formatRefreshMessage({ prices, stock, skipped });
  assert.equal(fmt(2, 1), "已更新 2 款價格、1 款庫存狀態");
  assert.equal(fmt(2, 0), "已更新 2 款價格");
  assert.equal(fmt(0, 3), "已更新 3 款庫存狀態");
  assert.equal(fmt(0, 3, "published"), "已更新 3 款庫存狀態（已上架，價格沒動）");
  assert.equal(fmt(0, 3, "confirmed"), "已更新 3 款庫存狀態（成本已確認，價格沒動）");
  assert.equal(fmt(0, 0), "");

  const body = { variants_flat: [mkFlat("s1", 20, { source_stock_status: "in_stock", source_quantity: 3 }),
    mkFlat("s2", 25)] };
  const setup = (over = {}) => makeFakeDb({ draft: mkDraft(), variants: [mkVariant("v1", "s1"),
    mkVariant("v2", "s2")], ...over });
  const ok = setup();
  const done = await refresh.refreshExistingCaptureDraft({ serviceSupabase: ok.db, draftId: "d1", body, now: NOW });
  assert.deepEqual(done.refreshed, { prices: 2, stock: 1, price_skipped_reason: null });
  assert.equal(done.message, "已更新 2 款價格、1 款庫存狀態");
  assert.deepEqual(ok.updates.map((u) => u.table + ":" + u.id), ["product_variants:v1", "product_variants:v2", "product_drafts:d1"]);

  const idle = setup();
  assert.equal(await refresh.refreshExistingCaptureDraft({ serviceSupabase: idle.db, draftId: "d1",
    body: { variants_flat: [] }, now: NOW }), null);
  assert.equal(idle.updates.length, 0);
  for (const failure of [{ readDraftError: true }, { readVariantsError: true }, { throwOnRead: true },
      { failVariantWriteAt: 1 }, { failDraftWrite: true }]) {
    const fake = setup(failure);
    const result = await refresh.refreshExistingCaptureDraft({ serviceSupabase: fake.db, draftId: "d1", body, now: NOW });
    assert.equal(result, null, JSON.stringify(failure));
    if ("failVariantWriteAt" in failure) assert.ok(!fake.updates.some((u) => u.table === "product_drafts"));
  }

  const create = read("src/lib/import/createCaptureDraft.ts");
  const refillAt = create.indexOf("if (refill) return refill;");
  assert.ok(refillAt > 0 && create.indexOf("refreshExistingCaptureDraft(", refillAt) > refillAt);
  const route = read("src/app/api/import/product-page/route.ts");
  const branch = route.indexOf('result.status === "refreshed"');
  assert.ok(branch > 0 && branch < route.indexOf("after("));
  assert.ok(route.slice(branch, route.indexOf("after(")).includes("status: 200"));
  const source = read("src/lib/import/refreshCapture.ts").toLowerCase();
  for (const word of ["product_images", ".delete(", ".insert(", "graphql", "fetch(", "syncshopifyproduct", "productvariants"]) {
    assert.ok(!source.includes(word), "refreshCapture.ts contains " + word);
  }
});

// ───────────────────────── UI ─────────────────────────
await check("CF31 specs panel, badge and card wiring (source) use only existing classes", () => {
  const panel = read("src/components/listing/result-card/ResultCardSpecsPanel.tsx");
  for (const word of ["已排除 ${", "款來源售完", "加回", "全部加回", "priceRecalcPending",
      'reason !== "source_sold_out"', 'reason === "source_sold_out"']) {
    assert.ok(panel.includes(word), word);
  }
  const css = read("src/app/globals.css");
  for (const cls of ["vc-excluded", "vc-note", "vc-list", "vc-excluded-row", "vc-excluded-label", "vc-toolbar", "price-soft-warn"]) {
    assert.ok(panel.includes(cls), cls + " unused in panel");
    assert.ok(css.includes("." + cls), "." + cls + " missing from globals.css");
  }
  const render = read("src/components/listing/VariantEditorRender.tsx");
  assert.equal(render.split("isSourceSoldOut(").length - 1, 2);
  assert.equal(render.split("rc-tag warned").length - 1, 2);
  assert.ok(render.includes("來源售完"));
  assert.ok(!css.includes("source-sold") && !css.includes("capture-fix"));
  const card = read("src/components/listing/ResultCard.tsx");
  for (const word of ["restoreAllSoldOutVariants", "readPriceRefreshSkuIds", 'all: true, reason: "source_sold_out"']) {
    assert.ok(card.includes(word), word);
  }
});
await check("CF32 existing capture / price / variant / publish suites still pass", () => {
  for (const name of ["verify-capture-interact.mjs", "verify-cap2.mjs", "verify-price-guard.mjs",
      "verify-variant-clean.mjs", "verify-publish-guard.mjs", "verify-cap1.mjs"]) {
    const run = spawnSync(process.execPath, [path.join(root, "scripts", name)], { cwd: root, encoding: "utf8" });
    assert.equal(run.status, 0, name + "\n" + run.stderr + "\n" + run.stdout.slice(-1500));
  }
});

if (failed.length) {
  console.error(failed.length + " CAPTURE-FIX checks failed");
  process.exitCode = 1;
} else {
  console.log("CAPTURE-FIX: all " + passed + " checks passed");
}
