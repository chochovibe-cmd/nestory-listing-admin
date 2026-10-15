/**
 * VARIANT-CLEAN verify (no network, no .env, no Supabase).
 *
 * Imports the REAL modules through scripts/publish-guard-loader.mjs and drives them with an
 * in-memory Supabase fake and a fake Shopify Admin GraphQL caller that records every call.
 *
 *   A  import: fake options excluded (shared PUBLISH-GUARD predicate), bundles kept, originals kept
 *   B  rule layer of 款式名稱整理 (brackets, whitespace, glossary, marketing words, product name kept)
 *   C  AI validator: any broken promise falls back to the rule result
 *   D  SKU: NS-<draft>-NN, manual SKUs untouched, Taobao skuId kept for purchasing
 *   E  variant image bind: mediaId payload, bounded READY wait, warning-only, resume path
 *   F  selling price guard: null / <= 0 blocks, no NT$0 fallback
 *   G  resync: only price / compareAtPrice / mediaId, one product per request, never full sync
 *   H  restore an excluded variant, 依公式重算售價 helpers, UI / wiring (static)
 *
 * Run: node scripts/verify-variant-clean.mjs  |  npm run verify:variant-clean
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

const capture = await import(src("src/lib/import/mapCaptureFields.ts"));
const rules = await import(src("src/lib/variants/variantNameRules.ts"));
const validator = await import(src("src/lib/variants/variantNameValidator.ts"));
const preview = await import(src("src/lib/variants/variantNamePreview.ts"));
const skuLib = await import(src("src/lib/variants/variantSku.ts"));
const restore = await import(src("src/lib/variants/restoreExcludedVariant.ts"));
const readiness = await import(src("src/lib/shopify/publishReadiness.ts"));
const shopifyVariants = await import(src("src/lib/variants/shopifyVariants.ts"));
const bind = await import(src("src/lib/shopify/variantMediaBind.ts"));
const resync = await import(src("src/lib/shopify/variantResync.ts"));
const plan = await import(src("src/lib/variants/priceResyncPlan.ts"));
const { publishDraft } = await import(src("src/lib/shopify/publishDraftSafe.ts"));
const { defaultPricingSettings } = await import(src("src/lib/pricing.ts"));
const { dbRowsToForm, formRowsToDbInserts } = await import(src("src/lib/variants/variantMapping.ts"));
const { localizeToTaiwanTraditionalText } = await import(src("src/lib/zhTwLocalizer.ts"));
const variantImageCleanup = await import(src("src/lib/variants/variantImageCleanup.ts"));
const { gradeWarningText } = await import(src("src/lib/drafts/warningTiers.ts"));

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

const fetchCalls = [];
globalThis.fetch = async (url) => {
  fetchCalls.push(String(url));
  throw new Error("NETWORK_FORBIDDEN_IN_VARIANT_CLEAN_VERIFIER");
};
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

// --- fakes ---------------------------------------------------------------------------------
function createFakeSupabase(seed) {
  const tables = {
    product_drafts: [],
    product_variants: [],
    product_images: [],
    team_settings: [],
    shopify_sync_jobs: [],
    publish_jobs: [],
    ...structuredClone(seed)
  };
  const writes = [];
  let idCounter = 0;
  function from(table) {
    const state = { op: "select", filters: [], payload: null, single: false, maybe: false };
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
        return { data: state.single ? inserted[0] : inserted, error: null };
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
        return hit[0] ? { data: hit[0], error: null } : { data: null, error: { message: "no rows" } };
      }
      if (state.maybe) return { data: hit[0] ?? null, error: null };
      return { data: hit, error: null };
    }
    const api = {
      select: () => api,
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
      upsert() {
        state.op = "upsert";
        return api;
      },
      delete() {
        state.op = "delete";
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
      order: () => api,
      limit: () => api,
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

const PRODUCT = "gid://shopify/Product/500";
const ok = (data) => ({ response: { ok: true, status: 200 }, result: { data } });

/**
 * Fake Shopify. Media become READY after `readyAfterReads` reads of ProductMediaBind; every
 * call is recorded with its variables.
 */
function createShopify({ media = [], variants = [], readyAfterReads = 0, failBind = false, failBindQuery = false } = {}) {
  const state = {
    media: structuredClone(media),
    variants: structuredClone(variants),
    reads: 0
  };
  const calls = [];
  let seq = 1000;
  const caller = async (query, variables) => {
    const m = /^\s*(query|mutation)\s+(\w+)/.exec(query);
    const name = m?.[2] ?? "unknown";
    calls.push({ kind: m?.[1], name, variables: structuredClone(variables), query });
    switch (name) {
      case "ProductMediaBind": {
        if (failBindQuery) throw new Error("boom");
        state.reads += 1;
        const ready = state.reads > readyAfterReads;
        return ok({
          product: {
            id: PRODUCT,
            media: { nodes: state.media.map((n) => ({ ...n, status: ready ? "READY" : "PROCESSING" })) },
            variants: { pageInfo: { hasNextPage: false }, nodes: structuredClone(state.variants) }
          }
        });
      }
      case "BindVariantMedia":
      case "ResyncVariantPrices": {
        const root = "productVariantsBulkUpdate";
        if (failBind && name === "BindVariantMedia") {
          return ok({ [root]: { productVariants: null, userErrors: [{ field: ["variants"], message: "Media is not ready" }] } });
        }
        for (const v of variables.variants) {
          const hit = state.variants.find((x) => x.id === v.id);
          if (!hit) return ok({ [root]: { productVariants: null, userErrors: [{ field: ["variants"], message: "no variant" }] } });
          if ("price" in v) hit.price = v.price;
          if ("compareAtPrice" in v) hit.compareAtPrice = v.compareAtPrice;
          if ("mediaId" in v) hit.media = { nodes: [{ id: v.mediaId }] };
        }
        return ok({ [root]: { productVariants: [], userErrors: [] } });
      }
      case "AddVariantImageMedia": {
        for (const item of variables.media) {
          state.media.push({
            id: `gid://shopify/MediaImage/${++seq}`,
            mediaContentType: "IMAGE",
            image: { url: item.originalSource }
          });
        }
        return ok({ productUpdate: { product: { id: PRODUCT, media: { nodes: state.media } }, userErrors: [] } });
      }
      // --- publishDraft (fresh create) ---
      case "ProductCreate": {
        const options = variables.product.productOptions ?? [];
        const selectedOptions = options.map((o) => ({ name: o.name, value: o.values[0].name }));
        state.variants = [{ id: "gid://shopify/ProductVariant/1", title: "x", sku: null, selectedOptions, price: "0", compareAtPrice: null, media: { nodes: [] } }];
        return ok({
          productCreate: {
            product: { id: PRODUCT, title: "t", status: "DRAFT", variants: { nodes: [{ id: "gid://shopify/ProductVariant/1", selectedOptions }] } },
            userErrors: []
          }
        });
      }
      case "ProductVariantsBulkUpdate":
        return ok({ productVariantsBulkUpdate: { productVariants: [], userErrors: [] } });
      case "ProductVariantsBulkCreate": {
        for (const v of variables.variants) {
          state.variants.push({
            id: `gid://shopify/ProductVariant/${++seq}`,
            title: "y",
            sku: v.inventoryItem?.sku ?? null,
            selectedOptions: (v.optionValues ?? []).map((o) => ({ name: o.optionName, value: o.name })),
            price: v.price ?? null,
            compareAtPrice: null,
            media: { nodes: [] }
          });
        }
        return ok({ productVariantsBulkCreate: { productVariants: [], userErrors: [] } });
      }
      case "ProductAttachMedia": {
        for (const item of variables.media) {
          state.media.push({ id: `gid://shopify/MediaImage/${++seq}`, mediaContentType: "IMAGE", image: { url: item.originalSource } });
        }
        return ok({ productUpdate: { product: { id: variables.product.id, status: "DRAFT" }, userErrors: [] } });
      }
      case "ResumeShopifyDraft":
        return ok({
          product: {
            id: PRODUCT,
            status: "DRAFT",
            media: { nodes: state.media.map((n) => ({ id: n.id })) },
            variants: { nodes: state.variants.slice(0, 1).map(({ id }) => ({ id })) }
          }
        });
      case "ResumeShopifyDraftVariant":
        return ok({
          product: { id: PRODUCT, status: "DRAFT", variants: { pageInfo: { hasNextPage: false }, nodes: structuredClone(state.variants) } }
        });
      case "ProductLifecycleStatus":
        return ok({ product: { id: PRODUCT, status: "DRAFT" } });
      default:
        throw new Error(`UNEXPECTED_SHOPIFY_CALL:${name}`);
    }
  };
  return {
    caller,
    calls,
    state,
    named: (name) => calls.filter((c) => c.name === name),
    mutations: () => calls.filter((c) => c.kind === "mutation")
  };
}

function manualClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    advance: (ms) => {
      t += ms;
    }
  };
}

const cdn = (name) => `https://cdn.shopify.com/s/files/1/0/${name}.webp?v=1`;
const remoteMedia = (...names) =>
  names.map((n, i) => ({ id: `gid://shopify/MediaImage/${i + 1}`, mediaContentType: "IMAGE", status: "READY", image: { url: cdn(n) } }));
const remoteVariant = (n, label, extra = {}) => ({
  id: `gid://shopify/ProductVariant/${n}0`,
  title: label,
  sku: null,
  price: "5480.00",
  compareAtPrice: null,
  selectedOptions: [{ name: "款式", value: label }],
  media: { nodes: [] },
  ...extra
});
function variantRow(label, overrides = {}) {
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
    cny_price: 200,
    twd_price: 5480,
    compare_at_price: null,
    cost_is_inherited: false,
    sell_price_locked: false,
    compare_at_locked: false,
    price_locked: false,
    sort_order: 0,
    inventory_quantity: 0,
    inventory_policy: "continue",
    image_id: null,
    created_at: "2026-10-14T00:00:00Z",
    ...overrides
  };
}
function imageRow(id, name, extra = {}) {
  return {
    id,
    draft_id: "d1",
    image_type: "variant",
    processed_file_url: cdn(name),
    original_file_url: null,
    generated_file_url: null,
    alt_text: id,
    sort_order: 0,
    processing_status: "done",
    ...extra
  };
}

