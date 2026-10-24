#!/usr/bin/env node
// SYNC-KEEP-MEDIA acceptance checks — written by Claude BEFORE construction
// (spec: docs/SYNC-KEEP-MEDIA-施工規格-2026-10-24.md). GPT implements until every check passes;
// do not weaken or delete checks. Offline only: real modules + in-memory DB and Shopify doubles.
// No .env, network, SQL or production writes.
// Real cases behind the fixtures (10-24 SYNC-ROLLOUT):
//  - ae962018: tool sends https://www.youtube.com/watch?v=ID, Shopify stores originUrl https://youtu.be/ID
//    → readback_mismatch on add, and every later sync would treat the video as "remove + add again".
//  - 3c67c42b & co.: Shopify gallery holds images the tool does not send (old publishes put 詳情圖 in the
//    gallery) → removal_confirmation_required. Boss rule: images follow Shopify for these products.
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

const sync = await import(src("src/lib/shopify/syncShopifyProduct.ts"));
const payload = await import(src("src/lib/shopify/payload.ts"));
const videos = await import(src("src/lib/media/videoUrls.ts"));

const VID = "dQw4w9WgXcQ";
const WATCH = `https://www.youtube.com/watch?v=${VID}`;
const SHORT = `https://youtu.be/${VID}`;
const KEEP_WARNING = "圖片以 Shopify 為準：這次沒有新增、刪除或修改 Shopify 圖片／影片";
const SIX_IDS = [
  "3c67c42b-b7a1-4550-814e-c6e1f5d41a7b",
  "329f516c-af09-44fe-bafb-743107da6009",
  "8b3a323e-366d-4cde-a83e-ea4ab79dda35",
  "b9400278-3811-4c5a-94ec-a1ff9b372d6f",
  "8b3a35b9-2a9b-4b14-84d3-5c7e84f9b8f8",
  "6ede08ef-ac72-4741-92db-794f253a6ff6"
];

console.log("SYNC-KEEP-MEDIA V — YouTube identity");
await check("KM01 videoIdentityKey: youtu.be / watch / m.youtube / extra params → same key; other URLs → trimmed self", () => {
  assert.equal(typeof videos.videoIdentityKey, "function", "src/lib/media/videoUrls.ts must export videoIdentityKey");
  const k = videos.videoIdentityKey;
  assert.equal(k(SHORT), k(WATCH));
  assert.equal(k(`https://m.youtube.com/watch?v=${VID}&t=3`), k(WATCH));
  assert.equal(k(`  ${WATCH}  `), k(WATCH));
  assert.notEqual(k("https://youtu.be/aaaaaaaaaaa"), k(WATCH));
  assert.equal(k("  https://cdn.example.com/a.mp4 "), "https://cdn.example.com/a.mp4");
});

function minimalSnapshot(overrides = {}) {
  return {
    id: "gid://shopify/Product/1",
    title: "標題",
    handle: "h",
    descriptionHtml: "<p>a</p>",
    vendor: "潮巢 Nestory",
    productType: "",
    tags: [],
    status: "DRAFT",
    updatedAt: "2026-10-24T00:00:00Z",
    seo: { title: "", description: "" },
    category: null,
    variants: { nodes: [] },
    media: { nodes: [] },
    metafields: { nodes: [] },
    ...overrides
  };
}
const minimalCore = { id: "gid://shopify/Product/1", title: "標題", descriptionHtml: "<p>a</p>", vendor: "潮巢 Nestory", productType: "", tags: [], status: "DRAFT" };
const videoNode = (originUrl, id = "gid://shopify/ExternalVideo/1") => ({ id, alt: "", mediaContentType: "EXTERNAL_VIDEO", status: "READY", originUrl });

