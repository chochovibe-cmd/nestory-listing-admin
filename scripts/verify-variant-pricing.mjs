/**
 * Per-variant selling price verify (no network, no Supabase).
 *
 * Root cause being guarded: the shop-wide 尾數美化 ladder (src/lib/nestoryPrice.ts) jumps
 * 1680 -> 2280 -> 4480 -> 5480 ..., so variants with different costs (e.g. 219..259 CNY)
 * were all rounded UP to the same selling price. Variant pricing now uses the "fine" ladder.
 *
 * Real examples from production (product_variants):
 *   e4ba2299: cny 219 / 229 / 238.9 / 249 / 258.9 ...  -> twd 2280 for all
 *   31701317: cny 599 / 649                            -> twd 5480 for both
 *
 * Run: node scripts/verify-variant-pricing.mjs  |  npm run verify:variant-pricing
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

const { beautifyNestoryPrice, nextBeautifiedPriceAbove } = await import(src("src/lib/nestoryPrice.ts"));
const { calculatePrice, defaultPricingSettings } = await import(src("src/lib/pricing.ts"));
const { recalculateUnlockedVariantPrices, lockVariantPrice } = await import(
  src("src/lib/variants/variantPricing.ts")
);
const { dbRowsToForm, formRowsToDbInserts } = await import(src("src/lib/variants/variantMapping.ts"));
const { buildVariantPublishPlan } = await import(src("src/lib/variants/shopifyVariants.ts"));
const { buildShowmoreRows } = await import(src("src/lib/csv/showmore.ts"));

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(name);
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

const E4BA = [219, 229, 238.9, 249, 258.9];
const THREE = [599, 649];

/** A product_variants row as read from production: unlocked, own cost, stale uniform price. */
function dbRow(i, cost, staleTwd) {
  return {
    option1_name: "款式",
    option1_value: `V${i + 1}`,
    option2_value: null,
    option3_value: null,
    cny_price: cost,
    twd_price: staleTwd,
    compare_at_price: null,
    cost_is_inherited: false,
    sell_price_locked: false,
    compare_at_locked: false,
    price_locked: false,
    sort_order: i,
    inventory_quantity: 0,
    inventory_policy: "continue",
    sku: null,
    image_id: null
  };
}

function reprice(costs, stale, extra = {}) {
  const dbRows = costs.map((c, i) => ({ ...dbRow(i, c, stale), ...(extra[i] ?? {}) }));
  const { rows } = dbRowsToForm([{ name: "款式" }], dbRows, { productCost: Math.min(...costs) });
  return recalculateUnlockedVariantPrices(rows, {
    currency: "CNY",
    priceMode: "sale",
    settings: defaultPricingSettings,
    productCost: Math.min(...costs)
  });
}

const sells = (rows) => rows.map((r) => Number(r.sellPrice));

console.log("per-variant selling price");

await check("root cause pinned: STANDARD ladder collapses the real examples into one price", () => {
  const std = (cny) =>
    calculatePrice(cny, { currency: "CNY", priceMode: "sale", settings: defaultPricingSettings }).sellPrice;
  assert.deepEqual(new Set(E4BA.map(std)), new Set([2280]));
  assert.deepEqual(new Set(THREE.map(std)), new Set([5480]));
});

await check("e4ba2299 costs: every variant gets its own price, monotonic with cost", () => {
  const out = sells(reprice(E4BA, 2280));
  assert.equal(new Set(out).size, E4BA.length, `prices ${out}`);
  for (let i = 1; i < out.length; i += 1) assert.ok(out[i] > out[i - 1], `not increasing: ${out}`);
  assert.ok(out.every((p) => p > 0));
});

await check("31701317 costs: 599 and 649 get different prices, monotonic", () => {
  const out = sells(reprice(THREE, 5480));
  assert.equal(new Set(out).size, 2, `prices ${out}`);
  assert.ok(out[1] > out[0]);
});

await check("compare-at stays strictly above each variant's sell price (sale mode)", () => {
  for (const r of reprice([...E4BA, ...THREE], null)) {
    assert.ok(Number(r.compareAt) > Number(r.sellPrice), `${r.sellPrice} vs ${r.compareAt}`);
  }
});

await check("single mode: no compare-at, still per-variant prices", () => {
  const dbRows = E4BA.map((c, i) => dbRow(i, c, 2280));
  const { rows } = dbRowsToForm([{ name: "款式" }], dbRows, { productCost: 219 });
  const out = recalculateUnlockedVariantPrices(rows, {
    currency: "CNY",
    priceMode: "single",
    settings: defaultPricingSettings,
    productCost: 219
  });
  assert.equal(new Set(sells(out)).size, E4BA.length);
  assert.ok(out.every((r) => r.compareAt === ""));
});

await check("locked sell price keeps its manual value; unlocked neighbours still follow own cost", () => {
  const out = reprice(E4BA, 2280, { 2: { twd_price: 2999, sell_price_locked: true, price_locked: true } });
  assert.equal(Number(out[2].sellPrice), 2999);
  assert.equal(out[2].sellPriceLocked, true);
  const free = [0, 1, 3, 4].map((i) => Number(out[i].sellPrice));
  assert.equal(new Set(free).size, 4);
  // compare-at lock is independent: sell locked, compare-at still recomputed
  assert.ok(Number(out[2].compareAt) > 0);
});

