#!/usr/bin/env node
// STOCK (4b) acceptance checks — written by Claude BEFORE construction (spec: docs/STOCK-施工規格-2026-10-22.md).
// GPT implements until every check passes; do not weaken or delete checks. No network, no DB.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
register(pathToFileURL(path.join(root, "scripts/publish-guard-loader.mjs")).href);
const src = (name) => pathToFileURL(path.join(root, name)).href;
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

const {
  summarizeSourceStockForShopify,
  isSourceLowStock,
  readShopifyStockMark
} = await import(src("src/lib/variants/sourceStock.ts"));
const {
  planSourceStockSync,
  runSourceStockSync,
  SOURCE_STOCK_QUERY,
  SOURCE_STOCK_MUTATION
} = await import(src("src/lib/shopify/sourceStockSync.ts"));
const { buildVariantUpdateInput } = await import(src("src/lib/shopify/syncShopifyProduct.ts"));
const { buildVariantPublishPlan } = await import(src("src/lib/variants/shopifyVariants.ts"));

let passed = 0;
const failed = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  ✓ " + name);
  } catch (err) {
    failed.push({ name, err });
    console.error("  ✗ " + name + ": " + (err && err.stack ? err.stack : err));
  }
}

const NOW = "2026-10-22T08:00:00.000Z";
const LOC = "gid://shopify/Location/1";
const PRODUCT = "gid://shopify/Product/100";
const stock = (status, quantity = null) => ({ status, quantity, checked_at: "2026-10-22T04:00:00.000Z" });
const so = (s, mark) => ({ names: ["款式", null, null], values: ["x", null, null], stock: s, ...(mark ? { shopify_stock: mark } : {}) });
const SOLD_MARK = { applied: "sold_out", at: "2026-10-21T00:00:00.000Z", prev: { policy: "CONTINUE", tracked: false, available: 3 } };

function localVariants() {
  return [
    { id: "v1", draft_id: "d1", shopify_variant_id: "gid://shopify/ProductVariant/1", option1_value: "悟空", option2_value: "現貨", option3_value: null, source_options: so(stock("sold_out", 0)) },
    { id: "v2", draft_id: "d1", shopify_variant_id: "gid://shopify/ProductVariant/2", option1_value: "貝吉塔", option2_value: null, option3_value: null, source_options: so(stock("sold_out", 0)) },
    { id: "v3", draft_id: "d1", shopify_variant_id: "gid://shopify/ProductVariant/3", option1_value: "弗利薩", option2_value: null, option3_value: null, source_options: so(stock("sold_out", 0)) },
    { id: "v4", draft_id: "d1", shopify_variant_id: null, option1_value: "比克", option2_value: null, option3_value: null, source_options: so(stock("sold_out", 0)) },
    { id: "v5", draft_id: "d1", shopify_variant_id: "gid://shopify/ProductVariant/5", option1_value: "布瑪", option2_value: null, option3_value: null, source_options: so(stock("in_stock", 40), SOLD_MARK) },
    { id: "v6", draft_id: "d1", shopify_variant_id: "gid://shopify/ProductVariant/6", option1_value: "克林", option2_value: null, option3_value: null, source_options: so(stock("in_stock", 40), SOLD_MARK) },
    { id: "v7", draft_id: "d1", shopify_variant_id: "gid://shopify/ProductVariant/7", option1_value: "天津飯", option2_value: null, option3_value: null, source_options: so(stock("in_stock", 3)) },
    { id: "v8", draft_id: "d1", shopify_variant_id: "gid://shopify/ProductVariant/8", option1_value: "飲茶", option2_value: null, option3_value: null, source_options: so(stock("unknown")) }
  ];
}

const level = (available) =>
  available === null ? { nodes: [] } : { nodes: [{ location: { id: LOC, name: "倉庫" }, quantities: [{ name: "available", quantity: available }] }] };
