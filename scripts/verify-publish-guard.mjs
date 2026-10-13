/**
 * PUBLISH-GUARD verify (no network, no .env, no Supabase).
 *
 * Imports the REAL modules (publishReadiness / publishDraftSafe / runPublishBatch /
 * station3Publish / publishBatch) through scripts/publish-guard-loader.mjs and drives
 * them with an in-memory Supabase fake that records every write.
 *
 *   Part A  mock mode = dry run: zero DB writes, zero Shopify / Make calls
 *   Part B  readiness blockers (fake variants, bundle cost, unconfirmed price)
 *   Part C  UI wiring (static source assertions)
 *
 * Run: node scripts/verify-publish-guard.mjs  |  npm run verify:publish-guard
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
process.chdir(root);
register(pathToFileURL(path.join(root, "scripts", "publish-guard-loader.mjs")).href);

const src = (rel) => pathToFileURL(path.join(root, rel)).href;
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const readiness = await import(src("src/lib/shopify/publishReadiness.ts"));
const { publishDraft } = await import(src("src/lib/shopify/publishDraftSafe.ts"));
const { runPublishBatch } = await import(src("src/lib/shopify/runPublishBatch.ts"));
const station3 = await import(src("src/lib/drafts/station3Publish.ts"));
const batchHelpers = await import(src("src/lib/drafts/publishBatch.ts"));

const {
  checkPublishReadiness,
  findBundleInheritedVariantLabels,
  findFakeVariantLabels,
  formatPublishBlockMessage,
  isVariantPriceConfirmed,
  variantLabel
} = readiness;

// --- harness ---------------------------------------------------------------

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

// Network guard: any fetch (Make webhook, Shopify, Files upload) is recorded and refused.
const fetchCalls = [];
globalThis.fetch = async (url) => {
  fetchCalls.push(String(url));
  throw new Error("NETWORK_FORBIDDEN_IN_PUBLISH_GUARD_VERIFIER");
};
process.env.MAKE_WEBHOOK_URL = "https://make.invalid/hook";

async function withEnv(patch, fn) {
  const before = {};
  for (const key of Object.keys(patch)) before[key] = process.env[key];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** In-memory Supabase fake. Every insert / update / upsert / delete lands in `writes`. */
function createFakeSupabase(seed) {
  const tables = {
    product_drafts: [],
    product_variants: [],
    product_images: [],
    team_settings: [],
    publish_batches: [],
    publish_batch_items: [],
    publish_jobs: [],
    ...structuredClone(seed)
  };
  const writes = [];
  let idCounter = 0;

  function from(table) {
    const state = { table, op: "select", filters: [], payload: null, single: false, maybe: false };
    const matches = (row) => state.filters.every((f) => f(row));
    const withEmbeds = (row) =>
      table === "product_drafts"
        ? { ...row, product_images: (tables.product_images ?? []).filter((i) => i.draft_id === row.id) }
        : row;
    function execute() {
      const rows = tables[table] ?? [];
      if (state.op === "insert") {
        const list = Array.isArray(state.payload) ? state.payload : [state.payload];
        const inserted = list.map((row) => ({ id: row.id ?? `fake-${table}-${++idCounter}`, ...row }));
        rows.push(...inserted);
        tables[table] = rows;
        const out = state.single ? inserted[0] : inserted;
        return { data: out ?? null, error: null };
      }
      if (state.op === "update") {
        const hit = rows.filter(matches);
        for (const row of hit) Object.assign(row, state.payload);
        if (state.single || state.maybe) return { data: hit[0] ? { id: hit[0].id } : null, error: null };
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      if (state.op === "delete" || state.op === "upsert") return { data: null, error: null };
      const hit = rows.filter(matches).map(withEmbeds);
      if (state.single) {
        return hit[0]
          ? { data: hit[0], error: null }
          : { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } };
      }
      if (state.maybe) return { data: hit[0] ?? null, error: null };
      return { data: hit, error: null };
    }
    const api = {
      select() {
        return api;
      },
      insert(payload) {
        state.op = "insert";
        state.payload = payload;
        writes.push({ op: "insert", table, payload });
        return api;
      },
      update(payload) {
        state.op = "update";
        state.payload = payload;
        writes.push({ op: "update", table, payload });
        return api;
      },
      upsert(payload) {
        state.op = "upsert";
        writes.push({ op: "upsert", table, payload });
        return api;
      },
      delete() {
        state.op = "delete";
        writes.push({ op: "delete", table });
        return api;
      },
      eq(column, value) {
        state.filters.push((row) => row[column] === value);
        return api;
      },
      neq(column, value) {
        state.filters.push((row) => row[column] !== value);
        return api;
      },
      in(column, values) {
        state.filters.push((row) => values.includes(row[column]));
        return api;
      },
      order() {
        return api;
      },
      limit() {
        return api;
      },
      single() {
        state.single = true;
        return api;
      },
      maybeSingle() {
        state.maybe = true;
        return api;
      },
      then(resolve, reject) {
        return Promise.resolve(execute()).then(resolve, reject);
      }
    };
    return api;
  }

  return { from, writes, tables };
}

function draftRow(overrides = {}) {
  return {
    id: "d1",
    status: "approved",
    pipeline_stage: "ready",
    publish_status: "pending",
    title_zh: "測試商品",
    cny_price: 50,
    twd_price: 500,
    shopify_product_id: null,
    shopify_admin_url: null,
    raw_capture: null,
    warnings: [],
    ...overrides
  };
}

function variant(label, overrides = {}) {
  return {
    id: `v-${label}`,
    draft_id: "d1",
    option1_name: "款式",
    option1_value: label,
    option2_name: null,
    option2_value: null,
    option3_name: null,
    option3_value: null,
    sku: null,
    cny_price: 30,
    twd_price: 300,
    compare_at_price: null,
    cost_is_inherited: false,
    price_locked: false,
    sort_order: 0,
    inventory_quantity: 0,
    inventory_policy: "continue",
    image_id: null,
    created_at: "2026-10-13T00:00:00Z",
    ...overrides
  };
}

const codesOf = (result) => result.blockers.map((b) => b.code);

console.log("\nPUBLISH-GUARD verify\n");

// =====================================================================
// Part B: pure readiness rules
// =====================================================================
console.log("Part B — readiness rules");

await check("variantLabel joins non-empty option values with ／", () => {
  assert.equal(
    variantLabel({ option1_value: " 紅色 ", option2_value: "", option3_value: "L" }),
    "紅色／L"
  );
});

