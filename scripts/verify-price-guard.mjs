/**
 * PRICE-GUARD verify (no network, no .env, no Supabase).
 *
 * Incident 2026-10-14: Taobao/Tmall hid the per-variant prices (ICE
 * `skuItem.hideOtherPrice = true`, sku2info without `price`). The extension warned, but
 *   1) the server stored price_requires_confirmation=false / confidence "high",
 *   2) the card editor was fed variant rows WITHOUT cost_is_inherited, re-inferred the flag as
 *      "independent" and saved cny=product cost + cost_is_inherited=false,
 *   3) PUBLISH-GUARD trusted that flag, so all variants went live at the cheapest price.
 *
 * Imports the REAL modules through scripts/publish-guard-loader.mjs.
 *   Part A  server capture flags hidden per-variant prices (multi-variant only)
 *   Part B  inherited state survives load -> save; only an explicit cost edit clears it
 *   Part C  publish readiness backstop (independent of cost_is_inherited)
 *   Part D  static wiring (selects, card hint, verify registration)
 *
 * Run: node scripts/verify-price-guard.mjs  |  npm run verify:price-guard
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
register(pathToFileURL(path.join(root, "scripts", "publish-guard-loader.mjs")).href);
const src = (rel) => pathToFileURL(path.join(root, rel)).href;
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const { mapCaptureToDraftFields } = await import(src("src/lib/import/mapCaptureFields.ts"));
const hidden = await import(src("src/lib/import/captureHiddenPrices.ts"));
const { dbRowsToForm, formRowsToDbInserts } = await import(src("src/lib/variants/variantMapping.ts"));
const { syncInheritedVariantCosts } = await import(src("src/lib/variants/variantPricing.ts"));
const { defaultPricingSettings } = await import(src("src/lib/pricing.ts"));
const readiness = await import(src("src/lib/shopify/publishReadiness.ts"));
const { checkPublishReadiness, isVariantPriceUnconfirmedCapture } = readiness;

let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

const CLIENT_WARNING = "sku: 個別未優惠價未完整取得；未以商品價假裝 SKU 價格";
const HIDDEN_WARNING = "淘寶隱藏了各款價格，所有款式暫用最低價；發布前請逐款確認成本";

// --- fixtures mirroring the real captures --------------------------------------------------

/** 2026-10-14 19:56-20:01: hideOtherPrice, no per-sku price, warning present, promo range. */
function hiddenPriceBody(overrides = {}) {
  const names = ["Hello Kitty", "My Melody", "Cinnamoroll", "Kuromi"];
  return {
    source_url: "https://detail.tmall.com/item.htm?id=900000000001",
    source_platform: "tmall",
    title: "三麗鷗 造型零錢包",
    price_cny: 169,
    variants_flat: names.map((name, i) => ({
      option1_name: "顏色分類",
      option1_value: name,
      sku: `sku-${i}`
    })),
    capture_meta: {
      adapter: "taobao",
      price_confidence: "high",
      price_source: "ice.price",
      warnings_from_client: ["sku: 使用頁面資料表（ICE）", CLIENT_WARNING],
      price_debug: {
        res_keys: ["skuBase", "skuCore"],
        sku_core_keys: ["sku2info", "skuItem"],
        sample_sku_info: [{ sku: "sku-0", keys: ["quantity", "quantityText"] }],
        price_paths: [
          { path: "res.skuCore.skuItem.hideOtherPrice", value: true },
          { path: "res.price.shopProm[0].priceText", value: "店铺活动￥329-418" },
          { path: "res.price.priceText", value: "超级立减活动价￥169-338" },
          { path: "res.price.extraPrices[0].priceText", value: "￥10.9-189.9" }
        ],
        scanned_nodes: 300
      },
      ...(overrides.capture_meta ?? {})
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== "capture_meta"))
  };
}