const rv = (n, policy, tracked, available) => ({
  id: "gid://shopify/ProductVariant/" + n,
  inventoryPolicy: policy,
  inventoryItem: { id: "gid://shopify/InventoryItem/" + n, tracked, inventoryLevels: level(available) }
});
function remoteVariants() {
  return [
    rv(1, "CONTINUE", false, 3),
    rv(2, "DENY", true, 0),
    rv(3, "CONTINUE", false, null),
    rv(5, "DENY", true, 0),
    rv(6, "CONTINUE", false, 0),
    rv(7, "CONTINUE", false, 0),
    rv(8, "CONTINUE", false, 0)
  ];
}
// planSourceStockSync takes the flat remote shape (already resolved to the configured location).
function flatRemote() {
  return remoteVariants().map((v) => {
    const q = v.inventoryItem.inventoryLevels.nodes[0]?.quantities[0]?.quantity;
    return { id: v.id, inventoryPolicy: v.inventoryPolicy, tracked: v.inventoryItem.tracked, available: Number.isInteger(q) ? q : null };
  });
}

function fakeDb(initial) {
  const tables = structuredClone(initial);
  const writes = [];
  function from(table) {
    const state = { action: "select", predicates: [], patch: null, single: false, maybe: false };
    const api = {
      select() { return api; },
      eq(key, value) { state.predicates.push((row) => row[key] === value); return api; },
      in(key, values) { state.predicates.push((row) => values.includes(row[key])); return api; },
      order() { return api; },
      single() { state.single = true; return api; },
      maybeSingle() { state.maybe = true; return api; },
      update(data) { state.action = "update"; state.patch = data; return api; },
      then(resolve, reject) {
        const all = tables[table] ?? (tables[table] = []);
        const rows = all.filter((row) => state.predicates.every((p) => p(row)));
        let response;
        if (state.action === "update") {
          for (const row of rows) Object.assign(row, structuredClone(state.patch));
          writes.push({ table, rows: rows.map((r) => r.id), patch: structuredClone(state.patch) });
          response = { data: state.single || state.maybe ? rows[0] ?? null : rows, error: null };
        } else {
          const visible = rows.map((r) => structuredClone(r));
          response = { data: state.single || state.maybe ? visible[0] ?? null : visible, error: null };
        }
        return Promise.resolve(response).then(resolve, reject);
      }
    };
    return api;
  }
  return { from, tables, writes };
}

function shopFake({ readError = null, readErrorOnCall = 1, userErrors = null, product = undefined } = {}) {
  const variants = remoteVariants();
  const calls = [];
  let reads = 0;
  const ok = (data) => ({ response: { ok: true, status: 200 }, result: { data } });
  const caller = async (query, variables) => {
    const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "unknown";
    calls.push({ name, variables: structuredClone(variables) });
    if (name === "ProductSourceStock") {
      reads++;
      if (readError && reads === readErrorOnCall) {
        return { response: { ok: true, status: 200 }, result: { errors: [{ message: readError, extensions: { code: "ACCESS_DENIED" } }] } };
      }
      if (product === null) return ok({ product: null });
      return ok({ product: { id: PRODUCT, variants: { nodes: structuredClone(variants) } } });
    }
    if (name === "SourceStockVariants") {
      if (userErrors) return ok({ productVariantsBulkUpdate: { productVariants: [], userErrors } });
      for (const input of variables.variants) {
        const v = variants.find((x) => x.id === input.id);
        if (input.inventoryPolicy) v.inventoryPolicy = input.inventoryPolicy;
        if (input.inventoryItem && "tracked" in input.inventoryItem) v.inventoryItem.tracked = input.inventoryItem.tracked;
        for (const adj of input.quantityAdjustments ?? []) {
          const q = v.inventoryItem.inventoryLevels.nodes[0].quantities[0];
          assert.equal(q.quantity, adj.changeFromQuantity, "changeFromQuantity must equal the current available");
          q.quantity += adj.adjustment;
        }
      }
      return ok({ productVariantsBulkUpdate: { productVariants: variables.variants.map((v) => ({ id: v.id })), userErrors: [] } });
    }
    throw new Error("unexpected GraphQL operation " + name);
  };
  return { caller, calls, variants };
}

function harness(opts = {}) {
  const db = fakeDb({
    product_drafts: [{ id: "d1", shopify_product_id: PRODUCT, shopify_sync_status: "synced", ...(opts.draft ?? {}) }],
    product_variants: localVariants()
  });
  const shop = shopFake(opts.shop);
  return { db, shop };
}
const run = (h, extra) =>
  runSourceStockSync({ serviceSupabase: h.db, draftId: "d1", now: NOW, deps: { callGraphQL: h.shop.caller, locationId: LOC }, ...extra });
