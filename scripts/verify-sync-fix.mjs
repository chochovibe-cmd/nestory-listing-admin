#!/usr/bin/env node
// SYNC-FIX acceptance checks — written by Claude BEFORE construction (spec: docs/SYNC-FIX-施工規格-2026-10-23.md).
// GPT implements until every check passes; do not weaken or delete checks.
// Offline only: real modules + in-memory DB and Shopify doubles. No .env, network, SQL or production writes.
// Fixtures scripts/fixtures/sync-fix/6232c6b0.{tool,shopify}.html are the real 10-22 pair: what the tool
// sent for 6232c6b0 and what Shopify stored (Shopify adds "\n" around <li>/</ul> and drops "/" in <img ... />).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
register(pathToFileURL(path.join(root, "scripts", "publish-guard-loader.mjs")).href);
const src = (relative) => pathToFileURL(path.join(root, relative)).href;
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const TOOL_HTML = read("scripts/fixtures/sync-fix/6232c6b0.tool.html");
const SHOPIFY_HTML = read("scripts/fixtures/sync-fix/6232c6b0.shopify.html");

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("  ✓ " + name);
  } catch (error) {
    failures.push(name);
    console.error("  ✗ " + name + ": " + (error instanceof Error ? error.message : String(error)));
  }
}

let norm = null;
let sync = null;
let payload = null;
try {
  norm = await import(src("src/lib/shopify/htmlNormalize.ts"));
} catch (error) {
  console.error("  ✗ import src/lib/shopify/htmlNormalize.ts: " + error.message);
}
sync = await import(src("src/lib/shopify/syncShopifyProduct.ts"));
payload = await import(src("src/lib/shopify/payload.ts"));

// What real Shopify did to 6232c6b0 on 10-22 (see fixtures): newline before every <li> and </ul>,
// and void tags lose their self-closing slash.
function shopifyRewrite(html) {
  return String(html ?? "")
    .replace(/<li>/g, "\n<li>")
    .replace(/<\/ul>/g, "\n</ul>")
    .replace(/<(img|br|hr)\b([^>]*?)\s*\/>/g, "<$1$2>");
}