await check("the 4 real production fake variants are FAKE_VARIANT (never confirmable)", () => {
  // 4th is the full real title: bare 客服 is no longer a trigger, only a leading 聯繫客服… is.
  const names = ["購買須知", "資訊說明｜勿拍", "售罄勿拍", "聯繫客服免費定製賀卡，定製內容務必聯繫客服！"];
  const rows = [variant("藍色"), ...names.map((n, i) => variant(n, { sort_order: i + 1 }))];
  assert.deepEqual(findFakeVariantLabels(rows), names);
  const result = checkPublishReadiness(draftRow(), rows);
  assert.equal(result.blocked, true);
  const fake = result.blockers.find((b) => b.code === "FAKE_VARIANT");
  assert.ok(fake);
  assert.equal(fake.confirmable, false);
  assert.deepEqual(fake.variantLabels, names);
  assert.match(fake.message, /有 4 個款式不是可賣的商品/);
  assert.match(fake.message, /「購買須知」「資訊說明｜勿拍」「售罄勿拍」「聯繫客服免費定製賀卡，定製內容務必聯繫客服！」/);
  assert.match(fake.message, /請在商品卡刪除這些款式後再發布/);
});

await check("fake-variant wording is detected in Traditional and Simplified", () => {
  for (const name of [
    "购买须知",
    "补差价",
    "補差價",
    "拍下不發貨",
    "拍下不发货",
    "運費",
    "运费",
    "定金",
    "订金",
    "联系客服免费定制",
    "諮詢客服",
    "【注意】咨询客服",
    "拍下不出貨",
    "拍下不出货",
    "不出貨",
    "專拍",
    "专拍",
    "售完",
    "已售空",
    "说明",
    "不單獨發",
    "不单独发"
  ]) {
    assert.equal(findFakeVariantLabels([variant(name)]).length, 1, `${name} should be fake`);
  }
});

await check("real store titles that must be FAKE_VARIANT", () => {
  for (const title of [
    "【購買須知】CCD配件存放說明 （資訊說明 | 拍下不出貨）",
    "Hellokitty正版授權|三檔亮度|拉線式開關 （資訊說明 | 勿拍）",
    "【升級語音版】Kitty蘋果款檯燈+Kitty招財貓擺件 （售罄勿拍）",
    "聯繫客服免費定製賀卡，定製內容務必聯繫客服！",
    "【定製】聯繫客服免費定製賀卡"
  ]) {
    assert.equal(findFakeVariantLabels([variant(title)]).length, 1, `${title} should be fake`);
  }
});

await check("real store titles that must NOT be FAKE_VARIANT (客服 mid-text, 賀卡, 拆盒確認, 禮品袋)", () => {
  for (const title of [
    "【定製版】小王子星球燈+星星掛鏈（可磁吸※可定製文字） 定製務必聯繫客服",
    "【定製版】小王子星球燈+星星掛鏈+正版專屬禮袋 定製務必聯繫客服",
    "pingu護眼儀【紅色】★精美高檔禮盒裝贈賀卡",
    "【現貨】小隱藏-擁抱的力量【拆盒確認】",
    "禮品袋-拍下只發禮品袋",
    "客服款",
    "1個盲盒【隨機發】"
  ]) {
    assert.deepEqual(findFakeVariantLabels([variant(title)]), [], `${title} must not be fake`);
  }
  // option1 / option2 split of a Shopify title: label is the joined values
  const split = variant("1個盲盒【隨機發】", { option2_value: "【官方正版】" });
  assert.equal(variantLabel(split), "1個盲盒【隨機發】／【官方正版】");
  assert.deepEqual(findFakeVariantLabels([split]), []);
  // a CS lead in option2 still counts as fake
  assert.equal(findFakeVariantLabels([variant("藍色", { option2_value: "聯繫客服定製" })]).length, 1);
});

await check("real store titles that are bundle-like (inherited cost, 2+ rows) → BUNDLE_VARIANT_PRICE", () => {
  for (const title of [
    "2個盲盒【隨機發】",
    "3個盲盒",
    "端盒【一套9個不重複】",
    "【升級語音版】Kitty蘋果款檯燈+【升級款】Kitty掛脖風扇 （優惠組合裝3）",
    "12入",
    "6顆"
  ]) {
    const rows = [variant("單個"), variant(title, { cost_is_inherited: true, sort_order: 1 })];
    assert.deepEqual(findBundleInheritedVariantLabels(rows, 50), [title], `${title} should be bundle-like`);
  }
});

await check("real store titles that are NOT bundle-like (1個盲盒 / 16G / 32G / decimals)", () => {
  for (const title of ["1個盲盒【隨機發】", "【升級款-32G】", "16G", "1.5盒", "S號", "藍色"]) {
    const rows = [variant("單個"), variant(title, { cost_is_inherited: true, sort_order: 1 })];
    assert.deepEqual(findBundleInheritedVariantLabels(rows, 50), [], `${title} must not be bundle-like`);
  }
});

await check("a bundle-like title with its own sourced cost is not a blocker (rule unchanged)", () => {
  const rows = [variant("單個"), variant("2個盲盒【隨機發】", { cost_is_inherited: false, cny_price: 80, sort_order: 1 })];
  assert.equal(checkPublishReadiness(draftRow({ cny_price: 50 }), rows).blocked, false);
});

await check("legit names (藍色 / 說明書 / 手機套 / S號) trigger neither FAKE nor BUNDLE", () => {
  const rows = ["藍色", "說明書", "手機套", "S號", "说明书"].map((n, i) =>
    variant(n, { sort_order: i, cost_is_inherited: true })
  );
  assert.deepEqual(findFakeVariantLabels(rows), []);
  assert.deepEqual(findBundleInheritedVariantLabels(rows, 50), []);
  assert.equal(checkPublishReadiness(draftRow(), rows).blocked, false);
});

await check("端盒6款 inheriting the product cost is BUNDLE_VARIANT_PRICE (flag true)", () => {
  const rows = [variant("單盒"), variant("端盒6款", { cost_is_inherited: true, sort_order: 1 })];
  const result = checkPublishReadiness(draftRow(), rows);
  assert.deepEqual(codesOf(result), ["BUNDLE_VARIANT_PRICE"]);
  assert.equal(result.blockers[0].confirmable, true);
  assert.match(result.blockers[0].message, /款式「端盒6款」看起來是套組／整盒，但成本沿用單個商品的價格，請確認這款的成本。/);
  assert.equal(result.needsPriceConfirm, true);
});