const ids = (list) => list.map((a) => a.variantId).sort();

console.log("STOCK verifier");

await check("ST01 summarizeSourceStockForShopify counts sold-out-not-applied / restorable / low", () => {
  const s = summarizeSourceStockForShopify(localVariants());
  // sold_out & on Shopify & not marked: v1 v2 v3 (v4 has no shopify_variant_id)
  assert.deepEqual(s, { soldOut: 3, restorable: 2, low: 1 });
  assert.deepEqual(summarizeSourceStockForShopify([]), { soldOut: 0, restorable: 0, low: 0 });
});

await check("ST02 isSourceLowStock: in_stock with 1..5 left only", () => {
  assert.equal(isSourceLowStock(so(stock("in_stock", 5))), true);
  assert.equal(isSourceLowStock(so(stock("in_stock", 1))), true);
  assert.equal(isSourceLowStock(so(stock("in_stock", 6))), false);
  assert.equal(isSourceLowStock(so(stock("in_stock", 0))), false);
  assert.equal(isSourceLowStock(so(stock("in_stock", null))), false);
  assert.equal(isSourceLowStock(so(stock("sold_out", 0))), false);
  assert.equal(isSourceLowStock(null), false);
});

await check("ST03 readShopifyStockMark reads only well-formed marks", () => {
  assert.deepEqual(readShopifyStockMark(so(stock("in_stock"), SOLD_MARK)), SOLD_MARK);
  assert.equal(readShopifyStockMark(so(stock("in_stock"))), null);
  assert.equal(readShopifyStockMark({ shopify_stock: { applied: "weird" } }), null);
  assert.equal(readShopifyStockMark(null), null);
});

await check("ST04 planSourceStockSync decision matrix", () => {
  const plan = planSourceStockSync({ variants: localVariants(), remote: flatRemote() });
  assert.deepEqual(ids(plan.soldOut), ["v1"]);
  assert.deepEqual(ids(plan.restore), ["v5"]);
  const reasons = Object.fromEntries(plan.skipped.map((a) => [a.variantId, a.reason]));
  assert.deepEqual(reasons, { v2: "already_sold_out", v3: "no_level", v4: "not_on_shopify", v6: "manual_change" });
  const v1 = plan.soldOut[0];
  assert.equal(v1.label, "悟空／現貨");
  assert.equal(v1.shopifyVariantId, "gid://shopify/ProductVariant/1");
  assert.deepEqual(v1.prev, { policy: "CONTINUE", tracked: false, available: 3 });
  assert.deepEqual(plan.restore[0].to, SOLD_MARK.prev);
});

await check("ST05 preview reads Shopify once and never writes", async () => {
  const h = harness();
  const res = await run(h, { mode: "preview" });
  assert.equal(res.ok, true);
  assert.equal(res.mode, "preview");
  assert.deepEqual(ids(res.plan.soldOut), ["v1"]);
  assert.deepEqual(ids(res.plan.restore), ["v5"]);
  assert.deepEqual(h.shop.calls.map((c) => c.name), ["ProductSourceStock"]);
  assert.equal(h.shop.calls[0].variables.id, PRODUCT);
  assert.equal(h.db.writes.length, 0);
});

await check("ST06 apply sends exact inventory inputs, reads back, records marks", async () => {
  const h = harness();
  const res = await run(h, { mode: "apply", expectedVariantIds: ["v5", "v1"] });
  assert.equal(res.ok, true);
  assert.deepEqual(h.shop.calls.map((c) => c.name), ["ProductSourceStock", "SourceStockVariants", "ProductSourceStock"]);
  const m = h.shop.calls[1].variables;
  assert.equal(m.productId, PRODUCT);
  const byId = Object.fromEntries(m.variants.map((v) => [v.id, v]));
  assert.deepEqual(byId["gid://shopify/ProductVariant/1"], {
    id: "gid://shopify/ProductVariant/1",
    inventoryPolicy: "DENY",
    inventoryItem: { tracked: true },
    quantityAdjustments: [{ locationId: LOC, adjustment: -3, changeFromQuantity: 3 }]
  });
  assert.deepEqual(byId["gid://shopify/ProductVariant/5"], {
    id: "gid://shopify/ProductVariant/5",
    inventoryPolicy: "CONTINUE",
    inventoryItem: { tracked: false }
  });
  assert.equal(m.variants.length, 2, "only planned variants are sent");
  assert.deepEqual(res.applied, { soldOut: 1, restore: 1, failed: [] });
  const v1 = h.db.tables.product_variants.find((r) => r.id === "v1").source_options;
  assert.deepEqual(v1.shopify_stock, { applied: "sold_out", at: NOW, prev: { policy: "CONTINUE", tracked: false, available: 3 } });
  assert.deepEqual(v1.stock, stock("sold_out", 0), "source stock is preserved");
  const v5 = h.db.tables.product_variants.find((r) => r.id === "v5").source_options;
  assert.deepEqual(v5.shopify_stock, { applied: "restored", at: NOW, prev: null });
  assert.deepEqual(h.db.writes.map((w) => w.table), ["product_variants", "product_variants"]);
  assert.ok(h.db.writes.every((w) => Object.keys(w.patch).join() === "source_options"), "only source_options is written");
});