await check("legacy price_locked (split columns NULL) locks both sell and compare-at", () => {
  const out = reprice(E4BA, 2280, { 1: { twd_price: 2500, compare_at_price: 3500, sell_price_locked: null, compare_at_locked: null, price_locked: true } });
  assert.equal(Number(out[1].sellPrice), 2500);
  assert.equal(Number(out[1].compareAt), 3500);
});

await check("lockVariantPrice only locks fields that actually changed", () => {
  const [row] = reprice([219], null);
  const locked = lockVariantPrice(row, { sellPrice: "2100" });
  assert.equal(locked.sellPriceLocked, true);
  assert.equal(locked.compareAtLocked, false);
});

await check("blank variant cost inherits product cost (one price for those rows only)", () => {
  const dbRows = [dbRow(0, 219, null), { ...dbRow(1, null, null), cost_is_inherited: true }, dbRow(2, 249, null)];
  const { rows } = dbRowsToForm([{ name: "款式" }], dbRows, { productCost: 219 });
  const out = sells(
    recalculateUnlockedVariantPrices(rows, {
      currency: "CNY",
      priceMode: "sale",
      settings: defaultPricingSettings,
      productCost: 219
    })
  );
  assert.equal(out[0], out[1]);
  assert.ok(out[2] > out[0]);
});

await check("recompute path -> DB inserts -> Shopify publish seeds carry per-variant prices", () => {
  const out = reprice(E4BA, 2280);
  const inserts = formRowsToDbInserts([{ name: "款式" }], out);
  assert.equal(new Set(inserts.map((r) => r.twd_price)).size, E4BA.length);
  const plan = buildVariantPublishPlan(inserts.map((r, i) => ({ ...r, id: String(i), draft_id: "d" })), {
    cny_price: 219,
    twd_cost: 1282,
    price_mode: "sale"
  });
  assert.equal(plan.mode, "multi");
  const prices = plan.all.map((s) => s.price);
  assert.equal(new Set(prices).size, E4BA.length);
  assert.deepEqual(prices, inserts.map((r) => r.twd_price));
});

await check("publish never substitutes the draft-level price for rows that have their own", () => {
  const safe = fs.readFileSync("src/lib/shopify/publishDraftSafe.ts", "utf8");
  const shopifyVariants = fs.readFileSync("src/lib/variants/shopifyVariants.ts", "utf8");
  assert.match(shopifyVariants, /price: row\.twd_price \?\? 0/);
  assert.doesNotMatch(shopifyVariants, /draft\.twd_price/);
  assert.match(safe, /toBulkVariantInput\(multi\.initial/);
  assert.match(safe, /toBulkVariantInput\(seed/);
});

await check("Showmore export keeps per-variant prices apart (fine ladder on variant rows)", () => {
  const variants = E4BA.map((c, i) => ({ ...dbRow(i, c, null), twd_price: 0 }));
  const prices = sells(reprice(E4BA, null));
  const draft = {
    id: "d",
    status: "approved",
    pipeline_stage: "ready",
    title_zh: "t",
    taobao_title: "t",
    original_title: "t",
    sku: "SKU",
    twd_price: prices[0],
    twd_cost: 1282,
    compare_at_price: null,
    price_mode: "single",
    description_html: "d",
    product_images: [],
    product_variants: variants.map((v, i) => ({ ...v, twd_price: prices[i] }))
  };
  const rows = buildShowmoreRows([draft], { showmoreMarkupPercent: 5 });
  const sellCol = rows.map((r) => r["售價*"]);
  assert.equal(new Set(sellCol).size, E4BA.length, `showmore prices ${sellCol}`);
});

await check("fine ladder equals the standard ladder up to NT$1,680 (no change for cheap/mid items)", () => {
  for (let raw = 1; raw <= 1680; raw += 1) {
    assert.equal(beautifyNestoryPrice(raw, "fine"), beautifyNestoryPrice(raw, "standard"), `raw ${raw}`);
  }
});

await check("fine ladder: >= raw, never above standard, monotonic, only charm points (x80/x99)", () => {
  let prev = 0;
  for (let raw = 1681; raw <= 30000; raw += 1) {
    const fine = beautifyNestoryPrice(raw, "fine");
    assert.ok(fine >= raw, `raw ${raw} -> ${fine}`);
    assert.ok(fine <= beautifyNestoryPrice(raw, "standard"), `raw ${raw} above standard`);
    assert.ok(fine >= prev, `not monotonic at ${raw}`);
    assert.ok(fine % 100 === 80 || fine % 100 === 99, `raw ${raw} -> ${fine}`);
    prev = fine;
  }
  assert.equal(nextBeautifiedPriceAbove(1799, "fine"), 1880);
  assert.ok(nextBeautifiedPriceAbove(2280, "fine") > 2280);
});

await check("default (non-variant) pricing is unchanged: standard ladder is still the default", () => {
  assert.equal(beautifyNestoryPrice(1794.8), 2280);
  assert.equal(beautifyNestoryPrice(4906), 5480);
  const single = calculatePrice(219, { currency: "CNY", priceMode: "sale", settings: defaultPricingSettings });
  assert.equal(single.sellPrice, 2280);
});

await check("static: package.json + verify-all wiring + variant pricing uses the fine ladder", () => {
  assert.match(fs.readFileSync("package.json", "utf8"), /"verify:variant-pricing": "node scripts\/verify-variant-pricing\.mjs"/);
  assert.match(fs.readFileSync("scripts/verify-all.mjs", "utf8"), /verify-variant-pricing\.mjs/);
  assert.match(fs.readFileSync("src/lib/variants/variantPricing.ts", "utf8"), /priceLadder: "fine"/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
