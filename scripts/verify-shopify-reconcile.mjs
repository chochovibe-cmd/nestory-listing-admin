/**
 * 1.5a SHOPIFY-RECONCILE verifier.
 * Offline only: real pure/application modules + in-memory DB and Shopify doubles.
 * No .env loading, network calls, SQL execution, or production writes.
 */
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

const fields = await import(src("src/lib/shopify/reconcileFields.ts"));
const diffService = await import(src("src/lib/shopify/shopifyDiff.ts"));
const payload = await import(src("src/lib/shopify/payload.ts"));
const sync = await import(src("src/lib/shopify/syncShopifyProduct.ts"));
const html = await import(src("src/lib/contentGenerator/htmlFormat.ts"));

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

function draft(overrides = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    updated_at: "2026-10-20T00:00:00.000Z",
    title_zh: "工具標題",
    taobao_title: "工具標題",
    description_html: "第一行\n第二行",
    description_plain: "",
    generated_faq_html: "<h3><strong>工具問？</strong></h3>\n<p>工具答。</p>",
    spec_text: "材質：ABS",
    why_we_chose_it: "工具理由",
    product_highlights: ["工具亮點"],
    seo_title: "工具 SEO",
    seo_description: "工具 SEO 描述",
    vendor: "潮巢 Nestory",
    product_type: null,
    category: null,
    shopify_handle: "tool-product",
    shopify_product_id: "gid://shopify/Product/500",
    shopify_remote_updated_at: null,
    shopify_sync_hash: null,
    shopify_sync_baseline: null,
    shopify_sync_status: "never",
    shopify_sync_error: null,
    generation_tone: "小編聊天口吻",
    sale_status: "",
    twd_price: 2480,
    compare_at_price: null,
    twd_cost: 1000,
    cny_price: 200,
    price_mode: "variant",
    sku: "MY-CUSTOM-01",
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

function snapshotFromDraft(localDraft, overrides = {}) {
  const built = payload.buildShopifyProductPayload(
    { ...localDraft, product_images: localDraft.product_images ?? [], product_variants: [] },
    "draft",
    {}
  );
  const category = built.product.category ? { id: built.product.category, name: "x" } : null;
  const product = {
    id: localDraft.shopify_product_id,
    title: built.product.title,
    handle: built.product.handle ?? "tool-product",
    descriptionHtml: built.product.descriptionHtml,
    vendor: built.product.vendor,
    productType: built.product.productType,
    tags: built.product.tags ?? [],
    status: "DRAFT",
    updatedAt: "2026-10-20T00:00:00.000Z",
    seo: built.product.seo,
    category,
    variants: {
      nodes: [{
        id: "gid://shopify/ProductVariant/1",
        title: "Default Title",
        sku: built.variantSeed.sku ?? "",
        price: String(built.variantSeed.price ?? 0),
        compareAtPrice:
          built.variantSeed.compareAtPrice != null && Number(built.variantSeed.compareAtPrice) > 0
            ? String(built.variantSeed.compareAtPrice)
            : null,
        inventoryPolicy: built.variantSeed.inventoryPolicy ?? "CONTINUE",
        selectedOptions: [{ name: "Title", value: "Default Title" }],
        inventoryItem: {
          id: "gid://shopify/InventoryItem/1",
          tracked: false,
          inventoryLevels: { nodes: [] }
        }
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
        updatedAt: "2026-10-20T00:00:00.000Z"
      }))
    }
  };
  return {
    ...product,
    ...overrides,
    variants: overrides.variants ?? product.variants,
    media: overrides.media ?? product.media,
    metafields: overrides.metafields ?? product.metafields,
    seo: overrides.seo ?? product.seo
  };
}