await check("ST07 restore of a tracked variant puts the old available back", async () => {
  const h = harness();
  const mark = { applied: "sold_out", at: "2026-10-21T00:00:00.000Z", prev: { policy: "DENY", tracked: true, available: 4 } };
  h.db.tables.product_variants.find((r) => r.id === "v5").source_options = so(stock("in_stock", 40), mark);
  const res = await run(h, { mode: "apply", expectedVariantIds: ["v1", "v5"] });
  assert.equal(res.ok, true);
  const input = h.shop.calls[1].variables.variants.find((v) => v.id === "gid://shopify/ProductVariant/5");
  assert.deepEqual(input, {
    id: "gid://shopify/ProductVariant/5",
    inventoryPolicy: "DENY",
    inventoryItem: { tracked: true },
    quantityAdjustments: [{ locationId: LOC, adjustment: 4, changeFromQuantity: 0 }]
  });
  assert.deepEqual(res.applied.failed, []);
});

await check("ST08 apply refuses when the plan changed since preview", async () => {
  const h = harness();
  const res = await run(h, { mode: "apply", expectedVariantIds: ["v1"] });
  assert.equal(res.ok, false);
  assert.equal(res.status, 409);
  assert.equal(res.code, "plan_changed");
  assert.deepEqual(h.shop.calls.map((c) => c.name), ["ProductSourceStock"]);
  assert.equal(h.db.writes.length, 0);
  const missing = await run(harness(), { mode: "apply" });
  assert.equal(missing.code, "plan_changed", "apply without expectedVariantIds is refused");
});

await check("ST09 missing read_inventory → inventory_read_failed, nothing written", async () => {
  const h = harness({ shop: { readError: "Access denied for inventoryLevels field." } });
  const res = await run(h, { mode: "apply", expectedVariantIds: ["v1", "v5"] });
  assert.equal(res.ok, false);
  assert.equal(res.status, 502);
  assert.equal(res.code, "inventory_read_failed");
  assert.match(res.error, /read_inventory/);
  assert.deepEqual(h.shop.calls.map((c) => c.name), ["ProductSourceStock"]);
  assert.equal(h.db.writes.length, 0);
});

await check("ST10 Shopify userErrors → failed list, no marks recorded", async () => {
  const h = harness({ shop: { userErrors: [{ field: ["variants"], message: "Access denied for write_inventory" }] } });
  const res = await run(h, { mode: "apply", expectedVariantIds: ["v1", "v5"] });
  assert.equal(res.ok, true);
  assert.deepEqual(res.applied.soldOut, 0);
  assert.deepEqual(res.applied.restore, 0);
  assert.deepEqual(res.applied.failed.map((f) => f.variantId).sort(), ["v1", "v5"]);
  assert.ok(res.applied.failed.every((f) => /write_inventory/.test(f.message)));
  assert.equal(h.db.writes.length, 0);
});

await check("ST11 readback failure after the write → inventory_read_failed, no marks", async () => {
  const h = harness({ shop: { readError: "timeout", readErrorOnCall: 2 } });
  const res = await run(h, { mode: "apply", expectedVariantIds: ["v1", "v5"] });
  assert.equal(res.ok, false);
  assert.equal(res.code, "inventory_read_failed");
  assert.match(res.error, /重新檢查/);
  assert.equal(h.db.writes.length, 0);
});