await check("KM02 verifyReadback: watch URL sent, Shopify stored youtu.be → NOT a mismatch (the ae962018 case)", () => {
  const mm = sync.verifyReadback(minimalSnapshot({ media: { nodes: [videoNode(SHORT)] } }), minimalCore, [], [], [WATCH], null, []);
  assert.deepEqual(mm, []);
});
await check("KM03 verifyReadback: a different video id IS still a mismatch", () => {
  const mm = sync.verifyReadback(minimalSnapshot({ media: { nodes: [videoNode("https://youtu.be/aaaaaaaaaaa")] } }), minimalCore, [], [], [WATCH], null, []);
  assert.equal(mm.length, 1);
  assert.ok(mm[0].startsWith("media.externalVideo:"), mm[0]);
});

console.log("SYNC-KEEP-MEDIA E — full sync end-to-end (fake DB + fake Shopify)");
const DRAFT_ID = "33333333-3333-4333-8333-333333333333";
function draft(overrides = {}) {
  return {
    id: DRAFT_ID,
    updated_at: "2026-10-24T00:00:00.000Z",
    title_zh: "三麗鷗 吊飾",
    taobao_title: "三麗鷗 吊飾",
    description_html: "商品介紹\n可愛的吊飾。\n\n商品資訊\n・IP：三麗鷗",
    description_plain: "",
    generated_faq_html: "<h3><strong>會掉色嗎？</strong></h3>\n<p>不容易掉色。</p>",
    spec_text: "材質：PVC",
    why_we_chose_it: "",
    product_highlights: [],
    seo_title: "三麗鷗 吊飾",
    seo_description: "三麗鷗 吊飾",
    vendor: "潮巢 Nestory",
    product_type: null,
    category: null,
    shopify_handle: "sanrio-charm",
    shopify_product_id: "gid://shopify/Product/700",
    shopify_remote_updated_at: null,
    shopify_sync_hash: null,
    shopify_sync_baseline: null,
    shopify_sync_status: "never",
    shopify_sync_error: null,
    shopify_media_mode: "tool",
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
    shopify_tags: [],
    tags: [],
    metafields_json: null,
    generated_payload_json: null,
    video_urls: [],
    ip_name: null,
    ...overrides
  };
}
function toolImage(n, overrides = {}) {
  return {
    id: `img-${n}`,
    draft_id: DRAFT_ID,
    image_type: "main",
    sort_order: n,
    original_file_url: `https://cdn.example.com/files/0000000${n}-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp`,
    processed_file_url: `https://cdn.example.com/files/0000000${n}-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp`,
    generated_file_url: null,
    alt_text: `主圖${n + 1}`,
    shopify_media_id: null,
    shopify_file_id: null,
    shopify_source_hash: null,
    ...overrides
  };
}
const imageNode = (id, alt, url = `https://cdn.shopify.com/files/${id.split("/").pop()}.webp`) => ({
  id,
  alt,
  mediaContentType: "IMAGE",
  status: "READY",
  image: { url }
});

