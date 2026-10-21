/**
 * HOTFIX-1 §10 regression verifier. Entirely offline: real application modules,
 * a fake Shopify GraphQL caller, and in-memory auth/service Supabase doubles.
 * No .env, remote network requests, SQL execution, or application writes.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { register } from "node:module";
import { webcrypto } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
register(pathToFileURL(path.join(root, "scripts/publish-guard-loader.mjs")).href);
const src = (relative) => pathToFileURL(path.join(root, relative)).href;
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
let passed = 0;
const check = async (id, run) => {
  await run();
  passed += 1;
  console.log("  ✓ " + id);
};

// Real code (not copies of the implementations under test).
const repair = await import(src("src/lib/contentGenerator/copyFormatRepair.ts"));
const html = await import(src("src/lib/contentGenerator/htmlFormat.ts"));
const copy = await import(src("src/lib/providers/copy.ts"));
const payload = await import(src("src/lib/shopify/payload.ts"));
const sync = await import(src("src/lib/shopify/syncShopifyProduct.ts"));
const notices = await import(src("src/lib/contentGenerator/saleStatusNotice.ts"));
const localizer = await import(src("src/lib/zhTwLocalizer.ts"));
const capture = await import(src("src/lib/import/mapCaptureFields.ts"));
const roles = await import(src("src/lib/auth/roles.ts"));
const pipeline = await import(src("src/lib/drafts/pipelineStage.ts"));
const captureTypes = await import(src("src/lib/import/captureTypes.ts"));
const queueProvider = await import(src("src/lib/drafts/queueProvider.ts"));
const brokenFaq = "<h3><strong>問題</strong></h3><p>這款音箱是否支援無線連接功能？</p>\n<p>是的，這款音箱支援藍牙無線連接，方便隨時隨地使用。</p>";

console.log("HOTFIX-1 A — copy format");
await check("A1: three plaintext Q/A pairs become canonical 3-h3 3-p HTML", () => {
  const source = [
    "Q：第一題？", "A：第一答。", "",
    "Q：第二題？", "A：第二答。", "",
    "Q：第三題？", "A：第三答。"
  ].join("\n");
  const result = repair.normalizeFaqOutput(source);
  assert.equal((result.match(/<h3>/g) ?? []).length, 3);
  assert.equal((result.match(/<p>/g) ?? []).length, 3);
  assert.equal(result, [
    "<h3><strong>第一題？</strong></h3>\n<p>第一答。</p>",
    "<h3><strong>第二題？</strong></h3>\n<p>第二答。</p>",
    "<h3><strong>第三題？</strong></h3>\n<p>第三答。</p>"
  ].join("\n\n"));
  assert.doesNotMatch(result, /<strong>問題<\/strong>/);
  assert.equal(repair.normalizeFaqOutput("  "), "");
  assert.equal(repair.normalizeFaqOutput("這不是 Q/A"), "");
});
await check("A2: fullwidth/question/answer prefixes and multiline ASCII/CJK joining", () => {
  const output = repair.normalizeFaqOutput([
    "Ｑ：能連接", "藍牙嗎？", "Ａ：支援", "藍牙連線。", "",
    "問：Battery", "life?", "答：About", "8 hours", "",
    "Q：試用？", "A：好。"
  ].join("\n"));
  const pairs = html.extractFaqPairs(output);
  assert.equal(pairs.length, 3);
  assert.equal(pairs[0].question, "能連接藍牙嗎？");
  assert.equal(pairs[0].answer, "支援藍牙連線。");
  assert.equal(pairs[1].question, "Battery life?");
  assert.equal(pairs[1].answer, "About 8 hours");
  assert.equal(pairs[2].answer, "好。");
  assert.equal(repair.normalizeFaqOutput("Q：真的問題？\nA：內容").includes("<h3>"), true);
  assert.equal(repair.normalizeFaqOutput("Q：問題\nA：").trim(), "");
});
await check("A3: real malformed FAQ sample retains true question and answer", () => {
  assert.deepEqual(html.extractFaqPairs(brokenFaq), [{
    question: "這款音箱是否支援無線連接功能？",
    answer: "是的，這款音箱支援藍牙無線連接，方便隨時隨地使用。"
  }]);
});
await check("A4: well-formed legacy HTML remains byte-for-byte identical", () => {
  const good = "<h3><strong>尺寸？</strong></h3>\n<p>約 20cm。</p>\n\n<h3><strong>材質？</strong></h3><p>ABS。</p>";
  assert.equal(repair.repairFaqHtml(good), good);
});
await check("A5: strip placeholder spec labels, preserve other lines", () => {
  assert.equal(repair.repairSpecText("項目:小夜燈\n項目：三檔色溫\n材質: ABS"), "小夜燈\n三檔色溫\n材質: ABS");
  assert.equal(repair.repairSpecText("材質: ABS\n項目：\n尺寸：10cm"), "材質: ABS\n尺寸：10cm");
});
await check("A6: real parseCopySegments wires FAQ and spec repair", () => {
  const source = ["[[generated_faq_html]]", "Q：可以送禮嗎？", "A：可以。", "[[spec]]", "項目:盒裝", "材質: ABS"].join("\n");
  const result = copy.parseCopySegments(source, "test", "test");
  assert.equal(result.generatedFaqHtml, "<h3><strong>可以送禮嗎？</strong></h3>\n<p>可以。</p>");
  assert.equal(result.spec, "盒裝\n材質: ABS");
});
await check("A6b: JSON fallback parser applies the same FAQ and spec repair", () => {
  const json = JSON.stringify({
    enriched_title: "標題",
    generated_faq_html: "Q：可以送禮嗎？\nA：可以。",
    spec: "項目:盒裝\n材質: ABS"
  });
  const result = copy.parseCopyProviderOutput(json, "test", "test");
  assert.equal(result.generatedFaqHtml, "<h3><strong>可以送禮嗎？</strong></h3>\n<p>可以。</p>");
  assert.equal(result.spec, "盒裝\n材質: ABS");
});
await check("A6c: tolerant Q/A prefixes; literal prompt placeholders are dropped", () => {
  const pairs = html.extractFaqPairs(repair.normalizeFaqOutput([
    "- **Q1：** 有附提袋嗎？", "**A1：** 有，附品牌提袋。", "",
    "問題：可以水洗嗎？", "答案：建議手洗。", "",
    "Q2: Type-C 充電嗎？", "回答：是的。"
  ].join("\n")));
  assert.deepEqual(pairs, [
    { question: "有附提袋嗎？", answer: "有，附品牌提袋。" },
    { question: "可以水洗嗎？", answer: "建議手洗。" },
    { question: "Type-C 充電嗎？", answer: "是的。" }
  ]);
  assert.equal(repair.normalizeFaqOutput("Q：問句\nA：答案"), "");
  assert.equal(repair.repairSpecText("材質：內容\n尺寸：約 20cm"), "尺寸：約 20cm");
});
const testDraft = (overrides = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  title_zh: "HOTFIX 測試商品",
  description_html: "測試內文",
  generated_faq_html: "",
  spec_text: "",
  shopify_product_id: "gid://shopify/Product/500",
  shopify_remote_updated_at: "2026-10-15T00:00:00.000Z",
  shopify_sync_hash: "legacy-full-sync",
  shopify_sync_status: "idle",
  generation_tone: "小編聊天口吻",
  sale_status: "",
  twd_price: 299,
  twd_cost: 100,
  cny_price: 20,
  inventory_policy: "continue",
  inventory_quantity: 0,
  product_images: [],
  shopify_tags: [],
  tags: [],
  ...overrides
});
await check("A7: Shopify payload emits repaired true FAQ and spec values", () => {
  const built = payload.buildShopifyProductPayload(testDraft({
    generated_faq_html: "<h3><strong>問題</strong></h3><p>真問句</p>\n<p>真答案</p>",
    spec_text: "項目:小夜燈\n材質: ABS"
  }), "draft");
  const fields = Object.fromEntries(built.product.metafields.map((f) => [f.key, f.value]));
  assert.equal(fields.product_faq, "Q：真問句\nA：真答案");
  assert.equal(fields.product_specs, "小夜燈\n材質: ABS");
});
await check("A8: prompt templates have neither broken placeholder", () => {
  for (const file of [
    "src/lib/providers/systemPromptBase.ts",
    "src/lib/providers/chaochaoPrompt.ts",
    "src/lib/providers/visionProvider.ts",
    "src/lib/providers/productBrief.ts"
  ]) {
    const text = read(file);
    assert.doesNotMatch(text, /<strong>問題<\/strong>/, file);
    assert.doesNotMatch(text, /項目：內容/, file);
  }
});
await check("A9: migration contains §3 exact two regex transformations", () => {
  const spec = read("docs/HOTFIX-1-施工規格-2026-10-16.md");
  const expected = spec.split("## 3. B：修舊資料")[1]?.match(/```sql\n([\s\S]*?)\n```/);
  assert.ok(expected?.[1], "SQL block missing in source spec");
  const sql = read("supabase/migrations/20261016100000_hotfix1_repair_faq_spec_format.sql");
  assert.equal(sql.trimEnd(), expected[1], "migration must match spec §3 exactly");
  assert.equal((sql.match(/update public\.product_drafts/g) ?? []).length, 2);
});

console.log("HOTFIX-1 D — logistics notice position");
const chao = "商品介紹\n這是一段介紹。\n\n收藏亮點\n・小巧\n\n適合誰\n・收藏玩家\n\n商品資訊\n・材質：ABS";
await check("D1: Chaochao notice is first paragraph under 購買提醒, not 商品介紹", () => {
  const notice = notices.saleStatusNoticeHtml("海外代購（約14天）", "潮巢導購版");
  const result = html.formatChaochaoSalesDescriptionHtml(chao, "海外代購（約14天）");
  assert.ok(notice.length > 0);
  assert.ok(!result.startsWith("<h2>商品介紹</h2>" + notice));
  assert.ok(result.includes("<h2>購買提醒</h2>" + notice));
});
await check("D2: notice alone still produces a 購買提醒 section", () => {
  const result = html.formatChaochaoSalesDescriptionHtml(chao, "海外代購（約14天）");
  assert.ok(result.includes("<h2>購買提醒</h2><p>此為海外代購商品"));
});
await check("D3: other tone appends original notice after description", () => {
  const draft = testDraft({ generation_tone: "小編聊天口吻", sale_status: "海外代購（約14天）", description_html: "第一行\n第二行" });
  const built = payload.buildShopifyProductPayload(draft, "draft");
  const notice = notices.saleStatusNoticeHtml(draft.sale_status, draft.generation_tone);
  assert.ok(built.product.descriptionHtml.endsWith(notice));
  assert.ok(built.product.descriptionHtml.indexOf("第一行") < built.product.descriptionHtml.indexOf(notice));
});
await check("D4: empty sale_status creates no logistics notice or empty care section", () => {
  const result = html.formatChaochaoSalesDescriptionHtml(chao, "");
  assert.doesNotMatch(result, /<h2>購買提醒<\/h2>/);
  assert.doesNotMatch(result, /預估約 14 天/);
});

console.log("HOTFIX-1 E — small fixes");
await check("E1: only wrong 適閤 is restored", () => {
  assert.equal(localizer.localizeToTaiwanTraditionalText("适合家用"), "適合家用");
  assert.equal(localizer.localizeToTaiwanTraditionalText("閤家歡樂"), "閤家歡樂");
});
await check("E2: colors with comma-separated values stay in capture spec", () => {
  const result = capture.filterCaptureSpecText("顏色: 紅,黃,黑,白");
  assert.ok(result && result.includes("紅,黃,黑,白"), String(result));
});

// Common in-memory DB that exercises the actual query/update chains.
function fakeDb(initial, { auth = false, role = "admin", userId = "owner-1" } = {}) {
  const tables = initial;
  const writes = [];
  const queries = [];
  let sequence = 0;
  function from(table) {
    const state = { action: "select", predicates: [], filterSpecs: [], patch: null, maybe: false, single: false, count: false };
    const matches = (row) => state.predicates.every((p) => p(row));
    const api = {
      select(_columns, options) { if (options?.count === "exact") state.count = true; return api; },
      eq(key, value) { state.filterSpecs.push(["eq", key, value]); state.predicates.push((r) => r[key] === value); return api; },
      neq(key, value) { state.filterSpecs.push(["neq", key, value]); state.predicates.push((r) => r[key] !== value); return api; },
      in(key, values) { state.filterSpecs.push(["in", key, values]); state.predicates.push((r) => values.includes(r[key])); return api; },
      like(key, pattern) { state.filterSpecs.push(["like", key, pattern]); state.predicates.push((r) => String(r[key] ?? "").startsWith(pattern.replace(/%/g, ""))); return api; },
      lt(key, value) { state.filterSpecs.push(["lt", key, value]); state.predicates.push((r) => r[key] < value); return api; },
      is(key, value) { state.filterSpecs.push(["is", key, value]); state.predicates.push((r) => r[key] === value); return api; },
      contains(key, obj) { state.filterSpecs.push(["contains", key, obj]); state.predicates.push((r) => Object.entries(obj).every(([k, v]) => r[key]?.[k] === v)); return api; },
      order() { return api; }, limit() { return api; },
      single() { state.single = true; return api; },
      maybeSingle() { state.maybe = true; return api; },
      insert(data) { state.action = "insert"; state.patch = data; return api; },
      update(data) { state.action = "update"; state.patch = data; return api; },
      then(resolve, reject) {
        const allRows = tables[table] ?? (tables[table] = []);
        const visible = allRows.filter((r) => !auth || table !== "product_drafts" || role !== "operator" || r.created_by === userId);
        const rows = visible.filter(matches);
        queries.push({ table, action: state.action, filters: state.filterSpecs, isAuth: auth });
        let response;
        if (state.action === "insert") {
          const created = (Array.isArray(state.patch) ? state.patch : [state.patch]).map((row) => ({ id: row.id ?? "fake-" + (++sequence), ...row }));
          allRows.push(...created);
          writes.push({ table, action: "insert", rows: created });
          response = { data: state.single || state.maybe ? created[0] : created, error: null };
        } else if (state.action === "update") {
          for (const row of rows) Object.assign(row, state.patch);
          writes.push({ table, action: "update", rows: rows.map((r) => r.id), patch: state.patch });
          response = { data: state.single || state.maybe ? (rows[0] ?? null) : rows, error: null };
        } else {
          const embedded = rows.map((r) => table === "product_drafts" && !auth
            ? { ...r, product_images: (tables.product_images ?? []).filter((i) => i.draft_id === r.id) }
            : { ...r });
          response = {
            data: state.count ? null : state.single || state.maybe ? (embedded[0] ?? null) : embedded,
            error: state.single && embedded.length === 0 ? { message: "No rows" } : null,
            ...(state.count ? { count: rows.length } : {})
          };
        }
        return Promise.resolve(response).then(resolve, reject);
      }
    };
    return api;
  }
  return { from, writes, queries, tables };
}

console.log("HOTFIX-1 C — Shopify managed metafields deletion");
const ID = "gid://shopify/Product/500";
function shopifyFake({ existingFaq = true, deleteError = false, staleReadback = false, remoteImages = [] } = {}) {
  const state = {
    product: {
      id: ID, title: "舊標題", descriptionHtml: "舊描述", vendor: "舊商家",
      productType: "舊品類", tags: [], handle: "hotfix-test", status: "DRAFT",
      updatedAt: "2026-10-15T00:00:00.000Z",
      variants: { nodes: [{
        id: "gid://shopify/ProductVariant/1", title: "Default Title", sku: "",
        price: "299", compareAtPrice: null, inventoryPolicy: "CONTINUE",
        selectedOptions: [{ name: "Title", value: "Default Title" }],
        inventoryItem: { id: "gid://shopify/InventoryItem/1", tracked: false, inventoryLevels: { nodes: [] } }
      }] },
      media: { nodes: structuredClone(remoteImages) },
      metafields: { nodes: existingFaq ? [{
        id: "gid://shopify/Metafield/5", namespace: "custom", key: "product_faq",
        type: "multi_line_text_field", value: "Q：以前的題目\nA：以前的答案",
        updatedAt: "2026-10-15T00:00:00.000Z"
      }] : [] }
    }
  };
  const calls = [];
  const response = (data) => ({ response: { ok: true, status: 200 }, result: { data } });
  const caller = async (query, variables) => {
    const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "unknown";
    calls.push({ name, variables });
    if (name === "ProductSyncSnapshot") return response({ product: structuredClone(state.product) });
    if (name === "SyncProductCore") {
      Object.assign(state.product, Object.fromEntries(
        ["title", "descriptionHtml", "vendor", "productType", "tags", "status"].map((k) => [k, variables.product[k]])
      ));
      for (const meta of variables.product.metafields ?? []) {
        const found = state.product.metafields.nodes.find((f) => f.namespace === meta.namespace && f.key === meta.key);
        if (found) found.value = meta.value;
        else state.product.metafields.nodes.push({ id: "m-new", updatedAt: "", ...meta });
      }
      return response({ productUpdate: { product: { id: ID }, userErrors: [] } });
    }
    if (name === "DeleteProductMetafields") {
      if (deleteError) return response({ metafieldsDelete: { deletedMetafields: [], userErrors: [{ field: ["metafields"], message: "blocked" }] } });
      if (!staleReadback) {
        const keys = variables.metafields.map((f) => f.namespace + "." + f.key);
        state.product.metafields.nodes = state.product.metafields.nodes.filter((f) => !keys.includes(f.namespace + "." + f.key));
      }
      return response({ metafieldsDelete: { deletedMetafields: variables.metafields, userErrors: [] } });
    }
    if (name === "SyncProductVariants") {
      for (const patch of variables.variants) {
        const variant = state.product.variants.nodes.find((v) => v.id === patch.id);
        if (variant) Object.assign(variant, {
          price: patch.price, sku: patch.inventoryItem?.sku ?? variant.sku,
          compareAtPrice: patch.compareAtPrice, inventoryPolicy: patch.inventoryPolicy
        });
      }
      return response({ productVariantsBulkUpdate: { productVariants: [], userErrors: [] } });
    }
    throw new Error("Unexpected Shopify fake operation " + name);
  };
  return { caller, calls, state };
}
async function syncFixture(settings = {}) {
  const draft = testDraft({
    metafields_json: settings.manual ?? null,
    ...(settings.draftOverrides ?? {})
  });
  const tables = {
    product_drafts: [draft], product_variants: [], product_images: settings.images ?? [],
    team_settings: [], shopify_sync_jobs: []
  };
  const db = fakeDb(tables);
  const shop = shopifyFake(settings);
  const result = await sync.syncShopifyProduct({
    serviceSupabase: db,
    draftId: draft.id,
    createdBy: "owner-1",
    forceRemoteOverwrite: settings.forceRemoteOverwrite ?? false,
    deps: { callGraphQL: shop.caller }
  });
  return { db, shop, result };
}
await check("C1: clear FAQ deletes exactly one existing managed key", async () => {
  const { shop, result } = await syncFixture();
  assert.equal(result.ok, true, JSON.stringify(result));
  const deleteCalls = shop.calls.filter((c) => c.name === "DeleteProductMetafields");
  assert.equal(deleteCalls.length, 1);
  assert.equal(deleteCalls[0].variables.metafields.length, 1);
  assert.equal(deleteCalls[0].variables.metafields[0].key, "product_faq");
  assert.equal(deleteCalls[0].variables.metafields[0].ownerId, ID);
  assert.equal(deleteCalls[0].variables.metafields[0].namespace, "custom");
});
await check("C2: no remote FAQ means no delete mutation", async () => {
  const { shop, result } = await syncFixture({ existingFaq: false });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(shop.calls.filter((c) => c.name === "DeleteProductMetafields").length, 0);
});
await check("C3: manually overridden metafields_json array forbids deletion", async () => {
  const { shop, result } = await syncFixture({ manual: [] });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(shop.calls.filter((c) => c.name === "DeleteProductMetafields").length, 0);
});
await check("C4: metafieldsDelete userErrors fail with Chinese field name", async () => {
  const { shop, result } = await syncFixture({ deleteError: true });
  assert.equal(shop.calls.filter((c) => c.name === "DeleteProductMetafields").length, 1);
  assert.equal(result.ok, false);
  assert.match(result.error, /問與答/);
});
await check("C5: metafield remains on readback produces not_deleted mismatch", async () => {
  const { result } = await syncFixture({ staleReadback: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /metafield\.custom\.product_faq\.not_deleted/);
});


console.log("HOTFIX-1 S — sync-media list alignment and never-synced safety");
await check("S1: only 2 main + 3 variant media survive 10 detail + 1 generated_detail, in payload order", async () => {
  const draftId = testDraft().id;
  const types = ["detail", "variant", "main", "detail", "variant", "main", "detail", "variant",
    "detail", "detail", "detail", "detail", "detail", "detail", "detail", "detail"];
  // Exactly 2 main, 3 variant, 10 detail, 1 generated_detail.
  types[types.length - 1] = "generated_detail";
  assert.equal(types.filter((type) => type === "detail").length, 10);
  const images = types.map((image_type, i) => ({
    id: "row-" + i,
    draft_id: draftId,
    image_type,
    sort_order: types.length - i,
    original_file_url: "https://example.test/hotfix-image-" + i + ".webp",
    alt_text: "圖 " + i,
    ...(image_type === "main" || image_type === "variant"
      ? { shopify_media_id: "gid://shopify/MediaImage/" + i } : {})
  }));
  const expectedImages = images.filter(payload.isShopifyProductMediaImage)
    .sort((a, b) => a.sort_order - b.sort_order);
  const resultPayload = payload.buildShopifyProductPayload(testDraft({ product_images: images }), "draft");
  const imageMedia = resultPayload.media.filter((item) => item.mediaContentType === "IMAGE");
  assert.equal(expectedImages.length, 5);
  assert.equal(imageMedia.length, 5);
  assert.deepEqual(imageMedia.map((item) => item.originalSource),
    expectedImages.map((item) => item.original_file_url));
  const remoteImages = expectedImages.map((item) => ({
    id: item.shopify_media_id,
    alt: item.alt_text,
    mediaContentType: "IMAGE",
    status: "READY",
    image: { url: item.original_file_url }
  }));
  const fixture = await syncFixture({ images, remoteImages });
  assert.equal(fixture.result.ok, true, JSON.stringify(fixture.result));
  assert.notEqual(fixture.result.code, "image_payload_mismatch");
  assert.equal(fixture.shop.calls.filter((call) => call.name === "UpdateProductFiles").length, 0,
    "same rows and payload positions must avoid unexpected alt/media mutations");
});
await check("S2: shared media predicate is used by both payload and sync", () => {
  const payloadSource = read("src/lib/shopify/payload.ts");
  const mediaPredicateSource = read("src/lib/images/shopifyMainImage.ts");
  const syncSource = read("src/lib/shopify/syncShopifyProduct.ts");
  assert.match(payloadSource, /export \{ isShopifyProductMediaImage \} from "@\/lib\/images\/shopifyMainImage"/);
  assert.match(mediaPredicateSource, /export function isShopifyProductMediaImage\(/);
  assert.match(payloadSource, /\.filter\(isShopifyProductMediaImage\)/);
  assert.match(syncSource, /import \{ buildShopifyProductPayload, isShopifyProductMediaImage \} from "@\/lib\/shopify\/payload"/);
  assert.match(syncSource, /\.filter\(isShopifyProductMediaImage\)/);
  assert.doesNotMatch(syncSource, /image_type !== "spec"/);
});
await check("S3: never-synced draft without force stops at 409 before any Shopify write", async () => {
  const { result, db, shop } = await syncFixture({
    draftOverrides: { shopify_remote_updated_at: null }
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.code, "remote_conflict");
  assert.equal(result.error, "這件商品還沒有同步紀錄，無法確認 Shopify 後台是否被手動修改過；已停止覆蓋，請先比對差異");
  assert.equal(db.tables.product_drafts[0].shopify_sync_status, "conflict");
  assert.equal(db.tables.product_drafts[0].shopify_sync_error, "Never synced; remote baseline unknown");
  assert.ok(db.writes.some((write) => write.table === "product_drafts" &&
    write.patch.shopify_sync_status === "conflict"));
  assert.equal(shop.calls.filter((call) => call.name !== "ProductSyncSnapshot").length, 0);
});
await check("S4: never-synced draft with explicit forceRemoteOverwrite can sync", async () => {
  const { result, shop } = await syncFixture({
    draftOverrides: { shopify_remote_updated_at: null },
    forceRemoteOverwrite: true
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(shop.calls.filter((call) => call.name === "SyncProductCore").length, 1);
});
await check("S5: unchanged remote with known baseline retains existing successful sync", async () => {
  const { result, shop } = await syncFixture({
    draftOverrides: { shopify_remote_updated_at: "2026-10-15T00:00:00.000Z" }
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(shop.calls.filter((call) => call.name === "SyncProductCore").length, 1);
});

console.log("HOTFIX-1 F/G — genuine generation-queue route with fake auth/service DB");
const routeFile = "src/app/api/generation-queue/route.ts";
const routeCode = ts.transpileModule(read(routeFile), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: routeFile
}).outputText;
const fullInput = {
  queueVersion: "v1.1", title: "測試", provider: "openai", mode: "test",
  useWebSearch: false, tone: "小編聊天口吻", copyLength: "標準", hasImages: false
};
function queueHarness({ role = "operator", userId = "owner-1", draftOwner = "owner-1", runStatus = "processing", draftStatus = "processing", generationStatus = "processing", runs = true } = {}) {
  const tables = {
    profiles: [{ id: userId, role }],
    product_drafts: [{
      id: "draft-1", created_by: draftOwner, status: draftStatus,
      generation_status: generationStatus, worker_id: null
    }],
    generation_runs: runs ? [{
      id: "run-1", draft_id: "draft-1", status: runStatus,
      input_payload: fullInput, created_at: "2026-10-15T00:00:00.000Z",
      created_by: draftOwner, started_at: "2026-10-15T00:00:00.000Z"
    }] : []
  };
  const service = fakeDb(tables);
  const auth = fakeDb(tables, { auth: true, role, userId });
  auth.auth = { getUser: async () => ({ data: { user: { id: userId } } }) };
  const module = { exports: {} };
  const localRequire = (moduleName) => {
    if (moduleName === "@/lib/auth/roles") return roles;
    if (moduleName === "@/lib/drafts/pipelineStage") return pipeline;
    if (moduleName === "@/lib/import/captureTypes") return captureTypes;
    if (moduleName === "@/lib/drafts/queueProvider") return queueProvider;
    if (moduleName === "@/lib/supabase/server") return {
      createServerSupabaseClient: async () => auth,
      createServiceSupabaseClient: () => service
    };
    if (moduleName === "next/server") return {};
    throw new Error("Unexpected generation-queue import: " + moduleName);
  };
  vm.runInNewContext(routeCode, {
    exports: module.exports, module, require: localRequire,
    Response, Date, Number, Math, String, Array, Object, Set,
    crypto: webcrypto, console, process
  }, { filename: routeFile });
  const post = (body) => module.exports.POST({ json: async () => body }).then(async (response) => ({
    status: response.status, data: await response.json()
  }));
  return { post, service, auth, tables };
}
await check("F1: completed run returns already_completed and writes nothing", async () => {
  const h = queueHarness({ runStatus: "completed", draftStatus: "ready_for_review", generationStatus: "completed" });
  const response = await h.post({ action: "fail", draftId: "draft-1", runId: "run-1" });
  assert.equal(response.status, 200);
  assert.equal(response.data.status, "already_completed");
  assert.equal(h.service.writes.length, 0);
});
await check("F2: processing run + processing draft are conditionally failed", async () => {
  const h = queueHarness();
  const response = await h.post({ action: "fail", draftId: "draft-1", runId: "run-1" });
  assert.equal(response.data.status, "failed");
  assert.equal(h.tables.generation_runs[0].status, "failed");
  assert.equal(h.tables.product_drafts[0].status, "failed");
  assert.equal(h.tables.product_drafts[0].generation_status, "failed");
});
await check("F3: finished draft is not overwritten, though run is marked failed", async () => {
  const h = queueHarness({ draftStatus: "ready_for_review", generationStatus: "completed" });
  const response = await h.post({ action: "fail", draftId: "draft-1", runId: "run-1" });
  assert.equal(response.data.status, "failed");
  assert.equal(h.tables.generation_runs[0].status, "failed");
  assert.equal(h.tables.product_drafts[0].status, "ready_for_review");
  assert.equal(h.tables.product_drafts[0].generation_status, "completed");
});
await check("F4: four frontend already_completed branches show prescribed success feedback", () => {
  const source = read("src/components/listing/GenerationQueueRunner.tsx");
  assert.equal((source.match(/result === "already_completed"/g) ?? []).length, 4);
  assert.equal((source.match(/重生已完成（連線曾中斷，結果已保存）/g) ?? []).length, 2);
  assert.equal((source.match(/已生成完成（連線曾中斷，結果已保存）/g) ?? []).length, 2);
  assert.equal((source.match(/伺服器已完成/g) ?? []).length, 2);
  assert.equal((source.match(/status: "completed", field: job\.input\.regenField/g) ?? []).length, 2);
});
await check("G1: operator cannot access any of the five actions for other person's draft", async () => {
  for (const action of ["enqueue", "fail", "retry", "regen_status", "enqueue_regen"]) {
    const h = queueHarness({ draftOwner: "someone-else" });
    const response = await h.post({
      action, draftId: "draft-1", runId: "run-1",
      input: { ...fullInput, jobKind: "regen_full" }
    });
    assert.equal(response.status, 404, action + " " + JSON.stringify(response));
    assert.equal(response.data.error, "Draft not found", action);
    assert.equal(h.service.writes.length, 0, action + " must not write service-role data");
    assert.equal(h.service.queries.length, 0, action + " must not read using service-role");
  }
});
await check("G2: operator claim filters created_by, admin claim does not", async () => {
  const operator = queueHarness({ draftOwner: "someone-else" });
  const admin = queueHarness({ role: "admin", draftOwner: "someone-else" });
  const opResult = await operator.post({ action: "claim", limit: 1 });
  const adResult = await admin.post({ action: "claim", limit: 1 });
  assert.equal(opResult.status, 200);
  assert.equal(adResult.status, 200);
  const q = (h) => h.service.queries.find((item) => item.table === "generation_runs" &&
    item.filters.some((f) => f[0] === "eq" && f[1] === "status" && f[2] === "pending"));
  assert.ok(q(operator), "operator candidates query missing");
  assert.ok(q(admin), "admin candidates query missing");
  assert.ok(q(operator).filters.some((f) => f[0] === "eq" && f[1] === "created_by" && f[2] === "owner-1"));
  assert.ok(!q(admin).filters.some((f) => f[1] === "created_by"));
});

console.log("HOTFIX-1: " + passed + " checks passed, network/DB writes forbidden.");