await check("ST12 guards: location / mock / not published / remote deleted", async () => {
  const h1 = harness();
  const r1 = await runSourceStockSync({ serviceSupabase: h1.db, draftId: "d1", mode: "preview", now: NOW, deps: { callGraphQL: h1.shop.caller, locationId: null } });
  assert.equal(r1.code, "location_required");
  assert.equal(r1.status, 409);
  assert.equal(h1.shop.calls.length, 0);

  const prevMock = process.env.SHOPIFY_PUBLISH_MOCK;
  process.env.SHOPIFY_PUBLISH_MOCK = "true";
  const h2 = harness();
  const r2 = await runSourceStockSync({ serviceSupabase: h2.db, draftId: "d1", mode: "preview", now: NOW });
  if (prevMock === undefined) delete process.env.SHOPIFY_PUBLISH_MOCK; else process.env.SHOPIFY_PUBLISH_MOCK = prevMock;
  assert.equal(r2.code, "mock_mode");

  const h3 = harness({ draft: { shopify_product_id: null } });
  assert.equal((await run(h3, { mode: "preview" })).code, "not_published");
  const h4 = harness({ draft: { shopify_sync_status: "remote_deleted" } });
  assert.equal((await run(h4, { mode: "preview" })).code, "remote_deleted");
  const h5 = harness({ shop: { product: null } });
  assert.equal((await run(h5, { mode: "preview" })).code, "remote_deleted");
  assert.equal(h3.shop.calls.length + h4.shop.calls.length, 0);
});

await check("ST13 GraphQL documents: names, fields, no other inventory mutations", () => {
  assert.match(SOURCE_STOCK_QUERY, /query ProductSourceStock\(\$id: ID!\)/);
  for (const field of ["inventoryPolicy", "tracked", "inventoryLevels", 'quantities(names: ["available"])', "location"]) {
    assert.ok(SOURCE_STOCK_QUERY.includes(field), "query must read " + field);
  }
  assert.match(SOURCE_STOCK_MUTATION, /mutation SourceStockVariants\(\$productId: ID!, \$variants: \[ProductVariantsBulkInput!\]!\)/);
  assert.match(SOURCE_STOCK_MUTATION, /productVariantsBulkUpdate\(productId: \$productId, variants: \$variants\)/);
  assert.match(SOURCE_STOCK_MUTATION, /userErrors \{ field message \}/);
  const file = read("src/lib/shopify/sourceStockSync.ts");
  assert.doesNotMatch(file, /inventorySetQuantities|inventoryAdjustQuantities|inventoryActivate|productDelete|productVariantsBulkDelete/);
  assert.doesNotMatch(file, /\bprice\b\s*:/, "stock sync never sends prices");
});

await check("ST14 full sync no longer touches inventory of unlimited variants", () => {
  const seed = (policy, qty) => ({
    optionValues: [{ optionName: "款式", name: "A" }],
    price: 390, compareAtPrice: null, cost: 120, sku: "NS-abc123-01",
    inventoryQuantity: qty, inventoryPolicy: policy, imageId: null
  });
  const remote = rv(1, "DENY", true, 0); // e.g. the owner marked it sold out in Shopify admin
  const unlimited = buildVariantUpdateInput({ row: null, seed: seed("CONTINUE", null), remote: { ...remote, sku: "", price: "390", compareAtPrice: null, selectedOptions: [] } }, LOC);
  assert.equal("inventoryPolicy" in unlimited, false, "unlimited rows must not send inventoryPolicy");
  assert.deepEqual(unlimited.inventoryItem, { sku: "NS-abc123-01", cost: "120" });
  assert.equal("quantityAdjustments" in unlimited, false);
  const finite = buildVariantUpdateInput({ row: null, seed: seed("DENY", 5), remote: { ...remote, sku: "", price: "390", compareAtPrice: null, selectedOptions: [] } }, LOC);
  assert.equal(finite.inventoryPolicy, "DENY");
  assert.deepEqual(finite.inventoryItem, { sku: "NS-abc123-01", cost: "120", tracked: true });
  assert.deepEqual(finite.quantityAdjustments, [{ locationId: LOC, adjustment: 5, changeFromQuantity: 0 }]);
  const sync = read("src/lib/shopify/syncShopifyProduct.ts");
  assert.match(sync, /desired\.seed\.inventoryPolicy === "DENY" && match\.inventoryPolicy !== "DENY"/, "readback compares policy only for finite rows");
  assert.doesNotMatch(sync, /if \(match\.inventoryPolicy !== desired\.seed\.inventoryPolicy\)/);
});

