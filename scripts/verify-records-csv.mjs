#!/usr/bin/env node
// RECORDS-CSV acceptance checks — written by Claude BEFORE construction
// (spec: docs/RECORDS-CSV-施工規格-2026-10-22.md).
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
const exists = (name) => fs.existsSync(path.join(root, name));

const {
  SHOPIFY_CSV_COLUMNS,
  buildShopifyProductCsv,
  normalizeShopifyProductGid,
  sumAvailableByVariant,
  shopifyCsvFilename
} = await import(src("src/lib/csv/shopifyProductCsv.ts"));
const { collectShopifyCsvProducts, shopifyCsvExportNote } = await import(
  src("src/lib/csv/shopifyCsvExport.ts")
);
const {
  BATCH_KIND_FILTERS,
  batchKindLabel,
  batchKindIcon,
  batchCardTitle,
  formatExportHistory
} = await import(src("src/lib/drafts/publishRecords.ts"));
const { recordCsvExportBatch } = await import(src("src/lib/drafts/recordCsvExportBatch.ts"));
const { PRODUCT_SYNC_SNAPSHOT_QUERY, PRODUCT_SYNC_INVENTORY_QUERY } = await import(
  src("src/lib/shopify/fullSyncGraphQL.ts")
);

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

/** Minimal RFC 4180 parser (quoted fields may contain commas, quotes, newlines). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let quoted = false;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      quoted = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  row.push(field);
  rows.push(row);
  return rows;
}

function csvObjects(text) {
  assert.equal(text.charCodeAt(0), 0xfeff, "CSV must start with UTF-8 BOM");
  const rows = parseCsv(text.slice(1));
  const header = rows[0];
  return {
    header,
    rows: rows.slice(1).map((r) => {
      assert.equal(r.length, header.length, "every row must have the same column count as header");
      return Object.fromEntries(header.map((h, idx) => [h, r[idx]]));
    })
  };
}

const EXPECTED_COLUMNS = [
  "Handle",
  "Title",
  "Body (HTML)",
  "Vendor",
  "Product Category",
  "Type",
  "Tags",
  "Published",
  "Option1 Name",
  "Option1 Value",
  "Option2 Name",
  "Option2 Value",
  "Option3 Name",
  "Option3 Value",
  "Variant SKU",
  "Variant Grams",
  "Variant Inventory Tracker",
  "Variant Inventory Qty",
  "Variant Inventory Policy",
  "Variant Fulfillment Service",
  "Variant Price",
  "Variant Compare At Price",
  "Variant Requires Shipping",
  "Variant Taxable",
  "Variant Barcode",
  "Image Src",
  "Image Position",
  "Image Alt Text",
  "Gift Card",
  "SEO Title",
  "SEO Description",
  "Variant Image",
  "Variant Weight Unit",
  "Cost per item",
  "Status"
];

const PRODUCT_LEVEL = [
  "Title",
  "Body (HTML)",
  "Vendor",
  "Product Category",
  "Type",
  "Tags",
  "Published",
  "Option1 Name",
  "Option2 Name",
  "Option3 Name",
  "Gift Card",
  "SEO Title",
  "SEO Description",
  "Status"
];

function variant(id, sku, price, opts, extra = {}) {
  return {
    id: `gid://shopify/ProductVariant/${id}`,
    title: opts.map((o) => o[1]).join(" / "),
    sku,
    price,
    compareAtPrice: extra.compareAtPrice ?? null,
    inventoryPolicy: extra.inventoryPolicy ?? "DENY",
    selectedOptions: opts.map(([name, value]) => ({ name, value })),
    inventoryItem: extra.noItem
      ? null
      : {
          id: `gid://shopify/InventoryItem/${id}`,
          tracked: extra.tracked ?? true,
          unitCost: extra.cost ? { amount: extra.cost, currencyCode: "TWD" } : null
        }
  };
}

function image(id, url, alt) {
  return { id: `gid://shopify/MediaImage/${id}`, alt, mediaContentType: "IMAGE", status: "READY", image: { url } };
}

const MULTI = {
  id: "gid://shopify/Product/100",
  title: "吉伊卡哇 小八 吊飾",
  handle: "chiikawa-hachiware-charm",
  descriptionHtml: '<p>可愛"小八"，附吊繩,\n兩款可選</p>',
  vendor: "Chiikawa",
  productType: "吊飾",
  tags: ["吉伊卡哇", "小八", "吊飾"],
  status: "ACTIVE",
  updatedAt: "2026-10-22T06:00:00Z",
  seo: { title: "小八吊飾 SEO", description: "SEO 描述" },
  category: { id: "gid://shopify/TaxonomyCategory/tg-5-1", name: "Keychains" },
  variants: {
    nodes: [
      variant(1, "CK-HA-A", "390.00", [["款式", "A 款"], ["尺寸", "小"]], {
        compareAtPrice: "450.00",
        cost: "120.0"
      }),
      variant(2, "CK-HA-B", "420.00", [["款式", "B 款"], ["尺寸", "大"]], {
        inventoryPolicy: "CONTINUE",
        tracked: false
      })
    ]
  },
  media: {
    nodes: [
      image(11, "https://cdn.shopify.com/a.webp", "主圖"),
      { id: "gid://shopify/Video/12", alt: null, mediaContentType: "VIDEO", status: "READY" },
      image(13, "https://cdn.shopify.com/b.webp", null),
      image(14, "https://cdn.shopify.com/c.webp", "第三張")
    ]
  },
  metafields: { nodes: [] }
};

const SINGLE = {
  id: "gid://shopify/Product/200",
  title: "米飛兔 掛毯",
  handle: "miffy-tapestry",
  descriptionHtml: "<p>掛毯</p>",
  vendor: "Miffy",
  productType: "",
  tags: [],
  status: "DRAFT",
  updatedAt: "2026-10-22T06:00:00Z",
  seo: { title: null, description: null },
  category: null,
  variants: { nodes: [variant(3, "", "690.00", [["Title", "Default Title"]])] },
  media: { nodes: [] },
  metafields: { nodes: [] }
};

console.log("RECORDS-CSV verify");

// ---------- RC01–RC10: pure Shopify CSV builder ----------

await check("RC01 SHOPIFY_CSV_COLUMNS is the exact Shopify product CSV header in order", () => {
  assert.deepEqual([...SHOPIFY_CSV_COLUMNS], EXPECTED_COLUMNS);
});

await check("RC02 BOM + header line unquoted + values all quoted + \\n line endings", () => {
  const csv = buildShopifyProductCsv([{ product: SINGLE }]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const firstLine = csv.slice(1).split("\n")[0];
  assert.equal(firstLine, EXPECTED_COLUMNS.join(","));
  assert.ok(!csv.includes("\r\n"), "must use \\n, not \\r\\n");
  const secondLine = csv.slice(1).split("\n")[1];
  assert.ok(secondLine.startsWith('"miffy-tapestry",'), "values must be wrapped in double quotes");
  assert.ok(secondLine.includes('""'), "empty values must still be quoted as \"\"");
});

await check("RC03 multi-variant: one row per variant, product-level fields only on first row", () => {
  const { rows } = csvObjects(buildShopifyProductCsv([{ product: MULTI }]));
  assert.equal(rows.length, 3, "2 variants + 1 image-only row (3 images)");
  assert.equal(rows[0].Handle, "chiikawa-hachiware-charm");
  assert.equal(rows[1].Handle, "chiikawa-hachiware-charm");
  assert.equal(rows[0].Title, "吉伊卡哇 小八 吊飾");
  assert.equal(rows[0]["Body (HTML)"], '<p>可愛"小八"，附吊繩,\n兩款可選</p>', "quotes/commas/newlines round-trip");
  assert.equal(rows[0].Vendor, "Chiikawa");
  assert.equal(rows[0].Type, "吊飾");
  assert.equal(rows[0].Tags, "吉伊卡哇, 小八, 吊飾");
  assert.equal(rows[0]["Option1 Name"], "款式");
  assert.equal(rows[0]["Option2 Name"], "尺寸");
  assert.equal(rows[0]["Option3 Name"], "");
  for (const col of PRODUCT_LEVEL) {
    assert.equal(rows[1][col], "", `row 2 must leave product-level column "${col}" empty`);
  }
});

await check("RC04 variant fields mapped per row", () => {
  const { rows } = csvObjects(buildShopifyProductCsv([{ product: MULTI }]));
  const [a, b] = rows;
  assert.equal(a["Option1 Value"], "A 款");
  assert.equal(a["Option2 Value"], "小");
  assert.equal(b["Option1 Value"], "B 款");
  assert.equal(b["Option2 Value"], "大");
  assert.equal(a["Option3 Value"], "");
  assert.equal(a["Variant SKU"], "CK-HA-A");
  assert.equal(a["Variant Price"], "390.00");
  assert.equal(a["Variant Compare At Price"], "450.00");
  assert.equal(b["Variant Compare At Price"], "");
  assert.equal(a["Variant Inventory Tracker"], "shopify");
  assert.equal(b["Variant Inventory Tracker"], "", "untracked → empty tracker");
  assert.equal(a["Variant Inventory Policy"], "deny");
  assert.equal(b["Variant Inventory Policy"], "continue");
  assert.equal(a["Variant Fulfillment Service"], "manual");
  assert.equal(a["Variant Requires Shipping"], "TRUE");
  assert.equal(a["Variant Taxable"], "TRUE");
  assert.equal(a["Variant Grams"], "");
  assert.equal(a["Variant Barcode"], "");
  assert.equal(a["Variant Image"], "");
  assert.equal(a["Variant Weight Unit"], "");
  assert.equal(a["Cost per item"], "120.0");
  assert.equal(b["Cost per item"], "");
});

await check("RC05 product flags: Published / Status / Gift Card / SEO / Category id", () => {
  const multi = csvObjects(buildShopifyProductCsv([{ product: MULTI }])).rows[0];
  assert.equal(multi.Published, "TRUE");
  assert.equal(multi.Status, "active");
  assert.equal(multi["Gift Card"], "FALSE");
  assert.equal(multi["SEO Title"], "小八吊飾 SEO");
  assert.equal(multi["SEO Description"], "SEO 描述");
  assert.equal(multi["Product Category"], "tg-5-1", "TaxonomyCategory gid → trailing id");
  const single = csvObjects(buildShopifyProductCsv([{ product: SINGLE }])).rows[0];
  assert.equal(single.Published, "FALSE");
  assert.equal(single.Status, "draft");
  assert.equal(single["Product Category"], "");
  assert.equal(single["SEO Title"], "");
  assert.equal(single.Tags, "");
  const archived = csvObjects(
    buildShopifyProductCsv([{ product: { ...SINGLE, status: "ARCHIVED" } }])
  ).rows[0];
  assert.equal(archived.Status, "archived");
  assert.equal(archived.Published, "FALSE");
});

await check("RC06 images: only IMAGE media; image k on row k; extra images get image-only rows", () => {
  const { rows } = csvObjects(buildShopifyProductCsv([{ product: MULTI }]));
  assert.equal(rows[0]["Image Src"], "https://cdn.shopify.com/a.webp");
  assert.equal(rows[0]["Image Position"], "1");
  assert.equal(rows[0]["Image Alt Text"], "主圖");
  assert.equal(rows[1]["Image Src"], "https://cdn.shopify.com/b.webp", "video skipped");
  assert.equal(rows[1]["Image Position"], "2");
  assert.equal(rows[1]["Image Alt Text"], "", "null alt → empty");
  const extra = rows[2];
  assert.equal(extra.Handle, "chiikawa-hachiware-charm");
  assert.equal(extra["Image Src"], "https://cdn.shopify.com/c.webp");
  assert.equal(extra["Image Position"], "3");
  assert.equal(extra["Image Alt Text"], "第三張");
  for (const col of EXPECTED_COLUMNS) {
    if (["Handle", "Image Src", "Image Position", "Image Alt Text"].includes(col)) continue;
    assert.equal(extra[col], "", `image-only row must leave "${col}" empty`);
  }
});

await check("RC07 single Default Title variant keeps Title/Default Title option", () => {
  const { rows } = csvObjects(buildShopifyProductCsv([{ product: SINGLE }]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]["Option1 Name"], "Title");
  assert.equal(rows[0]["Option1 Value"], "Default Title");
  assert.equal(rows[0]["Variant SKU"], "");
  assert.equal(rows[0]["Image Src"], "");
  assert.equal(rows[0]["Image Position"], "");
});

await check("RC08 inventory qty from availableByVariantId; missing map / missing id → empty", () => {
  const withQty = csvObjects(
    buildShopifyProductCsv([
      {
        product: MULTI,
        availableByVariantId: { "gid://shopify/ProductVariant/1": 7 }
      }
    ])
  ).rows;
  assert.equal(withQty[0]["Variant Inventory Qty"], "7");
  assert.equal(withQty[1]["Variant Inventory Qty"], "", "variant not in map → empty");
  const zero = csvObjects(
    buildShopifyProductCsv([
      { product: MULTI, availableByVariantId: { "gid://shopify/ProductVariant/1": 0 } }
    ])
  ).rows;
  assert.equal(zero[0]["Variant Inventory Qty"], "0", "0 must print as 0, not empty");
  const none = csvObjects(buildShopifyProductCsv([{ product: MULTI, availableByVariantId: null }])).rows;
  assert.equal(none[0]["Variant Inventory Qty"], "");
});

await check("RC09 several products concatenate in input order; zero-variant product still emits one row", () => {
  const empty = { ...SINGLE, handle: "empty-product", variants: { nodes: [] } };
  const { rows } = csvObjects(
    buildShopifyProductCsv([{ product: SINGLE }, { product: MULTI }, { product: empty }])
  );
  assert.deepEqual(
    rows.map((r) => r.Handle),
    ["miffy-tapestry", "chiikawa-hachiware-charm", "chiikawa-hachiware-charm", "chiikawa-hachiware-charm", "empty-product"]
  );
  const last = rows[4];
  assert.equal(last.Title, "米飛兔 掛毯");
  assert.equal(last["Variant SKU"], "");
  assert.equal(last["Variant Price"], "");
  assert.equal(last["Option1 Name"], "");
  assert.equal(last["Variant Fulfillment Service"], "", "no variant → no variant defaults");
  assert.equal(last["Variant Requires Shipping"], "");
});

await check("RC10 empty input → header only", () => {
  const csv = buildShopifyProductCsv([]);
  assert.equal(csv, "﻿" + EXPECTED_COLUMNS.join(","));
});

// ---------- RC11–RC13: small helpers ----------

await check("RC11 normalizeShopifyProductGid", () => {
  assert.equal(normalizeShopifyProductGid("8821"), "gid://shopify/Product/8821");
  assert.equal(normalizeShopifyProductGid(8821), "gid://shopify/Product/8821");
  assert.equal(normalizeShopifyProductGid(" gid://shopify/Product/8821 "), "gid://shopify/Product/8821");
  assert.equal(normalizeShopifyProductGid(""), null);
  assert.equal(normalizeShopifyProductGid(null), null);
  assert.equal(normalizeShopifyProductGid(undefined), null);
  assert.equal(normalizeShopifyProductGid("abc"), null);
  assert.equal(normalizeShopifyProductGid("gid://shopify/ProductVariant/1"), null);
});

await check("RC12 sumAvailableByVariant sums 'available' across locations", () => {
  const product = {
    variants: {
      nodes: [
        {
          id: "gid://shopify/ProductVariant/1",
          inventoryItem: {
            id: "gid://shopify/InventoryItem/1",
            inventoryLevels: {
              nodes: [
                { location: { id: "L1", name: "A" }, quantities: [{ name: "available", quantity: 3 }] },
                { location: { id: "L2", name: "B" }, quantities: [{ name: "available", quantity: 4 }] }
              ]
            }
          }
        },
        {
          id: "gid://shopify/ProductVariant/2",
          inventoryItem: { id: "gid://shopify/InventoryItem/2", inventoryLevels: { nodes: [] } }
        },
        { id: "gid://shopify/ProductVariant/3", inventoryItem: null }
      ]
    }
  };
  assert.deepEqual(sumAvailableByVariant(product), {
    "gid://shopify/ProductVariant/1": 7,
    "gid://shopify/ProductVariant/2": 0
  });
  assert.deepEqual(sumAvailableByVariant(null), {});
});

await check("RC13 shopifyCsvFilename uses Asia/Taipei time", () => {
  assert.equal(
    shopifyCsvFilename(new Date("2026-10-22T07:30:00.000Z")),
    "nestory-shopify-20261022-1530.csv"
  );
  assert.equal(
    shopifyCsvFilename(new Date("2026-12-31T16:05:00.000Z")),
    "nestory-shopify-20270101-0005.csv",
    "crosses midnight in Taipei"
  );
});

// ---------- RC14–RC18: collectShopifyCsvProducts (read-only, fake caller) ----------

function fakeCaller({ products = {}, inventory = {}, failSnapshot = new Set(), throwSnapshot = new Set(), inventoryMode = "ok" } = {}) {
  const calls = [];
  const caller = async (query, variables) => {
    calls.push({ query, variables });
    const id = variables.id;
    if (query === PRODUCT_SYNC_SNAPSHOT_QUERY) {
      if (throwSnapshot.has(id)) throw new Error("network down");
      if (failSnapshot.has(id)) {
        return { response: { ok: false, status: 500 }, result: { errors: [{ message: "boom" }] } };
      }
      return { response: { ok: true, status: 200 }, result: { data: { product: products[id] ?? null } } };
    }
    if (query === PRODUCT_SYNC_INVENTORY_QUERY) {
      if (inventoryMode === "denied") {
        return {
          response: { ok: true, status: 200 },
          result: { errors: [{ message: "Access denied for inventoryLevels field.", extensions: { code: "ACCESS_DENIED" } }] }
        };
      }
      if (inventoryMode === "throw") throw new Error("inventory network down");
      return { response: { ok: true, status: 200 }, result: { data: { product: inventory[id] ?? null } } };
    }
    throw new Error("unexpected query: only the two read queries are allowed");
  };
  return { caller, calls };
}

const INV_100 = {
  variants: {
    nodes: [
      {
        id: "gid://shopify/ProductVariant/1",
        inventoryItem: {
          id: "gid://shopify/InventoryItem/1",
          inventoryLevels: { nodes: [{ location: { id: "L1", name: "A" }, quantities: [{ name: "available", quantity: 5 }] }] }
        }
      }
    ]
  }
};

const DRAFTS = [
  { draftId: "d-multi", title: "吉伊卡哇 小八 吊飾", shopifyProductId: "100" },
  { draftId: "d-none", title: "還沒上架的", shopifyProductId: null },
  { draftId: "d-gone", title: "被刪掉的", shopifyProductId: "gid://shopify/Product/999" },
  { draftId: "d-single", title: "米飛兔 掛毯", shopifyProductId: "gid://shopify/Product/200" }
];

await check("RC14 collects in input order; skips no-id / not-found with reasons", async () => {
  const { caller } = fakeCaller({
    products: { "gid://shopify/Product/100": MULTI, "gid://shopify/Product/200": SINGLE },
    inventory: { "gid://shopify/Product/100": INV_100 }
  });
  const res = await collectShopifyCsvProducts(DRAFTS, caller);
  assert.deepEqual(res.items.map((i) => i.product.handle), ["chiikawa-hachiware-charm", "miffy-tapestry"]);
  assert.deepEqual(res.exported, [
    { draftId: "d-multi", title: "吉伊卡哇 小八 吊飾" },
    { draftId: "d-single", title: "米飛兔 掛毯" }
  ]);
  assert.deepEqual(res.skipped, [
    { draftId: "d-none", title: "還沒上架的", reason: "還沒在 Shopify 上" },
    { draftId: "d-gone", title: "被刪掉的", reason: "Shopify 找不到這個商品" }
  ]);
  assert.deepEqual(res.items[0].availableByVariantId, { "gid://shopify/ProductVariant/1": 5 });
  assert.equal(res.inventoryNote, null);
});

await check("RC15 snapshot error / non-ok / throw → skipped 'Shopify 讀取失敗', others still export", async () => {
  const { caller } = fakeCaller({
    products: {
      "gid://shopify/Product/100": MULTI,
      "gid://shopify/Product/200": SINGLE,
      "gid://shopify/Product/300": { ...SINGLE, handle: "ok-product" }
    },
    failSnapshot: new Set(["gid://shopify/Product/100"]),
    throwSnapshot: new Set(["gid://shopify/Product/200"])
  });
  const res = await collectShopifyCsvProducts(
    [DRAFTS[0], DRAFTS[3], { draftId: "d-ok", title: "OK", shopifyProductId: "300" }],
    caller
  );
  assert.deepEqual(res.skipped.map((s) => [s.draftId, s.reason]), [
    ["d-multi", "Shopify 讀取失敗"],
    ["d-single", "Shopify 讀取失敗"]
  ]);
  assert.deepEqual(res.items.map((i) => i.product.handle), ["ok-product"]);
});

await check("RC16 inventory ACCESS_DENIED or throw → qty map null + inventoryNote, product still exported", async () => {
  for (const mode of ["denied", "throw"]) {
    const { caller } = fakeCaller({
      products: { "gid://shopify/Product/100": MULTI },
      inventoryMode: mode
    });
    const res = await collectShopifyCsvProducts([DRAFTS[0]], caller);
    assert.equal(res.items.length, 1, mode);
    assert.equal(res.items[0].availableByVariantId, null, mode);
    assert.equal(res.inventoryNote, "庫存欄留空（Shopify 權限不足或讀取失敗）", mode);
  }
});

await check("RC17 only the two read queries are sent; no-id drafts make zero calls", async () => {
  const { caller, calls } = fakeCaller({ products: { "gid://shopify/Product/100": MULTI } });
  await collectShopifyCsvProducts([DRAFTS[1]], caller);
  assert.equal(calls.length, 0);
  await collectShopifyCsvProducts([DRAFTS[0]], caller);
  for (const c of calls) {
    assert.ok(
      c.query === PRODUCT_SYNC_SNAPSHOT_QUERY || c.query === PRODUCT_SYNC_INVENTORY_QUERY,
      "must reuse the validated read queries verbatim"
    );
    assert.ok(!/mutation/i.test(c.query));
    assert.equal(c.variables.id, "gid://shopify/Product/100");
  }
});

await check("RC18 concurrency is capped at 4 in-flight product reads", async () => {
  let inFlight = 0;
  let peak = 0;
  const caller = async (query, variables) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    if (query === PRODUCT_SYNC_SNAPSHOT_QUERY) {
      return { response: { ok: true, status: 200 }, result: { data: { product: { ...SINGLE, id: variables.id, handle: variables.id } } } };
    }
    return { response: { ok: true, status: 200 }, result: { data: { product: null } } };
  };
  const drafts = Array.from({ length: 12 }, (_, i) => ({ draftId: `d${i}`, title: `T${i}`, shopifyProductId: String(i + 1) }));
  const res = await collectShopifyCsvProducts(drafts, caller);
  assert.equal(res.items.length, 12);
  assert.deepEqual(
    res.items.map((i) => i.product.handle),
    drafts.map((d) => `gid://shopify/Product/${d.shopifyProductId}`),
    "output order = input order even when concurrent"
  );
  assert.ok(peak <= 4, `peak in-flight ${peak} > 4`);
  assert.ok(peak >= 2, "must actually run reads concurrently (peak >= 2)");
});

await check("RC19 shopifyCsvExportNote", () => {
  assert.equal(
    shopifyCsvExportNote({ exported: [{}, {}], skipped: [], inventoryNote: null }),
    "已下載 2 件"
  );
  assert.equal(
    shopifyCsvExportNote({
      exported: [{}],
      skipped: [
        { reason: "還沒在 Shopify 上" },
        { reason: "還沒在 Shopify 上" },
        { reason: "Shopify 找不到這個商品" }
      ],
      inventoryNote: "庫存欄留空（Shopify 權限不足或讀取失敗）"
    }),
    "已下載 1 件；略過 3 件（還沒在 Shopify 上 2、Shopify 找不到這個商品 1）；庫存欄留空（Shopify 權限不足或讀取失敗）"
  );
});

// ---------- RC20–RC23: records helpers ----------

await check("RC20 BATCH_KIND_FILTERS adds Shopify CSV after Matrixify", () => {
  assert.deepEqual(
    BATCH_KIND_FILTERS.map((k) => [k.key, k.label]),
    [
      ["all", "全部"],
      ["shopify_api", "Shopify API"],
      ["showmore", "Showmore"],
      ["matrixify", "Matrixify"],
      ["shopify_csv", "Shopify CSV"]
    ]
  );
});

await check("RC21 batchKindLabel / batchKindIcon / batchCardTitle by kind", () => {
  assert.equal(batchKindLabel("shopify_api"), "Shopify 發布");
  assert.equal(batchKindLabel("showmore"), "Showmore CSV");
  assert.equal(batchKindLabel("matrixify"), "Matrixify CSV");
  assert.equal(batchKindLabel("shopify_csv"), "Shopify CSV");
  assert.equal(batchKindLabel("weird"), "weird");
  assert.equal(batchKindIcon("shopify_api"), "🛍");
  assert.equal(batchKindIcon("showmore"), "⬇");
  assert.equal(batchKindIcon("matrixify"), "⬇");
  assert.equal(batchKindIcon("shopify_csv"), "⬇");
  assert.equal(batchCardTitle({ kind: "showmore", publish_mode: "draft" }), "匯出 Showmore CSV");
  assert.equal(batchCardTitle({ kind: "matrixify", publish_mode: "draft" }), "匯出 Matrixify CSV");
  assert.equal(batchCardTitle({ kind: "shopify_csv", publish_mode: "draft" }), "下載 Shopify CSV");
  // shopify_api keeps the existing publishBatchTitle wording (unchanged behaviour).
  const apiDraft = batchCardTitle({ kind: "shopify_api", publish_mode: "draft" });
  const apiActive = batchCardTitle({ kind: "shopify_api", publish_mode: "active" });
  assert.ok(apiDraft && apiActive && apiDraft !== apiActive);
  assert.ok(!/CSV/.test(apiDraft) && !/CSV/.test(apiActive));
});

await check("RC22 formatExportHistory: newest first, max 3, Taipei MM/DD HH:mm, total count", () => {
  assert.equal(formatExportHistory([]), null);
  assert.equal(
    formatExportHistory([{ kind: "showmore", at: "2026-10-21T01:10:00.000Z" }]),
    "紀錄：Showmore CSV 10/21 09:10"
  );
  assert.equal(
    formatExportHistory([
      { kind: "shopify_api", at: "2026-10-20T06:20:00.000Z" },
      { kind: "shopify_csv", at: "2026-10-22T07:30:00.000Z" },
      { kind: "showmore", at: "2026-10-21T01:10:00.000Z" },
      { kind: "matrixify", at: "2026-10-19T15:59:00.000Z" }
    ]),
    "紀錄：Shopify CSV 10/22 15:30 · Showmore CSV 10/21 09:10 · Shopify 發布 10/20 14:20（共 4 次）"
  );
  assert.equal(
    formatExportHistory([
      { kind: "showmore", at: "2026-10-21T01:10:00.000Z" },
      { kind: "shopify_api", at: "2026-10-20T06:20:00.000Z" }
    ]),
    "紀錄：Showmore CSV 10/21 09:10 · Shopify 發布 10/20 14:20",
    "≤3 entries → no total suffix"
  );
});

await check("RC23 recordCsvExportBatch: shopify_csv kind + pointDrafts:false never touches product_drafts", async () => {
  const touched = [];
  const inserted = {};
  const fakeService = {
    from(table) {
      touched.push(table);
      const api = {
        insert(payload) {
          inserted[table] = payload;
          return {
            select() {
              return { single: async () => ({ data: { id: "batch-1" }, error: null }) };
            },
            then(resolve) {
              resolve({ error: null });
            }
          };
        },
        update() {
          touched.push(table + ".update");
          return { eq: async () => ({ error: null }) };
        }
      };
      return api;
    }
  };
  const res = await recordCsvExportBatch({
    serviceSupabase: fakeService,
    kind: "shopify_csv",
    drafts: [{ draftId: "d1", title: "A" }],
    createdBy: "u1",
    pointDrafts: false
  });
  assert.equal(res.batchId, "batch-1");
  assert.equal(inserted.publish_batches.kind, "shopify_csv");
  assert.ok(!touched.includes("product_drafts"), "pointDrafts:false must not touch product_drafts");
  assert.ok(!touched.some((t) => t.endsWith(".update")));
  // Default stays as before: existing callers still point drafts at the batch.
  const touched2 = touched.length;
  await recordCsvExportBatch({
    serviceSupabase: fakeService,
    kind: "showmore",
    drafts: [{ draftId: "d1", title: "A" }],
    createdBy: "u1"
  });
  assert.ok(touched.slice(touched2).includes("product_drafts"), "default pointDrafts=true unchanged");
});

// ---------- RC24–RC28: static wiring ----------

const ROUTE = "src/app/api/exports/shopify-csv/route.ts";
const PANEL = "src/components/records/PublishRecordsPanel.tsx";
const MIGRATION = "supabase/migrations/20261022160000_publish_batches_shopify_csv_kind.sql";

await check("RC24 route exists, read-only, reviewer-gated, ledgers shopify_csv without pointing drafts", () => {
  assert.ok(exists(ROUTE), ROUTE);
  const s = read(ROUTE);
  assert.match(s, /export async function POST\(/);
  assert.match(s, /export const maxDuration = 60;/);
  assert.match(s, /\["admin", "reviewer"\]\.includes\(/);
  assert.match(s, /collectShopifyCsvProducts\(/);
  assert.match(s, /buildShopifyProductCsv\(/);
  assert.match(s, /shopifyCsvFilename\(/);
  assert.match(s, /shopifyCsvExportNote\(/);
  assert.match(s, /callShopifyAdminGraphQL/);
  assert.match(s, /kind: "shopify_csv"/);
  assert.match(s, /pointDrafts: false/);
  assert.match(s, /X-Export-Note/);
  assert.match(s, /publish_batch_items/, "must support { batchId } body");
  assert.match(s, /一次最多 50 件/);
  assert.match(s, /選取的商品都還沒在 Shopify 上，無法下載 Shopify CSV/);
  assert.ok(!/\.update\(|\.upsert\(|\.delete\(|\.rpc\(/.test(s), "route must not write anything except via recordCsvExportBatch");
  assert.ok(!/mutation/i.test(s), "route must not send Shopify mutations");
  assert.ok(!/notifyMake/.test(s), "re-download must not notify Make");
});

await check("RC25 existing export routes untouched in behaviour (still mark csv_ready, still point drafts)", () => {
  for (const f of ["src/app/api/exports/showmore/route.ts", "src/app/api/exports/matrixify/route.ts"]) {
    const s = read(f);
    assert.match(s, /status: "csv_ready"/, f);
    assert.ok(!/pointDrafts: false/.test(s), f + " must keep default pointDrafts");
  }
});

await check("RC26 migration widens kind check to 4 kinds, idempotent", () => {
  assert.ok(exists(MIGRATION), MIGRATION);
  const s = read(MIGRATION);
  assert.match(s, /drop constraint if exists publish_batches_kind_check/);
  assert.match(
    s,
    /check \(kind in \('shopify_api', 'showmore', 'matrixify', 'shopify_csv'\)\)/
  );
  const domain = read("src/types/domain.ts");
  assert.match(domain, /export type PublishBatchKind = "shopify_api" \| "showmore" \| "matrixify" \| "shopify_csv";/);
});

await check("RC27 records panel wiring: toolbar, row checkbox, batch button, history line, role gate", () => {
  const s = read(PANEL);
  assert.match(s, /\/api\/exports\/shopify-csv/);
  assert.match(s, /⬇ 下載 Shopify CSV/);
  assert.match(s, /勾選商品下載 Shopify CSV/);
  assert.match(s, /⬇ Shopify CSV/);
  assert.match(s, /還沒在 Shopify 上/);
  assert.match(s, /formatExportHistory\(/);
  assert.match(s, /rec-export-history/);
  assert.match(s, /batchKindIcon\(/);
  assert.match(s, /results-batch-toolbar/);
  assert.match(s, /X-Export-Note/);
  assert.match(s, /role === "admin" \|\| role === "reviewer"/);
  assert.ok(!/!important/.test(s));
});

await check("RC28 no new !important in globals.css; package.json script registered", () => {
  const css = read("src/app/globals.css");
  // Baseline measured on handoff 041ea68.
  const count = (css.match(/!important/g) ?? []).length;
  assert.ok(count <= 12, `!important count ${count} > baseline 12`);
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["verify:records-csv"], "node scripts/verify-records-csv.mjs");
});

console.log(`\n${passed} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