/** 16:31 Kitty capture: 8 variants, each with its own structured sku2info price. */
function kittyBody() {
  const prices = [19.9, 29.9, 39.9, 45, 59, 68.8, 79, 99];
  return {
    source_url: "https://item.taobao.com/item.htm?id=900000000002",
    source_platform: "taobao",
    title: "Hello Kitty 小物",
    price_cny: 19.9,
    variants_flat: prices.map((cny, i) => ({
      option1_name: "款式",
      option1_value: `款式${i + 1}`,
      sku: `k-${i}`,
      cny_price: cny,
      price_source: "ice.skuCore.sku2info.price",
      price_confidence: "structured_primary"
    })),
    capture_meta: {
      adapter: "taobao",
      price_confidence: "structured_min",
      warnings_from_client: ["sku: 使用頁面資料表（ICE）"],
      price_debug: {
        price_paths: [
          // A promo range text and even hideOtherPrice may still be on the page.
          { path: "res.skuCore.skuItem.hideOtherPrice", value: true },
          { path: "res.price.priceText", value: "店铺活动￥19.9-99" }
        ]
      }
    }
  };
}

const OWNER = { userId: "u1", receivedAt: "2026-10-14T19:56:00.000Z" };
const server = (mapped) => mapped.rawCapture.server;

// --- Part A: server capture ------------------------------------------------------------------

console.log("Part A  server capture");

check("hideOtherPrice + no per-sku price + warning → requires confirmation, lowered confidence, Chinese warning", () => {
  const mapped = mapCaptureToDraftFields(hiddenPriceBody(), OWNER);
  assert.equal(server(mapped).price_requires_confirmation, true);
  assert.equal(server(mapped).price_confidence, "needs_confirmation");
  assert.ok(server(mapped).warnings.includes(HIDDEN_WARNING), "raw_capture.server.warnings");
  assert.ok(mapped.warnings.includes(HIDDEN_WARNING), "draft warnings");
  assert.equal(mapped.variantRows.length, 4);
  assert.ok(mapped.variantRows.every((row) => row.cny_price == null && row.cost_is_inherited === true));
});

check("client warning alone (no price_debug) is enough while a variant has no price", () => {
  const body = hiddenPriceBody({ capture_meta: { price_debug: null } });
  assert.equal(server(mapCaptureToDraftFields(body, OWNER)).price_requires_confirmation, true);
});

check("hideOtherPrice alone (no client warning) flags when no variant has a structured price", () => {
  const body = hiddenPriceBody({
    capture_meta: {
      warnings_from_client: [],
      price_debug: { price_paths: [{ path: "res.skuCore.skuItem.hideOtherPrice", value: true }] }
    }
  });
  assert.equal(server(mapCaptureToDraftFields(body, OWNER)).price_requires_confirmation, true);
});

check("promo price RANGE alone flags when all variants lack prices", () => {
  const body = hiddenPriceBody({
    capture_meta: {
      warnings_from_client: [],
      price_debug: { price_paths: [{ path: "res.price.priceText", value: "￥10.9-189.9" }] }
    }
  });
  assert.equal(server(mapCaptureToDraftFields(body, OWNER)).price_requires_confirmation, true);
});

check("only the DOM 'selected SKU' price is known → still flagged (it covers one variant)", () => {
  const body = hiddenPriceBody();
  body.variants_flat[0] = {
    ...body.variants_flat[0],
    cny_price: 169,
    price_source: "dom.selected_sku",
    price_confidence: "display_only"
  };
  const mapped = mapCaptureToDraftFields(body, OWNER);
  assert.equal(server(mapped).price_requires_confirmation, true);
});

check("single-variant draft is never flagged by this rule", () => {
  const body = hiddenPriceBody();
  body.variants_flat = body.variants_flat.slice(0, 1);
  const mapped = mapCaptureToDraftFields(body, OWNER);
  assert.equal(server(mapped).price_requires_confirmation, false);
  assert.equal(server(mapped).price_confidence, "high");
  assert.ok(!mapped.warnings.includes(HIDDEN_WARNING));
});

check("real per-sku prices (16:31 Kitty capture, 8 different prices) are NOT flagged", () => {
  const mapped = mapCaptureToDraftFields(kittyBody(), OWNER);
  assert.equal(server(mapped).price_requires_confirmation, false);
  assert.equal(server(mapped).price_confidence, "structured_min");
  assert.ok(!mapped.warnings.includes(HIDDEN_WARNING));
  assert.equal(new Set(mapped.variantRows.map((r) => r.cny_price)).size, 8);
});

check("an existing 'conflict' confidence is kept, not overwritten", () => {
  const body = hiddenPriceBody({ capture_meta: { price_confidence: "conflict" } });
  assert.equal(server(mapCaptureToDraftFields(body, OWNER)).price_confidence, "conflict");
});