await check("ST15 first publish / new variants: source sold-out → DENY with 0", () => {
  const row = (id, sortOrder, sourceOptions) => ({
    id, draft_id: "d1", sort_order: sortOrder, option1_name: "款式", option1_value: id, option2_name: null, option2_value: null,
    option3_name: null, option3_value: null, twd_price: 390, compare_at_price: null, cny_price: 30, sku: "NS-abc123-0" + sortOrder,
    inventory_policy: "continue", inventory_quantity: 0, image_id: null, source_options: sourceOptions
  });
  const plan = buildVariantPublishPlan([row("A", 1, so(stock("in_stock", 9))), row("B", 2, so(stock("sold_out", 0)))], { cny_price: 30, price_mode: "single" });
  assert.equal(plan.mode, "multi");
  assert.equal(plan.all[0].inventoryPolicy, "CONTINUE");
  assert.equal(plan.all[0].inventoryQuantity, null);
  assert.equal(plan.all[1].inventoryPolicy, "DENY");
  assert.equal(plan.all[1].inventoryQuantity, 0);
});

await check("ST16 API route: reviewer only, server-side plan, preview/apply", () => {
  const route = read("src/app/api/drafts/[id]/shopify-stock/route.ts");
  assert.match(route, /canPublish\(/);
  assert.match(route, /runSourceStockSync\(/);
  assert.match(route, /maxDuration = \d+/);
  assert.match(route, /mode === "apply" \? "apply" : "preview"|body\.mode === "apply"/);
  assert.match(route, /Array\.isArray\(body\.expectedVariantIds\)/);
  assert.doesNotMatch(route, /shopify_variant_id|variantIds\s*:\s*body/, "never trust Shopify IDs from the browser");
});

await check("ST17 migration: variant bookkeeping in source_options no longer marks the draft dirty", () => {
  const dir = "supabase/migrations";
  const file = fs.readdirSync(path.join(root, dir)).find((name) => /^\d{14}_stock_source_options_not_dirty\.sql$/.test(name));
  assert.ok(file, "missing supabase/migrations/<timestamp>_stock_source_options_not_dirty.sql");
  const sql = read(path.join(dir, file));
  assert.match(sql, /create or replace function public\.mark_linked_product_child_dirty\(\)/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = public/);
  assert.match(sql, /tg_table_name = 'product_variants'/);
  assert.match(sql, /to_jsonb\(new\) - 'source_options'/);
  assert.match(sql, /to_jsonb\(old\) - 'source_options'/);
  assert.doesNotMatch(sql, /drop trigger|create trigger/i, "only the function body changes");
});

await check("ST18 UI wiring (exact copy, existing classes only)", () => {
  const controls = read("src/components/listing/ShopifySyncControls.tsx");
  for (const text of ["來源庫存同步到 Shopify", "確認套用", "重新檢查", "/shopify-stock", "設為售完", "恢復可賣", "來源補貨"]) {
    assert.ok(controls.includes(text), "ShopifySyncControls missing: " + text);
  }
  assert.match(controls, /sourceStockSummary/);
  const card = read("src/components/listing/ResultCard.tsx");
  assert.match(card, /summarizeSourceStockForShopify\(/);
  assert.match(card, /sourceStockSummary=\{/);
  const editor = read("src/components/listing/VariantEditorRender.tsx");
  assert.match(editor, /isSourceLowStock\(/);
  assert.match(editor, /來源剩/);
  assert.match(editor, /Shopify 已設售完/);
  for (const file of ["src/components/listing/ShopifySyncControls.tsx", "src/components/listing/VariantEditorRender.tsx"]) {
    assert.doesNotMatch(read(file), /!important|style=\{\{/, file + ": no inline styles / !important");
  }
});

await check("ST19 registered in verify:all and package.json", () => {
  assert.match(read("scripts/verify-all.mjs"), /"scripts\/verify-stock\.mjs"/);
  assert.match(read("package.json"), /"verify:stock": "node scripts\/verify-stock\.mjs"/);
});

if (failed.length) {
  console.error(`\nSTOCK: ${failed.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\nSTOCK: all ${passed} checks passed`);