console.log("SYNC-FIX N — normalizeShopifyHtml");
await check("SF01 real 6232c6b0 pair: differs raw, equal after normalizing", () => {
  assert.notEqual(TOOL_HTML, SHOPIFY_HTML);
  assert.equal(norm.normalizeShopifyHtml(TOOL_HTML), norm.normalizeShopifyHtml(SHOPIFY_HTML));
});
await check("SF02 void tags: <br/>, <br />, <img ... /> equal their unslashed form", () => {
  const n = norm.normalizeShopifyHtml;
  assert.equal(n("<p>a<br/>b</p>"), n("<p>a<br>b</p>"));
  assert.equal(n("<p>a<br />b</p>"), n("<p>a<br>b</p>"));
  assert.equal(n('<p><img src="x.webp" alt="圖" loading="lazy" style="max-width:100%;height:auto;" /></p>'),
    n('<p><img src="x.webp" alt="圖" loading="lazy" style="max-width:100%;height:auto;"></p>'));
  assert.equal(n('<hr/><HR />'), n("<hr><HR>"));
});
await check("SF03 non-void self-closing tags are NOT rewritten", () => {
  const n = norm.normalizeShopifyHtml;
  assert.notEqual(n("<div/>"), n("<div>"));
  assert.notEqual(n("<p/>"), n("<p>"));
});
await check("SF04 whitespace between tags (\\n, \\r\\n, spaces, tabs) and at the ends is ignored", () => {
  const n = norm.normalizeShopifyHtml;
  const base = "<ul><li>一</li><li>二</li></ul>";
  assert.equal(n("<ul>\n<li>一</li>\n<li>二</li>\n</ul>"), n(base));
  assert.equal(n("<ul>\r\n<li>一</li>\r\n<li>二</li>\r\n</ul>"), n(base));
  assert.equal(n("  <ul> \t<li>一</li>  <li>二</li></ul>\n"), n(base));
});
await check("SF05 real content changes are still detected", () => {
  const n = norm.normalizeShopifyHtml;
  assert.notEqual(n(TOOL_HTML.replace("孫悟空", "孫悟飯")), n(SHOPIFY_HTML));
  assert.notEqual(n("<p>A  B</p>"), n("<p>A B</p>"), "whitespace inside text is content");
  assert.notEqual(n("<p> A</p>"), n("<p>A</p>"), "leading space inside an element is content");
  assert.notEqual(n('<img src="a.webp" alt="一">'), n('<img src="a.webp" alt="二">'));
  assert.notEqual(n("<p>x</p><!-- nestory-desc-embed --><p>y</p>"), n("<p>x</p><p>y</p>"));
  assert.notEqual(n("<p>x</p>"), n("<P>x</P>"), "tag case is not folded");
});
await check("SF06 null / undefined / empty normalize to empty string", () => {
  assert.equal(norm.normalizeShopifyHtml(null), "");
  assert.equal(norm.normalizeShopifyHtml(undefined), "");
  assert.equal(norm.normalizeShopifyHtml("  \n "), "");
});
await check("SF07 htmlNormalize.ts is pure (no imports, no env, no IO)", () => {
  const source = read("src/lib/shopify/htmlNormalize.ts");
  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.doesNotMatch(source, /require\(|process\.env|fetch\(/);
});

console.log("SYNC-FIX D — describeHtmlDifference");
await check("SF08 equal (after normalizing) → null", () => {
  assert.equal(norm.describeHtmlDifference(TOOL_HTML, SHOPIFY_HTML), null);
  assert.equal(norm.describeHtmlDifference(null, ""), null);
});
await check("SF09 first difference: index of the first differing char; snippets = normalized.slice(index-40, index+80)", () => {
  const changed = SHOPIFY_HTML.replace("孫悟空", "孫悟飯");
  const d = norm.describeHtmlDifference(TOOL_HTML, changed);
  assert.ok(d && Number.isInteger(d.index) && d.index >= 0, JSON.stringify(d));
  const a = norm.normalizeShopifyHtml(TOOL_HTML);
  const b = norm.normalizeShopifyHtml(changed);
  assert.equal(d.index, a.indexOf("孫悟空") + 2, "index points at 空/飯, the first differing char");
  assert.equal(d.tool, a.slice(Math.max(0, d.index - 40), d.index + 80));
  assert.equal(d.shopify, b.slice(Math.max(0, d.index - 40), d.index + 80));
  assert.ok(d.tool.includes("孫悟空") && d.shopify.includes("孫悟飯"), JSON.stringify(d));
  assert.ok(d.tool.length <= 120 && d.shopify.length <= 120, "snippets must stay short");
});
await check("SF10 length-only difference (one side is a prefix) is reported", () => {
  const d = norm.describeHtmlDifference("<p>一</p><p>二</p>", "<p>一</p>");
  assert.ok(d, "must not be null");
  assert.equal(d.index, "<p>一</p>".length);
  assert.equal(d.tool, "<p>一</p><p>二</p>");
  assert.equal(d.shopify, "<p>一</p>");
});

console.log("SYNC-FIX R — verifyReadback");
function minimalSnapshot(overrides = {}) {
  return {
    id: "gid://shopify/Product/1",
    title: "標題",
    handle: "h",
    descriptionHtml: SHOPIFY_HTML,
    vendor: "潮巢 Nestory",
    productType: "",
    tags: ["a", "b"],
    status: "DRAFT",
    updatedAt: "2026-10-22T08:05:41Z",
    seo: { title: "", description: "" },
    category: null,
    variants: { nodes: [] },
    media: { nodes: [] },
    metafields: { nodes: [] },
    ...overrides
  };
}
const minimalCore = (overrides = {}) => ({
  id: "gid://shopify/Product/1",
  title: "標題",
  descriptionHtml: TOOL_HTML,
  vendor: "潮巢 Nestory",
  productType: "",
  tags: ["b", "a"],
  status: "DRAFT",
  ...overrides
});
await check("SF11 verifyReadback is exported", () => {
  assert.equal(typeof sync.verifyReadback, "function");
});
await check("SF12 Shopify-normalized description is NOT a mismatch (the 10-22 6232c6b0 case)", () => {
  assert.deepEqual(sync.verifyReadback(minimalSnapshot(), minimalCore(), [], [], [], null, []), []);
});
await check("SF13 a real description change IS still a mismatch", () => {
  const mm = sync.verifyReadback(
    minimalSnapshot({ descriptionHtml: SHOPIFY_HTML.replace("孫悟空", "孫悟飯") }),
    minimalCore(), [], [], [], null, []
  );
  assert.deepEqual(mm, ["product.descriptionHtml"]);
});
await check("SF14 title / vendor / productType stay strict (no HTML normalizing)", () => {
  const mm = sync.verifyReadback(
    minimalSnapshot({ title: "標題 ", vendor: "潮巢Nestory", productType: "x" }),
    minimalCore(), [], [], [], null, []
  );
  assert.deepEqual(mm.sort(), ["product.productType", "product.title", "product.vendor"]);
});

console.log("SYNC-FIX E — full sync end-to-end (fake DB + fake Shopify)");
function draft(overrides = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    updated_at: "2026-10-22T00:00:00.000Z",
    title_zh: "七龍珠 吊飾",
    taobao_title: "七龍珠 吊飾",
    description_html:
      "商品介紹\n四個角色的小團隊。\n\n收藏亮點\n・絨毛觸感\n・顏色鮮明\n\n適合誰\n七龍珠迷。\n\n商品資訊\n・IP：七龍珠",
    description_plain: "",
    generated_faq_html: "<h3><strong>會掉毛嗎？</strong></h3>\n<p>不容易掉毛。</p>",
    spec_text: "材質：毛絨",
    why_we_chose_it: "",
    product_highlights: [],
    seo_title: "七龍珠 吊飾",
    seo_description: "七龍珠 吊飾",
    vendor: "潮巢 Nestory",
    product_type: null,
    category: null,
    shopify_handle: "dragon-ball-charm",
    shopify_product_id: "gid://shopify/Product/600",
    shopify_remote_updated_at: null,
    shopify_sync_hash: null,
    shopify_sync_baseline: null,
    shopify_sync_status: "never",
    shopify_sync_error: null,
    generation_tone: "潮巢導購版",
    sale_status: "海外代購（約14天）",
    twd_price: 390,
    compare_at_price: null,
    twd_cost: 200,
    cny_price: 40,
    price_mode: "variant",
    sku: "MY-CHARM-01",
    inventory_policy: "continue",
    inventory_quantity: 0,
    product_images: [],
    shopify_tags: [],
    tags: [],
    metafields_json: null,
    generated_payload_json: null,
    video_urls: [],
    ip_name: null,
    ...overrides
  };
}

function snapshotFromDraft(localDraft, rewrite) {
  const built = payload.buildShopifyProductPayload(
    { ...localDraft, product_images: [], product_variants: [] },
    "draft",
    {}
  );
  return {
    id: localDraft.shopify_product_id,
    title: built.product.title,
    handle: built.product.handle ?? "dragon-ball-charm",
    descriptionHtml: rewrite(built.product.descriptionHtml),
    vendor: built.product.vendor,
    productType: built.product.productType,
    tags: built.product.tags ?? [],
    status: "DRAFT",
    updatedAt: "2026-10-22T00:00:00.000Z",
    seo: built.product.seo,
    category: built.product.category ? { id: built.product.category, name: "x" } : null,
    variants: {
      nodes: [{
        id: "gid://shopify/ProductVariant/1",
        title: "Default Title",
        sku: built.variantSeed.sku ?? "",
        price: String(built.variantSeed.price ?? 0),
        compareAtPrice: null,
        inventoryPolicy: built.variantSeed.inventoryPolicy ?? "CONTINUE",
        selectedOptions: [{ name: "Title", value: "Default Title" }],
        inventoryItem: { id: "gid://shopify/InventoryItem/1", tracked: false, inventoryLevels: { nodes: [] } }
      }]
    },
    media: { nodes: [] },
    metafields: {
      nodes: (built.product.metafields ?? []).map((item, index) => ({
        id: "gid://shopify/Metafield/" + (index + 1),
        namespace: item.namespace,
        key: item.key,
        type: item.type,
        value: item.value,
        updatedAt: "2026-10-22T00:00:00.000Z"
      }))
    }
  };
}

function fakeDb(initial) {
  const tables = structuredClone(initial);
  let sequence = 0;
  function from(table) {
    const state = { action: "select", predicates: [], patch: null, single: false, maybe: false };
    const api = {
      select() { return api; },
      eq(key, value) { state.predicates.push((row) => row[key] === value); return api; },
      neq(key, value) { state.predicates.push((row) => row[key] !== value); return api; },
      order() { return api; },
      single() { state.single = true; return api; },
      maybeSingle() { state.maybe = true; return api; },
      insert(data) { state.action = "insert"; state.patch = data; return api; },
      update(data) { state.action = "update"; state.patch = data; return api; },
      then(resolve, reject) {
        const all = tables[table] ?? (tables[table] = []);
        const rows = all.filter((row) => state.predicates.every((predicate) => predicate(row)));
        let response;
        if (state.action === "insert") {
          const incoming = Array.isArray(state.patch) ? state.patch : [state.patch];
          const created = incoming.map((row) => ({ id: row.id ?? "fake-" + (++sequence), ...structuredClone(row) }));
          all.push(...created);
          response = { data: state.single || state.maybe ? created[0] : created, error: null };
        } else if (state.action === "update") {
          for (const row of rows) Object.assign(row, structuredClone(state.patch));
          response = { data: state.single || state.maybe ? (rows[0] ?? null) : rows, error: null };
        } else {
          const visible = rows.map((row) =>
            table === "product_drafts"
              ? { ...structuredClone(row), product_images: structuredClone((tables.product_images ?? []).filter((image) => image.draft_id === row.id)) }
              : structuredClone(row)
          );
          response = {
            data: state.single || state.maybe ? (visible[0] ?? null) : visible,
            error: state.single && visible.length === 0 ? { message: "No rows" } : null
          };
        }
        return Promise.resolve(response).then(resolve, reject);
      }
    };
    return api;
  }
  return { from, tables };
}

function shopifyFake(initialSnapshot, rewrite) {
  const state = { product: structuredClone(initialSnapshot) };
  const calls = [];
  const ok = (data) => ({ response: { ok: true, status: 200 }, result: { data } });
  const caller = async (query, variables) => {
    const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "unknown";
    calls.push(name);
    if (name === "ProductSyncSnapshot") return ok({ product: structuredClone(state.product) });
    if (name === "SyncProductCore") {
      const product = variables.product;
      for (const key of ["title", "vendor", "productType", "tags", "status", "handle"]) {
        if (Object.prototype.hasOwnProperty.call(product, key)) state.product[key] = product[key];
      }
      if (Object.prototype.hasOwnProperty.call(product, "descriptionHtml")) {
        state.product.descriptionHtml = rewrite(product.descriptionHtml);
      }
      if (Object.prototype.hasOwnProperty.call(product, "seo")) state.product.seo = structuredClone(product.seo);
      for (const metafield of product.metafields ?? []) {
        const existing = state.product.metafields.nodes.find(
          (item) => item.namespace === metafield.namespace && item.key === metafield.key
        );
        if (existing) existing.value = metafield.value;
        else state.product.metafields.nodes.push({ id: "gid://shopify/Metafield/n" + calls.length, ...metafield, updatedAt: state.product.updatedAt });
      }
      state.product.updatedAt = "2026-10-23T01:00:00Z";
      return ok({ productUpdate: { product: { id: state.product.id }, userErrors: [] } });
    }
    if (name === "SyncProductVariants") {
      for (const patch of variables.variants) {
        const remote = state.product.variants.nodes.find((item) => item.id === patch.id);
        if (!remote) continue;
        if (patch.price != null) remote.price = String(patch.price);
        remote.compareAtPrice = patch.compareAtPrice ?? null;
        if (patch.inventoryPolicy) remote.inventoryPolicy = patch.inventoryPolicy;
        remote.sku = patch.inventoryItem?.sku ?? remote.sku;
      }
      return ok({ productVariantsBulkUpdate: { productVariants: [], userErrors: [] } });
    }
    throw new Error("Unexpected Shopify fake operation " + name);
  };
  return { caller, calls, state };
}

async function runSync({ draftOverrides = {}, rewriteOnWrite = shopifyRewrite } = {}) {
  const localDraft = draft(draftOverrides);
  const db = fakeDb({
    product_drafts: [localDraft],
    product_variants: [],
    product_images: [],
    team_settings: [],
    shopify_sync_jobs: []
  });
  const shop = shopifyFake(snapshotFromDraft(localDraft, shopifyRewrite), rewriteOnWrite);
  const prevMock = process.env.SHOPIFY_PUBLISH_MOCK;
  process.env.SHOPIFY_PUBLISH_MOCK = "false";
  try {
    const result = await sync.syncShopifyProduct({
      serviceSupabase: db,
      draftId: localDraft.id,
      createdBy: "owner-1",
      deps: { callGraphQL: shop.caller }
    });
    return { result, db, shop, draftRow: db.tables.product_drafts[0], jobs: db.tables.shopify_sync_jobs };
  } finally {
    if (prevMock === undefined) delete process.env.SHOPIFY_PUBLISH_MOCK;
    else process.env.SHOPIFY_PUBLISH_MOCK = prevMock;
  }
}

await check("SF15 control: the fake really rewrites the HTML the tool sends", async () => {
  const h = await runSync();
  const built = payload.buildShopifyProductPayload({ ...draft(), product_images: [], product_variants: [] }, "draft", {});
  assert.ok(built.product.descriptionHtml.includes("<li>"), "fixture draft must produce a <ul> list");
  assert.notEqual(h.shop.state.product.descriptionHtml, built.product.descriptionHtml);
});
await check("SF16 Shopify reformats HTML on write → sync completes as synced (was readback_mismatch/partial)", async () => {
  const h = await runSync();
  assert.equal(h.result.ok, true, JSON.stringify(h.result));
  assert.equal(h.draftRow.shopify_sync_status, "synced");
  assert.equal(h.draftRow.shopify_sync_error, null);
  assert.ok(h.draftRow.shopify_sync_baseline, "baseline must be written on success");
  assert.equal(h.jobs.length, 1);
  assert.equal(h.jobs[0].status, "completed");
});
await check("SF17 re-sync from 'partial' (the 6232c6b0 state) completes as synced", async () => {
  const h = await runSync({
    draftOverrides: {
      shopify_sync_status: "partial",
      shopify_sync_error: "Shopify 已完成 2 個步驟後中斷，屬於部分同步：\"Shopify 回讀與工具不一致：product.descriptionHtml\"",
      shopify_remote_updated_at: "2026-10-22T08:05:41Z"
    }
  });
  assert.equal(h.result.ok, true, JSON.stringify(h.result));
  assert.equal(h.draftRow.shopify_sync_status, "synced");
});
await check("SF18 Shopify really changes the text → still readback_mismatch + partial, job carries descriptionDiff", async () => {
  const h = await runSync({ rewriteOnWrite: (html) => shopifyRewrite(html).replace("四個角色", "三個角色") });
  assert.equal(h.result.ok, false);
  assert.equal(h.result.code, "readback_mismatch");
  assert.equal(h.draftRow.shopify_sync_status, "partial");
  const job = h.jobs[0];
  assert.equal(job.status, "failed");
  assert.equal(job.error_code, "readback_mismatch");
  const diff = job.response_payload?.descriptionDiff;
  assert.ok(diff && Number.isInteger(diff.index), "response_payload.descriptionDiff missing: " + JSON.stringify(job.response_payload));
  assert.ok(diff.tool.includes("四個角色") && diff.shopify.includes("三個角色"), JSON.stringify(diff));
  assert.deepEqual(job.response_payload.mismatches, ["product.descriptionHtml"]);
});
await check("SF19 descriptionDiff is only added when the description itself mismatches", () => {
  const engine = read("src/lib/shopify/syncShopifyProduct.ts");
  assert.match(engine, /descriptionDiff/);
  assert.match(engine, /mismatches\.includes\("product\.descriptionHtml"\)/);
});

console.log("SYNC-FIX S — source guards");
await check("SF20 syncShopifyProduct.ts imports the normalizer; readback no longer compares descriptionHtml raw", () => {
  const engine = read("src/lib/shopify/syncShopifyProduct.ts");
  assert.match(engine, /from "@\/lib\/shopify\/htmlNormalize"/);
  assert.match(engine, /normalizeShopifyHtml\(/);
  const start = engine.indexOf("function verifyReadback(");
  const body = engine.slice(start, engine.indexOf("\n}\n", start));
  assert.doesNotMatch(body, /\["title", "descriptionHtml", "vendor", "productType"\]/,
    "descriptionHtml must leave the strict scalar loop");
});
await check("SF21 scope: reconcile / payload / UI / migrations untouched by this package", () => {
  // These files are compared against the spec base commit by the reviewer; here we only pin
  // that the reconcile text comparison still exists unchanged in shape.
  const fields = read("src/lib/shopify/reconcileFields.ts");
  assert.match(fields, /export function descriptionCompareText\(/);
  assert.doesNotMatch(fields, /normalizeShopifyHtml/);
});
await check("SF22 wired into verify:all and package.json", () => {
  assert.match(read("scripts/verify-all.mjs"), /scripts\/verify-sync-fix\.mjs/);
  assert.match(read("package.json"), /"verify:sync-fix":\s*"node scripts\/verify-sync-fix\.mjs"/);
});

console.log(`\nSYNC-FIX: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("Failed: " + failures.join(" | "));
  process.exit(1);
}
