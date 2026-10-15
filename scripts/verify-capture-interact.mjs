/**
 * CAPTURE-INTERACT verifier: DOM-only linkedom simulation, fake time, no external I/O.
 * Run from repo root with: npm run verify:capture-interact
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
const readiness = await import(src("src/lib/shopify/publishReadiness.ts"));
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
const OPTS = { host: "item.taobao.com" };
function makeFixture({
  colors = ["A", "B", "C"], sizes = ["1", "2"],
  values, delay = 200, disabled = [], soldOut = [], ignoreClicks = false,
  startsWith = 999, priceStarts = true, constantPrice = null
} = {}) {
  const variants = [], amounts = {};
  colors.forEach((color, ci) => sizes.forEach((size, si) => {
    const sku = "sku-" + ci + "-" + si;
    const price = constantPrice == null ? 10 + ci * 10 + si : constantPrice;
    variants.push({
      sku, option1_name: "顏色分類", option1_value: color,
      option2_name: "尺寸", option2_value: size, cny_price: null
    });
    amounts[sku] = values && values[sku] != null ? values[sku] : price;
  }));
  const info = {};
  for (const row of variants) info[row.sku] = { quantity: soldOut.includes(row.sku) ? 0 : 10 };
  const ice = { loaderData: { home: { data: { res: { skuCore: {
    sku2info: info, skuItem: { hideOtherPrice: "true" }
  } } } } } };
  const options = (items, axis) => items.map((item) =>
    '<div class="valueItem--x' + (disabled.includes(item) ? ' isDisabled--x' : '') +
    '" data-value="' + item + '" data-axis="' + axis + '">' + item + "</div>").join("");
  const html = '<html><body><div id="SkuPanel_tbpcDetail_ssr2025">' +
    '<div class="skuItem--x"><span class="ItemLabel--x">顏色分類</span>' +
    options(colors, 1) + "</div>" +
    '<div class="skuItem--x"><span class="ItemLabel--x">尺寸</span>' +
    options(sizes, 2) + "</div></div>" +
    (priceStarts ? '<div class="subPrice--x">优惠前 ¥' + startsWith + "</div>" : "") +
    '<div class="highlightPrice--x"><span class="text--x">券后 ¥' +
    (priceStarts ? startsWith - 1 : 88) + "</span></div>" +
    "<script>window.__ICE_APP_CONTEXT__=" + JSON.stringify(ice) + ";</script></body></html>";
  const { document } = parseHTML(html);
  const proto = document.createElement("div").constructor.prototype;
  if (typeof proto.click !== "function") {
    proto.click = function () { this.dispatchEvent(new document.defaultView.Event("click", { bubbles: true })); };
  }
  const choices = [null, null], counts = new Map(), pending = [];
  let time = 0, sequence = 0;
  const source = document.querySelector(".subPrice--x");
  const promo = document.querySelector(".highlightPrice--x span");
  function setDisplayed(base) {
    if (source) source.textContent = "优惠前 ¥" + base;
    promo.textContent = "券后 ¥" + (base - 1);
  }
  for (const node of document.querySelectorAll("[data-axis]")) {
    node.addEventListener("click", () => {
      const value = node.getAttribute("data-value");
      counts.set(value, (counts.get(value) || 0) + 1);
      if (ignoreClicks || disabled.includes(value)) return;
      const axis = Number(node.getAttribute("data-axis")) - 1;
      const already = node.classList.contains("isSelected--x");
      for (const other of document.querySelectorAll('[data-axis="' + (axis + 1) + '"]'))
        other.classList.remove("isSelected--x");
      if (already) choices[axis] = null;
      else {
        node.classList.add("isSelected--x");
        choices[axis] = value;
      }
      if (choices[0] != null && choices[1] != null) {
        const row = variants.find((v) => v.option1_value === choices[0] &&
          v.option2_value === choices[1]);
        const id = ++sequence;
        pending.push({ at: time + delay, value: amounts[row.sku], id });
      }
    });
  }
  async function wait(ms) {
    time += ms;
    const due = pending.filter((p) => p.at <= time).sort((a, b) => a.at - b.at);
    for (const task of due) if (task.id === sequence) setDisplayed(task.value);
    for (const task of due) pending.splice(pending.indexOf(task), 1);
  }
  const payload = {
    source_platform: "taobao", price_cny: Math.min(...Object.values(amounts)),
    variants_flat: variants, capture_meta: { warnings_from_client: [
      "sku: 個別未優惠價未完整取得；未以商品價假裝 SKU 價格"
    ] }
  };
  return { document, payload, variants, amounts, counts, wait, now: () => time,
    opts: { ...OPTS, wait, now: () => time } };
}
async function run(f, limits) {
  return Cap.interactSkuPrices(f.document, f.payload,
    { ...f.opts, ...(limits ? { limits } : {}) });
}
const badCount = (result, status) => result.rows.filter((row) => row.status === status).length;
console.log("verify-capture-interact: §4 16 cases");

await check("CI01 condition: structured/one-variant/non-Taobao skips interaction", () => {
  const f = makeFixture();
  assert.equal(Cap.shouldInteractSkuPrices(f.payload), true);
  f.payload.variants_flat.forEach((r) => { r.cny_price = 11; });
  assert.equal(Cap.shouldInteractSkuPrices(f.payload), false);
  f.payload.variants_flat[0].cny_price = null;
  f.payload.source_platform = "shopee";
  assert.equal(Cap.shouldInteractSkuPrices(f.payload), false);
  f.payload.source_platform = "taobao";
  f.payload.variants_flat = f.payload.variants_flat.slice(0, 1);
  assert.equal(Cap.shouldInteractSkuPrices(f.payload), false);
});
await check("CI02 2-axis 3x2: 6/6 twice-verified prices and provenance", async () => {
  const f = makeFixture();
  const r = await run(f);
  assert.equal(r.ok, 6); assert.equal(r.status, "complete");
  assert.equal(r.requires_confirmation, false);
  for (const row of f.variants) {
    assert.equal(row.cny_price, f.amounts[row.sku]);
    assert.equal(row.price_source, "interact.selected_sku");
    assert.equal(row.price_confidence, "interact_verified");
    assert.equal(row.promo_price_source, "interact.selected_sku.promo");
    assert.equal(row.price_candidates.at(-1).kind, "base");
  }
});
await check("CI03 delayed 900ms: reverse-pass disagreement/third read; 2000ms mismatch", async () => {
  const f = makeFixture({ delay: 900 });
  const r = await run(f);
  assert.equal(r.ok, 6);
  assert.ok(r.rows.some((x) => x.pass1 !== x.pass2),
    "delayed render must exercise disagreeing passes");
  const g = makeFixture({ delay: 2000 });
  const rr = await run(g);
  assert.ok(badCount(rr, "mismatch") >= 1, "very late render must not be trusted");
});
await check("CI04 selected options are never clicked again (toggle-off regression)", async () => {
  const f = makeFixture();
  const r = await run(f);
  assert.equal(r.ok, 6);
  assert.equal(f.variants.every((v) => v.cny_price === f.amounts[v.sku]), true);
  assert.ok((f.counts.get("A") || 0) < 12);
});
await check("CI05 disabled options and ICE sold-out quantity are not read", async () => {
  const f = makeFixture({ disabled: ["C"], soldOut: ["sku-0-0"] });
  const r = await run(f);
  assert.equal(badCount(r, "sold_out"), 1);
  assert.equal(badCount(r, "disabled"), 2);
  assert.equal(f.counts.get("C") || 0, 0);
});
await check("CI06 3 consecutive failed clicks abort and leave rest not_run", async () => {
  const f = makeFixture({ ignoreClicks: true });
  const r = await run(f);
  assert.equal(r.status, "aborted"); assert.equal(r.abort_reason, "click_failed");
  assert.equal(badCount(r, "click_failed"), 3);
  assert.equal(badCount(r, "not_run"), 3);
});
await check("CI07 price text never loses 起: timeout, no guessed price", async () => {
  const f = makeFixture({ delay: 999999 });
  f.document.querySelector(".subPrice--x").textContent = "优惠前 ¥9 起";
  const r = await run(f);
  assert.ok(badCount(r, "timeout") >= 1);
  assert.ok(f.variants.every((v) => v.cny_price == null));
});
await check("CI08 promo-only never becomes base cost", async () => {
  const f = makeFixture({ priceStarts: false });
  const r = await run(f);
  assert.ok(badCount(r, "promo_only") > 0);
  assert.ok(f.variants.every((v) => v.cny_price == null));
});
await check("CI09 identical twice-read prices flag all_identical", async () => {
  const f = makeFixture({ constantPrice: 100 });
  const r = await run(f);
  assert.ok(r.reasons.includes("all_identical"));
  assert.equal(r.requires_confirmation, true);
});
await check("CI10 minimum price different from page start flags min_mismatch", async () => {
  const f = makeFixture();
  f.payload.price_cny = 5;
  const r = await run(f);
  assert.ok(r.reasons.includes("min_mismatch"));
});
await check("CI11 maxCombos and maxTotalMs partial + over_limit", async () => {
  const a = await run(makeFixture(), { maxCombos: 3, maxTotalMs: 90000 });
  assert.equal(badCount(a, "over_limit"), 3); assert.equal(a.status, "partial");
  const b = await run(makeFixture(), { maxCombos: 40, maxTotalMs: 1 });
  assert.ok(badCount(b, "over_limit") > 0);
  assert.equal(b.status, "partial");
});
await check("CI12 mixed structured/unknown prices are preserved", async () => {
  const f = makeFixture();
  for (let i = 0; i < 3; i++) {
    f.variants[i].cny_price = 700 + i;
    f.variants[i].price_source = "ice.skuCore.sku2info";
  }
  const r = await run(f);
  assert.equal(r.targets, 3);
  for (let i = 0; i < 3; i++) {
    assert.equal(f.variants[i].cny_price, 700 + i);
    assert.equal(f.variants[i].price_source, "ice.skuCore.sku2info");
  }
});
async function captureWith(fakeResult, initial) {
  const { document } = parseHTML("<html><body></body></html>");
  const ctx = {
    document, location: { href: "https://item.taobao.com/item.htm?id=test",
      hostname: "item.taobao.com" },
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
await check("CI13 capture.js removes solved missing-price warning / summarizes partial statuses", async () => {
  const a = makeFixture();
  a.payload.detail_image_urls = Array.from({ length: 5 }, (_, i) => String(i));
  const filled = a.payload.variants_flat.map((v, i) => ({ ...v, cny_price: 10 + i }));
  const complete = await captureWith({
    payload: { variants_flat: filled },
    result: { version: 1, status: "complete", targets: 6, ok: 6, rows: [], reasons: [] }
  }, a.payload);
  assert.ok(!complete.capture_meta.warnings_from_client.some((w) =>
    w.includes("個別未優惠價未完整取得")));
  const b = makeFixture();
  b.payload.detail_image_urls = a.payload.detail_image_urls;
  const partial = await captureWith({
    result: { version: 1, status: "partial", targets: 6, ok: 3,
      rows: [{ status: "sold_out" }, { status: "timeout" },
        { status: "over_limit" }, { status: "ok" }, { status: "ok" }, { status: "ok" }],
      reasons: ["incomplete"] }
  }, b.payload);
  assert.ok(partial.capture_meta.warnings_from_client.some((w) =>
    w.includes("3 款沒讀到價格（來源缺貨 1、頁面沒反應 1、超過上限 1）")));
});
const OWNER = { userId: "u1", receivedAt: "2026-10-15T00:00:00Z" };
function serverBody({ prices = [10, 20], status = "complete", confirm = false, range = "¥10-20" } = {}) {
  return { source_url: "https://item.taobao.com/item.htm?id=9001",
    source_platform: "taobao", title: "variant verification", price_cny: 10,
    variants_flat: prices.map((p, i) => ({
      sku: "v" + i, option1_name: "款式", option1_value: "Option" + i,
      cny_price: p, price_source: p == null ? null : "interact.selected_sku",
      price_confidence: p == null ? "unknown" : "interact_verified"
    })),
    capture_meta: { price_confidence: "high", warnings_from_client: [],
      interact: { version: 1, status, targets: prices.length, ok: prices.filter((p) => p != null).length,
        requires_confirmation: confirm },
      price_debug: { price_paths: [
        { path: "res.skuCore.skuItem.hideOtherPrice", value: true },
        { path: "res.price.priceText", value: range }
      ] } }
  };
}
await check("CI14 server: all verified clears hidden warning; partial + range mismatch guard", () => {
  const all = mapCaptureToDraftFields(serverBody(), OWNER);
  assert.equal(all.rawCapture.server.price_requires_confirmation, false);
  assert.ok(!all.warnings.includes(hidden.WARNING_HIDDEN_VARIANT_PRICES));
  assert.equal(all.variantRows[0].cny_price, 10);
  const partial = mapCaptureToDraftFields(serverBody({ prices: [10, null],
    status: "partial", confirm: true }), OWNER);
  assert.equal(partial.rawCapture.server.price_requires_confirmation, true);
  assert.ok(partial.rawCapture.server.warnings.includes(hidden.WARNING_INTERACT_NEEDS_CONFIRMATION));
  const mismatch = mapCaptureToDraftFields(serverBody({ range: "¥10-30" }), OWNER);
  assert.equal(mismatch.rawCapture.server.price_requires_confirmation, true);
  assert.ok(mismatch.warnings.some((w) => w.includes("頁面價格區間")));
  assert.deepEqual(readiness.parsePriceRange("優惠前 ￥10-30"), { low: 10, high: 30 });
});
await check("CI15 unchanged PRICE-GUARD: hidden + identical costs still blocked", () => {
  const raw_capture = { client_meta: { price_debug: { price_paths: [
    { path: "res.skuCore.skuItem.hideOtherPrice", value: true }
  ] } } };
  const rows = [{ option1_value: "A", cny_price: 10, twd_price: 100 },
    { option1_value: "B", cny_price: 10, twd_price: 100 }];
  const r = readiness.checkPublishReadiness({ cny_price: 10, raw_capture }, rows);
  assert.ok(r.blocked);
  assert.ok(r.blockers.some((b) => b.code === "VARIANT_PRICE_UNCONFIRMED"));
});
await check("CI16 existing CAP2/PRICE-GUARD/VARIANT-CLEAN/PUBLISH-GUARD + SKU fixture", () => {
  for (const name of ["verify-cap2.mjs", "verify-price-guard.mjs",
      "verify-variant-clean.mjs", "verify-publish-guard.mjs"]) {
    const run = spawnSync(process.execPath, [path.join(root, "scripts", name)],
      { cwd: root, encoding: "utf8" });
    assert.equal(run.status, 0, name + "\n" + run.stderr + "\n" + run.stdout.slice(-1500));
  }
  const html = read("scripts/fixtures/tmall-ssr2025-sku.html");
  const { document } = parseHTML(html);
  const parsed = Cap.adapters.taobao(document, "https://detail.tmall.com/item.htm?id=1",
    "detail.tmall.com");
  assert.ok(parsed.sku_table || parsed.variants_flat.length > 0);
  assert.ok(read("extension/lib/adapters/taobao.js").includes("skuValueText(n, dom)"));
});
if (failed.length) {
  console.error(failed.length + " / 16 CAPTURE-INTERACT checks failed");
  process.exitCode = 1;
} else {
  console.log("CAPTURE-INTERACT: all " + passed + " / 16 checks passed");
}