await check("端盒6款 with no own cost (cny_price null) is BUNDLE_VARIANT_PRICE", () => {
  const rows = [variant("單盒"), variant("端盒6款", { cny_price: null, cost_is_inherited: false, sort_order: 1 })];
  assert.deepEqual(codesOf(checkPublishReadiness(draftRow(), rows)), ["BUNDLE_VARIANT_PRICE"]);
});

await check("端盒6款 legacy row (flag NULL) equal to the product price is BUNDLE_VARIANT_PRICE", () => {
  const rows = [
    variant("單盒"),
    variant("端盒6款", { cny_price: 50, cost_is_inherited: null, sort_order: 1 })
  ];
  assert.deepEqual(codesOf(checkPublishReadiness(draftRow({ cny_price: 50 }), rows)), ["BUNDLE_VARIANT_PRICE"]);
});

await check("端盒6款 legacy row (flag NULL) with its own different cost passes", () => {
  const rows = [
    variant("單盒"),
    variant("端盒6款", { cny_price: 300, cost_is_inherited: null, sort_order: 1 })
  ];
  assert.equal(checkPublishReadiness(draftRow({ cny_price: 50 }), rows).blocked, false);
});

await check("端盒6款 with cost_is_inherited=false (independently sourced) passes, even if price is equal", () => {
  const rows = [
    variant("單盒"),
    variant("端盒6款", { cny_price: 50, cost_is_inherited: false, sort_order: 1 })
  ];
  assert.equal(checkPublishReadiness(draftRow({ cny_price: 50 }), rows).blocked, false);
});

await check("bundle check is skipped when the draft has only one variant row", () => {
  const rows = [variant("端盒6款", { cost_is_inherited: true })];
  assert.deepEqual(findBundleInheritedVariantLabels(rows, 50), []);
  assert.equal(checkPublishReadiness(draftRow(), rows).blocked, false);
});

await check("bundle wording variants (套組 / 整盒 / 全6款 / x6 / 6個裝) are recognised", () => {
  for (const name of ["豪華套組", "整盒", "全 6 款", "盲盒 x6", "6個裝", "组合装", "一套"]) {
    const rows = [variant("單個"), variant(name, { cost_is_inherited: true, sort_order: 1 })];
    assert.deepEqual(findBundleInheritedVariantLabels(rows, 50), [name], `${name} should be a bundle`);
  }
});

await check("fake rows are excluded from the bundle check (reported as FAKE only)", () => {
  const rows = [variant("單盒"), variant("端盒補差價", { cost_is_inherited: true, sort_order: 1 })];
  const result = checkPublishReadiness(draftRow(), rows);
  assert.deepEqual(codesOf(result), ["FAKE_VARIANT"]);
});

await check("price_requires_confirmation=true is VARIANT_PRICE_UNCONFIRMED (with inherit count)", () => {
  const raw = { server: { price_requires_confirmation: true } };
  const rows = [
    variant("A", { cost_is_inherited: true }),
    variant("B", { cost_is_inherited: true, sort_order: 1 }),
    variant("C", { cost_is_inherited: false, cny_price: 20, sort_order: 2 })
  ];
  const result = checkPublishReadiness(draftRow({ raw_capture: raw }), rows);
  assert.deepEqual(codesOf(result), ["VARIANT_PRICE_UNCONFIRMED"]);
  assert.match(result.blockers[0].message, /抓取時價格被標記為「需確認」/);
  assert.match(result.blockers[0].message, /目前有 2 個款式沿用商品成本。/);
  // single product: no inherit sentence
  const single = checkPublishReadiness(draftRow({ raw_capture: raw }), []);
  assert.deepEqual(codesOf(single), ["VARIANT_PRICE_UNCONFIRMED"]);
  assert.doesNotMatch(single.blockers[0].message, /沿用商品成本/);
});

await check("the 0.01 placeholder price is left to the existing guard (no VARIANT_PRICE_UNCONFIRMED)", () => {
  const raw = { server: { price_requires_confirmation: true } };
  assert.equal(checkPublishReadiness(draftRow({ cny_price: 0.01, raw_capture: raw }), []).blocked, false);
});

await check("confirmVariantPrices=true drops confirmable blockers but never FAKE_VARIANT", () => {
  const raw = { server: { price_requires_confirmation: true } };
  const rows = [
    variant("單盒"),
    variant("端盒6款", { cost_is_inherited: true, sort_order: 1 }),
    variant("購買須知", { sort_order: 2 })
  ];
  const draft = draftRow({ raw_capture: raw });
  const before = checkPublishReadiness(draft, rows);
  assert.deepEqual(codesOf(before).sort(), ["BUNDLE_VARIANT_PRICE", "FAKE_VARIANT", "VARIANT_PRICE_UNCONFIRMED"]);
  const after = checkPublishReadiness(draft, rows, { confirmVariantPrices: true });
  assert.deepEqual(codesOf(after), ["FAKE_VARIANT"]);
  assert.equal(after.needsPriceConfirm, false);
  assert.deepEqual(after.bypassed.map((b) => b.code).sort(), ["BUNDLE_VARIANT_PRICE", "VARIANT_PRICE_UNCONFIRMED"]);
});

await check("persisted variant_price_confirmed_at drops confirmable blockers, FAKE stays", () => {
  const raw = {
    server: { price_requires_confirmation: true, variant_price_confirmed_at: "2026-10-13T00:00:00.000Z" }
  };
  assert.equal(isVariantPriceConfirmed(raw), true);
  assert.equal(isVariantPriceConfirmed({ server: { variant_price_confirmed_at: "" } }), false);
  assert.equal(isVariantPriceConfirmed({ server: {} }), false);
  assert.equal(isVariantPriceConfirmed(null), false);
  const rows = [variant("單盒"), variant("端盒6款", { cost_is_inherited: true, sort_order: 1 })];
  assert.equal(checkPublishReadiness(draftRow({ raw_capture: raw }), rows).blocked, false);
  const withFake = [...rows, variant("勿拍", { sort_order: 2 })];
  assert.deepEqual(codesOf(checkPublishReadiness(draftRow({ raw_capture: raw }), withFake)), ["FAKE_VARIANT"]);
});

await check("formatPublishBlockMessage joins the blocker messages", () => {
  const rows = [variant("單盒"), variant("端盒6款", { cost_is_inherited: true, sort_order: 1 }), variant("勿拍", { sort_order: 2 })];
  const result = checkPublishReadiness(draftRow(), rows);
  const text = formatPublishBlockMessage(result.blockers);
  assert.match(text, /不是可賣的商品/);
  assert.match(text, /看起來是套組／整盒/);
});

// =====================================================================
// Part A + B: publishDraft against the in-memory fake
// =====================================================================
console.log("\nPart A/B — publishDraft");