console.log("\nVARIANT-CLEAN verify\n");

// =====================================================================
// A. import
// =====================================================================
console.log("A — capture import");

const flatsReal = [
  { option1_name: "颜色分类", option1_value: "【购买须知】CCD配件存放说明", sku: "5123456789012", cny_price: 10 },
  { option1_name: "颜色分类", option1_value: "资讯说明｜勿拍", sku: "5123456789013", cny_price: 10 },
  { option1_name: "颜色分类", option1_value: "售罄勿拍", sku: "5123456789014", cny_price: 10 },
  { option1_name: "颜色分类", option1_value: "联系客服免费定制贺卡，定制内容务必联系客服！", sku: "5123456789015", cny_price: 10 },
  { option1_name: "颜色分类", option1_value: "Pingu屏幕耳机【升级版】", sku: "5123456789016", cny_price: 219, image_url: "https://img.example/a.jpg" },
  { option1_name: "颜色分类", option1_value: "Pingu屏幕耳机【豪华版】", sku: "5123456789017", cny_price: 249, image_url: "https://img.example/b.jpg" }
];
const captureBody = (flats) => ({
  source_url: "https://item.taobao.com/item.htm?id=1",
  title: "Pingu 耳機",
  price_cny: 219,
  variants_flat: flats,
  main_image_urls: [],
  detail_image_urls: []
});
const mappedReal = capture.mapCaptureToDraftFields(captureBody(flatsReal), { userId: "u1" });

await check("fake options (購買須知／勿拍／售罄勿拍／聯繫客服定製賀卡) never become variants", () => {
  assert.equal(mappedReal.variantRows.length, 2);
  assert.deepEqual(
    mappedReal.variantRows.map((r) => r.option1_value),
    ["Pingu螢幕耳機【升級版】", "Pingu螢幕耳機【豪華版】"]
  );
  assert.equal(mappedReal.excludedVariants.length, 4);
});

await check("excluded options leave no trace in dimensions or variant image urls", () => {
  assert.deepEqual(mappedReal.variantDimensions, [
    { name: "款式", values: ["Pingu螢幕耳機【升級版】", "Pingu螢幕耳機【豪華版】"] }
  ]);
  const withFakeImage = capture.mapCaptureToDraftFields(
    captureBody([
      { option1_value: "售罄勿拍", image_url: "https://img.example/fake.jpg", cny_price: 5 },
      { option1_value: "紅色", image_url: "https://img.example/red.jpg", cny_price: 9 }
    ]),
    { userId: "u1" }
  );
  assert.deepEqual(withFakeImage.variantImageUrls, ["https://img.example/red.jpg"]);
});

await check("the import writes the 已排除 N 個非商品款式 warning and keeps the rows for 恢復", () => {
  const warning = mappedReal.warnings.find((w) => /已排除 4 個非商品款式/.test(w));
  assert.ok(warning, mappedReal.warnings.join("|"));
  assert.match(warning, /「售罄勿拍」/);
  const stored = mappedReal.draftRow.raw_capture.server.excluded_variants;
  assert.equal(stored.length, 4);
  assert.equal(stored[2].label, "售罄勿拍");
  assert.equal(stored[2].row.option1_value, "售罄勿拍");
  assert.equal(readRestoreList(mappedReal.draftRow.raw_capture).length, 4);
  assert.equal(gradeWarningText(warning), "suggest", "an informational note, not a 待確認 item");
});
function readRestoreList(rawCapture) {
  return restore.readExcludedVariants(rawCapture);
}

await check("套組／≥2 個／盒／入 are real products and are NOT excluded", () => {
  const names = ["【端盒】6 款全收", "2個入", "套組（含吊飾）", "整盒 12 入", "單隻"];
  const mapped = capture.mapCaptureToDraftFields(
    captureBody(names.map((n) => ({ option1_value: n, cny_price: 30 }))),
    { userId: "u1" }
  );
  assert.equal(mapped.excludedVariants.length, 0);
  assert.equal(mapped.variantRows.length, 5);
});

await check("import and PUBLISH-GUARD share ONE predicate (no second regex)", () => {
  const importSrc = read("src/lib/import/mapCaptureFields.ts");
  assert.match(importSrc, /import \{ isFakeVariantRow \} from "@\/lib\/shopify\/publishReadiness"/);
  assert.doesNotMatch(importSrc, /FAKE_VARIANT_PATTERN/);
  assert.match(importSrc, /if \(isFakeVariantRow\(row\)\)/);
  assert.equal(readiness.isFakeVariantRow({ option1_value: "售罄勿拍" }), true);
  assert.equal(readiness.isFakeVariantRow({ option1_value: "端盒 6 款" }), false);
});

await check("imported text is kept in source_options; Taobao skuId moves to source_sku_id (sku stays empty)", () => {
  const row = mappedReal.variantRows[0];
  assert.deepEqual(row.source_options, { names: ["颜色分类", null, null], values: ["Pingu屏幕耳机【升级版】", null, null] });
  assert.equal(row.source_sku_id, "5123456789016");
  assert.equal(row.sku, null);
  assert.equal(row.option1_name, "款式", "颜色分类 -> 款式");
});

await check("assigning SKUs after the draft insert makes NS- codes and keeps the skuId", () => {
  const assigned = skuLib.assignVariantSkus("e4ba2299-0000-4000-8000-000000000000", mappedReal.variantRows);
  assert.deepEqual(assigned.map((r) => r.sku), ["NS-E4BA22-01", "NS-E4BA22-02"]);
  assert.equal(assigned[0].source_sku_id, "5123456789016");
});