check("price-range detector ignores dates and ranges without a currency sign / with low >= high", () => {
  assert.equal(hidden.textHasPriceRange("2026-10-14"), false);
  assert.equal(hidden.textHasPriceRange("满1-2件"), false);
  assert.equal(hidden.textHasPriceRange("￥50-50"), false);
  assert.equal(hidden.textHasPriceRange("店铺活动￥329-418"), true);
});

// --- Part B: inherited state survives load -> save --------------------------------------------

console.log("Part B  load/save round trip");

const dims = [{ name: "顏色分類" }];
const baseDb = (n, extra) => ({
  option1_name: "顏色分類",
  option1_value: `款${n}`,
  sort_order: n,
  twd_price: null,
  compare_at_price: null,
  inventory_policy: "continue",
  inventory_quantity: 0,
  sku: null,
  image_id: null,
  ...extra
});
const roundTrip = (dbRows, options) => {
  const { dimensions, rows } = dbRowsToForm(dims, dbRows, options);
  return { rows, inserts: formRowsToDbInserts(dimensions, rows) };
};

check("capture-imported NULL cost rows load as inherited and save back inherited (NULL cost)", () => {
  const db = [1, 2, 3].map((n) => baseDb(n, { cny_price: null, cost_is_inherited: true }));
  const { rows, inserts } = roundTrip(db, { productCost: 169 });
  assert.ok(rows.every((r) => r.costIsInherited === true && r.cost === ""));
  assert.ok(inserts.every((r) => r.cny_price == null && r.cost_is_inherited === true));
});

check("the card path (select WITHOUT cost_is_inherited, no productCost) keeps NULL-cost rows inherited", () => {
  const db = [1, 2, 3].map((n) => baseDb(n, { cny_price: null })); // column absent entirely
  const { rows, inserts } = roundTrip(db);
  assert.ok(rows.every((r) => r.costIsInherited === true));
  assert.ok(inserts.every((r) => r.cost_is_inherited === true));
});

check("older saves wrote NULL cost + flag false → still inherited (never an 'independent' empty cost)", () => {
  const db = [1, 2].map((n) => baseDb(n, { cny_price: null, cost_is_inherited: false }));
  assert.ok(roundTrip(db).rows.every((r) => r.costIsInherited === true));
});

check("Workspace-filled rows (cost = product cost, flag true) round-trip unchanged", () => {
  const db = [1, 2, 3].map((n) => baseDb(n, { cny_price: 169, cost_is_inherited: true }));
  const { inserts } = roundTrip(db, { productCost: 169 });
  assert.ok(inserts.every((r) => r.cny_price === 169 && r.cost_is_inherited === true));
});

check("flag column missing (pre-migration) but cost equals product cost → inferred inherited via productCost", () => {
  const db = [1, 2, 3].map((n) => baseDb(n, { cny_price: 169 }));
  const { inserts } = roundTrip(db, { productCost: 169 });
  assert.ok(inserts.every((r) => r.cost_is_inherited === true));
});

check("explicit own cost (flag false, differs from product) stays independent", () => {
  const db = [baseDb(1, { cny_price: 169, cost_is_inherited: true }), baseDb(2, { cny_price: 259, cost_is_inherited: false })];
  const { inserts } = roundTrip(db, { productCost: 169 });
  assert.equal(inserts[0].cost_is_inherited, true);
  assert.equal(inserts[1].cost_is_inherited, false);
  assert.equal(inserts[1].cny_price, 259);
});

check("product-cost sync (Workspace reprice effect) keeps rows inherited and does not touch explicit ones", () => {
  const db = [baseDb(1, { cny_price: null, cost_is_inherited: true }), baseDb(2, { cny_price: 259, cost_is_inherited: false })];
  const { rows } = dbRowsToForm(dims, db, { productCost: 169 });
  const synced = syncInheritedVariantCosts(rows, 169, { currency: "CNY", priceMode: "sale", settings: defaultPricingSettings });
  const inserts = formRowsToDbInserts(dims, synced);
  assert.deepEqual(inserts.map((r) => [r.cny_price, r.cost_is_inherited]), [[169, true], [259, false]]);
});