function liveTrap() {
  const calls = [];
  const callGraphQL = async (query) => {
    calls.push(String(query).slice(0, 60));
    throw new Error("SHOPIFY_FORBIDDEN_IN_PUBLISH_GUARD_VERIFIER");
  };
  return { calls, callGraphQL };
}

await withEnv({ SHOPIFY_PUBLISH_MOCK: "true", SHOPIFY_LIVE_TEST_DRAFT_ID: undefined }, async () => {
  await check("mock publishDraft on a clean draft: ok + mock + zero writes, no Shopify, no Make", async () => {
    const fake = createFakeSupabase({
      product_drafts: [draftRow()],
      product_variants: [variant("藍色"), variant("紅色", { sort_order: 1 })]
    });
    const trap = liveTrap();
    const result = await publishDraft(fake, "d1", "draft", {
      mockMode: true,
      callGraphQL: trap.callGraphQL
    });
    assert.equal(result.ok, true);
    assert.equal(result.mock, true);
    assert.equal(result.productId, null);
    assert.equal(result.adminUrl, null);
    assert.ok(result.payload?.product, "payload is built");
    assert.equal(result.payload.product.status, "DRAFT");
    assert.ok(Array.isArray(result.mockNotes));
    assert.ok(result.mockNotes.includes("模擬模式：未執行發布前圖片處理（不上傳 Shopify Files）"));
    assert.equal(JSON.stringify(result).includes("mock-product-id"), false);
    assert.deepEqual(fake.writes, [], "mock mode must not write anything");
    assert.deepEqual(trap.calls, [], "mock mode must not call Shopify");
    assert.deepEqual(fetchCalls, [], "mock mode must not hit the network (Make / Files upload)");
    const stored = fake.tables.product_drafts[0];
    assert.equal(stored.status, "approved");
    assert.equal(stored.shopify_product_id, null);
  });

  await check("mock publishDraft (active mode) is still a dry run", async () => {
    const fake = createFakeSupabase({ product_drafts: [draftRow()], product_variants: [] });
    const result = await publishDraft(fake, "d1", "active", { mockMode: true });
    assert.equal(result.ok, true);
    assert.equal(result.mock, true);
    assert.deepEqual(fake.writes, []);
    assert.equal(fake.tables.product_drafts[0].status, "approved");
  });

  await check("mock + fake variant: 409 PUBLISH_BLOCKED, zero writes, status untouched", async () => {
    const fake = createFakeSupabase({
      product_drafts: [draftRow()],
      product_variants: [variant("藍色"), variant("購買須知", { sort_order: 1 })]
    });
    const result = await publishDraft(fake, "d1", "draft", { mockMode: true });
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(result.code, "PUBLISH_BLOCKED");
    assert.equal(result.blockers[0].code, "FAKE_VARIANT");
    assert.match(result.error, /購買須知/);
    assert.deepEqual(fake.writes, []);
  });

  await check("mock + bundle cost: 409 PUBLISH_NEEDS_PRICE_CONFIRM; with the flag it passes, still zero writes", async () => {
    const rows = [variant("單盒"), variant("端盒6款", { cost_is_inherited: true, sort_order: 1 })];
    const fake = createFakeSupabase({
      product_drafts: [draftRow({ raw_capture: { server: { price_requires_confirmation: false } } })],
      product_variants: rows
    });
    const blocked = await publishDraft(fake, "d1", "draft", { mockMode: true });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.code, "PUBLISH_NEEDS_PRICE_CONFIRM");
    assert.equal(blocked.blockers.length, 1);
    const confirmed = await publishDraft(fake, "d1", "draft", {
      mockMode: true,
      confirmVariantPrices: true,
      confirmedBy: "user-1"
    });
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.mock, true);
    assert.deepEqual(fake.writes, [], "mock mode never persists the confirmation");
    assert.equal(fake.tables.product_drafts[0].raw_capture.server.variant_price_confirmed_at, undefined);
  });

  await check("mock + fake variant stays blocked even with confirmVariantPrices", async () => {
    const fake = createFakeSupabase({
      product_drafts: [draftRow()],
      product_variants: [variant("藍色"), variant("勿拍", { sort_order: 1 })]
    });
    const result = await publishDraft(fake, "d1", "draft", { mockMode: true, confirmVariantPrices: true });
    assert.equal(result.ok, false);
    assert.equal(result.code, "PUBLISH_BLOCKED");
  });

  await check("mock + draft_created + real Shopify id: dry-run result with a reuse note (not a status-gate failure)", async () => {
    const productId = "gid://shopify/Product/9001";
    const fake = createFakeSupabase({
      product_drafts: [draftRow({ status: "draft_created", pipeline_stage: "published", shopify_product_id: productId })],
      product_variants: []
    });
    const trap = liveTrap();
    const result = await publishDraft(fake, "d1", "active", { mockMode: true, callGraphQL: trap.callGraphQL });
    assert.equal(result.ok, true);
    assert.equal(result.mock, true);
    assert.equal(result.productId, null);
    assert.ok(result.mockNotes.some((n) => n.includes(productId) && n.includes("不會另外建立新商品")));
    assert.deepEqual(fake.writes, []);
    assert.deepEqual(trap.calls, []);
  });

  await check("mock keeps the read-only guards: already published, publishing, placeholder cost, duplicate variants", async () => {
    const published = createFakeSupabase({
      product_drafts: [draftRow({ status: "active_published", pipeline_stage: "published", shopify_product_id: "mock-product-id" })]
    });
    const r1 = await publishDraft(published, "d1", "draft", { mockMode: true });
    assert.equal(r1.ok, false);
    assert.equal(r1.status, 409);
    assert.match(r1.error, /cannot be published/);

    const publishing = createFakeSupabase({ product_drafts: [draftRow({ status: "publishing" })] });
    const r2 = await publishDraft(publishing, "d1", "draft", { mockMode: true });
    assert.equal(r2.ok, false);
    assert.match(r2.error, /already publishing/);

    const placeholder = createFakeSupabase({ product_drafts: [draftRow({ cny_price: 0.01 })] });
    const r3 = await publishDraft(placeholder, "d1", "draft", { mockMode: true });
    assert.equal(r3.ok, false);
    assert.match(r3.error, /成本未取得/);

    const dup = createFakeSupabase({
      product_drafts: [draftRow()],
      product_variants: [variant("藍色"), variant("藍色", { id: "v-dup", sort_order: 1 })]
    });
    const r4 = await publishDraft(dup, "d1", "draft", { mockMode: true });
    assert.equal(r4.ok, false);
    assert.match(r4.error, /款式組合重複/);

    for (const fake of [published, publishing, placeholder, dup]) assert.deepEqual(fake.writes, []);
  });

  await check("mock + a real Shopify id on a plain approved draft gets the same 409 as live", async () => {
    const fake = createFakeSupabase({
      product_drafts: [draftRow({ shopify_product_id: "gid://shopify/Product/77" })]
    });
    const result = await publishDraft(fake, "d1", "draft", { mockMode: true });
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.match(result.error, /direct productCreate is blocked/);
    assert.deepEqual(fake.writes, []);
  });

  // ----- runPublishBatch (mock) -----
  console.log("\nPart A — runPublishBatch (mock dry run)");

  await check("mock runPublishBatch: zero writes, sentinel batchId, per-item mock, 【模擬】 message", async () => {
    const fake = createFakeSupabase({
      product_drafts: [
        draftRow({ id: "ok1", title_zh: "可發布" }),
        draftRow({ id: "bad1", title_zh: "有假款式" }),
        draftRow({ id: "bundle1", title_zh: "套組" })
      ],
      product_variants: [
        variant("藍色", { draft_id: "ok1" }),
        variant("藍色", { draft_id: "bad1" }),
        variant("購買須知", { draft_id: "bad1", sort_order: 1 }),
        variant("單盒", { draft_id: "bundle1" }),
        variant("端盒6款", { draft_id: "bundle1", cost_is_inherited: true, sort_order: 1 })
      ]
    });
    const result = await runPublishBatch({
      serviceSupabase: fake,
      draftIds: ["ok1", "bad1", "bundle1", "ghost"],
      publishMode: "draft",
      createdBy: "user-1",
      mockMode: true,
      gapMs: 0
    });
    assert.equal(result.ok, true);
    assert.equal(result.mock, true);
    assert.equal(result.batchId, "mock-dry-run");
    assert.equal(result.makeWebhook, "skipped");
    assert.equal(result.succeeded, 1);
    assert.equal(result.failed, 3);
    assert.equal(result.skipped, 0);
    assert.equal(
      result.message,
      "【模擬】1 筆檢查通過、3 筆被擋下；沒有寫入 Shopify，草稿狀態沒有改變"
    );
    assert.ok(result.message.startsWith("【模擬】"));
    assert.equal(result.results.length, 4);
    assert.ok(result.results.every((r) => r.mock === true));
    const byId = Object.fromEntries(result.results.map((r) => [r.draftId, r]));
    assert.equal(byId.ok1.ok, true);
    assert.equal(byId.ok1.productId, null);
    assert.equal(byId.bad1.code, "PUBLISH_BLOCKED");
    assert.equal(byId.bad1.blockers[0].code, "FAKE_VARIANT");
    assert.equal(byId.bundle1.code, "PUBLISH_NEEDS_PRICE_CONFIRM");
    assert.equal(byId.ghost.ok, false);
    assert.equal(JSON.stringify(result).includes("mock-product-id"), false);
    assert.deepEqual(fake.writes, [], "mock batch must not insert/update anything");
    assert.deepEqual(fetchCalls, [], "mock batch must not send Make / call Shopify");
    assert.deepEqual(fake.tables.publish_batches, []);
    assert.deepEqual(fake.tables.publish_batch_items, []);
    for (const row of fake.tables.product_drafts) {
      assert.equal(row.current_publish_batch_id, undefined);
      assert.equal(row.status, "approved");
    }
  });

  await check("mock runPublishBatch forwards confirmVariantPrices / confirmedBy / mockMode to publishOne", async () => {
    const fake = createFakeSupabase({ product_drafts: [draftRow()] });
    const seen = [];
    const result = await runPublishBatch({
      serviceSupabase: fake,
      draftIds: ["d1"],
      publishMode: "draft",
      createdBy: "user-7",
      mockMode: true,
      confirmVariantPrices: true,
      publishOne: async (_client, id, mode, opts) => {
        seen.push({ id, mode, opts });
        return { ok: true, mock: true, payload: {}, productId: null, adminUrl: null, mockNotes: ["n"] };
      }
    });
    assert.equal(result.ok, true);
    assert.deepEqual(seen, [
      { id: "d1", mode: "draft", opts: { confirmVariantPrices: true, confirmedBy: "user-7", mockMode: true } }
    ]);
    assert.deepEqual(result.results[0].mockNotes, ["n"]);
  });

  await check("mock runPublishBatch never reports a Shopify product id, even if publishOne returns one", async () => {
    const fake = createFakeSupabase({ product_drafts: [draftRow()] });
    const result = await runPublishBatch({
      serviceSupabase: fake,
      draftIds: ["d1"],
      publishMode: "draft",
      createdBy: null,
      mockMode: true,
      publishOne: async () => ({ ok: true, productId: "gid://shopify/Product/1", adminUrl: "x" })
    });
    assert.equal(result.results[0].productId, null);
    assert.equal(result.results[0].adminUrl, null);
  });

  await check("mock runPublishBatch honours the time budget (remaining drafts skipped, still no writes)", async () => {
    const fake = createFakeSupabase({
      product_drafts: [draftRow({ id: "a" }), draftRow({ id: "b" })]
    });
    let t = 0;
    const result = await runPublishBatch({
      serviceSupabase: fake,
      draftIds: ["a", "b"],
      publishMode: "draft",
      createdBy: null,
      mockMode: true,
      now: () => (t += 59_000),
      publishOne: async () => ({ ok: true, mock: true, payload: {}, productId: null, adminUrl: null, mockNotes: [] })
    });
    assert.equal(result.stoppedEarly, true);
    assert.equal(result.skipped, 2);
    assert.ok(result.results.every((r) => r.mock === true && r.itemStatus === "skipped"));
    assert.deepEqual(fake.writes, []);
  });
});