await check("createCaptureDraft assigns SKUs before every persist and no longer matches rows by sku", () => {
  const s = read("src/lib/import/createCaptureDraft.ts");
  assert.equal((s.match(/assignVariantSkus\(/g) ?? []).length, 3);
  const identity = s.slice(s.indexOf("function variantIdentity"), s.indexOf("function mergeWarnings"));
  assert.doesNotMatch(identity, /row\.sku/);
});

// =====================================================================
// B. rule layer
// =====================================================================
console.log("\nB — rule layer");
const clean = (value) => rules.cleanOptionValue(value);

await check("whitespace, full-width letters/digits and brackets are normalised; 【】 stays", () => {
  assert.equal(clean("  紅色   款 "), "紅色 款");
  assert.equal(clean("ＡＢＣ１２３　款"), "ABC123 款");
  assert.equal(clean("Pingu(升級版)"), "Pingu（升級版）");
  assert.equal(clean("Pingu【升級版】"), "Pingu【升級版】");
  assert.equal(clean("Pingu （ 升級版 ）"), "Pingu （升級版）");
});

await check("Taiwan glossary: 內存卡→記憶卡, U盤→隨身碟, 充電寶→行動電源, 數據線→傳輸線, 屏幕→螢幕, 軟件→軟體, 視頻→影片", () => {
  assert.equal(clean("128G内存卡"), "128G記憶卡");
  assert.equal(clean("U盘"), "隨身碟");
  assert.equal(clean("充电宝"), "行動電源");
  assert.equal(clean("数据线"), "傳輸線");
  assert.equal(clean("屏幕"), "螢幕");
  assert.equal(clean("软件"), "軟體");
  assert.equal(clean("视频"), "影片");
  assert.equal(localizeToTaiwanTraditionalText(localizeToTaiwanTraditionalText("内存卡")), "記憶卡", "idempotent");
});

await check("Taiwan IP / character aliases: Sanrio, Disney and Pokémon, one fixture per term", () => {
  const cases = [
    ["M8玉桂狗16G拍立得", "M8大耳狗16G拍立得"],
    ["库洛米吊飾", "酷洛米吊飾"],
    ["庫洛米吊飾", "酷洛米吊飾"],
    ["美乐蒂吊飾", "美樂蒂吊飾"],
    ["帕恰狗吊飾", "帕恰狗吊飾"],
    ["布丁狗吊飾", "布丁狗吊飾"],
    ["大眼蛙吊飾", "大眼蛙吊飾"],
    ["凯蒂猫掛件", "Hello Kitty吊飾"],
    ["米老鼠吊飾", "米奇吊飾"],
    ["唐老鸭吊飾", "唐老鴨吊飾"],
    ["精灵宝可梦週邊", "寶可夢週邊"],
    ["口袋妖怪公仔", "寶可夢公仔"],
    ["皮卡丘吊飾", "皮卡丘吊飾"],
    ["龙珠掛件", "七龍珠吊飾"],
    ["史迪仔公仔", "史迪奇公仔"],
    ["奥特曼公仔", "超人力霸王公仔"],
    ["布朗熊抱枕", "熊大抱枕"],
    ["可妮兔抱枕", "兔兔抱枕"],
    ["小猪佩奇公仔", "粉紅豬小妹公仔"],
    ["托马斯小火车玩具", "湯瑪士小火車玩具"],
    ["托马斯玩具", "湯瑪士小火車玩具"],
    ["海贼王公仔", "航海王公仔"],
    ["蜘蛛侠公仔", "蜘蛛人公仔"],
    ["钢铁侠公仔", "鋼鐵人公仔"],
    ["星球大战公仔", "星際大戰公仔"],
    ["机器猫公仔", "哆啦A夢公仔"],
    ["汪汪队公仔", "汪汪隊立大功公仔"]
  ];
  for (const [raw, expected] of cases) assert.equal(clean(raw), expected, raw);
  assert.equal(rules.cleanVariantRows([{ option1_value: "M8玉桂狗16G拍立得" }])[0].values[0], "M8大耳狗16G拍立得");
});

await check("Taiwan IP replacement is idempotent, never duplicates Kitty or 七龍珠", () => {
  for (const original of [
    "大耳狗", "酷洛米", "美樂蒂", "帕恰狗", "布丁狗", "大眼蛙",
    "Hello Kitty凱蒂貓", "凱蒂貓／Kitty", "七龍珠", "七龍珠套組", "玉桂狗",
    "汪汪隊立大功", "湯瑪士小火車", "超人力霸王", "龍珠／七龍珠"
  ]) {
    const once = clean(original);
    assert.equal(clean(once), once, original);
  }
  assert.equal(clean("Hello Kitty凱蒂貓"), "Hello Kitty");
  assert.equal(clean("凱蒂貓／Kitty"), "Kitty");
  assert.equal(clean("七龍珠"), "七龍珠");
  assert.equal(clean("七龍珠套組"), "七龍珠套組");
});

await check("decorative marketing words go; kept when the name would become empty or a duplicate", () => {
  assert.equal(clean("【現貨】Pingu螢幕耳機"), "Pingu螢幕耳機");
  assert.equal(clean("正版授權 Pingu 吊飾 包郵"), "Pingu 吊飾");
  assert.equal(clean("現貨"), "現貨", "would become empty -> kept");
  const out = rules.cleanVariantRows([{ option1_value: "現貨 Pingu耳機" }, { option1_value: "Pingu耳機" }]);
  assert.deepEqual(out.map((r) => r.values[0]), ["現貨 Pingu耳機", "Pingu耳機"], "removal would duplicate -> kept");
});

await check("the product name inside every variant is KEPT (no common-prefix stripping)", () => {
  const out = rules.cleanVariantRows([
    { option1_name: "颜色分类", option1_value: "Pingu屏幕耳机【升级版】+Pingu绒毛吊饰（马桶款）" },
    { option1_name: "颜色分类", option1_value: "Pingu屏幕耳机【升级版】+Pingu绒毛吊饰（浴缸款）" }
  ]);
  assert.deepEqual(out.map((r) => r.values[0]), [
    "Pingu螢幕耳機【升級版】+Pingu絨毛吊飾（馬桶款）",
    "Pingu螢幕耳機【升級版】+Pingu絨毛吊飾（浴缸款）"
  ]);
});

await check("axis names: 颜色分类→款式, 尺码→尺寸; mixed rows never split an axis", () => {
  assert.equal(rules.cleanDimensionName("颜色分类"), "款式");
  assert.equal(rules.cleanDimensionName("尺码"), "尺寸");
  assert.equal(rules.cleanDimensionName("角色"), "角色");
  const out = rules.cleanVariantRows([
    { option1_name: "颜色分类", option1_value: "A" },
    { option1_name: "款式", option1_value: "B" }
  ]);
  assert.equal(new Set(out.map((r) => r.names[0])).size, 1);
});

await check("rule layer is idempotent and never creates duplicate combinations", () => {
  const rows = [
    { option1_name: "颜色分类", option1_value: "屏幕款" },
    { option1_name: "颜色分类", option1_value: "螢幕款" }
  ];
  const once = rules.cleanVariantRows(rows);
  assert.equal(new Set(once.map((r) => r.values[0])).size, 2, "屏幕款 / 螢幕款 would collide -> originals kept");
  const twice = rules.cleanVariantRows(once.map((r) => ({ option1_name: r.names[0], option1_value: r.values[0] })));
  assert.deepEqual(twice.map((r) => r.values), once.map((r) => r.values));
});

// =====================================================================
// C. AI validator
// =====================================================================
console.log("\nC — AI validator");
const RULE = [["Pingu螢幕耳機【升級版】"], ["Pingu螢幕耳機【豪華版】"], ["128G記憶卡"]];
const validate = (ai, ctx = { names: ["Pingu"] }) => validator.validateAiVariantNames(RULE, ai, ctx);

await check("a faithful wording change is accepted", () => {
  const res = validate([["Pingu螢幕耳機【升級款】"], ["Pingu螢幕耳機【豪華版】"], ["128G記憶卡"]]);
  assert.equal(res.rows[0][0], "Pingu螢幕耳機【升級款】");
  assert.equal(res.cells[0].accepted, true);
});

await check("dropping a number / unit / English falls back to the rule result", () => {
  const res = validate([["Pingu螢幕耳機【升級版】"], ["Pingu螢幕耳機【豪華版】"], ["記憶卡"]]);
  assert.equal(res.rows[2][0], "128G記憶卡");
  assert.match(res.cells[2].reason, /128/);
});

await check("dropping the character / product name falls back (even when the length still fits)", () => {
  const res = validate([["螢幕耳機【升級版】"], ["Pingu螢幕耳機【豪華版】"], ["128G記憶卡"]], { names: ["Pingu"] });
  assert.equal(res.rows[0][0], "Pingu螢幕耳機【升級版】");
  const noCtx = validator.validateAiVariantNames(RULE, [["耳機【升級版】"], ["耳機【豪華版】"], ["128G記憶卡"]]);
  assert.equal(noCtx.rows[0][0], "Pingu螢幕耳機【升級版】", "the shared leading product name is protected without any context");
});

await check("AI validator preserves Taiwan character aliases without accepting dropped names", () => {
  const ruleRows = [["M8大耳狗16G拍立得"], ["酷洛米吊飾"]];
  const keep = validator.validateAiVariantNames(ruleRows, [["M8玉桂狗16G拍立得"], ["庫洛米吊飾"]], {
    names: ["玉桂狗", "库洛米"]
  });
  assert.equal(keep.cells[0].accepted, true, keep.cells[0].reason);
  assert.equal(keep.cells[1].accepted, true, keep.cells[1].reason);
  assert.equal(keep.rows[0][0], "M8大耳狗16G拍立得", "AI must not restore 玉桂狗");
  assert.equal(keep.rows[1][0], "酷洛米吊飾", "AI must not restore 庫洛米");
  const lost = validator.validateAiVariantNames([["大耳狗吊飾"]], [["小熊吊飾"]], { names: ["玉桂狗"] });
  assert.equal(lost.rows[0][0], "大耳狗吊飾");
  assert.match(lost.cells[0].reason, /缺少名稱/);
});

await check("shortening by deleting words (length -5) or padding (+5) is rejected", () => {
  const short = validator.validateAiVariantNames([["Pingu螢幕耳機【升級版】"]], [["Pingu【升】"]], { names: [] });
  assert.equal(short.rows[0][0], "Pingu螢幕耳機【升級版】");
  assert.match(short.cells[0].reason, /長度/);
  const long = validator.validateAiVariantNames([["紅色"]], [["紅色紅色紅色紅色紅色紅色紅色"]], { names: [] });
  assert.equal(long.rows[0][0], "紅色");
});

await check("new information (digits, English, extra Han, sales words) is rejected", () => {
  const cases = [
    [["Pingu螢幕耳機【升級版】1"], "digit"],
    [["Pingu螢幕耳機【升級版】Pro"], "english"],
    [["Pingu螢幕耳機【升級版】爆款"], "sales"],
    [["Pingu藍芽無線耳機【升級版】"], "han"]
  ];
  for (const [ai, label] of cases) {
    const res = validator.validateAiVariantNames([["Pingu螢幕耳機【升級版】"]], [ai], { names: ["Pingu"] });
    assert.equal(res.rows[0][0], "Pingu螢幕耳機【升級版】", label);
    assert.equal(res.cells[0].accepted, false, label);
  }
});

await check("two names that become identical both go back to the rule result", () => {
  const res = validate([["Pingu螢幕耳機【升級款】"], ["Pingu螢幕耳機【升級款】"], ["128G記憶卡"]]);
  assert.equal(res.rows[0][0], "Pingu螢幕耳機【升級版】");
  assert.equal(res.rows[1][0], "Pingu螢幕耳機【豪華版】");
});

await check("garbage AI output (wrong shape / count / types) is ignored wholesale", () => {
  for (const bad of [null, "x", [["a"]], [["a"], ["b"]], [[1], [2], [3]], { rows: [] }]) {
    const res = validate(bad);
    assert.deepEqual(res.rows, RULE.map((r) => [...r]));
    assert.ok(res.cells.every((c) => !c.accepted));
  }
});

await check("preview: rules always, AI only on request, AI failure still returns the rule result", async () => {
  const rows = [
    { option1_name: "颜色分类", option1_value: "Pingu屏幕耳机【升级版】" },
    { option1_name: "颜色分类", option1_value: "Pingu屏幕耳机【豪华版】" }
  ];
  let aiCalls = 0;
  const polish = async (req) => {
    aiCalls += 1;
    assert.deepEqual(req.rows.map((r) => r[0]), ["Pingu螢幕耳機【升級版】", "Pingu螢幕耳機【豪華版】"], "AI receives the rule result");
    return { rows: [["Pingu螢幕耳機【升級款】", "", ""], ["耳機", "", ""]], model: "gpt-4o-mini" };
  };
  const noAi = await preview.buildVariantNamePreview({ rows, useAi: false, polish });
  assert.equal(aiCalls, 0, "no AI without the button");
  assert.equal(noAi.aiUsed, false);
  assert.equal(noAi.rows[0].suggested.values[0], "Pingu螢幕耳機【升級版】");
  assert.equal(noAi.rows[0].suggested.names[0], "款式");

  const withAi = await preview.buildVariantNamePreview({ rows, useAi: true, polish, protectNames: ["Pingu"] });
  assert.equal(aiCalls, 1, "exactly one call for all names");
  assert.equal(withAi.rows[0].suggested.values[0], "Pingu螢幕耳機【升級款】");
  assert.equal(withAi.rows[1].suggested.values[0], "Pingu螢幕耳機【豪華版】", "the bad AI row fell back");
  assert.ok(withAi.rows[1].aiRejected.length > 0);

  const down = await preview.buildVariantNamePreview({
    rows,
    useAi: true,
    polish: async () => ({ rows: null, model: "rules-only", warning: "AI 潤飾暫不可用" })
  });
  assert.equal(down.aiUsed, false);
  assert.match(down.warning, /暫不可用/);
  assert.equal(down.rows[0].suggested.values[0], "Pingu螢幕耳機【升級版】");
});

await check("AI polish is button-only: never imported by the capture import or generate path", () => {
  for (const file of ["src/lib/import/mapCaptureFields.ts", "src/lib/import/createCaptureDraft.ts", "src/app/api/generate/route.ts"]) {
    assert.doesNotMatch(read(file), /variantNamePolish|polishVariantNames/, file);
  }
  const route = read("src/app/api/variants/clean-names/route.ts");
  assert.match(route, /useAi: body\?\.useAi === true/);
  assert.match(read("src/lib/providers/variantNamePolish.ts"), /OPENAI_BRIEF_MODEL/);
});

// =====================================================================
// D. SKU
// =====================================================================
console.log("\nD — SKU");
const DRAFT = "e4ba2299-1111-4222-8333-444444444444";

await check("format NS-<draft UUID first 6 hex upper>-<2-digit seq>", () => {
  assert.equal(skuLib.skuPrefix(DRAFT), "E4BA22");
  assert.equal(skuLib.buildVariantSku(DRAFT, 1), "NS-E4BA22-01");
  assert.equal(skuLib.buildVariantSku(DRAFT, 12), "NS-E4BA22-12");
  assert.match(skuLib.buildVariantSku(DRAFT, 3), /^NS-[0-9A-F]{6}-\d{2}$/);
});

await check("sequence follows sort_order, single-variant is -01", () => {
  const rows = [
    { id: "b", sku: null, sort_order: 2 },
    { id: "a", sku: null, sort_order: 0 },
    { id: "c", sku: null, sort_order: 1 }
  ];
  const out = skuLib.assignVariantSkus(DRAFT, rows);
  assert.deepEqual(out.map((r) => [r.id, r.sku]), [["b", "NS-E4BA22-03"], ["a", "NS-E4BA22-01"], ["c", "NS-E4BA22-02"]]);
  assert.equal(skuLib.assignVariantSkus(DRAFT, [{ sku: null, sort_order: 0 }])[0].sku, "NS-E4BA22-01");
  assert.equal(skuLib.deriveDraftSku(DRAFT, null), "NS-E4BA22-01");
});

await check("auto vs manual: empty / NS- / digits / CHO-…-001 are overwritten, a hand-typed SKU never is", () => {
  for (const auto of [null, "", "NS-E4BA22-07", "5123456789016", "CHO-BBX-PNG-PNG-001"]) assert.equal(skuLib.isAutoSku(auto), true, String(auto));
  for (const manual of ["MY-SKU-1", "PINGU-RED", "abc"]) assert.equal(skuLib.isAutoSku(manual), false, manual);
  const out = skuLib.assignVariantSkus(DRAFT, [
    { sku: "MY-SKU-1", sort_order: 0 },
    { sku: "5123456789016", sort_order: 1, source_sku_id: null },
    { sku: "CHO-BBX-PNG-PNG-001", sort_order: 2 }
  ]);
  assert.equal(out[0].sku, "MY-SKU-1");
  assert.equal(out[1].sku, "NS-E4BA22-02");
  assert.equal(out[1].source_sku_id, "5123456789016", "Taobao id kept for purchasing");
  assert.equal(out[2].sku, "NS-E4BA22-03");
  assert.equal(skuLib.deriveDraftSku(DRAFT, "MY-SKU-1"), "MY-SKU-1");
});

await check("existing NS- SKUs of this draft keep their number; new rows get the next free one", () => {
  const out = skuLib.assignVariantSkus(DRAFT, [
    { sku: "NS-E4BA22-02", sort_order: 0 },
    { sku: null, sort_order: 1 },
    { sku: "NS-E4BA22-01", sort_order: 2 }
  ]);
  assert.deepEqual(out.map((r) => r.sku), ["NS-E4BA22-02", "NS-E4BA22-03", "NS-E4BA22-01"]);
  const again = skuLib.assignVariantSkus(DRAFT, out);
  assert.deepEqual(again.map((r) => r.sku), out.map((r) => r.sku), "idempotent");
});

await check("the AI is no longer asked for a SKU (prompts) and publish uses the program SKU", () => {
  for (const file of ["src/lib/providers/chaochaoPrompt.ts", "src/lib/providers/systemPromptBase.ts", "src/lib/providers/productBrief.ts"]) {
    assert.doesNotMatch(read(file), /CHO-\{型態縮寫\}/, file);
  }
  assert.doesNotMatch(read("src/lib/providers/chaochaoPrompt.ts"), /CHO-\.\.\./);
  const payload = read("src/lib/shopify/payload.ts");
  assert.match(payload, /deriveDraftSku\(draft\.id, draft\.sku\)/);
  assert.doesNotMatch(payload, /generateSku/);
  assert.match(read("src/app/api/generate/route.ts"), /sku: draft\.sku \?\? ""/);
});

await check("SKU / source columns survive a card save: form row ⇄ db insert ⇄ db row", () => {
  const dbRow = {
    ...variantRow("A"),
    sku: "NS-E4BA22-01",
    source_sku_id: "5123456789016",
    source_options: { names: ["颜色分类", null, null], values: ["原名", null, null] }
  };
  const { dimensions, rows } = dbRowsToForm([], [dbRow]);
  assert.equal(rows[0].sourceSkuId, "5123456789016");
  const inserts = formRowsToDbInserts(dimensions, rows);
  assert.equal(inserts[0].source_sku_id, "5123456789016");
  assert.deepEqual(inserts[0].source_options, dbRow.source_options);
  assert.equal(inserts[0].sku, "NS-E4BA22-01");
  const persist = read("src/lib/variants/variantPersist.ts");
  assert.match(persist, /"source_sku_id"/);
  assert.match(persist, /"source_options"/);
  const page = read("src/app/drafts/new/page.tsx");
  assert.match(page, /source_sku_id, source_options/);
});

await check("publish (live) writes the assigned SKUs to Shopify and the DB, never the Taobao id", async () => {
  const fake = createFakeSupabase({
    product_drafts: [{ id: DRAFT, status: "approved", pipeline_stage: "ready", title_zh: "Pingu", cny_price: 219, twd_price: 1799, raw_capture: null, warnings: [], sku: "CHO-BBX-PNG-PNG-001" }],
    product_variants: [
      variantRow("升級版", { draft_id: DRAFT, sku: "5123456789016", sort_order: 0 }),
      variantRow("豪華版", { draft_id: DRAFT, sku: null, sort_order: 1 })
    ]
  });
  const shopify = createShopify();
  const result = await withEnv(
    { SHOPIFY_PUBLISH_MOCK: "false", SHOPIFY_LIVE_TEST_DRAFT_ID: undefined, MAKE_WEBHOOK_URL: undefined, SHOPIFY_LOCATION_ID: undefined },
    () => publishDraft(fake, DRAFT, "draft", { mockMode: false, callGraphQL: shopify.caller, now: manualClock().now, sleep: async () => {} })
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  const skus = [
    ...shopify.named("ProductVariantsBulkUpdate").flatMap((c) => c.variables.variants),
    ...shopify.named("ProductVariantsBulkCreate").flatMap((c) => c.variables.variants)
  ].map((v) => v.inventoryItem.sku);
  assert.deepEqual(skus, ["NS-E4BA22-01", "NS-E4BA22-02"]);
  assert.deepEqual(fake.tables.product_variants.map((r) => r.sku), ["NS-E4BA22-01", "NS-E4BA22-02"]);
  assert.equal(fake.tables.product_variants[0].source_sku_id, "5123456789016");
});

// =====================================================================
// E. variant image bind
// =====================================================================
console.log("\nE — variant image bind");
const SEEDS = (imageIds) =>
  imageIds.map((imageId, i) => ({
    optionValues: [{ optionName: "款式", name: ["藍色", "紅色", "綠色"][i] }],
    price: 100,
    compareAtPrice: null,
    cost: 50,
    sku: null,
    inventoryQuantity: null,
    inventoryPolicy: "CONTINUE",
    imageId
  }));
const LOCAL = [
  { id: "img1", url: cdn("a"), inProductMedia: true },
  { id: "img2", url: cdn("b"), inProductMedia: true },
  { id: "img3", url: cdn("c"), inProductMedia: true }
];

await check("toBulkVariantInput carries mediaId when it is known, and nothing when it is not", () => {
  const seed = SEEDS(["img1"])[0];
  const withMedia = shopifyVariants.toBulkVariantInput(seed, { includeOptionValues: true, locationId: null, inventoryMode: "create", mediaId: "gid://shopify/MediaImage/1" });
  assert.equal(withMedia.mediaId, "gid://shopify/MediaImage/1");
  const without = shopifyVariants.toBulkVariantInput(seed, { includeOptionValues: true, locationId: null, inventoryMode: "create" });
  assert.equal("mediaId" in without, false);
});

await check("images are matched by saved id, then file name, then position (equal counts only)", () => {
  const remote = remoteMedia("a", "b", "c");
  const byName = bind.matchImagesToMedia(LOCAL, remote);
  assert.equal(byName.byImageId.get("img2"), "gid://shopify/MediaImage/2");
  const saved = bind.matchImagesToMedia([{ ...LOCAL[0], shopifyMediaId: "gid://shopify/MediaImage/3" }], remote);
  assert.equal(saved.byImageId.get("img1"), "gid://shopify/MediaImage/3");
  const renamed = bind.matchImagesToMedia(
    LOCAL.map((l, i) => ({ ...l, url: cdn(`other${i}`) })),
    remote
  );
  assert.equal(renamed.byImageId.get("img3"), "gid://shopify/MediaImage/3", "same count -> positional");
  const different = bind.matchImagesToMedia(
    LOCAL.map((l, i) => ({ ...l, url: cdn(`other${i}`) })),
    remoteMedia("a", "b")
  );
  assert.equal(different.byImageId.size, 0, "different counts + unknown names -> never guess");
});

await check("bind: waits (bounded) until READY, then ONE bulk update carrying only {id, mediaId}", async () => {
  const clock = manualClock();
  const shopify = createShopify({
    media: remoteMedia("a", "b", "c").map(({ status, ...n }) => n),
    variants: [remoteVariant(1, "藍色"), remoteVariant(2, "紅色"), remoteVariant(3, "綠色")],
    readyAfterReads: 2
  });
  const res = await bind.bindVariantMedia({
    caller: shopify.caller,
    productId: PRODUCT,
    seeds: SEEDS(["img1", "img2", "img3"]),
    localImages: LOCAL,
    deadlineAt: 45_000,
    now: clock.now,
    sleep: clock.sleep
  });
  assert.equal(res.bound, 3);
  assert.deepEqual(res.warnings, []);
  assert.equal(shopify.named("ProductMediaBind").length, 3, "polled until READY");
  const [mutation] = shopify.named("BindVariantMedia");
  assert.equal(shopify.mutations().length, 1);
  for (const v of mutation.variables.variants) assert.deepEqual(Object.keys(v).sort(), ["id", "mediaId"]);
  assert.deepEqual(mutation.variables.variants.map((v) => v.mediaId), [1, 2, 3].map((n) => `gid://shopify/MediaImage/${n}`));
  assert.ok(clock.now() <= 12_000, "wait stays well inside the 60s budget");
});

await check("bind: never READY → warning only (no mutation), wait capped at 12s", async () => {
  const clock = manualClock();
  const shopify = createShopify({
    media: remoteMedia("a").map(({ status, ...n }) => n),
    variants: [remoteVariant(1, "藍色")],
    readyAfterReads: 999
  });
  const res = await bind.bindVariantMedia({
    caller: shopify.caller,
    productId: PRODUCT,
    seeds: SEEDS(["img1"]),
    localImages: LOCAL,
    deadlineAt: 45_000,
    now: clock.now,
    sleep: clock.sleep
  });
  assert.equal(res.bound, 0);
  assert.match(res.warnings.join(""), /尚未處理完成/);
  assert.equal(shopify.mutations().length, 0);
  assert.ok(clock.now() <= 12_000);
});

await check("bind: the caller's deadline wins over the 12s wait", async () => {
  const clock = manualClock();
  clock.advance(44_000);
  const shopify = createShopify({
    media: remoteMedia("a").map(({ status, ...n }) => n),
    variants: [remoteVariant(1, "藍色")],
    readyAfterReads: 999
  });
  await bind.bindVariantMedia({
    caller: shopify.caller,
    productId: PRODUCT,
    seeds: SEEDS(["img1"]),
    localImages: LOCAL,
    deadlineAt: 45_000,
    now: clock.now,
    sleep: clock.sleep
  });
  assert.equal(shopify.named("ProductMediaBind").length, 1, "no wait loop once the budget is nearly gone");
});

await check("bind: a failing mutation or a throwing read only adds warnings (never throws)", async () => {
  const base = {
    productId: PRODUCT,
    seeds: SEEDS(["img1"]),
    localImages: LOCAL,
    deadlineAt: 45_000,
    now: manualClock().now,
    sleep: async () => {}
  };
  const failing = createShopify({ media: remoteMedia("a").map(({ status, ...n }) => n), variants: [remoteVariant(1, "藍色")], failBind: true });
  const a = await bind.bindVariantMedia({ ...base, caller: failing.caller });
  assert.equal(a.bound, 0);
  assert.match(a.warnings.join(""), /款式圖綁定失敗/);
  const throwing = createShopify({ failBindQuery: true });
  const b = await bind.bindVariantMedia({ ...base, caller: throwing.caller });
  assert.equal(b.bound, 0);
  assert.match(b.warnings.join(""), /款式圖綁定略過/);
});

await check("bind: variants already showing the right image are not touched", async () => {
  const shopify = createShopify({
    media: remoteMedia("a").map(({ status, ...n }) => n),
    variants: [remoteVariant(1, "藍色", { media: { nodes: [{ id: "gid://shopify/MediaImage/1" }] } })]
  });
  const res = await bind.bindVariantMedia({
    caller: shopify.caller,
    productId: PRODUCT,
    seeds: SEEDS(["img1"]),
    localImages: LOCAL,
    deadlineAt: 45_000,
    now: manualClock().now,
    sleep: async () => {}
  });
  assert.equal(res.bound, 0);
  assert.equal(shopify.mutations().length, 0);
});

await check("bind: a variant image that is not in the product media (detail image) is added first, then bound", async () => {
  const shopify = createShopify({ media: [], variants: [remoteVariant(1, "藍色")] });
  const res = await bind.bindVariantMedia({
    caller: shopify.caller,
    productId: PRODUCT,
    seeds: SEEDS(["detail1"]),
    localImages: [{ id: "detail1", url: cdn("d1"), inProductMedia: false }],
    deadlineAt: 45_000,
    now: manualClock().now,
    sleep: async () => {}
  });
  assert.equal(shopify.named("AddVariantImageMedia").length, 1);
  assert.equal(shopify.named("AddVariantImageMedia")[0].variables.media[0].originalSource, cdn("d1"));
  assert.equal(res.bound, 1);
});

function publishFixture({ status = "approved", productId = null, remote = null } = {}) {
  const images = [imageRow("img1", "a", { sort_order: 0 }), imageRow("img2", "b", { sort_order: 1 })];
  return createFakeSupabase({
    product_drafts: [
      {
        id: "d1",
        status,
        pipeline_stage: "ready",
        publish_status: "pending",
        title_zh: "Pingu",
        cny_price: 200,
        twd_price: 1799,
        shopify_product_id: productId,
        raw_capture: null,
        warnings: [],
        error_message: null
      }
    ],
    product_variants: [
      variantRow("藍色", { sort_order: 0, image_id: "img1", twd_price: 1799 }),
      variantRow("紅色", { sort_order: 1, image_id: "img2", twd_price: 1799 })
    ],
    product_images: images
  });
}
const LIVE_ENV = {
  SHOPIFY_PUBLISH_MOCK: "false",
  SHOPIFY_LIVE_TEST_DRAFT_ID: undefined,
  SHOPIFY_ACTIVE_PUBLISH_ENABLED: "true",
  SHOPIFY_LOCATION_ID: undefined,
  MAKE_WEBHOOK_URL: undefined
};

await check("publish: each variant is bound to its own image AFTER the media step, inside the same request", async () => {
  const fake = publishFixture();
  const shopify = createShopify({ readyAfterReads: 1 });
  const clock = manualClock();
  const result = await withEnv(LIVE_ENV, () =>
    publishDraft(fake, "d1", "draft", { mockMode: false, callGraphQL: shopify.caller, now: clock.now, sleep: clock.sleep })
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  const order = shopify.calls.map((c) => c.name);
  assert.ok(order.indexOf("BindVariantMedia") > order.indexOf("ProductAttachMedia"), order.join(","));
  const bound = shopify.named("BindVariantMedia")[0].variables.variants;
  assert.equal(bound.length, 2);
  assert.notEqual(bound[0].mediaId, bound[1].mediaId, "each variant got its OWN image");
  assert.equal(fake.tables.product_images[0].shopify_media_id, bound[0].mediaId);
  assert.equal(fake.tables.product_drafts[0].status, "draft_created");
});

await check("publish: a bind failure never fails the publish; it is recorded as a warning", async () => {
  const fake = publishFixture();
  const shopify = createShopify({ failBind: true });
  const result = await withEnv(LIVE_ENV, () =>
    publishDraft(fake, "d1", "draft", { mockMode: false, callGraphQL: shopify.caller, now: manualClock().now, sleep: async () => {} })
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fake.tables.product_drafts[0].status, "draft_created");
  assert.match((fake.tables.product_drafts[0].warnings ?? []).join(""), /款式圖綁定失敗/);
});

await check("publish resume (api_failed with media + variants already on the DRAFT) binds too", async () => {
  const fake = publishFixture({ status: "api_failed", productId: PRODUCT });
  const shopify = createShopify({
    media: remoteMedia("a", "b").map(({ status, ...n }) => n),
    variants: [remoteVariant(1, "藍色"), remoteVariant(2, "紅色")]
  });
  const result = await withEnv(LIVE_ENV, () =>
    publishDraft(fake, "d1", "draft", { mockMode: false, callGraphQL: shopify.caller, now: manualClock().now, sleep: async () => {} })
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(shopify.named("ProductCreate").length, 0);
  assert.equal(shopify.named("BindVariantMedia").length, 1);
});

await check("publish dry run (mock mode) binds nothing and writes nothing", async () => {
  const fake = publishFixture();
  const shopify = createShopify();
  const result = await withEnv({ ...LIVE_ENV, SHOPIFY_PUBLISH_MOCK: "true" }, () =>
    publishDraft(fake, "d1", "draft", { mockMode: true, callGraphQL: shopify.caller })
  );
  assert.equal(result.ok, true);
  assert.equal(shopify.calls.length, 0);
  assert.equal(fake.writes.length, 0);
});

await check("the publish budget: bind deadline is 45s after the request started, wait capped at 12s", () => {
  const safe = read("src/lib/shopify/publishDraftSafe.ts");
  assert.match(safe, /VARIANT_MEDIA_BIND_DEADLINE_MS = 45_000/);
  assert.match(read("src/lib/shopify/variantMediaBind.ts"), /MEDIA_READY_MAX_WAIT_MS = 12_000/);
  assert.ok(safe.indexOf("bindVariantMedia(") > safe.indexOf("ProductAttachMedia"), "bind runs after the media step");
  assert.ok(safe.indexOf("bindVariantMedia(") < safe.lastIndexOf("setShopifyProductStatus(productId, \"ACTIVE\""), "bind runs before ACTIVE");
});

// =====================================================================
// F. selling price guard
// =====================================================================
console.log("\nF — selling price guard");
const rowsNoPrice = (price) => [
  { option1_value: "藍色", cny_price: 10, twd_price: 300 },
  { option1_value: "紅色", cny_price: 10, twd_price: price }
];

await check("null / 0 / negative / blank variant price blocks publish with 款式「X」沒有售價 (not confirmable)", () => {
  for (const price of [null, 0, -5, "", "abc"]) {
    const result = readiness.checkPublishReadiness({ cny_price: 10, twd_price: 300 }, rowsNoPrice(price), { confirmVariantPrices: true });
    assert.equal(result.blocked, true, String(price));
    const blocker = result.blockers.find((b) => b.code === "VARIANT_NO_PRICE");
    assert.ok(blocker, String(price));
    assert.equal(blocker.confirmable, false);
    assert.match(blocker.message, /款式「紅色」沒有售價/);
  }
  assert.equal(readiness.checkPublishReadiness({ cny_price: 10 }, rowsNoPrice(300)).blocked, false);
});

await check("a single-variant draft with no / <= 0 draft price is blocked too", () => {
  for (const price of [null, 0]) {
    const result = readiness.checkPublishReadiness({ cny_price: 10, twd_price: price }, []);
    assert.equal(result.blocked, true);
    assert.equal(result.blockers[0].code, "VARIANT_NO_PRICE");
  }
  assert.equal(readiness.checkPublishReadiness({ cny_price: 10, twd_price: 500 }, []).blocked, false);
});

await check("buildVariantPublishPlan has no `?? 0`: a missing price stays null and is never sent as 0", () => {
  const out = shopifyVariants.buildVariantPublishPlan([variantRow("藍色", { twd_price: null }), variantRow("紅色", { sort_order: 1 })], { cny_price: 10, twd_cost: 40 });
  assert.equal(out.all[0].price, null);
  const input = shopifyVariants.toBulkVariantInput(out.all[0], { includeOptionValues: false, locationId: null, inventoryMode: "update" });
  assert.equal("price" in input, false);
  assert.doesNotMatch(read("src/lib/variants/shopifyVariants.ts"), /twd_price \?\? 0/);
});

await check("publishDraft stops (409 PUBLISH_BLOCKED, zero Shopify calls) when a variant has no price", async () => {
  const fake = publishFixture();
  fake.tables.product_variants[1].twd_price = null;
  const shopify = createShopify();
  const result = await withEnv(LIVE_ENV, () =>
    publishDraft(fake, "d1", "draft", { mockMode: false, callGraphQL: shopify.caller })
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.code, "PUBLISH_BLOCKED");
  assert.match(result.error, /款式「紅色」沒有售價/);
  assert.equal(shopify.calls.length, 0);
});

// =====================================================================
// G. resync
// =====================================================================
console.log("\nG — price / image resync");

function resyncFixture({ draftOverrides = {}, rows, images, shopifyOptions } = {}) {
  const fake = createFakeSupabase({
    product_drafts: [
      {
        id: "d1",
        status: "active_published",
        title_zh: "相機",
        taobao_title: "相機",
        shopify_product_id: PRODUCT,
        shopify_sync_status: "synced",
        price_mode: "sale",
        cny_price: 599,
        twd_price: 5480,
        compare_at_price: null,
        pricing_formula: {},
        ...draftOverrides
      }
    ],
    product_variants: rows ?? [
      variantRow("A", { sort_order: 0, image_id: "img1", twd_price: 4980 }),
      variantRow("B", { sort_order: 1, image_id: "img2", twd_price: 5280 })
    ],
    product_images: images ?? [imageRow("img1", "a"), imageRow("img2", "b")]
  });
  const shopify = createShopify({
    media: remoteMedia("a", "b").map(({ status, ...n }) => n),
    variants: [remoteVariant(1, "A"), remoteVariant(2, "B")],
    ...shopifyOptions
  });
  return { fake, shopify };
}
const applyReq = (variants, bindImages = true) => ({ variants, bindImages });
const run = (ctx, request, extra = {}) =>
  resync.applyVariantResync({
    serviceSupabase: ctx.fake,
    caller: ctx.shopify.caller,
    draftId: "d1",
    request,
    mockMode: false,
    actorId: "u1",
    now: manualClock().now,
    sleep: async () => {},
    ...extra
  });

await check("resync sends ONLY price / compareAtPrice (and mediaId in its own mutation) — nothing else", async () => {
  const ctx = resyncFixture();
  const res = await run(ctx, applyReq([
    { rowId: "v-A", price: 4980, compareAtPrice: null },
    { rowId: "v-B", price: 5280, compareAtPrice: 5980 }
  ]));
  assert.equal(res.ok, true, JSON.stringify(res));
  const [priceCall] = ctx.shopify.named("ResyncVariantPrices");
  for (const v of priceCall.variables.variants) {
    assert.ok(Object.keys(v).every((k) => ["id", "price", "compareAtPrice"].includes(k)), JSON.stringify(v));
  }
  assert.deepEqual(priceCall.variables.variants, [
    { id: "gid://shopify/ProductVariant/10", price: "4980", compareAtPrice: null },
    { id: "gid://shopify/ProductVariant/20", price: "5280", compareAtPrice: "5980" }
  ]);
  const [bindCall] = ctx.shopify.named("BindVariantMedia");
  for (const v of bindCall.variables.variants) assert.deepEqual(Object.keys(v).sort(), ["id", "mediaId"]);
  const all = JSON.stringify(ctx.shopify.mutations().map((m) => m.variables)) + ctx.shopify.mutations().map((m) => m.query).join("");
  for (const forbidden of ["title", "descriptionHtml", "inventoryPolicy", "inventoryItem", "inventoryQuantities", "quantityAdjustments", "tracked", "status", "sku", "optionValues", "publishable"]) {
    assert.equal(all.includes(forbidden), false, `must not touch ${forbidden}`);
  }
  assert.deepEqual(ctx.shopify.mutations().map((m) => m.name), ["ResyncVariantPrices", "BindVariantMedia"]);
});

await check("resync only changes variants whose Shopify price actually differs", async () => {
  const ctx = resyncFixture({ shopifyOptions: { variants: [remoteVariant(1, "A", { price: "4980.00" }), remoteVariant(2, "B")] } });
  const res = await run(ctx, applyReq([
    { rowId: "v-A", price: 4980, compareAtPrice: null },
    { rowId: "v-B", price: 5280, compareAtPrice: null }
  ], false));
  assert.equal(res.ok, true);
  assert.deepEqual(ctx.shopify.named("ResyncVariantPrices")[0].variables.variants.map((v) => v.id), ["gid://shopify/ProductVariant/20"]);
  assert.equal(ctx.shopify.named("BindVariantMedia").length, 0, "no image work when not asked");
});

await check("after a successful resync local twd_price / compare_at match Shopify, sync status restored, audit row written", async () => {
  const ctx = resyncFixture();
  const res = await run(ctx, applyReq([
    { rowId: "v-A", price: 4000, compareAtPrice: 4500 },
    { rowId: "v-B", price: 5280, compareAtPrice: null }
  ], false));
  assert.equal(res.ok, true);
  const rows = ctx.fake.tables.product_variants;
  assert.equal(rows[0].twd_price, 4000);
  assert.equal(rows[0].compare_at_price, 4500);
  assert.equal(ctx.fake.tables.product_drafts[0].shopify_sync_status, "synced");
  const job = ctx.fake.tables.shopify_sync_jobs[0];
  assert.equal(job.status, "completed");
  assert.equal(job.request_payload.kind, "variant_price_resync");
  assert.equal(job.shopify_product_id, PRODUCT);
  assert.equal(ctx.shopify.state.variants[0].price, "4000");
});

await check("resync failure leaves local data untouched and logs a failed audit row", async () => {
  const ctx = resyncFixture();
  const failing = {
    ...ctx.shopify,
    caller: async (query, variables) => {
      if (/ResyncVariantPrices/.test(query)) {
        return ok({ productVariantsBulkUpdate: { productVariants: null, userErrors: [{ field: ["variants"], message: "nope" }] } });
      }
      return ctx.shopify.caller(query, variables);
    }
  };
  const res = await resync.applyVariantResync({
    serviceSupabase: ctx.fake, caller: failing.caller, draftId: "d1", mockMode: false, actorId: "u1",
    request: applyReq([{ rowId: "v-A", price: 1000, compareAtPrice: null }], false)
  });
  assert.equal(res.ok, false);
  assert.equal(ctx.fake.tables.product_variants[0].twd_price, 4980);
  assert.equal(ctx.fake.tables.shopify_sync_jobs[0].status, "failed");
});

await check("resync is one product per request: a request for another product's variant is refused", async () => {
  const ctx = resyncFixture();
  const res = await run(ctx, applyReq([{ rowId: "someone-elses-variant", price: 1000, compareAtPrice: null }], false));
  assert.equal(res.ok, false);
  assert.equal(res.status, 409);
  assert.equal(ctx.shopify.mutations().length, 0);
  const route = read("src/app/api/price-resync/[draftId]/apply/route.ts");
  assert.match(route, /const \{ draftId \} = await params/);
  assert.doesNotMatch(route, /\.map\(|for \(const/, "no loop over products inside one request");
});

await check("ZERO matches (every name differs) → the product is skipped with a reason, never guessed", async () => {
  const ctx = resyncFixture({ shopifyOptions: { variants: [remoteVariant(1, "完全不同"), remoteVariant(2, "也不同")] } });
  const previewRes = await resync.previewVariantResync({ serviceSupabase: ctx.fake, caller: ctx.shopify.caller, draftId: "d1", mockMode: false });
  assert.equal(previewRes.ok, true);
  assert.match(previewRes.skipReason, /沒有任何款式能和系統的款式對應/);
  assert.deepEqual(previewRes.lines, []);
  const res = await run(ctx, applyReq([{ rowId: "v-A", price: 1000, compareAtPrice: null }], false));
  assert.equal(res.ok, false);
  assert.equal(res.status, 409);
  assert.equal(ctx.shopify.mutations().length, 0);
});

// Real prod shapes (read-only check, 2026-10-14): Shopify variants were deleted in the Shopify admin,
// the Nestory rows stayed. Those rows must not block the product.
const FAKE_NAMES = ["聯繫客服免費定製賀卡，定製內容務必聯繫客服！", "【購買須知】CCD配件存放說明 （資訊說明 | 拍下不出貨）", "資訊說明｜勿拍", "售罄勿拍"];

async function runShape({ localLabels, remoteLabels, extraRows = [] }) {
  const rows = [...localLabels, ...extraRows].map((label, i) =>
    variantRow(label, { sort_order: i, twd_price: 4480, id: `v-${label}` })
  );
  const ctx = resyncFixture({
    rows,
    images: [],
    shopifyOptions: {
      media: [],
      variants: remoteLabels.map((label, i) => remoteVariant(i + 1, label, { price: "4480.00" }))
    }
  });
  const previewRes = await resync.previewVariantResync({ serviceSupabase: ctx.fake, caller: ctx.shopify.caller, draftId: "d1", mockMode: false });
  return { ctx, previewRes, rows };
}

await check("小王子 shape: fake + discontinued 【定製版】 rows exist only in Nestory → still resynced", async () => {
  const kept = ["【禮盒版】小王子星球燈", "【禮盒版】小王子星球燈+正版專屬禮袋"];
  const discontinued = ["【定製版】小王子星球燈+星星掛鏈", "【定製版】小王子星球燈+星星掛鏈+正版專屬禮袋"];
  const { ctx, previewRes } = await runShape({ localLabels: [...kept, FAKE_NAMES[0], ...discontinued], remoteLabels: kept });
  assert.equal(previewRes.ok, true);
  assert.equal(previewRes.skipReason, null);
  assert.deepEqual(previewRes.lines.map((l) => l.label), kept);
  assert.deepEqual(previewRes.localOnly, discontinued, "fake rows are neither priced nor listed; discontinued rows are listed as local-only");
  assert.deepEqual(previewRes.remoteOnly, []);
  const res = await run(ctx, applyReq(previewRes.lines.map((l) => ({ rowId: l.rowId, price: 1799, compareAtPrice: null })), false));
  assert.equal(res.ok, true, JSON.stringify(res));
  const sent = ctx.shopify.named("ResyncVariantPrices")[0].variables.variants.map((v) => v.id);
  assert.deepEqual(sent, ["gid://shopify/ProductVariant/10", "gid://shopify/ProductVariant/20"], "only the matched Shopify variants");
  assert.equal(ctx.fake.tables.product_variants.find((r) => r.id === `v-${discontinued[0]}`).twd_price, 4480, "local-only rows untouched");
});

await check("Pingu CCD shape: 13 rows incl. 【購買須知】, Shopify 12 → resynced, the fake row is never counted", async () => {
  const labels = Array.from({ length: 12 }, (_, i) => `CCD款式${i + 1}`);
  const { ctx, previewRes } = await runShape({ localLabels: labels, remoteLabels: labels, extraRows: [FAKE_NAMES[1]] });
  assert.equal(previewRes.skipReason, null);
  assert.equal(previewRes.lines.length, 12);
  assert.deepEqual(previewRes.localOnly, [], "the 購買須知 row is excluded, not 'unmatched'");
  const res = await run(ctx, applyReq(previewRes.lines.map((l) => ({ rowId: l.rowId, price: 2280, compareAtPrice: null })), false));
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(ctx.shopify.named("ResyncVariantPrices")[0].variables.variants.length, 12);
  assert.equal(ctx.fake.tables.product_variants.find((r) => r.option1_value === FAKE_NAMES[1]).twd_price, 4480, "fake row never priced");
  assert.equal(ctx.shopify.mutations().length, 1);
});

await check("Hello Kitty 檯燈 shape: 勿拍 / 售罄勿拍 rows local-only + a Shopify-only variant → matched ones only, Shopify-only untouched", async () => {
  const sellable = ["Kitty蘋果款", "Kitty招財貓款"];
  const { ctx, previewRes } = await runShape({
    localLabels: [...sellable, FAKE_NAMES[2], FAKE_NAMES[3]],
    remoteLabels: [...sellable, "只在Shopify上的款"]
  });
  assert.equal(previewRes.skipReason, null);
  assert.deepEqual(previewRes.lines.map((l) => l.label), sellable);
  assert.deepEqual(previewRes.localOnly, []);
  assert.deepEqual(previewRes.remoteOnly, ["只在Shopify上的款"]);
  const res = await run(ctx, applyReq(previewRes.lines.map((l) => ({ rowId: l.rowId, price: 1799, compareAtPrice: null })), false));
  assert.equal(res.ok, true, JSON.stringify(res));
  const sent = ctx.shopify.named("ResyncVariantPrices")[0].variables.variants.map((v) => v.id);
  assert.deepEqual(sent, ["gid://shopify/ProductVariant/10", "gid://shopify/ProductVariant/20"]);
  assert.equal(ctx.shopify.state.variants[2].price, "4480.00", "the Shopify-only variant keeps its price");
  assert.ok(!sent.includes("gid://shopify/ProductVariant/30"));
});

await check("apply uses the same rule: an unmatched / fake row in the request is ignored, not a 409", async () => {
  const sellable = ["A款", "B款"];
  const { ctx } = await runShape({ localLabels: sellable, remoteLabels: [sellable[0]], extraRows: [FAKE_NAMES[3]] });
  const res = await run(ctx, applyReq([
    { rowId: "v-A款", price: 1799, compareAtPrice: null },
    { rowId: "v-B款", price: 1799, compareAtPrice: null },
    { rowId: `v-${FAKE_NAMES[3]}`, price: 1799, compareAtPrice: null }
  ], false));
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(ctx.shopify.named("ResyncVariantPrices")[0].variables.variants.map((v) => v.id), ["gid://shopify/ProductVariant/10"]);
});

await check("resync panel shows the two info lists collapsed (details), not as errors", () => {
  const panel = read("src/components/records/PriceResyncPanel.tsx");
  assert.match(panel, /系統有、Shopify 上已沒有（不處理）/);
  assert.match(panel, /Shopify 有、系統沒有（不動）/);
  assert.match(panel, /<details className="vr-notes">/);
});

await check("preview is read-only: uses Shopify's CURRENT price as 舊價 and reports which variants need an image", async () => {
  const ctx = resyncFixture();
  const res = await resync.previewVariantResync({ serviceSupabase: ctx.fake, caller: ctx.shopify.caller, draftId: "d1", mockMode: false });
  assert.equal(res.ok, true);
  assert.equal(res.skipReason, null);
  assert.deepEqual(res.lines.map((l) => [l.rowId, l.oldPrice, l.needsImage]), [["v-A", "5480.00", true], ["v-B", "5480.00", true]]);
  assert.equal(ctx.shopify.mutations().length, 0);
  assert.equal(ctx.fake.writes.length, 0);
});

await check("single-variant products are resynced from the draft price path", async () => {
  const ctx = resyncFixture({ rows: [], images: [] });
  ctx.shopify.state.variants = [remoteVariant(1, "Default Title")];
  const res = await run(ctx, applyReq([{ rowId: null, price: 2280, compareAtPrice: null }], false));
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(ctx.fake.tables.product_drafts[0].twd_price, 2280);
  assert.equal(ctx.fake.tables.product_drafts[0].shopify_sync_status, "synced");
});

await check("only active_published products with a real Shopify id can be resynced; mock mode is a dry run", async () => {
  const draft = resyncFixture({ draftOverrides: { status: "draft_created" } });
  assert.equal((await run(draft, applyReq([{ rowId: "v-A", price: 1, compareAtPrice: null }]))).ok, false);
  const mock = resyncFixture();
  const res = await run(mock, applyReq([{ rowId: "v-A", price: 1000, compareAtPrice: null }]), { mockMode: true });
  assert.equal(res.ok, true);
  assert.equal(res.mock, true);
  assert.equal(mock.shopify.calls.length, 0);
  assert.equal(mock.fake.writes.length, 0);
});

await check("sanity check refuses silly prices (0, negative, decimals, compare-at below price)", () => {
  assert.equal(plan.checkResyncPrice({ price: 1980, compareAtPrice: null }), null);
  assert.equal(plan.checkResyncPrice({ price: 1980, compareAtPrice: 2480 }), null);
  for (const bad of [{ price: 0 }, { price: -1 }, { price: 19.5 }, { price: 2_000_000 }, { price: 1000, compareAtPrice: 900 }, { price: "1000" }, null]) {
    assert.ok(plan.checkResyncPrice(bad), JSON.stringify(bad));
  }
});

await check("the resync path never calls the full sync engine", () => {
  for (const file of [
    "src/lib/shopify/variantResync.ts",
    "src/app/api/price-resync/[draftId]/apply/route.ts",
    "src/app/api/price-resync/[draftId]/preview/route.ts",
    "src/app/api/price-resync/candidates/route.ts",
    "src/components/records/PriceResyncPanel.tsx"
  ]) {
    assert.doesNotMatch(read(file), /from "@\/lib\/shopify\/syncShopifyProduct"|syncShopifyProduct\(|\/shopify-sync/, file);
  }
});

await check("GraphQL contract file lists the same operations and mediaId", () => {
  const contract = read("scripts/graphql/shopify-variant-clean-2026-04.graphql");
  for (const name of ["ProductMediaBind", "BindVariantMedia", "ResyncVariantPrices", "AddVariantImageMedia"]) {
    assert.match(contract, new RegExp(`(query|mutation) ${name}\\(`));
  }
  assert.match(contract, /mediaId: ID/);
  assert.match(bind.BIND_VARIANT_MEDIA_MUTATION, /mutation BindVariantMedia/);
  assert.match(resync.RESYNC_PRICE_MUTATION, /mutation ResyncVariantPrices/);
});

// =====================================================================
// H. 依公式重算售價, restore, UI wiring
// =====================================================================
console.log("\nH — recalculation, restore, UI wiring");
const costRows = [
  variantRow("A", { sort_order: 0, cny_price: 219, twd_price: 2280 }),
  variantRow("B", { sort_order: 1, cny_price: 249, twd_price: 2280, sell_price_locked: true, compare_at_locked: true }),
  variantRow("C", { sort_order: 2, cny_price: null, twd_price: 999 })
];

await check("recalc: unlocked rows follow the current ladder, locked rows never move, no-cost rows are left alone", () => {
  const lines = plan.computeVariantRecalcLines({ rows: costRows, productCost: null, priceMode: "single", settings: defaultPricingSettings });
  const [a, b, c] = lines;
  assert.equal(a.newSell, 1799, "219 CNY -> x80/x99 ladder (verify-variant-pricing)");
  assert.equal(a.changed, true);
  assert.equal(b.locked, true);
  assert.equal(b.newSell, 2280, "locked sell price kept");
  assert.equal(c.newSell, null, "no cost -> nothing to compute");
  assert.equal(plan.describePricingSettings(defaultPricingSettings).includes("此裝置的定價設定"), true);
});

await check("resync row plan combines Shopify's live price with this device's settings; default old = Shopify", () => {
  const candidate = {
    id: "d1",
    price_mode: "single",
    cny_price: 599,
    twd_price: 5480,
    variants: [variantRow("A", { cny_price: 219, twd_price: 2280 })],
    variant_dimensions: []
  };
  const row = plan.buildResyncRowPlan({
    candidate,
    preview: { lines: [{ rowId: "v-A", label: "A", oldPrice: "5480.00", oldCompareAt: null, needsImage: true }] },
    settings: defaultPricingSettings
  });
  assert.equal(row.lines[0].oldPrice, 5480);
  assert.equal(row.lines[0].newPrice, 1799);
  assert.equal(row.needsAction, true);
  assert.equal(row.imageCount, 1);
  assert.deepEqual(row.request, [{ rowId: "v-A", price: 1799, compareAtPrice: null }]);
  const upToDate = plan.buildResyncRowPlan({
    candidate,
    preview: { lines: [{ rowId: "v-A", label: "A", oldPrice: "1799.00", oldCompareAt: null, needsImage: false }] },
    settings: defaultPricingSettings
  });
  assert.equal(upToDate.needsAction, false);
});

await check("restoring an excluded variant: appended with an NS- SKU, removed from the list, dimensions updated, duplicates refused", () => {
  const excluded = mappedReal.draftRow.raw_capture.server.excluded_variants;
  const out = restore.planRestoreExcludedVariant({
    draftId: DRAFT,
    excluded,
    index: 2,
    existing: [{ id: "x", sku: "NS-E4BA22-01", sort_order: 0, option1_value: "A" }],
    dimensions: [{ name: "款式", values: ["A"] }]
  });
  assert.equal(out.ok, true);
  assert.equal(out.row.option1_value, "售罄勿拍");
  assert.equal(out.row.sku, "NS-E4BA22-02");
  assert.equal(out.row.sort_order, 1);
  assert.equal("image_url" in out.row, false);
  assert.equal(out.remaining.length, 3);
  assert.deepEqual(out.dimensions[0].values, ["A", "售罄勿拍"]);
  const dup = restore.planRestoreExcludedVariant({
    draftId: DRAFT,
    excluded,
    index: 2,
    existing: [{ id: "x", sort_order: 0, option1_value: "售罄勿拍" }],
    dimensions: []
  });
  assert.equal(dup.ok, false);
  assert.equal(dup.status, 409);
  assert.equal(restore.planRestoreExcludedVariant({ draftId: DRAFT, excluded, index: 99, existing: [], dimensions: [] }).ok, false);
});

await check("UI: 規格頁籤 has 整理款式名稱 / 依公式重算售價 buttons, an 已排除的款式 list with 恢復, and shows the pricing settings used", () => {
  const panel = read("src/components/listing/result-card/ResultCardSpecsPanel.tsx");
  for (const text of ["整理款式名稱", "依公式重算售價", "已排除的款式", "恢復"]) assert.match(panel, new RegExp(text), text);
  const clean = read("src/components/listing/VariantNameCleanModal.tsx");
  assert.match(clean, /原名：/);
  assert.match(clean, /套用/);
  assert.match(clean, /AI 潤飾成台灣用語/);
  assert.match(clean, /type="checkbox"/);
  assert.match(clean, /type="text"/);
  assert.match(clean, /onApply\(/);
  assert.doesNotMatch(clean, /useEffect\([^)]*load\(true\)/, "AI never runs automatically");
  assert.match(read("src/components/listing/RecalcPriceModal.tsx"), /describePricingSettings\(settings\)/);
  const card = read("src/components/listing/ResultCard.tsx");
  assert.match(card, /excluded-variants\/restore/);
});

await check("UI: resync panel defaults to nothing ticked, has 全選 and 同步勾選的商品（N）, per-row status + retry, shows the settings", () => {
  const panel = read("src/components/records/PriceResyncPanel.tsx");
  assert.match(panel, /useState<Set<string>>\(\(\) => new Set\(\)\)/, "nothing selected by default");
  assert.match(panel, /全選/);
  assert.match(panel, /同步勾選的商品（\{selectedCount\}）/);
  for (const text of ["同步中", "完成", "失敗", "重試"]) assert.match(panel, new RegExp(text), text);
  assert.match(panel, /describePricingSettings\(settings\)/);
  assert.match(panel, /\/api\/price-resync\/\$\{candidate\.id\}\/apply/);
  const records = read("src/lib/drafts/publishRecords.ts");
  assert.match(records, /價格／款式圖重同步/);
  assert.match(read("src/components/records/PublishRecordsPanel.tsx"), /<PriceResyncPanel \/>/);
});


await check("deleting a variant proposes only its exclusive image_type=variant picture", () => {
  const images = [
    { id: "solo", imageType: "variant" },
    { id: "shared", imageType: "variant" },
    { id: "main", imageType: "main" },
    { id: "detail", imageType: "detail" }
  ];
  const pick = variantImageCleanup.imageIdsOrphanedByRemovingVariant;
  assert.deepEqual(pick({ imageId: "solo" }, [{ imageId: "shared" }], images), ["solo"]);
  assert.deepEqual(pick({ imageId: "shared" }, [{ imageId: "shared" }], images), [], "shared image kept");
  assert.deepEqual(pick({ imageId: "main" }, [], images), [], "main image kept");
  assert.deepEqual(pick({ imageId: "detail" }, [], images), [], "detail image kept");
  assert.deepEqual(pick({ imageId: "unknown" }, [], images), [], "unknown image type kept");
});

// A small real-query-shaped fake for the image-integrity delete helper. It uses
// the actual DB-only cleanup path and fails if Storage deletion is ever attempted.
function makeDraftImageCleanupFake() {
  const tables = {
    product_images: [
      { id: "solo", draft_id: "d1", image_type: "variant" },
      { id: "shared", draft_id: "d1", image_type: "variant" },
      { id: "main", draft_id: "d1", image_type: "main" },
      { id: "detail", draft_id: "d1", image_type: "detail" },
      { id: "foreign", draft_id: "d2", image_type: "variant" }
    ],
    product_variants: [
      { id: "remaining", draft_id: "d1", image_id: "shared" }
    ]
  };
  const storageCalls = [];
  return {
    tables,
    storageCalls,
    storage: { from: () => ({
      remove: async (paths) => {
        storageCalls.push(paths);
        throw new Error("STORAGE_DELETE_FORBIDDEN");
      }
    }) },
    from(table) {
      let op = "select";
      const filters = [];
      const query = {
        select() { return query; },
        delete() { op = "delete"; return query; },
        eq(column, value) { filters.push((row) => row[column] === value); return query; },
        in(column, values) { filters.push((row) => values.includes(row[column])); return query; },
        then(resolve, reject) {
          const hit = tables[table].filter((row) => filters.every((f) => f(row)));
          if (op === "delete") {
            tables[table] = tables[table].filter((row) => !hit.includes(row));
          }
          return Promise.resolve({ data: structuredClone(hit), error: null }).then(resolve, reject);
        }
      };
      return query;
    }
  };
}

await check("draft-only cleanup removes an exclusive image DB row, preserves shared/main/detail/other drafts and Storage", async () => {
  const fake = makeDraftImageCleanupFake();
  const res = await variantImageCleanup.removeUnusedVariantImagesFromDraft(
    fake, "d1", ["solo", "shared", "main", "detail", "foreign"]
  );
  assert.deepEqual(res.deletedIds, ["solo"]);
  assert.deepEqual(fake.tables.product_images.map((img) => img.id), ["shared", "main", "detail", "foreign"]);
  assert.deepEqual(fake.tables.product_variants.map((row) => row.image_id), ["shared"]);
  assert.equal(fake.storageCalls.length, 0, "Storage objects are never permanently deleted");
});

await check("both variant editing entrances require a save before image cleanup and offer KEEP IMAGE", () => {
  const editor = read("src/components/listing/VariantEditor.tsx");
  assert.ok(editor.includes("這款有 ${count} 張只屬於它的款式圖"));
  assert.ok(editor.includes("取消＝保留圖片，只刪款式"));
  assert.ok(editor.includes("if (count > 0) {"), "no dialog when the row has no exclusive image (old behaviour)");
  assert.ok(editor.includes("if (removeImageToo) onQueueImageDeletion?.(candidateIds)"));
  const workspace = read("src/components/listing/WorkspaceInputPanel.tsx");
  const resultCard = read("src/components/listing/ResultCard.tsx");
  const specs = read("src/components/listing/result-card/ResultCardSpecsPanel.tsx");
  for (const item of [workspace, resultCard, specs]) assert.ok(item.includes("onQueueImageDeletion"));
  assert.ok(workspace.indexOf("await persistProductVariants(") < workspace.indexOf("await removeUnusedVariantImagesFromDraft("));
  assert.ok(resultCard.indexOf("await persistVariantsSafe(") < resultCard.indexOf("await removeUnusedVariantImagesFromDraft("));
  const helper = read("src/lib/variants/variantImageCleanup.ts");
  assert.ok(helper.includes("unbindVariants: false"));
  assert.ok(helper.includes("keepStorageFiles: true"));
  const deleteLib = read("src/lib/images/deleteProductImages.ts");
  assert.ok(deleteLib.includes("if (options.keepStorageFiles) return result"));
});

await check("narrow result-card keeps actions wrapping and fixes outer grid auto-minimum without new !important", () => {
  const css = read("src/app/globals.css");
  const block = css.slice(css.indexOf("/* VARIANT-CLEAN fixbatch:"));
  for (const fragment of [
    "grid-template-columns: minmax(0, 1fr)",
    ".result-card .rc-body",
    ".result-card .rc-specs-wrap",
    ".result-card .vc-toolbar",
    "flex-wrap: wrap"
  ]) assert.ok(block.includes(fragment), fragment);
  assert.doesNotMatch(block, /!important/);
  // 375/560/768 pixel card widths are visual browser-review gates;
  // static assertions guard the layout contract, not a screenshot claim.
});

await check("CSS: the new styles add no !important and only use existing tokens", () => {
  const css = read("src/app/globals.css");
  const block = css.slice(css.indexOf("/* VARIANT-CLEAN:"));
  assert.ok(block.length > 100);
  assert.doesNotMatch(block, /!important/);
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, "no raw colors");
  for (const token of block.match(/var\((--[a-z0-9-]+)\)/g) ?? []) {
    const name = token.slice(4, -1);
    assert.ok(css.includes(`${name}:`), `${name} must be an existing token`);
  }
});

await check("migration adds exactly the two new columns, additive and idempotent", () => {
  const sql = read("supabase/migrations/20261014100000_variant_clean_columns.sql");
  assert.match(sql, /add column if not exists source_sku_id text/);
  assert.match(sql, /add column if not exists source_options jsonb/);
  assert.doesNotMatch(sql, /drop |delete from|update public\./i);
});

await check("wiring: package.json script + verify-all entry, and no verifier path touched the network", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["verify:variant-clean"], "node scripts/verify-variant-clean.mjs");
  assert.match(read("scripts/verify-all.mjs"), /verify-variant-clean\.mjs/);
  assert.deepEqual(fetchCalls, []);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.error(`FAILED: ${f.name}\n${f.err?.stack ?? f.err}`);
  process.exit(1);
}
console.log("VARIANT-CLEAN checks passed");