check("an explicit cost edit of one row (what VariantEditor.onCostChange does) clears only that row", () => {
  const db = [1, 2, 3].map((n) => baseDb(n, { cny_price: 169, cost_is_inherited: true }));
  const { dimensions, rows } = dbRowsToForm(dims, db, { productCost: 169 });
  const edited = rows.map((row, i) => (i === 1 ? { ...row, cost: "259", costIsInherited: false } : row));
  const inserts = formRowsToDbInserts(dimensions, edited);
  assert.deepEqual(inserts.map((r) => r.cost_is_inherited), [true, false, true]);
  assert.deepEqual(inserts.map((r) => r.cny_price), [169, 259, 169]);
});

check("a row saved with no cost at all can never be 'confirmed' (NULL cost forces inherited)", () => {
  const { rows } = dbRowsToForm(dims, [baseDb(1, { cny_price: null, cost_is_inherited: true })]);
  const inserts = formRowsToDbInserts(dims, [{ ...rows[0], costIsInherited: false }]);
  assert.equal(inserts[0].cost_is_inherited, true);
});

// --- Part C: publish readiness backstop -------------------------------------------------------

console.log("Part C  publish readiness");

/** raw_capture exactly as stored for the incident drafts: server flag FALSE, client evidence present. */
const incidentRaw = () => {
  const mapped = mapCaptureToDraftFields(hiddenPriceBody(), OWNER);
  const raw = JSON.parse(JSON.stringify(mapped.rawCapture));
  raw.server.price_requires_confirmation = false;
  raw.server.price_confidence = "high";
  raw.server.warnings = [];
  return raw;
};
const draftOf = (raw, cny = 169) => ({ cny_price: cny, raw_capture: raw });
/** Final incident rows: every cny = product cost, cost_is_inherited = FALSE. */
const flatRows = (flag) =>
  ["Hello Kitty", "My Melody", "Cinnamoroll", "Kuromi"].map((v) => ({
    option1_value: v,
    cny_price: 169,
    cost_is_inherited: flag
  }));
const unconfirmed = (result) => result.blockers.filter((b) => b.code === "VARIANT_PRICE_UNCONFIRMED");

check("incident state (flag false, all costs 169 + client evidence) → VARIANT_PRICE_UNCONFIRMED, confirmable", () => {
  const result = checkPublishReadiness(draftOf(incidentRaw()), flatRows(false));
  assert.equal(result.blocked, true);
  assert.equal(result.needsPriceConfirm, true);
  assert.equal(unconfirmed(result).length, 1);
  assert.equal(unconfirmed(result)[0].confirmable, true);
});

check("same state with cost_is_inherited true / NULL costs is blocked too (any flag)", () => {
  assert.equal(unconfirmed(checkPublishReadiness(draftOf(incidentRaw()), flatRows(true))).length, 1);
  const nullRows = flatRows(false).map((r) => ({ ...r, cny_price: null }));
  assert.equal(unconfirmed(checkPublishReadiness(draftOf(incidentRaw()), nullRows)).length, 1);
});

check("a fresh server-flagged capture is blocked (price_requires_confirmation=true)", () => {
  const raw = mapCaptureToDraftFields(hiddenPriceBody(), OWNER).rawCapture;
  assert.equal(unconfirmed(checkPublishReadiness(draftOf(raw), flatRows(true))).length, 1);
  assert.equal(isVariantPriceUnconfirmedCapture(raw), true);
});

check("operator confirmation (flag in request) waives it; persisted variant_price_confirmed_at waives it", () => {
  const raw = incidentRaw();
  const waived = checkPublishReadiness(draftOf(raw), flatRows(false), { confirmVariantPrices: true });
  assert.equal(waived.blocked, false);
  assert.equal(waived.bypassed.length, 1);
  const persisted = JSON.parse(JSON.stringify(raw));
  persisted.server.variant_price_confirmed_at = "2026-10-14T21:00:00.000Z";
  assert.equal(checkPublishReadiness(draftOf(persisted), flatRows(false)).blocked, false);
  assert.equal(isVariantPriceUnconfirmedCapture({ ...persisted, server: { ...persisted.server, price_requires_confirmation: true } }), false);
});

check("operator typed different per-variant costs and the capture is not server-flagged → not blocked by the backstop", () => {
  const rows = flatRows(false).map((r, i) => ({ ...r, cny_price: 169 + i * 40 }));
  assert.equal(checkPublishReadiness(draftOf(incidentRaw()), rows).blocked, false);
});