// ----- live behaviour stays intact -----
console.log("\nLive mode regression");

await withEnv({ SHOPIFY_PUBLISH_MOCK: "false", SHOPIFY_LIVE_TEST_DRAFT_ID: undefined }, async () => {
  await check("live runPublishBatch still writes the ledger (publish_batches / items / current_publish_batch_id)", async () => {
    const fake = createFakeSupabase({ product_drafts: [draftRow()] });
    const seen = [];
    const result = await runPublishBatch({
      serviceSupabase: fake,
      draftIds: ["d1"],
      publishMode: "draft",
      createdBy: "user-3",
      mockMode: false,
      gapMs: 0,
      skipMakeWebhook: true,
      confirmVariantPrices: true,
      publishOne: async (_client, id, mode, opts) => {
        seen.push(opts);
        return { ok: true, productId: "gid://shopify/Product/5", adminUrl: "https://admin/5" };
      }
    });
    assert.equal(result.ok, true);
    assert.notEqual(result.mock, true);
    assert.notEqual(result.batchId, "mock-dry-run");
    assert.equal(result.succeeded, 1);
    assert.equal(result.results[0].productId, "gid://shopify/Product/5");
    assert.deepEqual(seen, [{ confirmVariantPrices: true, confirmedBy: "user-3", mockMode: false }]);
    const tablesWritten = new Set(fake.writes.map((w) => `${w.op}:${w.table}`));
    assert.ok(tablesWritten.has("insert:publish_batches"));
    assert.ok(tablesWritten.has("insert:publish_batch_items"));
    assert.ok(tablesWritten.has("update:product_drafts"));
  });

  await check("live runPublishBatch carries readiness code + blockers on a blocked item", async () => {
    const fake = createFakeSupabase({ product_drafts: [draftRow()] });
    const blockers = [{ code: "BUNDLE_VARIANT_PRICE", message: "m", confirmable: true }];
    const result = await runPublishBatch({
      serviceSupabase: fake,
      draftIds: ["d1"],
      publishMode: "draft",
      createdBy: null,
      mockMode: false,
      gapMs: 0,
      skipMakeWebhook: true,
      publishOne: async () => ({
        ok: false,
        status: 409,
        error: "m",
        code: "PUBLISH_NEEDS_PRICE_CONFIRM",
        blockers
      })
    });
    assert.equal(result.ok, true);
    assert.equal(result.results[0].ok, false);
    assert.equal(result.results[0].code, "PUBLISH_NEEDS_PRICE_CONFIRM");
    assert.deepEqual(result.results[0].blockers, blockers);
  });

  await check("live publishDraft: blocked draft → 409 before any status change / Shopify call", async () => {
    const fake = createFakeSupabase({
      product_drafts: [draftRow()],
      product_variants: [variant("藍色"), variant("售罄勿拍", { sort_order: 1 })]
    });
    const trap = liveTrap();
    const result = await publishDraft(fake, "d1", "draft", { mockMode: false, callGraphQL: trap.callGraphQL });
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(result.code, "PUBLISH_BLOCKED");
    assert.deepEqual(fake.writes, [], "a blocked draft must never be claimed / moved to publishing");
    assert.deepEqual(trap.calls, []);
    assert.equal(fake.tables.product_drafts[0].status, "approved");
  });

  await check("live publishDraft: confirmable blockers need the flag, then persist the confirmation (merge)", async () => {
    const productId = "gid://shopify/Product/42";
    const raw = {
      version: 1,
      payload: { keep: "me" },
      server: { backend_sha: "abc", price_requires_confirmation: true }
    };
    const make = () =>
      createFakeSupabase({
        product_drafts: [
          draftRow({
            status: "draft_created",
            pipeline_stage: "published",
            shopify_product_id: productId,
            raw_capture: structuredClone(raw)
          })
        ],
        product_variants: [variant("單盒"), variant("端盒6款", { cost_is_inherited: true, sort_order: 1 })]
      });

    const noFlag = make();
    const r1 = await publishDraft(noFlag, "d1", "draft", { mockMode: false });
    assert.equal(r1.ok, false);
    assert.equal(r1.code, "PUBLISH_NEEDS_PRICE_CONFIRM");
    assert.deepEqual(noFlag.writes, []);

    const withFlag = make();
    const r2 = await publishDraft(withFlag, "d1", "draft", {
      mockMode: false,
      confirmVariantPrices: true,
      confirmedBy: "user-9"
    });
    assert.equal(r2.ok, true);
    assert.equal(r2.productId, productId);
    assert.equal(withFlag.writes.length, 1);
    const [write] = withFlag.writes;
    assert.equal(write.op, "update");
    assert.equal(write.table, "product_drafts");
    const merged = write.payload.raw_capture;
    assert.equal(typeof merged.server.variant_price_confirmed_at, "string");
    assert.equal(merged.server.variant_price_confirmed_by, "user-9");
    assert.equal(merged.server.backend_sha, "abc", "other server keys survive");
    assert.equal(merged.server.price_requires_confirmation, true);
    assert.deepEqual(merged.payload, { keep: "me" }, "other raw_capture keys survive");

    // Already confirmed on a previous publish: no flag needed, nothing re-written.
    const persisted = createFakeSupabase({
      product_drafts: [
        draftRow({
          status: "draft_created",
          pipeline_stage: "published",
          shopify_product_id: productId,
          raw_capture: { server: { variant_price_confirmed_at: "2026-10-13T00:00:00.000Z" } }
        })
      ],
      product_variants: [variant("單盒"), variant("端盒6款", { cost_is_inherited: true, sort_order: 1 })]
    });
    const r3 = await publishDraft(persisted, "d1", "draft", { mockMode: false });
    assert.equal(r3.ok, true);
    assert.deepEqual(persisted.writes, []);
  });

  await check("live publishDraft: flag with raw_capture=null (or no server object) waives the blocker but persists nothing", async () => {
    for (const raw of [null, { version: 1 }]) {
      const fake = createFakeSupabase({
        product_drafts: [
          draftRow({
            status: "draft_created",
            pipeline_stage: "published",
            shopify_product_id: "gid://shopify/Product/43",
            raw_capture: raw
          })
        ],
        product_variants: [variant("單盒"), variant("端盒6款", { cost_is_inherited: true, sort_order: 1 })]
      });
      const result = await publishDraft(fake, "d1", "draft", { mockMode: false, confirmVariantPrices: true });
      assert.equal(result.ok, true);
      assert.deepEqual(fake.writes, []);
    }
  });

  await check("live publishDraft: a variants read error stops the publish (fails closed)", async () => {
    const fake = createFakeSupabase({ product_drafts: [draftRow()] });
    const realFrom = fake.from;
    const broken = {
      ...fake,
      from(table) {
        if (table !== "product_variants") return realFrom(table);
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          then: (resolve) => resolve({ data: null, error: { message: "boom" } })
        };
        return chain;
      }
    };
    const result = await publishDraft(broken, "d1", "draft", { mockMode: false });
    assert.equal(result.ok, false);
    assert.equal(result.status, 500);
    assert.match(result.error, /讀取款式資料失敗/);
    assert.deepEqual(fake.writes, []);
  });
});