function fakeDb(initial) {
  const tables = structuredClone(initial);
  const writes = [];
  let sequence = 0;
  function from(table) {
    const state = {
      action: "select",
      predicates: [],
      patch: null,
      single: false,
      maybe: false
    };
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
          const created = incoming.map((row) => ({
            id: row.id ?? "fake-" + (++sequence),
            ...structuredClone(row)
          }));
          all.push(...created);
          writes.push({ table, action: "insert", rows: structuredClone(created) });
          response = { data: state.single || state.maybe ? created[0] : created, error: null };
        } else if (state.action === "update") {
          for (const row of rows) Object.assign(row, structuredClone(state.patch));
          writes.push({
            table,
            action: "update",
            rows: rows.map((row) => row.id),
            patch: structuredClone(state.patch)
          });
          response = { data: state.single || state.maybe ? (rows[0] ?? null) : rows, error: null };
        } else {
          const visible = rows.map((row) =>
            table === "product_drafts"
              ? {
                  ...structuredClone(row),
                  product_images: structuredClone(
                    (tables.product_images ?? []).filter((image) => image.draft_id === row.id)
                  )
                }
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
  return { from, tables, writes };
}

function shopifyFake(initialSnapshot, { inventoryErrors = null } = {}) {
  const state = { product: structuredClone(initialSnapshot) };
  const calls = [];
  const ok = (data) => ({ response: { ok: true, status: 200 }, result: { data } });
  const caller = async (query, variables) => {
    const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "unknown";
    calls.push({ name, variables: structuredClone(variables) });
    if (name === "ProductSyncSnapshot") return ok({ product: structuredClone(state.product) });
    if (name === "ProductSyncInventory") {
      if (inventoryErrors) {
        return {
          response: { ok: true, status: 200 },
          result: { errors: structuredClone(inventoryErrors) }
        };
      }
      return ok({
        product: {
          variants: {
            nodes: state.product.variants.nodes.map((variant) => ({
              id: variant.id,
              inventoryItem: {
                id: variant.inventoryItem.id,
                inventoryLevels: structuredClone(variant.inventoryItem.inventoryLevels)
              }
            }))
          }
        }
      });
    }
    if (name === "SyncProductCore") {
      const product = variables.product;
      for (const key of ["title", "descriptionHtml", "vendor", "productType", "tags", "status", "handle"]) {
        if (Object.prototype.hasOwnProperty.call(product, key)) state.product[key] = product[key];
      }
      if (Object.prototype.hasOwnProperty.call(product, "seo")) {
        state.product.seo = structuredClone(product.seo);
      }
      if (Object.prototype.hasOwnProperty.call(product, "category")) {
        state.product.category = { id: product.category, name: "x" };
      }
      for (const metafield of product.metafields ?? []) {
        const existing = state.product.metafields.nodes.find(
          (item) => item.namespace === metafield.namespace && item.key === metafield.key
        );
        if (existing) existing.value = metafield.value;
        else {
          state.product.metafields.nodes.push({
            id: "gid://shopify/Metafield/new-" + state.product.metafields.nodes.length,
            namespace: metafield.namespace,
            key: metafield.key,
            type: metafield.type,
            value: metafield.value,
            updatedAt: state.product.updatedAt
          });
        }
      }
      return ok({ productUpdate: { product: { id: state.product.id }, userErrors: [] } });
    }
    if (name === "DeleteProductMetafields") {
      const deleted = new Set(
        variables.metafields.map((item) => item.namespace + ":" + item.key)
      );
      state.product.metafields.nodes = state.product.metafields.nodes.filter(
        (item) => !deleted.has(item.namespace + ":" + item.key)
      );
      return ok({ metafieldsDelete: { deletedMetafields: variables.metafields, userErrors: [] } });
    }
    if (name === "SyncProductVariants") {
      for (const patch of variables.variants) {
        const remote = state.product.variants.nodes.find((item) => item.id === patch.id);
        if (!remote) continue;
        if (patch.price != null) remote.price = String(patch.price);
        remote.compareAtPrice = patch.compareAtPrice ?? null;
        remote.inventoryPolicy = patch.inventoryPolicy;
        remote.sku = patch.inventoryItem?.sku ?? remote.sku;
      }
      return ok({ productVariantsBulkUpdate: { productVariants: [], userErrors: [] } });
    }
    throw new Error("Unexpected Shopify fake operation " + name);
  };
  return { caller, calls, state };
}

function harness({
  draftOverrides = {},
  snapshotOverrides = {},
  variantRows = [],
  inventoryErrors = null
} = {}) {
  const localDraft = draft(draftOverrides);
  const snapshot = snapshotFromDraft(localDraft, snapshotOverrides);
  const db = fakeDb({
    product_drafts: [localDraft],
    product_variants: variantRows,
    product_images: [],
    team_settings: [],
    shopify_sync_jobs: []
  });
  const shop = shopifyFake(snapshot, { inventoryErrors });
  return { localDraft, snapshot, db, shop };
}

function row(input = {}) {
  return {
    key: "product:title",
    group: "product",
    field: "title",
    label: "標題",
    state: "unknown",
    tool: "工具",
    shopify: "Shopify",
    pullable: true,
    pullBlockedReason: null,
    preselect: null,
    ...input
  };
}

console.log("SHOPIFY-RECONCILE N — normalization");
await check("N1 normPrice / normCompareAt / normTags", () => {
  assert.equal(fields.normPrice("2480.00"), "2480");
  assert.equal(fields.normCompareAt(null), "");
  assert.equal(fields.normCompareAt("0"), "");
  assert.equal(fields.normTags([" b", "a", "a", ""]), "a\u0001b");
});
await check("N2 descriptionCompareText strips notice/link/embed/script exactly", () => {
  const input = '<h2>商品介紹</h2><p>此為海外代購商品，預估約 14 天。</p><p>第一段。</p><h2>收藏亮點</h2><ul>\n<li>亮點一</li>\n</ul><p>更多三麗鷗周邊 → <a href="https://x.test">看看還有什麼</a></p><!-- nestory-desc-embed --><p><img src="https://x.test/a.webp"></p><script type="application/ld+json">{"a":1}</script>';
  assert.equal(
    fields.descriptionCompareText(input),
    "商品介紹\n\n第一段。\n\n收藏亮點\n\n・亮點一"
  );
});
await check("N3 empty descriptions normalize to empty", () => {
  assert.equal(fields.descriptionCompareText(""), "");
  assert.equal(fields.descriptionCompareText(null), "");
});

console.log("SHOPIFY-RECONCILE D — description roundtrip");
await check("D1 Chaochao description roundtrips through Shopify HTML", () => {
  const a = draft({
    generation_tone: "潮巢導購版",
    sale_status: "海外代購（約14天）",
    description_html:
      "商品介紹\n這是一段介紹。\n\n收藏亮點\n・亮點一\n\n適合誰\n收藏玩家。\n\n商品資訊\n・材質：ABS"
  });
  const html1 = payload.buildShopifyProductPayload(a, "draft").product.descriptionHtml;
  const text = fields.descriptionCompareText(html1);
  const a2 = { ...a, description_html: text };
  assert.equal(
    fields.descriptionCompareText(payload.buildShopifyProductPayload(a2, "draft").product.descriptionHtml),
    text
  );
});
await check("D2 legacy tone description roundtrips", () => {
  const a = draft({
    generation_tone: "小編聊天口吻",
    description_html: "第一行\n第二行\n\n第二段"
  });
  const html1 = payload.buildShopifyProductPayload(a, "draft").product.descriptionHtml;
  const text = fields.descriptionCompareText(html1);
  assert.equal(
    fields.descriptionCompareText(payload.buildShopifyProductPayload({ ...a, description_html: text }, "draft").product.descriptionHtml),
    text
  );
});
await check("D3 description pulled from Shopify survives rebuild", () => {
  const remoteDraft = draft({
    generation_tone: "潮巢導購版",
    sale_status: "海外代購（約14天）",
    description_html:
      "商品介紹\n遠端介紹。\n\n收藏亮點\n・遠端亮點\n\n適合誰\n收藏玩家。\n\n商品資訊\n・材質：ABS"
  });
  const before = snapshotFromDraft(remoteDraft);
  const local = draft({ description_html: "商品介紹\n工具不同。" });
  const desc = fields.descriptionCompareText(before.descriptionHtml);
  const pull = diffService.computePullability({
    draft: local,
    variantRows: [],
    internalLinkMap: {},
    before,
    productId: local.shopify_product_id,
    rows: [row({
      key: "product:description",
      field: "description",
      label: "商品描述",
      tool: fields.descriptionCompareText(payload.buildShopifyProductPayload(local, "draft").product.descriptionHtml),
      shopify: desc
    })]
  });
  assert.equal(pull["product:description"].pullable, true);
});

console.log("SHOPIFY-RECONCILE S — state and preselect");
await check("S1 baseline state matrix", () => {
  const mk = (toolTitle, shopTitle, baselineProduct) => fields.computeReconcileRows({
    tool: { product: { title: toolTitle }, variants: {} },
    shopify: { product: { title: shopTitle }, variants: {} },
    baseline: {
      version: 1,
      capturedAt: "x",
      remoteUpdatedAt: "x",
      product: baselineProduct,
      variants: {}
    },
    legacyUnchanged: false,
    variantLabels: {},
    pullability: { "product:title": { pullable: true, reason: null } }
  })[0];
  assert.equal(mk("T", "B", { title: "B" }).state, "tool");
  assert.equal(mk("B", "S", { title: "B" }).state, "shopify");
  assert.equal(mk("T", "S", { title: "B" }).state, "both");
  assert.equal(mk("T", "S", {}).state, "unknown");
});
await check("S2 no baseline uses legacyUnchanged only", () => {
  const compute = (legacyUnchanged) => fields.computeReconcileRows({
    tool: { product: { title: "T" }, variants: {} },
    shopify: { product: { title: "S" }, variants: {} },
    baseline: null,
    legacyUnchanged,
    variantLabels: {},
    pullability: {}
  })[0].state;
  assert.equal(compute(true), "tool");
  assert.equal(compute(false), "unknown");
});
await check("S3 preselect matrix", () => {
  const compute = ({ baselineTitle, tool, shopify, pullable, baseline = true, legacyUnchanged = false }) =>
    fields.computeReconcileRows({
      tool: { product: { title: tool }, variants: {} },
      shopify: { product: { title: shopify }, variants: {} },
      baseline: baseline ? {
        version: 1, capturedAt: "x", remoteUpdatedAt: "x",
        product: baselineTitle === undefined ? {} : { title: baselineTitle }, variants: {}
      } : null,
      legacyUnchanged,
      variantLabels: {},
      pullability: { "product:title": { pullable, reason: pullable ? null : "x" } }
    })[0].preselect;
  assert.equal(compute({ baselineTitle: "B", tool: "T", shopify: "B", pullable: true }), "tool");
  assert.equal(compute({ baselineTitle: "B", tool: "B", shopify: "S", pullable: true }), "shopify");
  assert.equal(compute({ baselineTitle: "B", tool: "B", shopify: "S", pullable: false }), null);
  assert.equal(compute({ baselineTitle: "B", tool: "T", shopify: "S", pullable: true }), null);
  assert.equal(compute({ baselineTitle: undefined, tool: "T", shopify: "S", pullable: true }), null);
});
await check("S4 equal values and unmanaged handle do not produce rows", () => {
  const rows = fields.computeReconcileRows({
    tool: { product: { title: "same" }, variants: {} },
    shopify: { product: { title: "same", handle: "remote" }, variants: {} },
    baseline: null,
    legacyUnchanged: false,
    variantLabels: {},
    pullability: {}
  });
  assert.deepEqual(rows, []);
});

console.log("SHOPIFY-RECONCILE P — pullback");
await check("P1 auto SKU is blocked, manual custom SKU is pullable", () => {
  const local = draft({ sku: "TOOL-CUSTOM" });
  const autoBefore = snapshotFromDraft(local);
  autoBefore.variants.nodes[0].sku = "5184548069544";
  const autoKey = "variant:" + autoBefore.variants.nodes[0].id + ":sku";
  const autoPull = diffService.computePullability({
    draft: local, variantRows: [], internalLinkMap: {}, before: autoBefore,
    productId: local.shopify_product_id,
    rows: [row({
      key: autoKey, group: "variant", field: "sku", label: "SKU",
      variantId: autoBefore.variants.nodes[0].id,
      variantLabel: "單一款式", tool: "TOOL-CUSTOM", shopify: "5184548069544"
    })]
  });
  assert.equal(autoPull[autoKey].pullable, false);
  assert.equal(autoPull[autoKey].reason, "這是淘寶／系統編號，工具固定使用 NS 編號");

  const manualBefore = snapshotFromDraft(local);
  manualBefore.variants.nodes[0].sku = "MY-CUSTOM-01";
  const manualKey = "variant:" + manualBefore.variants.nodes[0].id + ":sku";
  const manualPull = diffService.computePullability({
    draft: local, variantRows: [], internalLinkMap: {}, before: manualBefore,
    productId: local.shopify_product_id,
    rows: [row({
      key: manualKey, group: "variant", field: "sku", label: "SKU",
      variantId: manualBefore.variants.nodes[0].id,
      variantLabel: "單一款式", tool: "TOOL-CUSTOM", shopify: "MY-CUSTOM-01"
    })]
  });
  assert.equal(manualPull[manualKey].pullable, true);
});
await check("P2 multi variant compareAt is blocked in single price mode", () => {
  const local = draft({ price_mode: "single" });
  const variantId = "gid://shopify/ProductVariant/77";
  const variants = [{
    id: "row-77", draft_id: local.id, sort_order: 0,
    option1_name: "款式", option1_value: "A",
    option2_name: null, option2_value: null, option3_name: null, option3_value: null,
    twd_price: 2480, compare_at_price: null, cny_price: 200,
    sku: "MY-CUSTOM-77", inventory_policy: "continue", inventory_quantity: 0,
    image_id: null, shopify_variant_id: variantId
  }];
  const before = snapshotFromDraft(local, {
    variants: { nodes: [{
      ...snapshotFromDraft(local).variants.nodes[0],
      id: variantId,
      title: "A",
      sku: "MY-CUSTOM-77",
      price: "2480",
      compareAtPrice: "3000",
      selectedOptions: [{ name: "款式", value: "A" }]
    }] }
  });
  const key = "variant:" + variantId + ":compareAtPrice";
  const result = diffService.computePullability({
    draft: local, variantRows: variants, internalLinkMap: {}, before,
    productId: local.shopify_product_id,
    rows: [row({
      key, group: "variant", field: "compareAtPrice", label: "原價（劃線價）",
      variantId, variantLabel: "A", tool: "", shopify: "3000"
    })]
  });
  assert.equal(result[key].pullable, false);
  assert.equal(result[key].reason, "工具的規則會改寫這一欄，存回去也留不住，只能用工具版本");
});
await check("P3 localPatch converts highlights FAQ and multi price", () => {
  const local = draft();
  const before = snapshotFromDraft(local);
  before.metafields.nodes = [
    { id: "h", namespace: "custom", key: "product_highlights", type: "multi_line_text_field", value: "・甲\n・乙\n\n", updatedAt: "" },
    { id: "f", namespace: "custom", key: "product_faq", type: "multi_line_text_field", value: "Q：商品可以水洗嗎？\nA：請依商品洗標清潔。", updatedAt: "" }
  ];
  const highlights = fields.localPatchForChoice({
    row: row({ key: "product:highlights", field: "highlights", label: "商品賣點" }),
    snapshot: before, draftId: local.id, planMode: "single", variantRowId: null
  });
  assert.deepEqual(highlights.patch.product_highlights, ["甲", "乙"]);
  const faqPatch = fields.localPatchForChoice({
    row: row({ key: "product:faq", field: "faq", label: "問與答" }),
    snapshot: before, draftId: local.id, planMode: "single", variantRowId: null
  });
  assert.match(faqPatch.patch.generated_faq_html, /<h3>/);
  assert.equal(html.htmlFaqToPlainText(faqPatch.patch.generated_faq_html), "Q：商品可以水洗嗎？\nA：請依商品洗標清潔。");

  const variantId = before.variants.nodes[0].id;
  const pricePatch = fields.localPatchForChoice({
    row: row({
      key: "variant:" + variantId + ":price", group: "variant", field: "price",
      label: "售價", variantId, variantLabel: "A", shopify: "2480"
    }),
    snapshot: before, draftId: local.id, planMode: "multi", variantRowId: "row-1"
  });
  assert.deepEqual(pricePatch.patch, { twd_price: 2480, sell_price_locked: true });
});

console.log("SHOPIFY-RECONCILE I — inventory read gating");
await check("I1 snapshot query omits inventory while inventory query owns it", () => {
  const runtimeGraphql = read("src/lib/shopify/fullSyncGraphQL.ts");
  const snapshotQuery = /export const PRODUCT_SYNC_SNAPSHOT_QUERY = `([\s\S]*?)`;/m.exec(runtimeGraphql)?.[1];
  const inventoryQuery = /export const PRODUCT_SYNC_INVENTORY_QUERY = `([\s\S]*?)`;/m.exec(runtimeGraphql)?.[1];
  assert.ok(snapshotQuery, "PRODUCT_SYNC_SNAPSHOT_QUERY missing");
  assert.ok(inventoryQuery, "PRODUCT_SYNC_INVENTORY_QUERY missing");
  assert.equal(snapshotQuery.includes("inventoryLevels"), false);
  assert.equal(inventoryQuery.includes("inventoryLevels"), true);

  const contract = read("scripts/graphql/shopify-full-sync-2026-04.graphql");
  assert.equal((contract.match(/inventoryLevels/g) ?? []).length, 1);
  assert.match(contract, /ProductSyncInventory/);
});

console.log("SHOPIFY-RECONCILE E — sync engine");
async function runSync({
  draftOverrides = {},
  snapshotOverrides = {},
  forceRemoteOverwrite = false,
  inventoryErrors = null
} = {}) {
  const h = harness({ draftOverrides, snapshotOverrides, inventoryErrors });
  const result = await sync.syncShopifyProduct({
    serviceSupabase: h.db,
    draftId: h.localDraft.id,
    createdBy: "owner-1",
    forceRemoteOverwrite,
    deps: { callGraphQL: h.shop.caller }
  });
  return { ...h, result };
}
await check("I2 CONTINUE-only sync does not read inventory", async () => {
  const h = await runSync();
  assert.equal(h.result.ok, true, JSON.stringify(h.result));
  assert.equal(h.shop.calls.some((call) => call.name === "ProductSyncInventory"), false);
});
await check("I3 finite inventory access denial stops before Shopify writes", async () => {
  const h = await runSync({
    draftOverrides: { inventory_policy: "deny", inventory_quantity: 3 },
    inventoryErrors: [{ message: "Access denied for inventoryLevels field." }]
  });
  assert.equal(h.result.ok, false);
  assert.equal(h.result.code, "inventory_read_failed");
  assert.deepEqual(
    h.shop.calls.map((call) => call.name),
    ["ProductSyncSnapshot", "ProductSyncInventory"]
  );
});

await check("E1 no baseline + different title stops at remote_conflict before writes", async () => {
  const h = await runSync({ snapshotOverrides: { title: "Shopify 標題" } });
  assert.equal(h.result.ok, false);
  assert.equal(h.result.status, 409);
  assert.equal(h.result.code, "remote_conflict");
  assert.equal(h.result.error, "這件商品還沒有同步紀錄，無法確認 Shopify 後台是否被手動修改過；已停止覆蓋，請先比對差異");
  assert.equal(h.result.conflictCount, 1);
  assert.equal(h.shop.calls.filter((call) => call.name !== "ProductSyncSnapshot").length, 0);
});
await check("E2 no baseline + all fields equal syncs", async () => {
  const h = await runSync();
  assert.equal(h.result.ok, true, JSON.stringify(h.result));
});
await check("E3 remote changed after baseline blocks", async () => {
  const local = draft({ title_zh: "BASE", taobao_title: "BASE" });
  const baseSnapshot = snapshotFromDraft(local);
  const baseline = fields.buildBaselineFromSnapshot(baseSnapshot, "2026-10-19T00:00:00.000Z");
  const h = await runSync({
    draftOverrides: { title_zh: "BASE", taobao_title: "BASE", shopify_sync_baseline: baseline },
    snapshotOverrides: { title: "SHOPIFY" }
  });
  assert.equal(h.result.ok, false);
  assert.equal(h.result.status, 409);
  assert.equal(h.result.error, "Shopify 後台在上次同步後有新修改；已停止覆蓋，請先查看差異");
});
await check("E4 tool-only title change syncs and refreshes baseline", async () => {
  const baselineDraft = draft({ title_zh: "BASE", taobao_title: "BASE" });
  const baseSnapshot = snapshotFromDraft(baselineDraft);
  const baseline = fields.buildBaselineFromSnapshot(baseSnapshot, "2026-10-19T00:00:00.000Z");
  const h = await runSync({
    draftOverrides: {
      title_zh: "新標題",
      taobao_title: "新標題",
      shopify_sync_baseline: baseline
    },
    snapshotOverrides: { title: "BASE" }
  });
  assert.equal(h.result.ok, true, JSON.stringify(h.result));
  assert.equal(h.db.tables.product_drafts[0].shopify_sync_baseline.product.title, "新標題");
  assert.equal(h.db.tables.product_drafts[0].shopify_sync_baseline.version, 1);
});
await check("E5 category is sent only when Shopify category is empty", async () => {
  const first = await runSync({
    draftOverrides: { shopify_tags: ["類型_公仔模型"] },
    snapshotOverrides: { category: null },
    forceRemoteOverwrite: true
  });
  assert.equal(first.result.ok, true, JSON.stringify(first.result));
  const firstCore = first.shop.calls.find((call) => call.name === "SyncProductCore");
  assert.equal(firstCore.variables.product.category, "gid://shopify/TaxonomyCategory/tg-5-8-1-1");

  const second = await runSync({
    draftOverrides: { shopify_tags: ["類型_公仔模型"] },
    snapshotOverrides: { category: { id: "gid://shopify/TaxonomyCategory/xx", name: "x" } },
    forceRemoteOverwrite: true
  });
  assert.equal(second.result.ok, true, JSON.stringify(second.result));
  const secondCore = second.shop.calls.find((call) => call.name === "SyncProductCore");
  assert.equal(Object.prototype.hasOwnProperty.call(secondCore.variables.product, "category"), false);
});
await check("E6 forceRemoteOverwrite bypasses unknown-baseline conflict", async () => {
  const h = await runSync({
    snapshotOverrides: { title: "Shopify 標題" },
    forceRemoteOverwrite: true
  });
  assert.equal(h.result.ok, true, JSON.stringify(h.result));
});
await check("E7 remote_updated_at alone does not prove a legacy full sync", async () => {
  const h = await runSync({
    draftOverrides: {
      shopify_remote_updated_at: "2026-10-20T00:00:00.000Z",
      shopify_sync_hash: null
    },
    snapshotOverrides: { title: "Shopify 標題" }
  });
  assert.equal(h.result.ok, false);
  assert.equal(h.result.status, 409);
  assert.equal(h.result.error, "這件商品還沒有同步紀錄，無法確認 Shopify 後台是否被手動修改過；已停止覆蓋，請先比對差異");
});

console.log("SHOPIFY-RECONCILE R — resolve");
async function oneTitleDiffHarness(extra = {}) {
  return harness({
    draftOverrides: extra.draftOverrides ?? {},
    snapshotOverrides: { title: "Shopify 標題", ...(extra.snapshotOverrides ?? {}) }
  });
}
await check("R1 stale remoteUpdatedAt returns diff_stale with no writes", async () => {
  const h = await oneTitleDiffHarness();
  const loaded = await diffService.loadShopifyDiff({
    serviceSupabase: h.db, draftId: h.localDraft.id,
    deps: { callGraphQL: h.shop.caller }
  });
  assert.equal(loaded.ok, true);
  h.db.writes.length = 0;
  const result = await diffService.resolveShopifyDiff({
    serviceSupabase: h.db,
    draftId: h.localDraft.id,
    createdBy: "owner-1",
    body: {
      remoteUpdatedAt: "stale",
      draftUpdatedAt: loaded.draftUpdatedAt,
      choices: Object.fromEntries(loaded.rows.map((item) => [item.key, "tool"])),
      confirmActiveUpdate: false,
      confirmRemovals: false
    },
    deps: { callGraphQL: h.shop.caller }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "diff_stale");
  assert.equal(h.db.writes.length, 0);
  assert.ok(h.shop.calls.every((call) => call.name === "ProductSyncSnapshot"));
});
await check("R2 missing choice key returns diff_changed", async () => {
  const h = await oneTitleDiffHarness();
  const loaded = await diffService.loadShopifyDiff({
    serviceSupabase: h.db, draftId: h.localDraft.id,
    deps: { callGraphQL: h.shop.caller }
  });
  assert.equal(loaded.ok, true);
  const result = await diffService.resolveShopifyDiff({
    serviceSupabase: h.db, draftId: h.localDraft.id, createdBy: "owner-1",
    body: {
      remoteUpdatedAt: loaded.remoteUpdatedAt,
      draftUpdatedAt: loaded.draftUpdatedAt,
      choices: {},
      confirmActiveUpdate: false,
      confirmRemovals: false
    },
    deps: { callGraphQL: h.shop.caller }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "diff_changed");
});
await check("R3 selecting Shopify for a blocked row returns invalid_choice", async () => {
  const local = draft({ sku: "TOOL-CUSTOM" });
  const baseSnapshot = snapshotFromDraft(local);
  baseSnapshot.variants.nodes[0].sku = "5184548069544";
  const h = harness({
    draftOverrides: { sku: "TOOL-CUSTOM" },
    snapshotOverrides: { variants: baseSnapshot.variants }
  });
  const loaded = await diffService.loadShopifyDiff({
    serviceSupabase: h.db, draftId: h.localDraft.id,
    deps: { callGraphQL: h.shop.caller }
  });
  assert.equal(loaded.ok, true);
  const blocked = loaded.rows.find((item) => item.field === "sku");
  assert.ok(blocked && !blocked.pullable);
  const choices = Object.fromEntries(loaded.rows.map((item) => [item.key, "tool"]));
  choices[blocked.key] = "shopify";
  const result = await diffService.resolveShopifyDiff({
    serviceSupabase: h.db, draftId: h.localDraft.id, createdBy: "owner-1",
    body: {
      remoteUpdatedAt: loaded.remoteUpdatedAt,
      draftUpdatedAt: loaded.draftUpdatedAt,
      choices,
      confirmActiveUpdate: false,
      confirmRemovals: false
    },
    deps: { callGraphQL: h.shop.caller }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_choice");
});
await check("R4 pull title, keep tool FAQ, then full sync records audit", async () => {
  const local = draft();
  const remote = snapshotFromDraft(local);
  remote.title = "Shopify 標題";
  const faq = remote.metafields.nodes.find((item) => item.key === "product_faq");
  assert.ok(faq);
  faq.value = "Q：Shopify 問？\nA：Shopify 答。";
  const h = harness({
    snapshotOverrides: { title: remote.title, metafields: remote.metafields }
  });
  const loaded = await diffService.loadShopifyDiff({
    serviceSupabase: h.db, draftId: h.localDraft.id,
    deps: { callGraphQL: h.shop.caller }
  });
  assert.equal(loaded.ok, true);
  const choices = Object.fromEntries(loaded.rows.map((item) => [item.key, "tool"]));
  choices["product:title"] = "shopify";
  const result = await diffService.resolveShopifyDiff({
    serviceSupabase: h.db, draftId: h.localDraft.id, createdBy: "owner-1",
    body: {
      remoteUpdatedAt: loaded.remoteUpdatedAt,
      draftUpdatedAt: loaded.draftUpdatedAt,
      choices,
      confirmActiveUpdate: false,
      confirmRemovals: false
    },
    deps: { callGraphQL: h.shop.caller }
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(h.db.tables.product_drafts[0].title_zh, "Shopify 標題");
  const core = h.shop.calls.find((call) => call.name === "SyncProductCore");
  assert.equal(core.variables.product.title, "Shopify 標題");
  const faqSent = core.variables.product.metafields.find((item) => item.key === "product_faq");
  assert.equal(faqSent.value, "Q：工具問？\nA：工具答。");
  const job = h.db.tables.shopify_sync_jobs.at(-1);
  assert.ok(job.request_payload.reconcile.pulledKeys.includes("product:title"));
});

console.log("SHOPIFY-RECONCILE C — source contracts");
await check("C1 sync controls use compare/resolve UI contract", () => {
  const source = read("src/components/listing/ShopifySyncControls.tsx");
  assert.doesNotMatch(source, /以工具版本覆蓋/);
  const literalDraftId = "$" + "{draftId}";
  for (const token of [
    "/api/drafts/" + literalDraftId + "/shopify-diff",
    "/api/drafts/" + literalDraftId + "/shopify-resolve",
    "全部用工具",
    "全部用 Shopify",
    "套用選擇並同步",
    "沒有比對紀錄",
    "sel--tint",
    "rcx-pick"
  ]) assert.ok(source.includes(token), token);
});
await check("C2 route export contract and durations", () => {
  const files = [
    ["src/app/api/drafts/[id]/shopify-diff/route.ts", "60"],
    ["src/app/api/drafts/[id]/shopify-resolve/route.ts", "300"]
  ];
  for (const [file, duration] of files) {
    const source = read(file);
    assert.doesNotMatch(source, /export (?:async )?function (?!GET|POST)/);
    assert.doesNotMatch(source, /export const (?!runtime|maxDuration)/);
    assert.match(source, new RegExp("maxDuration\\s*=\\s*" + duration));
  }
  assert.match(read("src/app/api/drafts/[id]/shopify-sync/route.ts"), /maxDuration\s*=\s*300/);
});
await check("C3 both GraphQL contracts include category", () => {
  assert.match(read("src/lib/shopify/fullSyncGraphQL.ts"), /category \{ id name \}/);
  assert.match(read("scripts/graphql/shopify-full-sync-2026-04.graphql"), /category\s*\{\s*id\s*name\s*\}/);
});
await check("C4 publish baseline capture is after finishLocalSuccess and inside try", () => {
  const source = read("src/lib/shopify/publishDraftSafe.ts");
  const capture = source.lastIndexOf("captureShopifySyncBaseline(");
  const finish = source.lastIndexOf("finishLocalSuccess(", capture);
  assert.ok(capture > finish);
  const tryIndex = source.lastIndexOf("try {", capture);
  const catchIndex = source.indexOf("} catch", capture);
  assert.ok(tryIndex >= 0 && catchIndex > capture);
});
await check("C5 migration adds baseline jsonb", () => {
  assert.match(
    read("supabase/migrations/20261020100000_shopify_sync_baseline.sql"),
    /add column if not exists shopify_sync_baseline jsonb/
  );
});
await check("C6 rcx CSS has tokens only and no important/hex/rgb", () => {
  const source = read("src/app/globals.css");
  const marker = source.indexOf("/* 1.5a SHOPIFY-RECONCILE: 逐欄比對表");
  assert.ok(marker >= 0);
  const rcx = source.slice(marker);
  assert.doesNotMatch(rcx, /!important/);
  assert.doesNotMatch(rcx, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(rcx, /rgb\(/);
});

console.log("\nSHOPIFY-RECONCILE verifier: " + passed + " passed, " + failures.length + " failed");
if (failures.length > 0) {
  console.error("Failed: " + failures.join(", "));
  process.exit(1);
}