check("real per-sku prices (Kitty, 8 different costs, promo range on page) → not blocked", () => {
  const mapped = mapCaptureToDraftFields(kittyBody(), OWNER);
  const rows = mapped.variantRows.map((r) => ({ option1_value: r.option1_value, cny_price: r.cny_price, cost_is_inherited: false }));
  const result = checkPublishReadiness(draftOf(mapped.rawCapture, 19.9), rows);
  assert.equal(unconfirmed(result).length, 0);
  assert.equal(result.blocked, false);
});

check("single-variant draft with the same capture evidence is not blocked", () => {
  const rows = [{ option1_value: "Hello Kitty", cny_price: 169, cost_is_inherited: false }];
  assert.equal(checkPublishReadiness(draftOf(incidentRaw()), rows).blocked, false);
});

check("no capture evidence + identical costs is NOT blocked (legit same-price variants)", () => {
  const raw = { server: { price_requires_confirmation: false }, client_meta: { warnings_from_client: [] } };
  assert.equal(checkPublishReadiness(draftOf(raw), flatRows(false)).blocked, false);
});

check("end to end: capture → Workspace cost fill → round trip → still blocked until confirmed", () => {
  const mapped = mapCaptureToDraftFields(hiddenPriceBody(), OWNER);
  const db = mapped.variantRows.map((r) => ({ ...r }));
  const { dimensions, rows } = dbRowsToForm(mapped.variantDimensions, db, { productCost: 169 });
  const filled = syncInheritedVariantCosts(rows, 169, { currency: "CNY", priceMode: "sale", settings: defaultPricingSettings });
  const saved = formRowsToDbInserts(dimensions, filled); // Workspace save (cost = 169, flag true)
  const afterCard = formRowsToDbInserts(dimensions, dbRowsToForm(dimensions, saved, {}).rows); // card save, select w/o flag
  assert.ok(afterCard.every((r) => r.cost_is_inherited === true && r.cny_price === 169));
  const result = checkPublishReadiness(draftOf(mapped.rawCapture), afterCard);
  assert.equal(result.needsPriceConfirm, true);
});

// --- Part D: static wiring --------------------------------------------------------------------

console.log("Part D  wiring");

check("every variant select that feeds the editor includes cost_is_inherited (with base fallback)", () => {
  const page = read("src/app/drafts/new/page.tsx");
  assert.match(page, /workbenchVariantBase[\s\S]{0,400}cost_is_inherited, sell_price_locked, compare_at_locked/);
  assert.match(page, /fullVariants\.error \|\| !variants/);
  assert.match(page, /variantSelectFull = `\$\{variantSelectBase\}, cost_is_inherited/);
});

check("ResultCard hydrates the flag + passes productCost; hint shown only while unconfirmed", () => {
  const card = read("src/components/listing/ResultCard.tsx");
  assert.match(card, /cost_is_inherited\?: boolean \| null;/);
  assert.match(card, /inh: v\.cost_is_inherited/);
  assert.match(card, /dbRowsToForm\(dimsRaw, variantPrices, \{\s*productCost:/);
  assert.match(card, /priceUnconfirmed=\{isVariantPriceUnconfirmedCapture\(draft\.raw_capture\)\}/);
  const panel = read("src/components/listing/result-card/ResultCardSpecsPanel.tsx");
  assert.match(panel, /price-soft-warn/);
  assert.match(panel, /unconfirmedCost=\{priceUnconfirmed\}/);
  const render = read("src/components/listing/VariantEditorRender.tsx");
  assert.match(render, /v-cost-badge unconfirmed/);
});

check("explicit edit paths in VariantEditor still clear the flag", () => {
  const editor = read("src/components/listing/VariantEditor.tsx");
  assert.match(editor, /cost, costIsInherited: false/);
  assert.match(editor, /cost: String\(cost\), costIsInherited: false/);
});

check("no new !important in the CSS rule added for this fix", () => {
  const css = read("src/app/globals.css");
  const rule = css.match(/\.v-cost-badge\.unconfirmed \{[^}]*\}/);
  assert.ok(rule, "rule present");
  assert.doesNotMatch(rule[0], /!important/);
});

check("registered in package.json and verify-all", () => {
  assert.match(read("package.json"), /"verify:price-guard": "node scripts\/verify-price-guard\.mjs"/);
  assert.match(read("scripts/verify-all.mjs"), /scripts\/verify-price-guard\.mjs/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const { name, err } of failures) console.error(`FAIL ${name}\n  ${err.stack ?? err}`);
  process.exit(1);
}
console.log("PRICE-GUARD verify OK");