await check("the fake Supabase really records writes (sanity for the zero-write assertions)", async () => {
  const fake = createFakeSupabase({ product_drafts: [draftRow()] });
  await fake.from("product_drafts").update({ status: "x" }).eq("id", "d1");
  await fake.from("publish_jobs").insert({ draft_id: "d1" });
  assert.equal(fake.writes.length, 2);
});

// =====================================================================
// Part C: pure UI helpers + static wiring
// =====================================================================
console.log("\nPart C — UI helpers and wiring");

await check("shouldLeaveQueue: a mock API result never leaves the queue", () => {
  const selection = { shopify: "draft", matrixify: false, showmore: false };
  assert.equal(station3.shouldLeaveQueue({ selection, apiSucceeded: true, csvSucceeded: null }), true);
  assert.equal(
    station3.shouldLeaveQueue({ selection, apiSucceeded: true, csvSucceeded: null, apiMock: true }),
    false
  );
  assert.equal(
    station3.shouldLeaveQueue({
      selection: { shopify: "active", matrixify: true, showmore: false },
      apiSucceeded: true,
      csvSucceeded: true,
      apiMock: true
    }),
    false
  );
});

await check("formatStation3ResultMessage: mock results start with 【模擬】 and say nothing was written", () => {
  const selection = { shopify: "draft", matrixify: false, showmore: false };
  const ok = station3.formatStation3ResultMessage({
    selection,
    apiSucceeded: true,
    apiMessage: "【模擬】1 筆檢查通過、0 筆被擋下；沒有寫入 Shopify，草稿狀態沒有改變",
    csvSucceeded: null,
    leftQueue: false,
    apiMock: true
  });
  assert.ok(ok.startsWith("【模擬】"));
  assert.match(ok, /沒有寫入 Shopify，草稿狀態沒有改變/);
  assert.doesNotMatch(ok, /已正式上架|草稿已建立|已離開工作佇列/);

  const blocked = station3.formatStation3ResultMessage({
    selection,
    apiSucceeded: false,
    apiMessage: "有 1 個款式不是可賣的商品",
    csvSucceeded: null,
    leftQueue: false,
    apiMock: true
  });
  assert.ok(blocked.startsWith("【模擬】"));
  assert.match(blocked, /不是可賣的商品/);
  assert.match(blocked, /沒有寫入 Shopify，草稿狀態沒有改變/);

  const real = station3.formatStation3ResultMessage({
    selection,
    apiSucceeded: true,
    apiMessage: "x",
    csvSucceeded: null,
    leftQueue: true
  });
  assert.equal(real.startsWith("【模擬】"), false);
  assert.match(real, /Shopify 草稿已建立/);
});