function snapshotFromDraft(localDraft, media) {
  const built = payload.buildShopifyProductPayload({ ...localDraft, product_images: [], product_variants: [] }, "draft", {});
  return {
    id: localDraft.shopify_product_id,
    title: built.product.title,
    handle: built.product.handle ?? localDraft.shopify_handle,
    descriptionHtml: built.product.descriptionHtml,
    vendor: built.product.vendor,
    productType: built.product.productType,
    tags: built.product.tags ?? [],
    status: "DRAFT",
    updatedAt: "2026-10-24T00:00:00.000Z",
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
    media: { nodes: structuredClone(media) },
    metafields: {
      nodes: (built.product.metafields ?? []).map((item, index) => ({
        id: "gid://shopify/Metafield/" + (index + 1),
        namespace: item.namespace,
        key: item.key,
        type: item.type,
        value: item.value,
        updatedAt: "2026-10-24T00:00:00.000Z"
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

// Shopify double. Like real Shopify, an added YouTube EXTERNAL_VIDEO comes back with originUrl https://youtu.be/<id>.
function shopifyFake(initialSnapshot) {
  const state = { product: structuredClone(initialSnapshot) };
  const calls = [];
  let created = 0;
  const ok = (data) => ({ response: { ok: true, status: 200 }, result: { data } });
  const caller = async (query, variables) => {
    const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "unknown";
    calls.push(name);
    if (name === "ProductSyncSnapshot") return ok({ product: structuredClone(state.product) });
    if (name === "SyncProductCore") {
      const product = variables.product;
      for (const key of ["title", "vendor", "productType", "tags", "status", "handle", "descriptionHtml"]) {
        if (Object.prototype.hasOwnProperty.call(product, key)) state.product[key] = product[key];
      }
      if (Object.prototype.hasOwnProperty.call(product, "seo")) state.product.seo = structuredClone(product.seo);
      for (const metafield of product.metafields ?? []) {
        const existing = state.product.metafields.nodes.find(
          (item) => item.namespace === metafield.namespace && item.key === metafield.key
        );
        if (existing) existing.value = metafield.value;
        else state.product.metafields.nodes.push({ id: "gid://shopify/Metafield/n" + calls.length, ...metafield, updatedAt: state.product.updatedAt });
      }
      state.product.updatedAt = "2026-10-25T01:00:00Z";
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
    if (name === "AddProductMedia") {
      for (const item of variables.media) {
        created += 1;
        if (item.mediaContentType === "EXTERNAL_VIDEO") {
          const id = videos.canonicalizeYouTubeUrl(item.originalSource)?.split("v=")[1];
          state.product.media.nodes.push(videoNode(id ? `https://youtu.be/${id}` : item.originalSource, `gid://shopify/ExternalVideo/new-${created}`));
        } else {
          state.product.media.nodes.push(imageNode(`gid://shopify/MediaImage/new-${created}`, item.alt ?? "", item.originalSource));
        }
      }
      return ok({ productUpdate: { product: { id: state.product.id, updatedAt: state.product.updatedAt, media: { nodes: structuredClone(state.product.media.nodes) } }, userErrors: [] } });
    }
    if (name === "UpdateProductFiles") {
      for (const file of variables.files) {
        if (file.referencesToRemove) {
          state.product.media.nodes = state.product.media.nodes.filter((item) => item.id !== file.id);
          continue;
        }
        const node = state.product.media.nodes.find((item) => item.id === file.id);
        if (node && Object.prototype.hasOwnProperty.call(file, "alt")) node.alt = file.alt;
      }
      return ok({ fileUpdate: { files: [], userErrors: [] } });
    }
    throw new Error("Unexpected Shopify fake operation " + name);
  };
  return { caller, calls, state };
}

async function runSync({ draftOverrides = {}, images = [], media = [], snapshotDraftOverrides = null, forceRemoteOverwrite = false } = {}) {
  const localDraft = draft(draftOverrides);
  const db = fakeDb({
    product_drafts: [localDraft],
    product_variants: [],
    product_images: images,
    team_settings: [],
    shopify_sync_jobs: []
  });
  const shop = shopifyFake(snapshotFromDraft(snapshotDraftOverrides ? draft({ ...draftOverrides, ...snapshotDraftOverrides }) : localDraft, media));
  const mediaBefore = structuredClone(shop.state.product.media.nodes);
  const prevMock = process.env.SHOPIFY_PUBLISH_MOCK;
  process.env.SHOPIFY_PUBLISH_MOCK = "false";
  try {
    const result = await sync.syncShopifyProduct({
      serviceSupabase: db,
      draftId: localDraft.id,
      createdBy: "owner-1",
      forceRemoteOverwrite,
      deps: { callGraphQL: shop.caller }
    });
    return { result, db, shop, mediaBefore, draftRow: db.tables.product_drafts[0], jobs: db.tables.shopify_sync_jobs };
  } finally {
    if (prevMock === undefined) delete process.env.SHOPIFY_PUBLISH_MOCK;
    else process.env.SHOPIFY_PUBLISH_MOCK = prevMock;
  }
}
const mediaWrites = (h) => h.shop.calls.filter((name) => name === "AddProductMedia" || name === "UpdateProductFiles");

await check("KM04 tool mode: Shopify already has the video as youtu.be → sync ok, no media writes (was 409 removal)", async () => {
  const h = await runSync({ draftOverrides: { video_urls: [WATCH] }, media: [videoNode(SHORT)] });
  assert.equal(h.result.ok, true, JSON.stringify(h.result));
  assert.deepEqual(mediaWrites(h), []);
  assert.equal(h.draftRow.shopify_sync_status, "synced");
});
await check("KM05 tool mode: first-time video add, Shopify stores youtu.be → sync ok (was readback_mismatch/partial)", async () => {
  const h = await runSync({ draftOverrides: { video_urls: [WATCH] } });
  assert.equal(h.result.ok, true, JSON.stringify(h.result));
  assert.deepEqual(mediaWrites(h), ["AddProductMedia"]);
  assert.equal(h.shop.state.product.media.nodes.filter((item) => item.mediaContentType === "EXTERNAL_VIDEO").length, 1);
  assert.equal(h.draftRow.shopify_sync_status, "synced");
});

const linkedA = toolImage(0, { shopify_media_id: "gid://shopify/MediaImage/A" });
await check("KM06 tool mode (control, unchanged): a Shopify-only image still blocks with 409 removal_confirmation_required", async () => {
  const h = await runSync({
    images: [linkedA],
    media: [imageNode("gid://shopify/MediaImage/A", "主圖1"), imageNode("gid://shopify/MediaImage/B", "詳情圖")]
  });
  assert.equal(h.result.ok, false);
  assert.equal(h.result.code, "removal_confirmation_required");
  assert.deepEqual(h.result.removals, { variants: 0, media: 1 });
  assert.deepEqual(mediaWrites(h), []);
});
await check("KM07 unknown / missing shopify_media_mode behaves as 'tool' (same 409 as KM06)", async () => {
  for (const mode of [null, undefined, "", "SHOPIFY", "keep"]) {
    const h = await runSync({
      draftOverrides: { shopify_media_mode: mode },
      images: [linkedA],
      media: [imageNode("gid://shopify/MediaImage/A", "主圖1"), imageNode("gid://shopify/MediaImage/B", "詳情圖")]
    });
    assert.equal(h.result.code, "removal_confirmation_required", `mode=${String(mode)} → ${JSON.stringify(h.result)}`);
  }
});

// The 3c67c42b / 6ede08ef shape: Shopify gallery has extra images, tool has an image Shopify does not have,
// and a linked image whose alt was edited on Shopify.
const keepImages = () => [
  toolImage(0, { shopify_media_id: "gid://shopify/MediaImage/A" }),
  toolImage(1)
];
const keepMedia = [
  imageNode("gid://shopify/MediaImage/A", "老闆在 Shopify 改的 alt"),
  imageNode("gid://shopify/MediaImage/B", "詳情圖1"),
  imageNode("gid://shopify/MediaImage/C", "詳情圖2"),
  videoNode("https://youtu.be/bbbbbbbbbbb", "gid://shopify/ExternalVideo/9")
];
await check("KM08 shopify mode: extra Shopify images/video + tool-only image → ok, ZERO media writes, gallery identical", async () => {
  const h = await runSync({ draftOverrides: { shopify_media_mode: "shopify", video_urls: [WATCH] }, images: keepImages(), media: keepMedia });
  assert.equal(h.result.ok, true, JSON.stringify(h.result));
  assert.deepEqual(mediaWrites(h), []);
  assert.deepEqual(h.shop.state.product.media.nodes, h.mediaBefore);
  assert.equal(h.draftRow.shopify_sync_status, "synced");
  assert.ok(h.draftRow.shopify_sync_baseline, "baseline must be written on success");
  assert.equal(h.jobs.length, 1);
  assert.equal(h.jobs[0].status, "completed");
});
await check("KM09 shopify mode: tool image rows are not touched (no new links, hashes stay as they were)", async () => {
  const before = keepImages();
  const h = await runSync({ draftOverrides: { shopify_media_mode: "shopify" }, images: before, media: keepMedia });
  assert.equal(h.result.ok, true, JSON.stringify(h.result));
  assert.deepEqual(h.db.tables.product_images, before);
});
await check("KM10 shopify mode: no baseline + image counts differ (identity conflict case) → still ok", async () => {
  const h = await runSync({
    draftOverrides: { shopify_media_mode: "shopify" },
    images: [toolImage(0), toolImage(1)],
    media: [imageNode("gid://shopify/MediaImage/X", "a"), imageNode("gid://shopify/MediaImage/Y", "b"), imageNode("gid://shopify/MediaImage/Z", "c")]
  });
  assert.equal(h.result.ok, true, JSON.stringify(h.result));
  assert.deepEqual(mediaWrites(h), []);
});
await check("KM11 shopify mode: success result carries the exact keep-media warning", async () => {
  const h = await runSync({ draftOverrides: { shopify_media_mode: "shopify" }, images: keepImages(), media: keepMedia });
  assert.equal(h.result.ok, true, JSON.stringify(h.result));
  assert.deepEqual(h.result.warnings, [KEEP_WARNING]);
});
await check("KM12 shopify mode still syncs text: a tool title change reaches Shopify (resolve path = forceRemoteOverwrite)", async () => {
  const h = await runSync({
    forceRemoteOverwrite: true,
    draftOverrides: { shopify_media_mode: "shopify", title_zh: "三麗鷗 吊飾 新標題" },
    snapshotDraftOverrides: { title_zh: "三麗鷗 吊飾" },
    images: keepImages(),
    media: keepMedia
  });
  assert.equal(h.result.ok, true, JSON.stringify(h.result));
  assert.ok(h.shop.calls.includes("SyncProductCore"));
  assert.ok(String(h.shop.state.product.title).includes("新標題"), h.shop.state.product.title);
  assert.deepEqual(mediaWrites(h), []);
});
await check("KM13 tool mode success still returns warnings: [] (no keep-media warning)", async () => {
  const h = await runSync({ images: [toolImage(0, { shopify_media_id: "gid://shopify/MediaImage/A" })], media: [imageNode("gid://shopify/MediaImage/A", "主圖1")] });
  assert.equal(h.result.ok, true, JSON.stringify(h.result));
  assert.deepEqual(h.result.warnings, []);
});

console.log("SYNC-KEEP-MEDIA S — schema, types, wiring");
const MIGRATION = "supabase/migrations/20261025100000_shopify_media_mode.sql";
await check("KM14 migration adds product_drafts.shopify_media_mode ('tool'|'shopify', default 'tool') and marks the 6 batch-6 drafts", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /add column if not exists shopify_media_mode text not null default 'tool'/i);
  assert.match(sql, /check \(shopify_media_mode in \('tool', 'shopify'\)\)/i);
  for (const id of SIX_IDS) assert.ok(sql.includes(id), "missing " + id);
});
await check("KM15 ProductDraft type declares shopify_media_mode", () => {
  assert.match(read("src/types/domain.ts"), /shopify_media_mode\?: "tool" \| "shopify"( \| null)?;/);
});
await check("KM16 sync reads the mode from the draft row, not from the request body", () => {
  const code = read("src/lib/shopify/syncShopifyProduct.ts");
  assert.match(code, /shopify_media_mode/);
  assert.doesNotMatch(read("src/app/api/drafts/[id]/shopify-resolve/route.ts"), /shopify_media_mode|mediaMode/);
});
await check("KM17 wired into verify:all and package.json", () => {
  assert.ok(read("scripts/verify-all.mjs").includes("scripts/verify-sync-keep-media.mjs"));
  assert.equal(JSON.parse(read("package.json")).scripts["verify:sync-keep-media"], "node scripts/verify-sync-keep-media.mjs");
});

console.log(`\nSYNC-KEEP-MEDIA: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
