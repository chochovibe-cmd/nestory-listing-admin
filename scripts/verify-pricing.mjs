/**
 * 5 PRICING-RULES＋PRICING-DB ＋ 抓取健康提醒（2026-11-20）驗收。
 * 規格：docs/PRICING-定價雲端化＋抓取健康-施工規格-2026-11-20.md
 * 純函式＋原始碼檢查；不連網路、不連資料庫。施工者不准修改本檔。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
register(pathToFileURL(path.join(root, "scripts/publish-guard-loader.mjs")).href);
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const exists = (name) => fs.existsSync(path.join(root, name));
const load = (name) => import(pathToFileURL(path.join(root, name)).href);

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  ✗ ${name}\n    ${String(error?.message ?? error).split("\n").join("\n    ")}`);
  }
}

console.log("verify-pricing: PRICING-RULES / PRICING-DB / 抓取健康提醒");

// ── PRICING-RULES ───────────────────────────────────────────────
const DEFAULTS = { rate: 4.5, costMultiplier: 1.3, marginMultiplier: 1.4, compareAtMultiplier: 1.8, minPrice: 199, showmoreMarkupPercent: 5 };

await check("R0 calculatePrice 舊值不變（黃金數字）", async () => {
  const { calculatePrice, defaultPricingSettings } = await load("src/lib/pricing.ts");
  for (const [key, value] of Object.entries(DEFAULTS)) assert.equal(defaultPricingSettings[key], value, key);
  const pick = (r) => [r.costTwd, r.sellPrice, r.compareAtPrice, r.profitTwd];
  assert.deepEqual(pick(calculatePrice(100)), [585, 899, 1080, 314]);
  assert.deepEqual(pick(calculatePrice(35)), [205, 299, 399, 94]);
  assert.deepEqual(pick(calculatePrice(259)), [1516, 2180, 2780, 664]);
  assert.deepEqual(pick(calculatePrice(299, { priceMode: "single" })), [1750, 2480, null, 730]);
  assert.deepEqual(pick(calculatePrice(1200, { currency: "TWD" })), [1560, 2199, 2880, 639]);
  assert.deepEqual(
    pick(calculatePrice(100, { settings: { rate: 5, costMultiplier: 1.5, marginMultiplier: 1, compareAtMultiplier: 1.8, minPrice: 199, showmoreMarkupPercent: 5 } })),
    [750, 799, 1580, 49]
  );
});

await check("R4 PricingSettings 有選填 version，且會進 pricingFormula 快照", async () => {
  const src = read("src/lib/pricing.ts");
  assert.match(src, /version\?\s*:\s*string\s*\|\s*null/);
  const { calculatePrice } = await load("src/lib/pricing.ts");
  const r = calculatePrice(100, { settings: { ...DEFAULTS, version: "2026-11-20T10:00:00Z" } });
  assert.equal(r.pricingFormula.settings.version, "2026-11-20T10:00:00Z");
  assert.equal(r.sellPrice, 899);
});

let shared = null;
await check("R1 pricingSettingsShared：key、範圍、錯誤訊息", async () => {
  assert.ok(exists("src/lib/pricingSettingsShared.ts"), "缺 src/lib/pricingSettingsShared.ts");
  assert.doesNotMatch(read("src/lib/pricingSettingsShared.ts"), /^\s*["']use client["']/m, "共用檔不可加 use client");
  shared = await load("src/lib/pricingSettingsShared.ts");
  const { PRICING_SETTINGS_KEY, PRICING_LIMITS, validatePricingSettings, LOW_MARGIN_THRESHOLD } = shared;
  assert.equal(PRICING_SETTINGS_KEY, "pricing_settings");
  assert.equal(LOW_MARGIN_THRESHOLD, 1.15);
  const expectLimits = {
    rate: ["匯率", 3, 7], costMultiplier: ["成本係數", 1, 2], marginMultiplier: ["利潤係數", 1, 4],
    compareAtMultiplier: ["定價係數", 1, 5], minPrice: ["最低售價", 0, 3000], showmoreMarkupPercent: ["Showmore 加價%", 0, 30]
  };
  for (const [key, [label, min, max]] of Object.entries(expectLimits)) {
    assert.equal(PRICING_LIMITS[key].label, label, key);
    assert.equal(PRICING_LIMITS[key].min, min, key);
    assert.equal(PRICING_LIMITS[key].max, max, key);
  }
  assert.equal(PRICING_LIMITS.minPrice.integer, true);

  const ok = validatePricingSettings(DEFAULTS);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.settings, DEFAULTS);
  const asText = validatePricingSettings({ ...DEFAULTS, rate: "4.6", extra: 1, version: "x" });
  assert.equal(asText.ok, true);
  assert.equal(asText.settings.rate, 4.6);
  assert.ok(!("extra" in asText.settings) && !("version" in asText.settings), "只回 6 個欄位");

  const bad = (patch) => validatePricingSettings({ ...DEFAULTS, ...patch });
  assert.deepEqual([bad({ rate: 45 }).ok, bad({ rate: 45 }).field, bad({ rate: 45 }).message], [false, "rate", "匯率要在 3–7 之間"]);
  assert.equal(bad({ rate: "abc" }).message, "匯率要在 3–7 之間");
  assert.equal(bad({ costMultiplier: 0.9 }).message, "成本係數要在 1–2 之間");
  assert.equal(bad({ marginMultiplier: 4.5 }).message, "利潤係數要在 1–4 之間");
  assert.equal(bad({ compareAtMultiplier: 0 }).message, "定價係數要在 1–5 之間");
  assert.equal(bad({ minPrice: 199.5 }).message, "最低售價要是 0–3000 的整數");
  assert.equal(bad({ minPrice: -1 }).message, "最低售價要是 0–3000 的整數");
  assert.equal(bad({ showmoreMarkupPercent: 31 }).message, "Showmore 加價%要在 0–30 之間");
  const missing = { ...DEFAULTS };
  delete missing.marginMultiplier;
  assert.equal(validatePricingSettings(missing).ok, false);
  assert.equal(validatePricingSettings(missing).field, "marginMultiplier");
  assert.equal(validatePricingSettings(null).ok, false);
  // 10-10 事故的設定在範圍內（只提醒，不擋）
  assert.equal(validatePricingSettings({ rate: 5, costMultiplier: 1.5, marginMultiplier: 1, compareAtMultiplier: 1.8, minPrice: 199, showmoreMarkupPercent: 5 }).ok, true);
});

await check("R1 pickEditablePricing／samePricingSettings", async () => {
  assert.ok(shared, "共用檔未載入");
  const { pickEditablePricing, samePricingSettings } = shared;
  assert.deepEqual(pickEditablePricing({ rate: 4.4, version: "x", hacked: true, minPrice: 99 }), { rate: 4.4, minPrice: 99 });
  assert.deepEqual(pickEditablePricing(null), {});
  assert.equal(samePricingSettings(DEFAULTS, { ...DEFAULTS, version: "v2" }), true);
  assert.equal(samePricingSettings(DEFAULTS, { ...DEFAULTS, rate: 4.51 }), false);
});

await check("跨裝置一致性：雲端 JSON 往返後兩台算出同價", async () => {
  assert.ok(shared, "共用檔未載入");
  const { calculatePrice } = await load("src/lib/pricing.ts");
  const cloud = { rate: 4.62, costMultiplier: 1.35, marginMultiplier: 1.55, compareAtMultiplier: 2, minPrice: 249, showmoreMarkupPercent: 8 };
  const deviceA = shared.validatePricingSettings(JSON.parse(JSON.stringify(cloud))).settings;
  const deviceB = shared.validatePricingSettings(JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(cloud).map(([k, v]) => [k, String(v)]))))).settings;
  for (const cost of [9.9, 35, 128, 259, 319, 999]) {
    for (const priceMode of ["sale", "single"]) {
      const a = calculatePrice(cost, { settings: deviceA, priceMode });
      const b = calculatePrice(cost, { settings: deviceB, priceMode });
      assert.deepEqual([a.sellPrice, a.compareAtPrice, a.costTwd], [b.sellPrice, b.compareAtPrice, b.costTwd], `${cost}/${priceMode}`);
    }
  }
});

// ── PRICING-DB：API ─────────────────────────────────────────────
const ROUTE = "src/app/api/settings/pricing/route.ts";
await check("API route：只 export GET/PUT、權限、team_settings、錯誤訊息", () => {
  assert.ok(exists(ROUTE), `缺 ${ROUTE}`);
  const src = read(ROUTE);
  const exported = [...src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(exported, ["GET", "PUT"]);
  assert.doesNotMatch(src, /^export\s+(?:type|interface|\{)/m, "route.ts 不可 export 其他東西");
  for (const needle of [
    "createServerSupabaseClient", "createServiceSupabaseClient", "canOperate", "auth.getUser",
    "team_settings", "PRICING_SETTINGS_KEY", "validatePricingSettings", "pickEditablePricing", "defaultPricingSettings",
    "updated_by", "請先登入", "需要 operator、reviewer 或 admin 角色", "伺服器未設定 SUPABASE_SERVICE_ROLE_KEY",
    "invalid_cloud_settings", "雲端定價設定格式不正確，請到設定頁重新儲存一次", "invalid_settings",
    "讀取雲端定價設定失敗", "存到雲端失敗"
  ]) assert.ok(src.includes(needle), `route 缺「${needle}」`);
  assert.match(src, /onConflict:\s*["']key["']/);
  assert.match(src, /status:\s*401/);
  assert.match(src, /status:\s*403/);
  assert.match(src, /status:\s*400/);
});

// ── PRICING-DB：前端 store ──────────────────────────────────────
const STORE = "src/lib/pricingSettingsStore.ts";
await check("store：保留舊函式名、打雲端 API、debounce 800、狀態事件", () => {
  const src = read(STORE);
  assert.match(src, /^\s*["']use client["']/m);
  for (const name of ["getStoredPricingSettings", "setStoredPricingSettings", "seedCloudPricingFromThisDevice", "getPricingSyncStatus"]) {
    assert.match(src, new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`), name);
  }
  for (const needle of [
    "/api/settings/pricing", "nestory_pricing_settings", "nestory:pricing-settings-changed", "nestory:pricing-sync-status",
    "PRICING_SYNC_STATUS_EVENT", "hasSupabaseBrowserEnv", "validatePricingSettings", "samePricingSettings", "800"
  ]) assert.ok(src.includes(needle), `store 缺「${needle}」`);
  for (const state of ["local_only", "loading", "cloud", "cloud_empty", "load_error", "saving", "saved", "save_error", "invalid"]) {
    assert.ok(src.includes(`"${state}"`), `store 缺狀態 ${state}`);
  }
  assert.match(src, /method:\s*["']PUT["']/);
});

await check("讀設定的元件不用改：仍經 getStoredPricingSettings", () => {
  for (const file of [
    "src/components/listing/result-card/ResultCardPricingPanel.tsx",
    "src/components/listing/result-card/ResultCardSpecsPanel.tsx",
    "src/components/records/PriceResyncPanel.tsx",
    "src/components/ExchangeRateWidget.tsx"
  ]) {
    const src = read(file);
    assert.ok(src.includes("getStoredPricingSettings"), file);
    assert.doesNotMatch(src, /localStorage\.(?:get|set)Item\(\s*["']nestory_pricing_settings/, `${file} 不可直接讀 localStorage`);
  }
});

// ── PRICING-DB：UI ──────────────────────────────────────────────
const NOTE = "src/components/settings/PricingSyncNote.tsx";
await check("PricingSyncNote：各狀態文案與 class", () => {
  assert.ok(exists(NOTE), `缺 ${NOTE}`);
  const src = read(NOTE);
  for (const needle of [
    "本機模式（沒有連雲端）：設定只存在這台裝置。",
    "讀取雲端定價設定中…",
    "全店共用（存在雲端），所有電腦和手機算出一樣的售價。最後修改：",
    "儲存中…",
    "✓ 已存到雲端",
    "⚠ 沒有存到雲端：",
    "。數字已改回雲端上的設定。",
    "，這個數字還沒有存。",
    "⚠ 讀不到雲端定價設定，暫時用這台裝置上次的設定。請重新整理頁面再試；讀到之前不能修改。",
    "雲端還沒有全店共用的定價設定，目前用這台裝置的設定。到「設定 → 💰 定價規則」可以設為全店共用。",
    "雲端還沒有全店共用的定價設定，現在每台電腦／手機各用各的，算出的售價可能不一樣。",
    "這台裝置的設定：匯率",
    "請在平常定價的那台電腦按這個按鈕。",
    "把這台的設定設為全店共用",
    "⚠ 沒有設成功：",
    "seedCloudPricingFromThisDevice",
    "PRICING_SYNC_STATUS_EVENT",
    "PricingFormulaPreview",
    "@/components/ui/Button"
  ]) assert.ok(src.includes(needle), `PricingSyncNote 缺「${needle}」`);
  for (const cls of ["settings-note", "settings-muted", "price-soft-warn", "notice", "formula-preview"]) {
    assert.ok(src.includes(cls), `PricingSyncNote 沒用到 .${cls}`);
  }
});

await check("公式說明跟程式一致（5 行）＋低利潤提醒", () => {
  const src = read(NOTE);
  for (const needle of [
    "成本（台幣）＝ 人民幣成本 × 匯率",
    "（無條件進位）",
    "售價 ＝ 成本（台幣）× 利潤係數",
    "，再尾數美化",
    "定價 ＝ 成本（台幣）× 定價係數",
    "至少高於售價",
    "（單一售價商品沒有定價）",
    "利潤 ＝ 售價 − 成本（台幣）",
    "後再尾數美化（匯出時已套用）",
    "⚠ 利潤係數低於 1.15，售價幾乎等於成本，扣掉尾數美化可能只剩幾十元利潤。",
    "LOW_MARGIN_THRESHOLD"
  ]) assert.ok(src.includes(needle), `公式說明缺「${needle}」`);
});

await check("SettingsPanel：用 PricingSyncNote、舊本機文案移除、讀取中/錯誤時停用", () => {
  const src = read("src/components/settings/SettingsPanel.tsx");
  assert.match(src, /<PricingSyncNote\s+variant="settings"\s*\/>/);
  assert.match(src, /<PricingFormulaPreview\b/);
  assert.ok(!src.includes("共用本機儲存"), "舊文案「共用本機儲存」要刪");
  assert.ok(!src.includes("Showmore +% 暫存本機"), "舊文案「Showmore +% 暫存本機」要刪");
  assert.ok(src.includes("✨ 尾數美化"), "尾數美化那行要保留");
  assert.ok(src.includes("getPricingSyncStatus") || src.includes("PRICING_SYNC_STATUS_EVENT"), "要讀同步狀態來停用輸入框");
  assert.match(src, /load_error/);
  assert.match(src, /"loading"/);
});

await check("WorkspaceInputPanel：用 PricingSyncNote、舊本機文案移除", () => {
  const src = read("src/components/listing/WorkspaceInputPanel.tsx");
  assert.match(src, /<PricingSyncNote\s+variant="workspace"\s*\/>/);
  assert.match(src, /<PricingFormulaPreview\b/);
  assert.ok(!src.includes("共用本機儲存"), "舊文案「共用本機儲存」要刪");
  assert.ok(src.includes("含運費手續費緩衝。"), "成本係數說明保留");
  assert.match(src, /load_error/);
});

// ── 抓取健康提醒 ────────────────────────────────────────────────
const HEALTH = "src/lib/import/captureHealth.ts";
let health = null;
await check("captureHealth：檔案與 export", async () => {
  assert.ok(exists(HEALTH), `缺 ${HEALTH}`);
  const src = read(HEALTH);
  assert.doesNotMatch(src, /from\s+["'][^"']*(supabase|shopify\/(?!publishReadiness))/i, "健康檢查不可碰資料庫／Shopify（只准 import publishReadiness）");
  assert.ok(src.includes("mock-product-id"), "已上架判斷要排除 mock-product-id");
  for (const reuse of ["hasHiddenVariantPriceEvidence", "readHiddenVariantPriceEvidence", "isVariantPriceConfirmed", "isVariantPriceUnconfirmedCapture", "allVariantCostsIdentical"]) {
    assert.ok(src.includes(reuse), `要沿用既有 ${reuse}`);
  }
  health = await load(HEALTH);
  assert.equal(health.CAPTURE_HEALTH_TITLE, "抓取可能不完整，建議重抓");
  const readiness = read("src/lib/shopify/publishReadiness.ts");
  assert.match(readiness, /export function allVariantCostsIdentical\(/);
});

const HIDDEN_META = { price_debug: { price_paths: [{ path: "data.skuBase.hideOtherPrice", value: true }] } };
const RANGE_META = { price_debug: { price_paths: [{ path: "priceText", value: "￥329-418" }] } };
const v = (cny_price, cost_is_inherited = false) => ({ cny_price, cost_is_inherited });
const detail = 5;
function assess(input) {
  assert.ok(health, "captureHealth 未載入");
  return health.assessCaptureHealth({ productCny: 99, variants: [], detailImageCount: detail, shopifyProductId: null, ...input });
}
const codes = (r) => r.issues.map((i) => i.code);
const labels = (r) => r.issues.map((i) => i.label);

await check("健康 1：完整抓取 → 沒事", () => {
  const r = assess({ rawCapture: { client_meta: { sku_dimensions: 1 }, server: {} }, variants: [v(99), v(120)] });
  assert.deepEqual(r, { incomplete: false, issues: [] });
});
await check("健康 2：手動建立（沒有 client_meta/server）→ 不檢查", () => {
  assert.deepEqual(assess({ rawCapture: null, variants: [], productCny: 0.01, detailImageCount: 0 }), { incomplete: false, issues: [] });
  assert.deepEqual(assess({ rawCapture: { foo: 1 }, variants: [], productCny: 0.01, detailImageCount: 0 }), { incomplete: false, issues: [] });
});
await check("健康 3：已上架 → 不檢查", () => {
  const r = assess({ rawCapture: { client_meta: {}, server: {} }, productCny: 0.01, detailImageCount: 0, shopifyProductId: "gid://shopify/Product/123" });
  assert.equal(r.incomplete, false);
});
await check("健康 4：款式成本缺（自己和商品都沒有）", () => {
  const r = assess({ rawCapture: { client_meta: {}, server: {} }, productCny: 0.01, variants: [v(null), v(0.01), v(88)] });
  assert.deepEqual(codes(r), ["variant_cost_missing"]);
  assert.deepEqual(labels(r), ["款式價格有缺（2 款沒有成本）"]);
  assert.equal(r.incomplete, true);
});
await check("健康 5：款式沒自己的成本但商品有 → 不算缺", () => {
  const r = assess({ rawCapture: { client_meta: {}, server: {} }, productCny: 99, variants: [v(null, true), v(120)] });
  assert.deepEqual(codes(r), []);
});
await check("健康 6：PRICE-GUARD 未確認、暫用商品成本", () => {
  const raw = { client_meta: HIDDEN_META, server: { price_requires_confirmation: true } };
  const r = assess({ rawCapture: raw, productCny: 99, variants: [v(null, true), v(99, true), v(150)] });
  assert.deepEqual(codes(r), ["variant_cost_unconfirmed"]);
  assert.deepEqual(labels(r), ["款式價格有缺（淘寶隱藏各款價格，2 款暫用商品成本）"]);
});
await check("健康 7：已確認過的 PRICE-GUARD → 不提醒", () => {
  const raw = { client_meta: HIDDEN_META, server: { price_requires_confirmation: true, variant_price_confirmed_at: "2026-11-01T00:00:00Z" } };
  const r = assess({ rawCapture: raw, productCny: 99, variants: [v(99), v(99), v(99)] });
  assert.deepEqual(codes(r), []);
});
await check("健康 8：每款同價＋頁面有價差 → 紅；盲盒同價沒證據 → 不紅", () => {
  const r = assess({ rawCapture: { client_meta: RANGE_META, server: {} }, productCny: 329, variants: [v(329), v(329), v(329)] });
  assert.deepEqual(codes(r), ["same_price_with_range"]);
  assert.deepEqual(labels(r), ["每款都同價（但頁面顯示價格有高低或被隱藏）"]);
  const blindBox = assess({ rawCapture: { client_meta: { sku_dimensions: 1 }, server: {} }, productCny: 69, variants: [v(69), v(69), v(69)] });
  assert.deepEqual(codes(blindBox), []);
  const hiddenSame = assess({ rawCapture: { client_meta: HIDDEN_META, server: {} }, productCny: 50, variants: [v(50), v(50)] });
  assert.deepEqual(codes(hiddenSame), ["same_price_with_range"]);
});
await check("健康 9：0 個款式但頁面有選項；單一商品或被拿掉的固定軸 → 不紅", () => {
  const r = assess({ rawCapture: { client_meta: { sku_dimensions: 2 }, server: { dropped_constant_axes: [{ name: "顏色", value: "默認" }] } }, variants: [] });
  assert.deepEqual(labels(r), ["0 個款式（頁面有款式選項）"]);
  const single = assess({ rawCapture: { client_meta: { sku_dimensions: 0 }, server: {} }, variants: [] });
  assert.deepEqual(codes(single), []);
  const constAxis = assess({ rawCapture: { client_meta: { sku_dimensions: 1 }, server: { dropped_constant_axes: [{ name: "顏色", value: "默認" }] } }, variants: [] });
  assert.deepEqual(codes(constAxis), []);
  const range = assess({ rawCapture: { client_meta: RANGE_META, server: {} }, variants: [] });
  assert.deepEqual(codes(range), ["no_variants"]);
  const excluded = assess({ rawCapture: { client_meta: {}, server: { excluded_variants: [{ label: "購買須知" }] } }, variants: [] });
  assert.deepEqual(codes(excluded), ["no_variants"]);
});
await check("健康 10：0 張詳情圖；單一商品沒成本", () => {
  const r = assess({ rawCapture: { client_meta: {}, server: {} }, productCny: 0.01, variants: [], detailImageCount: 0 });
  assert.deepEqual(codes(r), ["variant_cost_missing", "no_detail_images"]);
  assert.deepEqual(labels(r), ["沒抓到成本", "0 張詳情圖"]);
});
await check("健康 11：多個問題的順序", () => {
  const raw = { client_meta: { ...RANGE_META, sku_dimensions: 1 }, server: {} };
  const r = assess({ rawCapture: raw, productCny: 0.01, variants: [], detailImageCount: 0 });
  assert.deepEqual(codes(r), ["variant_cost_missing", "no_variants", "no_detail_images"]);
});
await check("健康 12：重抓說明", () => {
  assert.ok(health, "captureHealth 未載入");
  const { captureHealthHowTo } = health;
  assert.equal(captureHealthHowTo([{ code: "variant_cost_missing", label: "x" }]), "用外掛重抓同一個網址，會補上還沒確認的成本。");
  assert.equal(captureHealthHowTo([{ code: "variant_cost_missing", label: "x" }, { code: "no_detail_images", label: "y" }]), "款式或詳情圖缺少時，要先封存這筆草稿，再用外掛重抓，才會重新建立。");
  assert.equal(captureHealthHowTo([{ code: "no_variants", label: "z" }]), "款式或詳情圖缺少時，要先封存這筆草稿，再用外掛重抓，才會重新建立。");
});

await check("ResultCard／規格頁籤接線", () => {
  const card = read("src/components/listing/ResultCard.tsx");
  for (const needle of ["assessCaptureHealth", 'data-testid="capture-health-chip"', "rc-detect-warn is-block", "⚠ 抓取可能不完整，建議重抓", "CAPTURE_HEALTH_TITLE", "captureHealthIssues="]) {
    assert.ok(card.includes(needle), `ResultCard 缺「${needle}」`);
  }
  assert.match(card, /variantPrices/);
  const specs = read("src/components/listing/result-card/ResultCardSpecsPanel.tsx");
  for (const needle of ["captureHealthIssues", 'className="capture-health-note"', 'data-testid="capture-health-note"', 'role="alert"', "⚠ 抓取可能不完整，建議重抓：", "captureHealthHowTo"]) {
    assert.ok(specs.includes(needle), `ResultCardSpecsPanel 缺「${needle}」`);
  }
  assert.ok(specs.includes("⚠ 淘寶隱藏了各款價格"), "既有黃色 PRICE-GUARD 提示要保留");
  assert.ok(specs.indexOf("capture-health-note") < specs.indexOf("⚠ 成本未取得"), "紅字要在「成本未取得」之前");
});

await check("交給 GPT 列表接線（CSV 不改）", () => {
  const list = read("src/components/listing/GptRawList.tsx");
  for (const needle of ["assessCaptureHealth", 'data-testid="capture-health-chip"', "schip schip--error", "⚠ 抓取可能不完整，建議重抓：", "capture_client_meta", "capture_server"]) {
    assert.ok(list.includes(needle), `GptRawList 缺「${needle}」`);
  }
  const page = read("src/app/drafts/new/page.tsx");
  assert.ok(page.includes("capture_client_meta:raw_capture->client_meta"), "page 查詢缺 capture_client_meta");
  assert.ok(page.includes("capture_server:raw_capture->server"), "page 查詢缺 capture_server");
  assert.match(page, /select\("id, draft_id, sort_order, cny_price, cost_is_inherited"\)/);
  const exp = read("src/lib/csv/gptRawExport.ts");
  assert.match(exp, /capture_client_meta:\s*unknown/);
  assert.match(exp, /capture_server:\s*unknown/);
  assert.match(exp, /"cost_is_inherited"/);
  assert.ok(exp.includes('"商品編號", "來源平台", "來源連結", "原始標題"'), "CSV 表頭不可改");
});

await check("CSS：只新增 .capture-health-note，沒有新增 !important", () => {
  const css = read("src/app/globals.css");
  const block = css.match(/\.capture-health-note\s*\{([^}]*)\}/);
  assert.ok(block, "缺 .capture-health-note");
  assert.match(block[1], /var\(--danger,\s*var\(--accent2\)\)/);
  assert.doesNotMatch(block[1], /#[0-9a-f]{3,8}\b|rgb\(/i, "不可自創顏色");
  assert.ok(css.indexOf(".capture-health-note") > css.indexOf(".price-soft-warn {"), "放在 .price-soft-warn 之後");
  const importantCount = (css.match(/!important/g) ?? []).length;
  assert.ok(importantCount <= 12, `!important 從 12 變成 ${importantCount}`);
});

await check("禁區：文案線檔案沒有引用本包新檔", () => {
  const files = [
    "src/app/api/generate/route.ts", "src/lib/ai/aiCost.ts", "src/lib/images/copyReference.ts"
  ];
  for (const file of files) {
    if (!exists(file)) continue;
    const src = read(file);
    assert.doesNotMatch(src, /pricingSettingsShared|captureHealth|PricingSyncNote/, file);
  }
});

// ── 沒有自己設定的裝置不能設為全店共用（11-23 預覽驗收發現）────────
await check("裝置設定判斷：無值／壞 JSON／無可編輯欄位／不能用 → false，有值 → true；沒有就不送 PUT", async () => {
  const KEY = "nestory_pricing_settings";
  const NO_OWN = "這台裝置沒有自己的定價設定，請到平常定價的那台電腦操作";
  const data = new Map();
  let storageBroken = false;
  const guard = () => { if (storageBroken) throw new Error("storage unavailable"); };
  const win = new EventTarget();
  win.localStorage = {
    getItem: (key) => { guard(); return data.has(key) ? data.get(key) : null; },
    setItem: (key, value) => { guard(); data.set(key, value); },
    removeItem: (key) => { guard(); data.delete(key); }
  };
  const calls = [];
  const savedGlobals = { window: globalThis.window, fetch: globalThis.fetch, url: process.env.NEXT_PUBLIC_SUPABASE_URL, anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
  globalThis.window = win;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url: String(url), method, body: init.body ?? null });
    const payload = method === "PUT"
      ? { ok: true, settings: { ...JSON.parse(init.body).settings, version: "2026-11-23T00:00:00Z" }, updatedAt: "2026-11-23T00:00:00Z" }
      : { ok: true, settings: null, updatedAt: null };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const store = await load(STORE);
    const puts = () => calls.filter((call) => call.method === "PUT").length;
    assert.equal(store.hasOwnPricingSettingsOnThisDevice(), false, "無值");
    store.getStoredPricingSettings();
    for (let i = 0; i < 50 && store.getPricingSyncStatus().state !== "cloud_empty"; i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(store.getPricingSyncStatus().state, "cloud_empty");

    const rejected = async (label) => {
      assert.equal(store.hasOwnPricingSettingsOnThisDevice(), false, label);
      assert.deepEqual(await store.seedCloudPricingFromThisDevice(), { ok: false, message: NO_OWN }, label);
      assert.equal(puts(), 0, `${label} 不可送 PUT`);
    };
    await rejected("無值");
    data.set(KEY, "{broken");
    await rejected("壞 JSON");
    data.set(KEY, "[1,2]");
    await rejected("不是物件");
    data.set(KEY, JSON.stringify({ foo: 1, version: "x" }));
    await rejected("沒有可編輯欄位");
    storageBroken = true;
    await rejected("localStorage 不能用");
    storageBroken = false;

    data.set(KEY, JSON.stringify({ ...DEFAULTS, rate: 4.62 }));
    assert.equal(store.hasOwnPricingSettingsOnThisDevice(), true, "有值");
    assert.deepEqual(await store.seedCloudPricingFromThisDevice(), { ok: true });
    assert.equal(puts(), 1, "有自己的設定才送一次 PUT");
    assert.equal(JSON.parse(calls.find((call) => call.method === "PUT").body).settings.rate, 4.62);
  } finally {
    if (savedGlobals.window === undefined) delete globalThis.window; else globalThis.window = savedGlobals.window;
    globalThis.fetch = savedGlobals.fetch;
    if (savedGlobals.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = savedGlobals.url;
    if (savedGlobals.anon === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = savedGlobals.anon;
  }
});

await check("沒有自己的設定：畫面不顯示按鈕、文案固定；改過數字後才重新判斷", () => {
  const src = read(NOTE);
  const start = src.indexOf("if (!hasOwn) return (");
  assert.ok(start > 0, "缺 !hasOwn 區塊");
  const end = src.indexOf("</div>", start);
  const block = src.slice(start, end);
  assert.ok(!block.includes("<Button"), "沒有自己的設定時不可有按鈕");
  for (const line of [
    "雲端還沒有全店共用的定價設定，現在每台電腦／手機各用各的，算出的售價可能不一樣。",
    "這台裝置沒有自己的定價設定，目前顯示的是系統預設值：匯率 ",
    "請到平常定價的那台電腦，打開這一頁按「把這台的設定設為全店共用」。"
  ]) assert.ok(block.includes(line), `缺「${line}」`);
  assert.equal((block.match(/<p>/g) ?? []).length, 3, "固定三行");
  assert.equal((src.match(/<Button\b/g) ?? []).length, 1, "只有一顆按鈕");
  assert.ok(src.indexOf("<Button") > end, "按鈕只在有自己設定的分支");
  assert.ok(src.includes("雲端還沒有全店共用的定價設定，這台裝置目前用系統預設值。請到平常定價的那台電腦，在「設定 → 💰 定價規則」設為全店共用。"), "工作台文案");
  assert.match(src, /variant === "workspace" && !hasOwn/);
  assert.equal((src.match(/setHasOwn\(hasOwnPricingSettingsOnThisDevice\(\)\)/g) ?? []).length, 2, "useEffect 與 onPricing 都要更新");
});

console.log(`\nverify-pricing: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