await check("withMockPrefix / formatMockPublishResponseMessage are idempotent", () => {
  assert.equal(batchHelpers.withMockPrefix("abc"), "【模擬】abc");
  assert.equal(batchHelpers.withMockPrefix("【模擬】abc"), "【模擬】abc");
  const msg = batchHelpers.formatMockPublishResponseMessage({ message: "boom", ok: false });
  assert.ok(msg.startsWith("【模擬】"));
  assert.match(msg, /沒有寫入 Shopify，草稿狀態沒有改變/);
  assert.equal(
    batchHelpers.formatMockPublishResponseMessage({ message: msg, ok: false }),
    msg,
    "an already-prefixed server message is used verbatim"
  );
  assert.equal(batchHelpers.MOCK_DRY_RUN_BATCH_ID, "mock-dry-run");
});

await check("publishReadiness stays pure: no imports at all", () => {
  const text = read("src/lib/shopify/publishReadiness.ts");
  assert.doesNotMatch(text, /^\s*import\s/m, "publishReadiness.ts must have no imports");
});

await check("publishDraftSafe: mock returns before image prep, claim, jobs, Make; mockPublish is gone", () => {
  const text = read("src/lib/shopify/publishDraftSafe.ts");
  assert.doesNotMatch(text, /mockPublish/);
  assert.doesNotMatch(text, /shopify_product_id:\s*"mock-product-id"/);
  const readinessIdx = text.indexOf("checkPublishReadiness(draft, typedVariantRows");
  const republishIdx = text.indexOf("return republishExistingDraft(serviceSupabase, id, draft");
  const statusGateIdx = text.indexOf("cannot be published");
  const prepIdx = text.indexOf("await prepareImagesForPublish(");
  const mockReturnIdx = text.indexOf("if (mockMode) {\n    const mockNotes");
  const claimIdx = text.indexOf("await claimPublishing(serviceSupabase, id, draft.status");
  assert.ok(readinessIdx > 0, "readiness check present");
  assert.ok(readinessIdx < republishIdx, "readiness runs before the republish path");
  assert.ok(readinessIdx < statusGateIdx, "readiness runs before the status gate");
  assert.ok(readinessIdx < prepIdx, "readiness runs before image prep");
  assert.ok(prepIdx > 0 && /if \(!mockMode\) \{\s*const prep = await prepareImagesForPublish/.test(text), "image prep is live-only");
  assert.ok(mockReturnIdx > prepIdx && mockReturnIdx < claimIdx, "mock returns before claimPublishing");
  const mockBlock = text.slice(mockReturnIdx, claimIdx);
  assert.doesNotMatch(mockBlock, /notifyMake|insertPublishJob|\.update\(|\.insert\(/);
  assert.equal((text.match(/\.from\("product_variants"\)/g) ?? []).length, 1, "variant rows are loaded once");
  assert.match(text, /deps\.mockMode \?\? process\.env\.SHOPIFY_PUBLISH_MOCK !== "false"/);
});

await check("runPublishBatch: mock branch precedes every ledger write and Make call", () => {
  const text = read("src/lib/shopify/runPublishBatch.ts");
  const mockIdx = text.indexOf("return runPublishBatchDryRun(input, uniqueIds)");
  assert.ok(mockIdx > 0);
  for (const marker of [
    '.from("publish_batches")',
    '.from("publish_batch_items")',
    "current_publish_batch_id: batchId",
    "notifyMake(",
    "safeTryNotifyPublishBatchIfComplete(batchId"
  ]) {
    const first = text.indexOf(marker, text.indexOf("export async function runPublishBatch("));
    assert.ok(first > mockIdx, `${marker} must come after the mock branch`);
  }
  const dryRun = text.slice(text.indexOf("async function runPublishBatchDryRun"), text.indexOf("export async function runPublishBatch("));
  assert.doesNotMatch(dryRun, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|notifyMake|mock-product-id/);
});

await check("unpublish + shopify-lifecycle routes short-circuit in mock mode before any Shopify call or DB write", () => {
  for (const [rel, shopifyCalls] of [
    ["src/app/api/drafts/[id]/unpublish/route.ts", ["setShopifyProductStatus(productId"]],
    [
      "src/app/api/drafts/[id]/shopify-lifecycle/route.ts",
      ["setShopifyProductStatus(productId", "deleteShopifyProduct(productId", "shopify_sync_status: \"syncing\""]
    ]
  ]) {
    const text = read(rel);
    const gate = text.indexOf('process.env.SHOPIFY_PUBLISH_MOCK !== "false"');
    assert.ok(gate > 0, `${rel}: mock gate present`);
    const gateBlock = text.slice(gate, gate + 700);
    assert.match(gateBlock, /status:\s*409/);
    assert.match(gateBlock, /mock:\s*true/);
    assert.match(gateBlock, /測試站（模擬模式）不會/);
    assert.match(gateBlock, /請到正式站操作/);
    const firstDbOrShopify = Math.min(
      ...[".from(\"product_drafts\")", ".update(", ...shopifyCalls]
        .map((m) => text.indexOf(m))
        .filter((i) => i >= 0)
    );
    assert.ok(gate < firstDbOrShopify, `${rel}: gate must precede the first DB/Shopify access`);
    const serviceClientIdx = text.indexOf("createServiceSupabaseClient()");
    assert.ok(gate < serviceClientIdx, `${rel}: gate must precede creating the service client`);
    assert.doesNotMatch(text, /mockProduct/);
  }
});

await check("single publish route reads body.confirmVariantPrices; batch route never accepts it", () => {
  const single = read("src/app/api/drafts/[id]/publish/route.ts");
  const batch = read("src/app/api/drafts/batch/publish/route.ts");
  assert.match(single, /confirmVariantPrices:\s*body\.confirmVariantPrices === true/);
  assert.match(single, /code:\s*first\.code/);
  assert.match(single, /blockers:\s*first\.blockers/);
  assert.match(single, /mockNotes/);
  assert.doesNotMatch(batch, /body\.confirmVariantPrices|confirmVariantPrices:\s*/);
  assert.match(batch, /mock:\s*result\.mock === true/);
  assert.match(batch, /mock:\s*r\.mock/);
});

await check("Station3PublishModal: mock notice + 「模擬發布（只檢查）」 button via useShopifyPublishMock", () => {
  const text = read("src/components/listing/Station3PublishModal.tsx");
  assert.match(text, /useShopifyPublishMock\(\)/);
  assert.match(text, /測試站・模擬模式：只做發布前檢查，不會建立 Shopify 商品，也不會改變草稿狀態/);
  assert.match(text, /模擬發布（只檢查）/);
  assert.doesNotMatch(text, /!important/);
  const hook = read("src/lib/shopify/clientPublishMock.ts");
  assert.match(hook, /\/api\/status/);
  assert.match(hook, /shopifyMock/);
  assert.match(hook, /let mockLookup/);
});

await check("PublishPriceConfirmModal: title, required checkbox, 取消 / 確認並發布, Escape", () => {
  const text = read("src/components/listing/PublishPriceConfirmModal.tsx");
  assert.match(text, /發布前請確認款式價/);
  assert.match(text, /我已逐一核對每個款式的成本（含套組／整盒款）/);
  assert.match(text, /disabled=\{!checked \|\| busy\}/);
  assert.match(text, />\s*取消\s*</);
  assert.match(text, /確認並發布/);
  assert.match(text, /event\.key === "Escape"/);
  assert.match(text, /modal-overlay open/);
  assert.match(text, /station3-publish-modal/);
});

await check("ResultCard: 409 PUBLISH_NEEDS_PRICE_CONFIRM opens the modal; confirm re-runs with confirmVariantPrices", () => {
  const text = read("src/components/listing/ResultCard.tsx");
  assert.match(text, /payload\.code === "PUBLISH_NEEDS_PRICE_CONFIRM"/);
  assert.match(text, /confirmVariantPrices: true/);
  assert.match(text, /<PublishPriceConfirmModal/);
  const flow = text.slice(text.indexOf("async function runStation3CardFlow"), text.indexOf("async function openNextCardExport"));
  const stopIdx = flow.indexOf("setPriceConfirm(");
  const csvIdx = flow.indexOf("const csvKinds");
  assert.ok(stopIdx > 0 && stopIdx < csvIdx, "the confirm stop happens before any CSV export");
  assert.match(flow, /apiMock/);
  assert.match(flow, /if \(!apiMock\) finishSuccessfulTransition\(left\)/);
});

await check("all publish UIs react to mock:true (ResultCard, DraftResultsPanel, DraftQueueList, PublishRecordsPanel)", () => {
  const card = read("src/components/listing/ResultCard.tsx");
  const panel = read("src/components/listing/DraftResultsPanel.tsx");
  const queue = read("src/components/drafts/DraftQueueList.tsx");
  const records = read("src/components/records/PublishRecordsPanel.tsx");
  assert.match(card, /apiMock = payload\.mock === true/);
  assert.match(panel, /apiMock = payload\.mock === true/);
  assert.match(panel, /apiMock/);
  assert.match(queue, /payload\.mock === true/);
  assert.match(queue, /formatMockPublishResponseMessage/);
  assert.match(records, /payload\.mock === true/);
  assert.match(records, /formatMockPublishResponseMessage/);
  // mock success must not clear selection / reload the ledger
  const mockBranchQueue = queue.slice(queue.indexOf("payload.mock === true"), queue.indexOf("router.refresh();", queue.indexOf("payload.mock === true")));
  assert.match(mockBranchQueue, /return;/);
  const mockBranchRecords = records.slice(records.indexOf("if (payload.mock === true) {"), records.indexOf("const okMsg"));
  assert.match(mockBranchRecords, /return;/);
  assert.doesNotMatch(mockBranchRecords, /loadBatches|setFailedSelected/);
});

await check("no client reads a mock batchId as a real batch (sentinel is never linked or loaded)", () => {
  for (const rel of [
    "src/components/listing/ResultCard.tsx",
    "src/components/listing/DraftResultsPanel.tsx",
    "src/components/drafts/DraftQueueList.tsx"
  ]) {
    assert.doesNotMatch(read(rel), /payload\.batchId|\.batchId/, `${rel} must not use batchId`);
  }
});

await check("verify wiring: package.json script + verify-all entry", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["verify:publish-guard"], "node scripts/verify-publish-guard.mjs");
  assert.match(read("scripts/verify-all.mjs"), /scripts\/verify-publish-guard\.mjs/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const { name, err } of failures) console.error(`\nFAIL: ${name}\n${err.stack}`);
  process.exit(1);
}
console.log("PUBLISH-GUARD checks passed");
