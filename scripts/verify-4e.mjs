/**
 * 4e DETAIL-LISTING verifier (written by Claude before construction).
 * 詳情圖全部放進商品描述（一個開關，預設開）＋發布／同步時先上傳 Shopify Files，描述只放 Shopify CDN 網址。
 * No network, no database. Run from repo root with: npm run verify:4e
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
register(pathToFileURL(path.join(root, "scripts/publish-guard-loader.mjs")).href);
const src = (name) => pathToFileURL(path.join(root, name)).href;
const flags = await import(src("src/lib/images/detailCompose/flags.ts"));
const rowsMod = await import(src("src/lib/images/descriptionDetailRows.ts"));
const desc = await import(src("src/lib/contentGenerator/descriptionDetailImages.ts"));
const upload = await import(src("src/lib/images/uploadDescriptionImages.ts"));
const payload = await import(src("src/lib/shopify/payload.ts"));
const reconcile = await import(src("src/lib/shopify/reconcileFields.ts"));

let passed = 0;
const failed = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  ✓ " + name);
  } catch (err) {
    failed.push({ name, err });
    console.error("  ✗ " + name + ": " + (err.stack || err));
  }
}

const SUPA = "https://tbgtqwvuohmdxnxisrgr.supabase.co/storage/v1/object/public/product-images/o/d/detail/";
const CDN = "https://cdn.shopify.com/s/files/1/0787/8600/3129/files/";
const img = (id, image_type, sort_order, url, extra = {}) => ({
  id,
  image_type,
  sort_order,
  alt_text: null,
  processed_file_url: url,
  original_file_url: url,
  generated_file_url: null,
  ...extra
});
const imgSrcs = (html) => [...html.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1]);

console.log("\n[A] 開關：image_flags.description_detail_images（預設開）");

await check("A1 isDescriptionDetailImagesEnabled：沒設＝開；false／\"false\"／0／\"0\"／\"off\"／\"no\"＝關", () => {
  assert.equal(flags.DESCRIPTION_DETAIL_IMAGES_FLAG, "description_detail_images");
  for (const v of [null, undefined, {}, [], "x", { other: "1" }, { description_detail_images: "true" }, { description_detail_images: true }]) {
    assert.equal(flags.isDescriptionDetailImagesEnabled(v), true, JSON.stringify(v));
  }
  for (const off of [false, "false", 0, "0", "off", "no", " FALSE "]) {
    assert.equal(flags.isDescriptionDetailImagesEnabled({ description_detail_images: off }), false, String(off));
  }
});

await check("A2 mergeDescriptionDetailImagesFlag：只改這一個 key，存字串 \"true\"／\"false\"", () => {
  const before = { vision_status: "done", generate_detail: "false" };
  const off = flags.mergeDescriptionDetailImagesFlag(before, false);
  assert.deepEqual(off, { vision_status: "done", generate_detail: "false", description_detail_images: "false" });
  assert.deepEqual(before, { vision_status: "done", generate_detail: "false" }, "不可改到傳入的物件");
  assert.deepEqual(flags.mergeDescriptionDetailImagesFlag(null, true), { description_detail_images: "true" });
  assert.deepEqual(flags.mergeDescriptionDetailImagesFlag(["x"], true), { description_detail_images: "true" });
});

console.log("\n[B] 哪些圖、什麼順序、只放 Shopify CDN");

const mixed = [
  img("d2", "detail", 5, CDN + "d2.webp"),
  img("v1", "variant", 1, CDN + "v1.webp"),
  img("g1", "generated_detail", 9, SUPA + "g1.webp", { original_file_url: CDN + "g1.webp" }),
  img("d1", "detail", 3, CDN + "d1.webp"),
  img("s1", "spec", 2, CDN + "s1.webp"),
  img("m1", "main", 0, CDN + "m1.webp"),
  img("d3", "detail", 4, SUPA + "d3.webp")
];

await check("B1 pickDescriptionDetailRows：合成繁中詳情圖排最前，再來詳情圖照 sort_order；主圖／款式圖／規格圖不算", () => {
  assert.deepEqual(rowsMod.pickDescriptionDetailRows(mixed).map((r) => r.id), ["g1", "d1", "d3", "d2"]);
  assert.deepEqual(rowsMod.pickDescriptionDetailRows(null), []);
  assert.equal(rowsMod.isDescriptionDetailImageType("detail"), true);
  assert.equal(rowsMod.isDescriptionDetailImageType("generated_detail"), true);
  assert.equal(rowsMod.isDescriptionDetailImageType("main"), false);
  assert.equal(desc.pickDescriptionDetailRows, rowsMod.pickDescriptionDetailRows, "descriptionDetailImages 要沿用同一個函式");
});

await check("B2 listDescriptionImagesToUpload：只列還沒在 Shopify CDN 的詳情圖（原圖已是 CDN 的合成圖不用再傳）", () => {
  assert.deepEqual(desc.listDescriptionImagesToUpload(mixed).map((r) => r.id), ["d3"]);
  assert.equal(desc.shopifyCdnUrlOf(mixed[2]), CDN + "g1.webp");
  assert.equal(desc.shopifyCdnUrlOf(mixed[6]), null);
});

await check("B3 buildDescriptionImagesHtml：主圖第一，接著全部 CDN 詳情圖照順序；Supabase 網址一張都不放；記號只出現一次", () => {
  const html = desc.buildDescriptionImagesHtml(mixed, "七龍珠 掛飾");
  assert.equal(html.split("<!-- nestory-desc-embed -->").length, 2);
  assert.ok(html.startsWith("<!-- nestory-desc-embed -->"));
  assert.deepEqual(imgSrcs(html), [CDN + "m1.webp", CDN + "g1.webp", CDN + "d1.webp", CDN + "d2.webp"]);
  assert.ok(!html.includes("supabase.co"), "不可嵌 Supabase 網址");
  assert.ok(html.includes('alt="七龍珠 掛飾"'));
  assert.ok(html.includes('loading="lazy" style="max-width:100%;height:auto;"'));
  assert.match(html, /^<!-- nestory-desc-embed -->(<p><img [^>]+ \/><\/p>)+$/);
});

await check("B4 沒有張數上限：20 張詳情圖＋主圖＝21 張；同網址只放一次；alt 會跳脫", () => {
  const many = [img("m", "main", 0, CDN + "m.webp", { alt_text: 'A "B" <C>' })];
  for (let i = 0; i < 20; i++) many.push(img("d" + i, "detail", 10 + i, CDN + "d" + i + ".webp"));
  many.push(img("dup", "detail", 99, CDN + "d0.webp"));
  const html = desc.buildDescriptionImagesHtml(many, "T");
  assert.equal(imgSrcs(html).length, 21);
  assert.ok(html.includes('alt="A &quot;B&quot; &lt;C&gt;"'));
});

await check("B5 主圖：主圖列有 CDN 用它；沒有就用 mainImageUrl（必須是 CDN）；都沒有就不放主圖", () => {
  const rows = [img("m", "main", 0, SUPA + "m.webp"), img("d", "detail", 1, CDN + "d.webp")];
  assert.deepEqual(imgSrcs(desc.buildDescriptionImagesHtml(rows, "T", { mainImageUrl: CDN + "remote.jpg?v=1" })), [CDN + "remote.jpg?v=1", CDN + "d.webp"]);
  assert.deepEqual(imgSrcs(desc.buildDescriptionImagesHtml(rows, "T", { mainImageUrl: SUPA + "x.webp" })), [CDN + "d.webp"]);
  assert.deepEqual(imgSrcs(desc.buildDescriptionImagesHtml(rows, "T")), [CDN + "d.webp"]);
  const cdnMain = [img("m", "main", 0, CDN + "m.webp"), img("d", "detail", 1, CDN + "d.webp")];
  assert.deepEqual(imgSrcs(desc.buildDescriptionImagesHtml(cdnMain, "T", { mainImageUrl: CDN + "remote.jpg" })), [CDN + "m.webp", CDN + "d.webp"]);
  assert.equal(desc.buildDescriptionImagesHtml([], "T"), "");
  assert.equal(desc.buildDescriptionImagesHtml([img("d", "detail", 1, SUPA + "d.webp")], "T"), "");
});

await check("B6 firstShopifyImageUrl：拿 Shopify 商品第一張 IMAGE 的網址，略過影片", () => {
  assert.equal(desc.firstShopifyImageUrl([
    { mediaContentType: "EXTERNAL_VIDEO" },
    { mediaContentType: "IMAGE", image: { url: CDN + "a.jpg" } },
    { mediaContentType: "IMAGE", image: { url: CDN + "b.jpg" } }
  ]), CDN + "a.jpg");
  assert.equal(desc.firstShopifyImageUrl([]), null);
  assert.equal(desc.firstShopifyImageUrl(undefined), null);
});

console.log("\n[C] Shopify 商品內容（payload）");

const baseDraft = (overrides = {}) => ({
  id: "11111111-2222-3333-4444-555555555555",
  title_zh: "七龍珠 掛飾",
  taobao_title: null,
  description_html: "第一段。",
  description_plain: null,
  generation_tone: "潮巢導購版",
  sale_status: "海外代購（約14天）",
  twd_price: 390,
  compare_at_price: null,
  twd_cost: 200,
  cny_price: 40,
  price_mode: "single",
  sku: null,
  inventory_policy: "continue",
  inventory_quantity: 0,
  shopify_tags: [],
  tags: [],
  metafields_json: null,
  generated_payload_json: null,
  generated_faq_html: "<p>Q：會褪色嗎？</p><p>A：不會。</p>",
  video_urls: [],
  ip_name: null,
  image_flags: {},
  product_images: mixed,
  product_variants: [],
  ...overrides
});
const build = (draft, options) => payload.buildShopifyProductPayload(draft, "draft", {}, options);

await check("C1 開關開（預設）：描述放主圖＋全部 CDN 詳情圖，位置在內文之後、內部連結／FAQ 結構化資料之前", () => {
  const html = build(baseDraft()).product.descriptionHtml;
  assert.deepEqual(imgSrcs(html), [CDN + "m1.webp", CDN + "g1.webp", CDN + "d1.webp", CDN + "d2.webp"]);
  const embedAt = html.indexOf("<!-- nestory-desc-embed -->");
  assert.ok(embedAt > html.indexOf("第一段"), "在內文之後");
  const scriptAt = html.indexOf("<script");
  assert.ok(scriptAt === -1 || scriptAt > embedAt, "FAQ JSON-LD 在圖片之後");
  const src = read("src/lib/shopify/payload.ts");
  const block = src.slice(src.indexOf("descriptionHtml:"), src.indexOf("descriptionHtml:") + 700);
  const i1 = block.indexOf("appendDescriptionImagesIfEnabled(");
  assert.ok(i1 > 0 && block.indexOf("buildInternalLinkHtml") > i1 && block.indexOf("buildFaqJsonLdScriptTag") > block.indexOf("buildInternalLinkHtml"), "順序：圖片 → 內部連結 → FAQ");
});

await check("C2 開關關：描述一張圖都不放（主圖也不放）", () => {
  const html = build(baseDraft({ image_flags: { description_detail_images: "false" } })).product.descriptionHtml;
  assert.ok(!html.includes("nestory-desc-embed"));
  assert.ok(!html.includes("<img"));
});

await check("C3 總開關 DESCRIPTION_EMBED_IMAGES=off 時，就算這件開著也不放", () => {
  const prev = process.env.DESCRIPTION_EMBED_IMAGES;
  process.env.DESCRIPTION_EMBED_IMAGES = "off";
  try {
    assert.ok(!build(baseDraft()).product.descriptionHtml.includes("<img"));
  } finally {
    if (prev === undefined) delete process.env.DESCRIPTION_EMBED_IMAGES;
    else process.env.DESCRIPTION_EMBED_IMAGES = prev;
  }
});

await check("C4 options.descriptionMainImageUrl 會傳到主圖（主圖列不是 CDN 時）", () => {
  const draft = baseDraft({ product_images: [img("m", "main", 0, SUPA + "m.webp"), img("d", "detail", 1, CDN + "d.webp")] });
  assert.deepEqual(imgSrcs(build(draft, { descriptionMainImageUrl: CDN + "r.jpg" }).product.descriptionHtml), [CDN + "r.jpg", CDN + "d.webp"]);
  assert.deepEqual(imgSrcs(build(draft).product.descriptionHtml), [CDN + "d.webp"]);
});

await check("C5 Shopify 商品圖（media）還是只有主圖＋款式圖，詳情圖不進圖庫", () => {
  const media = build(baseDraft()).media.filter((m) => m.mediaContentType === "IMAGE");
  assert.equal(media.length, 2);
  assert.ok(media.every((m) => !/\/(d\d|g1|s1)\.webp/.test(m.originalSource)));
});

await check("C6 對帳比對文字忽略圖片區：開／關、多／少張圖都不會被當成「描述被改」", () => {
  const on = build(baseDraft()).product.descriptionHtml;
  const off = build(baseDraft({ image_flags: { description_detail_images: "false" } })).product.descriptionHtml;
  const fewer = build(baseDraft({ product_images: mixed.slice(0, 2) })).product.descriptionHtml;
  assert.equal(reconcile.descriptionCompareText(on), reconcile.descriptionCompareText(off));
  assert.equal(reconcile.descriptionCompareText(on), reconcile.descriptionCompareText(fewer));
});

console.log("\n[D] 上傳 Shopify Files（uploadDescriptionImagesToShopifyFiles）");

function fakeDb() {
  const updates = [];
  return {
    updates,
    storageCalls: 0,
    get storage() {
      this.storageCalls++;
      throw new Error("storage must not be touched");
    },
    from(table) {
      return {
        update(patch) {
          return {
            eq(col, id) {
              updates.push({ table, patch, col, id });
              return Promise.resolve({ error: null });
            }
          };
        }
      };
    }
  };
}
const okUpload = (log, opts = {}) => async (input) => {
  log.push(input);
  opts.active && (opts.active.now++, (opts.active.max = Math.max(opts.active.max, opts.active.now)));
  await new Promise((r) => setTimeout(r, 5));
  opts.active && opts.active.now--;
  if (opts.failName && input.filename.startsWith(opts.failName)) {
    return { ok: false, code: "UPLOAD_FAILED", error: "staged upload HTTP 500" };
  }
  return { ok: true, storage: "shopify_cdn", cdnUrl: CDN + "new-" + input.filename, fileGid: "gid://shopify/MediaImage/" + log.length };
};
const bytesOf = (fetched) => async (url) => {
  fetched.push(url);
  return Buffer.from("img");
};

await check("D1 只傳還沒上 CDN 的詳情圖；成功寫 processed_file_url＋processing_status=done；不動 original_file_url、不碰 Storage", async () => {
  const db = fakeDb();
  const log = [];
  const fetched = [];
  const res = await upload.uploadDescriptionImagesToShopifyFiles({
    serviceSupabase: db,
    draftId: "draft-1",
    images: mixed,
    deps: { upload: okUpload(log), fetchBytes: bytesOf(fetched) }
  });
  assert.equal(res.attempted, 1);
  assert.equal(res.uploaded, 1);
  assert.equal(res.failed, 0);
  assert.deepEqual(res.warnings, []);
  assert.deepEqual(fetched, [SUPA + "d3.webp"]);
  assert.equal(log[0].filename, "d3.webp");
  assert.equal(log[0].mimeType, "image/webp");
  assert.deepEqual(res.cdnById, { d3: CDN + "new-d3.webp" });
  assert.deepEqual(db.updates, [{ table: "product_images", patch: { processed_file_url: CDN + "new-d3.webp", processing_status: "done", processing_error: null }, col: "id", id: "d3" }]);
  assert.equal(db.storageCalls, 0);
  const applied = upload.applyDescriptionImageCdnUrls(mixed, res.cdnById);
  assert.equal(applied.find((r) => r.id === "d3").processed_file_url, CDN + "new-d3.webp");
  assert.equal(applied.find((r) => r.id === "d3").original_file_url, SUPA + "d3.webp");
});

await check("D2 同時最多 4 張並行，20 張全部傳完", async () => {
  const many = [];
  for (let i = 0; i < 20; i++) many.push(img("x" + i, "detail", i, SUPA + "x" + i + ".webp"));
  const active = { now: 0, max: 0 };
  const log = [];
  const res = await upload.uploadDescriptionImagesToShopifyFiles({
    serviceSupabase: fakeDb(),
    draftId: "d",
    images: many,
    deps: { upload: okUpload(log, { active }), fetchBytes: bytesOf([]) }
  });
  assert.equal(upload.DESCRIPTION_UPLOAD_CONCURRENCY, 4);
  assert.equal(res.uploaded, 20);
  assert.equal(active.max, 4);
});

await check("D3 有一張失敗：其他照傳；寫 processing_error；警告文字固定", async () => {
  const rows = [img("a", "detail", 1, SUPA + "a.webp"), img("bad", "detail", 2, SUPA + "bad.webp"), img("c", "detail", 3, SUPA + "c.webp")];
  const db = fakeDb();
  const res = await upload.uploadDescriptionImagesToShopifyFiles({
    serviceSupabase: db,
    draftId: "d",
    images: rows,
    deps: { upload: okUpload([], { failName: "bad" }), fetchBytes: bytesOf([]) }
  });
  assert.equal(res.uploaded, 2);
  assert.equal(res.failed, 1);
  assert.deepEqual(Object.keys(res.cdnById).sort(), ["a", "c"]);
  assert.deepEqual(res.warnings, ["詳情圖上傳 Shopify 失敗 1 張，這次沒放進描述；再同步一次會補上"]);
  assert.ok(db.updates.some((u) => u.id === "bad" && u.patch.processing_error === "staged upload HTTP 500"));
  assert.ok(!db.updates.some((u) => u.id === "bad" && "processed_file_url" in u.patch));
});

await check("D4 超過 120 秒不再開新的上傳，剩下的列警告；下載失敗也算失敗、不會丟例外", async () => {
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push(img("t" + i, "detail", i, SUPA + "t" + i + ".webp"));
  let calls = 0;
  const now = () => (calls++ < 3 ? 0 : 120_000);
  const res = await upload.uploadDescriptionImagesToShopifyFiles({
    serviceSupabase: fakeDb(),
    draftId: "d",
    images: rows,
    deps: { upload: okUpload([]), fetchBytes: bytesOf([]), now }
  });
  assert.equal(upload.DESCRIPTION_UPLOAD_BUDGET_MS, 120_000);
  assert.ok(res.attempted >= 1 && res.attempted < 10, "attempted=" + res.attempted);
  assert.equal(res.skippedForTime, 10 - res.attempted);
  assert.ok(res.warnings.includes(`詳情圖還有 ${res.skippedForTime} 張來不及上傳，這次沒放進描述；再同步一次會補上`));
  const broken = await upload.uploadDescriptionImagesToShopifyFiles({
    serviceSupabase: fakeDb(),
    draftId: "d",
    images: [img("z", "detail", 1, SUPA + "z.webp")],
    deps: { upload: okUpload([]), fetchBytes: async () => { throw new Error("HTTP 404"); } }
  });
  assert.equal(broken.failed, 1);
  assert.deepEqual(broken.warnings, ["詳情圖上傳 Shopify 失敗 1 張，這次沒放進描述；再同步一次會補上"]);
});

await check("D5 重跑不重傳：已經是 CDN 的全部跳過；沒有詳情圖＝什麼都不做", async () => {
  const log = [];
  const done = mixed.map((r) => (r.id === "d3" ? { ...r, processed_file_url: CDN + "new-d3.webp" } : r));
  const res = await upload.uploadDescriptionImagesToShopifyFiles({ serviceSupabase: fakeDb(), draftId: "d", images: done, deps: { upload: okUpload(log), fetchBytes: bytesOf([]) } });
  assert.equal(res.attempted, 0);
  assert.equal(log.length, 0);
  const none = await upload.uploadDescriptionImagesToShopifyFiles({ serviceSupabase: fakeDb(), draftId: "d", images: [img("m", "main", 0, SUPA + "m.webp")], deps: { upload: okUpload(log), fetchBytes: bytesOf([]) } });
  assert.deepEqual(none, { attempted: 0, uploaded: 0, failed: 0, skippedForTime: 0, cdnById: {}, warnings: [] });
});

console.log("\n[E] 發布／同步接線");

const fnBody = (source, start) => {
  const at = source.indexOf(start);
  assert.ok(at >= 0, "找不到 " + start);
  return source.slice(at);
};

await check("E1 同步：先上傳詳情圖、再算要送的內容；只在開關開＋總開關開時；測試注入 callGraphQL 時不碰真 Files", () => {
  const s = fnBody(read("src/lib/shopify/syncShopifyProduct.ts"), "export async function syncShopifyProduct(");
  const guardAt = s.indexOf('code: "unsafe_remote_status"');
  const uploadAt = s.indexOf("await uploadDescriptionImages(");
  const desiredAt = s.indexOf("buildSyncDesiredState({");
  assert.ok(guardAt > 0 && uploadAt > guardAt && desiredAt > uploadAt, "順序：遠端狀態檢查 → 上傳詳情圖 → buildSyncDesiredState");
  assert.match(s, /deps\.uploadDescriptionImages \?\? \(deps\.callGraphQL \? null : uploadDescriptionImagesToShopifyFiles\)/);
  assert.match(s, /isDescriptionEmbedEnabled\(\)/);
  assert.match(s, /isDescriptionDetailImagesEnabled\(draft\.image_flags\)/);
  assert.match(s, /applyDescriptionImageCdnUrls\(draft\.product_images, uploaded\.cdnById\)/);
  assert.match(s, /\.\.\.descriptionImageWarnings/);
});

await check("E2 同步：主圖用 Shopify 現在第一張圖；同步不跑主圖／款式圖的 finalize（避免 Shopify 重傳商品圖）", () => {
  const s = read("src/lib/shopify/syncShopifyProduct.ts");
  assert.match(s, /descriptionMainImageUrl: firstShopifyImageUrl\(before\.media\?\.nodes\)/);
  assert.doesNotMatch(s, /prepareImagesForPublish|runFinalizeForDraft/);
});

await check("E3 發布：prepareImagesForPublish 之後、重新讀草稿之前上傳詳情圖；警告加「發布前圖處理：」前綴", () => {
  const s = read("src/lib/shopify/publishDraftSafe.ts");
  const prepAt = s.indexOf("await prepareImagesForPublish(");
  const upAt = s.indexOf("await uploadDescriptionImages(");
  const freshAt = s.indexOf("const { data: draftFresh }");
  assert.ok(prepAt > 0 && upAt > prepAt && freshAt > upAt, "順序：prepare → 上傳詳情圖 → 重新讀草稿");
  assert.match(s, /deps\.uploadDescriptionImages \?\? \(deps\.callGraphQL \? null : uploadDescriptionImagesToShopifyFiles\)/);
  assert.match(s, /isDescriptionDetailImagesEnabled\(draft\.image_flags\)/);
  assert.match(s, /`發布前圖處理：\$\{warning\}`/);
});

await check("E4 上傳模組不刪 Supabase 檔、不改 original_file_url；finalize 規則不變（仍只有主圖＋款式圖）", () => {
  const u = read("src/lib/images/uploadDescriptionImages.ts");
  assert.doesNotMatch(u, /\.storage\b|\.remove\(|original_file_url:/);
  const f = read("src/lib/images/runFinalize.ts");
  assert.match(f, /if \(!isFinalizeUploadImageType\(img\.image_type\)\) \{/);
  const files = read("src/lib/shopify/filesUpload.ts");
  assert.match(files, /if \(imageType === "main" \|\| imageType === "variant"\) return true;/);
});

await check("E5 CSV（Matrixify／Showmore）不在這包：仍用舊的 D8a 函式", () => {
  assert.match(read("src/lib/csv/matrixify.ts"), /appendDescriptionEmbedIfEnabled\(/);
  assert.match(read("src/lib/csv/showmore.ts"), /appendShowmoreDescriptionEmbedIfEnabled/);
  assert.match(read("src/lib/shopify/payload.ts"), /appendDescriptionImagesIfEnabled\(/);
  assert.doesNotMatch(read("src/lib/shopify/payload.ts"), /appendDescriptionEmbedIfEnabled/);
});

console.log("\n[F] 畫面（位置、文字、樣式寫死）");

await check("F1 審核卡「圖片」分頁：詳情圖縮圖正上方一列開關，沿用 .s2-compose-row／.toggle，文字固定", () => {
  const s = read("src/components/listing/result-card/ResultCardImagesPanel.tsx");
  assert.ok(s.includes('className="s2-compose-row rc-desc-images-row" style={{ marginTop: 10, marginBottom: 0 }}'));
  assert.ok(s.includes('<span className="s2-compose-title">詳情圖放進商品描述</span>'));
  assert.ok(s.includes("`發布／同步時，這 ${descriptionDetailImages.length} 張會放進商品描述（主圖排最前）；不要的按 ✕`"));
  assert.ok(s.includes('"已關閉：商品描述不放圖，詳情圖留在工具給 AI 讀字"'));
  assert.ok(s.includes('aria-label="詳情圖放進商品描述"'));
  assert.ok(s.includes('<label className="toggle" title={descriptionImagesOn ? "點一下關閉" : "點一下開啟"}>'));
  assert.ok(s.includes('<span className="toggle-slider" />'));
  assert.ok(s.includes("disabled={descriptionImagesBusy}"));
  const rowAt = s.indexOf("rc-desc-images-row");
  const thumbsAt = s.indexOf('<div className="thumbs" style={{ marginTop: 10 }}>');
  const excludedAt = s.indexOf("excludedDetailImages.length > 0");
  assert.ok(rowAt > 0 && thumbsAt > rowAt && excludedAt > thumbsAt, "開關列 → 詳情圖縮圖 → 已排除宣傳圖");
});

await check("F2 縮圖列＝描述順序（合成繁中詳情圖在前）；合成圖 alt「繁中合成詳情圖」；沒有詳情圖就整列不顯示", () => {
  const s = read("src/components/listing/result-card/ResultCardImagesPanel.tsx");
  assert.match(s, /const descriptionDetailImages = pickDescriptionDetailRows\(imageMarks\);/);
  assert.ok(s.includes('image.image_type === "generated_detail" ? "繁中合成詳情圖" : "詳情圖"'));
  assert.equal((s.match(/descriptionDetailImages\.length > 0 \?/g) || []).length, 2);
  assert.doesNotMatch(s, /\.filter\(\(image\) => image\.image_type === "detail"\)/);
});

await check("F3 客戶端元件不可 import 伺服器端模組（filesUpload／descriptionDetailImages）", () => {
  for (const f of ["src/components/listing/result-card/ResultCardImagesPanel.tsx", "src/components/listing/ResultCard.tsx", "src/components/listing/Station2ImagePanel.tsx"]) {
    const s = read(f);
    assert.doesNotMatch(s, /shopify\/filesUpload|contentGenerator\/descriptionDetailImages|images\/uploadDescriptionImages/, f);
  }
  assert.doesNotMatch(read("src/lib/images/descriptionDetailRows.ts"), /^import /m, "descriptionDetailRows 不 import 任何東西");
});

await check("F4 ResultCard：開關只合併寫 image_flags、成功才改畫面、已上架就標「待同步」；提示文字固定", () => {
  const s = fnBody(read("src/components/listing/ResultCard.tsx"), "async function setDescriptionImages(");
  const body = s.slice(0, s.indexOf("\n  }\n") + 4);
  assert.match(body, /mergeDescriptionDetailImagesFlag\(draftImageFlags, enabled\)/);
  assert.match(body, /\.from\("product_drafts"\)\s*\.update\(\{ image_flags: next \}\)/);
  assert.ok(body.indexOf("setDraftImageFlags(next)") > body.indexOf("if (error)"));
  assert.ok(body.includes('"詳情圖會放進商品描述" : "詳情圖不放進商品描述"'));
  assert.ok(body.includes("`儲存失敗：${error.message}`"));
  assert.match(body, /await markShopifyDirty\(\)/);
  const card = read("src/components/listing/ResultCard.tsx");
  assert.match(card, /descriptionImagesOn=\{isDescriptionDetailImagesEnabled\(draftImageFlags\)\}/);
  assert.match(card, /onToggleDescriptionImages=\{\(enabled\) => void setDescriptionImages\(enabled\)\}/);
});

await check("F5 已上架商品按 ✕ 刪圖：只刪資料列、保留 Supabase 檔（店面描述可能還在用）", () => {
  const s = fnBody(read("src/components/listing/ResultCard.tsx"), "async function removeImage(");
  const body = s.slice(0, 2500);
  assert.match(body, /keepStorageFiles: hasRealShopifyProduct/);
  assert.match(body, /backgroundStorageCleanup: true/);
});

await check("F6 站②「詳情圖」分頁標題改掉「不上架」，依開關顯示", () => {
  const s = read("src/components/listing/Station2ImagePanel.tsx");
  assert.ok(!s.includes("詳情圖（供 AI 參考，不上架）"));
  assert.ok(s.includes('"詳情圖（會放進商品描述，也給 AI 讀字；開關在審核卡「圖片」分頁）"'));
  assert.ok(s.includes('"詳情圖（這件設定不放進商品描述，只給 AI 讀字）"'));
  assert.match(s, /isDescriptionDetailImagesEnabled\(imageFlags\)/);
});

await check("F7 不新增 CSS 規則、不新增 !important、不新增 migration", () => {
  const css = read("src/app/globals.css");
  assert.ok(!css.includes("rc-desc-images-row"), "沿用 .s2-compose-row，不另寫樣式");
  const migrations = fs.readdirSync(path.join(root, "supabase/migrations"));
  assert.ok(!migrations.some((f) => /description_detail|detail_listing|4e/i.test(f)));
});

await check("F8 已註冊到 verify:all 與 package.json", () => {
  assert.match(read("scripts/verify-all.mjs"), /"scripts\/verify-4e\.mjs"/);
  assert.match(read("package.json"), /"verify:4e":\s*"node scripts\/verify-4e\.mjs"/);
});

console.log(`\n4e DETAIL-LISTING: ${passed} passed, ${failed.length} failed`);
if (failed.length > 0) {
  console.error("Failed: " + failed.map((f) => f.name).join(" | "));
  process.exit(1);
}
