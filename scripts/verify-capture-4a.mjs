/**
 * 4a CAPTURE-REVIEWS + CAPTURE-FILTER verifier (written by Claude before construction).
 * Real fixtures: scripts/fixtures/capture-4a/ (tmall1/taobao1 saved 2026-10-20 by the owner;
 * 8c4b315a = production capture of 2026-10-15 with the constant 「全新盒装：正版授权」 axis).
 * No network, no database. Run from repo root with: npm run verify:capture-4a
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register, createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const require = createRequire(import.meta.url);
const { parseHTML } = require("linkedom");
globalThis.NestoryCap = {};
for (const name of [
  "extension/lib/selectors.js", "extension/lib/domUtil.js", "extension/lib/parsePrice.js",
  "extension/lib/flattenSku.js", "extension/lib/adapters/taobao.js", "extension/lib/buildPayload.js"
]) require(path.join(root, name));
const Cap = globalThis.NestoryCap;
register(pathToFileURL(path.join(root, "scripts/publish-guard-loader.mjs")).href);
const src = (name) => pathToFileURL(path.join(root, name)).href;
const reviewsLib = await import(src("src/lib/import/sourceReviews.ts"));
const sharedLib = await import(src("src/lib/import/captureSharedImages.ts"));
const restoreImg = await import(src("src/lib/images/restoreExcludedDetailImage.ts"));
const mapLib = await import(src("src/lib/import/mapCaptureFields.ts"));
const refresh = await import(src("src/lib/import/refreshCapture.ts"));
const nameRules = await import(src("src/lib/variants/variantNameRules.ts"));
const tiers = await import(src("src/lib/drafts/warningTiers.ts"));

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

const FIX = "scripts/fixtures/capture-4a/";
const fixJson = (name) => JSON.parse(read(FIX + name));
const tmallRate = fixJson("tmall1-ice-rate.json");
const taobaoRate = fixJson("taobao1-ice-rate.json");
const emptyDoc = () => parseHTML("<html><body></body></html>").document;
const SELLER = "2218808631338";
const img = (id, owner = SELLER) => `https://img.alicdn.com/imgextra/i1/${owner}/O1CN01${id}_!!${owner}.jpg`;

function tmallPage({ withIce = true, withComments = false } = {}) {
  const ice = {
    loaderData: { home: { data: { res: {
      item: { title: "测试商品" },
      ...(withIce ? { rateVO: tmallRate.rateVO, itemEndorseVO: tmallRate.itemEndorseVO } : {})
    } } } }
  };
  const html = `<html><body><div class="ItemTitle--x"><span class="mainTitle--y">测试商品</span></div>
<div class="tabDetailWrap--a">${withComments ? read(FIX + "tmall1-comments.html") : ""}</div>
<div class="description--z"><div class="desc-root"><div class="descV8-container">
<img class="descV8-singleImage-image" src="${img("aaaaaaaaaaaaaaaaaaaa1")}">
<img class="descV8-singleImage-image" src="${img("aaaaaaaaaaaaaaaaaaaa2")}">
<img class="descV8-singleImage-image" src="https://assets.alicdn.com/kissy/1.0.0/build/imglazyload/spaceball.gif">
<img class="descV8-singleImage-image" src="${img("aaaaaaaaaaaaaaaaaaaa3")}">
</div></div>
<div class="recommendWrap--q"><img src="${img("rrrrrrrrrrrrrrrrrrrr1", "2200000000001")}"><img src="${img("rrrrrrrrrrrrrrrrrrrr2", "2200000000001")}"></div>
<div class="GuessULike--g"><img src="${img("gggggggggggggggggggg1", "2200000000002")}"></div></div>
<script>window.__ICE_APP_CONTEXT__ = ${JSON.stringify(ice)};</script></body></html>`;
  return parseHTML(html).document;
}
const TMALL = { href: "https://detail.tmall.com/item.htm?id=915722142018", host: "detail.tmall.com" };

console.log("\n[A] 外掛：買家評價摘要（source_reviews）");

await check("A1 tmall1 ICE rateVO → 標籤 7 個、好評率、評價數、2 則短評、回頭客/加購", () => {
  const r = Cap.adapters.taobaoSourceReviews(emptyDoc(), { rateVO: tmallRate.rateVO, itemEndorseVO: tmallRate.itemEndorseVO });
  assert.equal(r.source, "ice");
  assert.equal(r.total_text, "200+");
  assert.equal(r.good_rate_text, "好评率98.6%");
  assert.equal(r.tags.length, 7);
  assert.deepEqual(r.tags[0], { text: "外观设计很可爱", count: 16 });
  assert.deepEqual(r.tags[2], { text: "包装很好", count: 3 });
  assert.equal(r.samples.length, 2);
  assert.deepEqual(r.samples[0], { text: "包装很用心，拆开超有仪式感。", sku: "【纸夹透卡盲袋】整盒24包", date: "2026-09-12" });
  assert.ok(r.signals.includes("回头客135人"), JSON.stringify(r.signals));
  assert.ok(r.signals.includes("超800人加购"));
});

await check("A2 不存買家個資：暱稱、頭像、feedId 都不在結果裡", () => {
  const r = Cap.adapters.taobaoSourceReviews(emptyDoc(), { rateVO: tmallRate.rateVO, itemEndorseVO: tmallRate.itemEndorseVO });
  const json = JSON.stringify(r);
  for (const bad of ["测试用户", "example.invalid", "headPic", "userName", "feedId", "memberLevel"]) {
    assert.ok(!json.includes(bad), "leaked " + bad);
  }
  assert.deepEqual(Object.keys(r).sort(), ["good_rate_text", "samples", "signals", "source", "tags", "total_text"]);
});

await check("A3 taobao1 只有評價數 27 → 仍回傳（total_text=27，其他空陣列，好評率 null）", () => {
  const r = Cap.adapters.taobaoSourceReviews(emptyDoc(), { rateVO: taobaoRate.rateVO, itemEndorseVO: null });
  assert.equal(r.source, "ice");
  assert.equal(r.total_text, "27");
  assert.equal(r.good_rate_text, null);
  assert.deepEqual(r.tags, []);
  assert.deepEqual(r.samples, []);
  assert.deepEqual(r.signals, []);
});

await check("A4 沒有 ICE rateVO 時讀畫面上的「用户评价」區塊（source=dom）", () => {
  const doc = parseHTML(`<html><body>${read(FIX + "tmall1-comments.html")}</body></html>`).document;
  const r = Cap.adapters.taobaoSourceReviews(doc, {});
  assert.equal(r.source, "dom");
  assert.equal(r.good_rate_text, "好评率98.6%");
  assert.equal(r.tags.length, 7);
  assert.deepEqual(r.tags[1], { text: "整体感受好", count: 8 });
  assert.equal(r.samples.length, 2);
  assert.equal(r.samples[1].text, "外形确实好看，我很喜欢");
  assert.ok(!JSON.stringify(r).includes("测试用户"));
});

await check("A5 兩種來源都沒有 → null；captureTaobao／payload 不帶 source_reviews", () => {
  assert.equal(Cap.adapters.taobaoSourceReviews(emptyDoc(), {}), null);
  assert.equal(Cap.adapters.taobaoSourceReviews(emptyDoc(), null), null);
  const doc = tmallPage({ withIce: false });
  const r = Cap.adapters.taobao(doc, TMALL.href, TMALL.host);
  assert.ok(!("source_reviews" in r) || r.source_reviews == null);
  const body = Cap.buildCapturePayload(doc, TMALL);
  assert.ok(!("source_reviews" in body));
});

await check("A6 上限：標籤 ≤12、短評 ≤5、每則 ≤300 字、signals ≤6", () => {
  const many = {
    rateVO: {
      totalCount: "1万+",
      keywords: Array.from({ length: 20 }, (_, i) => ({ title: "标签" + i, count: String(i) })),
      group: { items: Array.from({ length: 9 }, (_, i) => ({ content: "长".repeat(500) + i, skuInfo: "已购 款" + i, dateTime: "2026-01-0" + (i % 9 + 1) })) }
    },
    itemEndorseVO: { endorseList: Array.from({ length: 9 }, (_, i) => ({ textList: ["信号" + i] })) }
  };
  const r = Cap.adapters.taobaoSourceReviews(emptyDoc(), many);
  assert.equal(r.tags.length, 12);
  assert.equal(r.samples.length, 5);
  assert.ok(r.samples.every((s) => s.text.length <= 300));
  assert.equal(r.samples[0].sku, "款0");
  assert.equal(r.signals.length, 6);
});

await check("A7 整頁擷取：captureTaobao 與 buildCapturePayload 都帶 source_reviews", () => {
  const doc = tmallPage();
  const r = Cap.adapters.taobao(doc, TMALL.href, TMALL.host);
  assert.equal(r.source_reviews.tags.length, 7);
  const body = Cap.buildCapturePayload(doc, TMALL);
  assert.equal(body.source_reviews.total_text, "200+");
});

await check("A8 外掛版本（4a-2 起 0.2.3）、CAPTURE_BUILD 更新、不新增權限", () => {
  const manifest = JSON.parse(read("extension/manifest.json"));
  assert.equal(manifest.version, "0.2.3");
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "storage"]);
  assert.equal(Cap.CAPTURE_BUILD, "capture-20261025-scroll");
  const taobao = read("extension/lib/adapters/taobao.js");
  const start = taobao.indexOf("function taobaoSourceReviews");
  assert.ok(start > 0, "taobao.js 要有 function taobaoSourceReviews");
  const end = taobao.indexOf("\n  function ", start + 10);
  const bodyText = taobao.slice(start, end > 0 ? end : undefined);
  assert.ok(!/fetch\(|XMLHttpRequest|\.click\(\)|scrollTo|scrollIntoView/.test(bodyText), "taobaoSourceReviews 只能讀已載入的資料，不准發請求、點按鈕或捲動");
});

console.log("\n[B] 外掛：詳情圖過濾");

await check("B1 網頁載入用的空白小圖（imglazyload／spaceball）不算詳情圖", () => {
  const r = Cap.adapters.taobao(tmallPage(), TMALL.href, TMALL.host);
  assert.ok(!r.detail_image_urls.some((u) => /spaceball|imglazyload/.test(u)), JSON.stringify(r.detail_image_urls));
});

await check("B2 「本店推薦／看了又看」區塊裡的圖不算詳情圖；商品自己的 3 張照收", () => {
  const r = Cap.adapters.taobao(tmallPage(), TMALL.href, TMALL.host);
  assert.deepEqual(r.detail_image_urls, [img("aaaaaaaaaaaaaaaaaaaa1"), img("aaaaaaaaaaaaaaaaaaaa2"), img("aaaaaaaaaaaaaaaaaaaa3")]);
});

console.log("\n[C] 後台：店家共用宣傳圖");

const HOLLY = "https://img.alicdn.com/imgextra/i2/2220960938105/O1CN01ocq71f29k9FtmAEce~crop,0,0,819,1638~_!!2220960938105.png";
const own = (n) => `https://img.alicdn.com/imgextra/i2/2220960938105/O1CN01own${String(n).padStart(15, "x")}_!!2220960938105.jpg`;
const hist = (id, urls) => ({ source_url: `https://detail.tmall.com/item.htm?id=${id}`, detail_image_urls: urls });

await check("C1 detailImageKey：同一張圖不同尺寸／webp 後綴得到同一個 key", () => {
  const a = sharedLib.detailImageKey(HOLLY);
  assert.equal(a, "O1CN01ocq71f29k9FtmAEce");
  assert.equal(sharedLib.detailImageKey(HOLLY.replace(".png", ".png_.webp")), a);
  const b = sharedLib.detailImageKey("https://img.alicdn.com/imgextra/i3/O1CN01XU1Y2d1Sk7fIMOkeU_!!6000000002284-2-tps-1125-1446.png");
  assert.equal(b, "O1CN01XU1Y2d1Sk7fIMOkeU", "key = O1CN 開頭的英數字（不含後面的 _ ~ !!）");
  assert.equal(sharedLib.detailImageKey("https://cdn.example.com/a/b_400x400.jpg"), sharedLib.detailImageKey("https://cdn.example.com/a/b.jpg"));
});

await check("C2 同一張圖已出現在 ≥2 件「其他商品」→ 排除並記錄；只出現在 1 件 → 保留", () => {
  assert.equal(sharedLib.SHARED_IMAGE_MIN_OTHER_ITEMS, 2);
  const current = [own(1), own(2), own(3), HOLLY];
  const out = sharedLib.pickSharedDetailImages({
    detailImageUrls: current,
    sourceUrl: "https://detail.tmall.com/item.htm?id=900000000001",
    history: [hist("800000000001", [HOLLY.replace(".png", ".png_.webp")]), hist("800000000002", [HOLLY, own(9)])]
  });
  assert.deepEqual(out.kept, [own(1), own(2), own(3)]);
  assert.equal(out.excluded.length, 1);
  assert.deepEqual(out.excluded[0], { url: HOLLY, key: "O1CN01ocq71f29k9FtmAEce", reason: "shop_shared", other_items: 2 });
  const once = sharedLib.pickSharedDetailImages({
    detailImageUrls: current,
    sourceUrl: "https://detail.tmall.com/item.htm?id=900000000001",
    history: [hist("800000000001", [HOLLY])]
  });
  assert.deepEqual(once.kept, current);
  assert.deepEqual(once.excluded, []);
});

await check("C3 同一件商品重抓的舊紀錄不算「其他商品」；同一件其他商品出現多次只算 1 件", () => {
  const out = sharedLib.pickSharedDetailImages({
    detailImageUrls: [own(1), own(2), own(3), HOLLY],
    sourceUrl: "https://detail.tmall.com/item.htm?id=900000000001&spm=x",
    history: [
      hist("900000000001", [HOLLY]), hist("900000000001", [HOLLY]),
      hist("800000000001", [HOLLY]), { source_url: "https://detail.tmall.com/item.htm?id=800000000001&sku=1", detail_image_urls: [HOLLY] },
      { source_url: null, detail_image_urls: [HOLLY] }, { source_url: "https://x.test/", detail_image_urls: "not-an-array" }
    ]
  });
  assert.deepEqual(out.excluded, []);
});

await check("C4 保險：要排除的超過詳情圖一半 → 一張都不排除（同系列共用整套詳情）", () => {
  const shared = [own(1), own(2), own(3)];
  const out = sharedLib.pickSharedDetailImages({
    detailImageUrls: [...shared, own(4)],
    sourceUrl: "https://detail.tmall.com/item.htm?id=900000000001",
    history: [hist("800000000001", shared), hist("800000000002", shared)]
  });
  assert.deepEqual(out.kept, [...shared, own(4)]);
  assert.deepEqual(out.excluded, []);
  assert.equal(out.skipped, "too_many");
});

await check("C5 警告文字與分級：「已排除 N 張店家共用宣傳圖」屬於資訊級（跟非商品款式同級）", () => {
  assert.equal(sharedLib.formatSharedImagesExcludedWarning(2), "已排除 2 張店家共用宣傳圖（可在圖片頁籤加回）");
  assert.equal(
    tiers.gradeWarningText("已排除 2 張店家共用宣傳圖（可在圖片頁籤加回）"),
    tiers.gradeWarningText("已排除 2 個非商品款式：「購買須知」（可在規格頁籤恢復）")
  );
});

await check("C6 加回：讀清單、用 index+url 對上才加回、已上架商品擋下、對不上回 404", () => {
  const entry = { url: HOLLY, key: "O1CN01ocq71f29k9FtmAEce", reason: "shop_shared", other_items: 2 };
  const raw = { payload: {}, server: { excluded_detail_images: [entry, { bad: true }] } };
  assert.deepEqual(restoreImg.readExcludedDetailImages(raw), [entry]);
  assert.deepEqual(restoreImg.readExcludedDetailImages(null), []);
  const ok = restoreImg.planRestoreExcludedDetailImage(raw, { index: 0, url: HOLLY, published: false });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.entry, entry);
  assert.deepEqual(ok.nextServer.excluded_detail_images, []);
  const wrong = restoreImg.planRestoreExcludedDetailImage(raw, { index: 0, url: own(1), published: false });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.status, 404);
  const pub = restoreImg.planRestoreExcludedDetailImage(raw, { index: 0, url: HOLLY, published: true });
  assert.equal(pub.ok, false);
  assert.equal(pub.status, 409);
  assert.equal(pub.error, "已上架的商品請到 Shopify 後台加圖");
});

await check("C7 匯入流程有接上：createCaptureDraft 用過濾後的清單抓圖、存 excluded_detail_images", () => {
  const s = read("src/lib/import/createCaptureDraft.ts");
  assert.ok(s.includes("pickSharedDetailImages"), "createCaptureDraft 要呼叫 pickSharedDetailImages");
  assert.ok(s.includes("loadDetailImageHistory"), "createCaptureDraft 要呼叫 loadDetailImageHistory");
  assert.ok(s.includes("excluded_detail_images"), "要寫進 raw_capture.server.excluded_detail_images");
  assert.ok(s.includes("formatSharedImagesExcludedWarning"));
  const route = "src/app/api/drafts/[id]/excluded-images/restore/route.ts";
  assert.ok(fs.existsSync(path.join(root, route)), "缺 " + route);
  const r = read(route);
  assert.ok(r.includes("canOperate") && r.includes("planRestoreExcludedDetailImage") && r.includes("fetchAndStoreCaptureImages"));
});

console.log("\n[D] 後台：款式軸（CAPTURE-FILTER）");

await check("D1 8c4b315a 真實資料：每款都一樣的「全新盒裝：正版授權」不建成款式軸", () => {
  const body = fixJson("8c4b315a-capture.json");
  const m = mapLib.mapCaptureToDraftFields(body, { userId: "u" });
  assert.equal(m.variantDimensions.length, 1, JSON.stringify(m.variantDimensions));
  assert.equal(m.variantDimensions[0].name, "款式描述");
  assert.deepEqual(m.variantDimensions[0].values, ["超極巨化噴火龍", "超級噴火龍Y", "超極巨化耿鬼", "超極巨化伊布", "超極巨化皮卡丘"]);
  assert.equal(m.variantRows.length, 5);
  for (const row of m.variantRows) {
    assert.equal(row.option1_name, "款式描述");
    assert.equal(row.option2_name ?? null, null);
    assert.equal(row.option2_value ?? null, null);
    assert.deepEqual(row.source_options.names, ["全新盒装", "款式描述", null], "source_options 保留原始兩軸（STOCK／重抓靠 source_sku_id，不受影響）");
  }
});

await check("D2 拿掉的軸寫進警告（資訊級）、server.dropped_constant_axes、商品規格", () => {
  const body = fixJson("8c4b315a-capture.json");
  const m = mapLib.mapCaptureToDraftFields(body, { userId: "u" });
  const text = mapLib.formatConstantAxisWarning("全新盒裝", "正版授權");
  assert.equal(text, "款式軸「全新盒裝」每款都是「正版授權」，已併入商品規格，不建成款式");
  assert.ok(m.warnings.includes(text), JSON.stringify(m.warnings));
  assert.equal(tiers.gradeWarningText(text), tiers.gradeWarningText("已排除 2 個非商品款式：「購買須知」（可在規格頁籤恢復）"));
  assert.deepEqual(m.rawCapture.server.dropped_constant_axes, [{ name: "全新盒裝", value: "正版授權" }]);
  assert.ok(String(m.draftRow.spec_text).split("\n").includes("全新盒裝：正版授權"), String(m.draftRow.spec_text));
});

await check("D3 只有一個軸、或另一軸也只有 1 個值時不拿掉；售完排除的款式不同值時也不拿掉", () => {
  const base = fixJson("8c4b315a-capture.json");
  const one = { ...base, sku_table: null, variants_flat: base.variants_flat.map((v) => ({ ...v, option1_name: "款式描述", option1_value: v.option2_value, option2_name: null, option2_value: null })) };
  assert.equal(mapLib.mapCaptureToDraftFields(one, { userId: "u" }).variantDimensions.length, 1);
  const single = { ...base, sku_table: null, variants_flat: [base.variants_flat[0]] };
  const ms = mapLib.mapCaptureToDraftFields(single, { userId: "u" });
  assert.ok(!(ms.rawCapture.server.dropped_constant_axes || []).length, "只有 1 款時不動");
  const flats = base.variants_flat.map((v, i) => (i === 4 ? { ...v, option1_value: "盒损特价", source_stock_status: "sold_out", source_quantity: 0 } : v));
  const md = mapLib.mapCaptureToDraftFields({ ...base, sku_table: null, variants_flat: flats }, { userId: "u" });
  assert.equal(md.variantDimensions.length, 2, "售完款在那個軸的值不同 → 不是固定軸，保留");
});

await check("D4 款式值尾巴的「.」「。」「、」「，」去掉（剩下不到 2 字就保留原樣）", () => {
  assert.equal(nameRules.cleanOptionValue("超极巨化喷火龙."), "超極巨化噴火龍");
  assert.equal(nameRules.cleanOptionValue("超级喷火龙Y。"), "超級噴火龍Y");
  assert.equal(nameRules.cleanOptionValue("皮卡丘、"), "皮卡丘");
  assert.equal(nameRules.cleanOptionValue("A."), "A.");
  assert.equal(nameRules.cleanOptionValue("1.5L"), "1.5L");
});

console.log("\n[E] 後台：評價存放、重抓、卡片");

await check("E1 normalizeSourceReviews：收乾淨、套上限、壞資料回 null；匯入時存進 raw_capture.payload.source_reviews", () => {
  const raw = Cap.adapters.taobaoSourceReviews(emptyDoc(), { rateVO: tmallRate.rateVO, itemEndorseVO: tmallRate.itemEndorseVO });
  const n = reviewsLib.normalizeSourceReviews(raw);
  assert.deepEqual(n, raw);
  assert.equal(reviewsLib.normalizeSourceReviews(null), null);
  assert.equal(reviewsLib.normalizeSourceReviews({ source: "evil", tags: "x" }), null);
  const dirty = reviewsLib.normalizeSourceReviews({ ...raw, userName: "x", samples: [...raw.samples, { text: "", sku: null, date: null }] });
  assert.ok(!("userName" in dirty));
  assert.equal(dirty.samples.length, 2, "空白短評要丟掉");
  assert.deepEqual(reviewsLib.SOURCE_REVIEW_LIMITS, { tags: 12, samples: 5, sampleChars: 300, signals: 6 });
  const body = { ...fixJson("8c4b315a-capture.json"), source_reviews: { ...raw, userName: "x" } };
  const m = mapLib.mapCaptureToDraftFields(body, { userId: "u" });
  assert.deepEqual(m.rawCapture.payload.source_reviews, raw);
  assert.deepEqual(reviewsLib.readSourceReviews(m.rawCapture), raw);
  assert.equal(reviewsLib.readSourceReviews({ payload: {} }), null);
});

function refreshInput(extra = {}) {
  return {
    draft: { id: "d1", shopify_product_id: "gid://shopify/Product/1", cny_price: 99, warnings: [], raw_capture: { payload: { title: "x" }, server: { a: 1 } } },
    variants: [],
    flats: [],
    now: "2026-10-25T00:00:00.000Z",
    ...extra
  };
}

await check("E2 重抓：只有評價變了也會寫入（已上架也可以），訊息「已更新買家評價摘要」", () => {
  const reviews = reviewsLib.normalizeSourceReviews(Cap.adapters.taobaoSourceReviews(emptyDoc(), { rateVO: tmallRate.rateVO, itemEndorseVO: tmallRate.itemEndorseVO }));
  const plan = refresh.planCaptureRefresh(refreshInput({ sourceReviews: reviews }));
  assert.equal(plan.reviews, true);
  assert.equal(plan.message, "已更新買家評價摘要");
  assert.deepEqual(plan.draftPatch.raw_capture.payload.source_reviews, reviews);
  assert.equal(plan.draftPatch.raw_capture.payload.title, "x", "payload 其他欄位不能被蓋掉");
  assert.equal(plan.draftPatch.raw_capture.server.a, 1);
  assert.ok(!("variant_dimensions" in plan.draftPatch) && !("description_html" in plan.draftPatch), "重抓只准寫 raw_capture／warnings／updated_at");
});

await check("E3 重抓：評價沒變或沒抓到 → 跟以前一樣不寫（draftPatch null、message 空）", () => {
  const reviews = reviewsLib.normalizeSourceReviews(Cap.adapters.taobaoSourceReviews(emptyDoc(), { rateVO: tmallRate.rateVO, itemEndorseVO: tmallRate.itemEndorseVO }));
  const same = refreshInput({ sourceReviews: reviews });
  same.draft.raw_capture.payload.source_reviews = reviews;
  const p1 = refresh.planCaptureRefresh(same);
  assert.equal(p1.reviews, false);
  assert.equal(p1.draftPatch, null);
  assert.equal(p1.message, "");
  const p2 = refresh.planCaptureRefresh(refreshInput({ sourceReviews: null }));
  assert.equal(p2.draftPatch, null);
  const p3 = refresh.planCaptureRefresh(refreshInput());
  assert.equal(p3.draftPatch, null);
});

await check("E4 重抓訊息：價格／庫存＋評價一起時接在後面", () => {
  assert.equal(refresh.formatRefreshMessage({ prices: 0, stock: 3, skipped: "published", reviews: true }), "已更新 3 款庫存狀態（已上架，價格沒動）；買家評價摘要已更新");
  assert.equal(refresh.formatRefreshMessage({ prices: 2, stock: 0, skipped: null, reviews: false }), "已更新 2 款價格");
  assert.equal(refresh.formatRefreshMessage({ prices: 0, stock: 0, skipped: null, reviews: true }), "已更新買家評價摘要");
  const s = read("src/lib/import/refreshCapture.ts");
  assert.ok(/sourceReviews:\s*normalizeSourceReviews\(input\.body\.source_reviews\)/.test(s), "refreshExistingCaptureDraft 要把 body.source_reviews 正規化後傳進 planCaptureRefresh");
});

await check("E5 卡片文案頁籤：唯讀顯示「淘寶買家印象（只給你參考，不會上架）」", () => {
  const p = read("src/components/listing/result-card/ResultCardCopyPanel.tsx");
  assert.ok(p.includes("淘寶買家印象（只給你參考，不會上架）"));
  assert.ok(p.includes("sourceReviews"));
  const label = p.indexOf("淘寶買家印象");
  assert.ok(p.indexOf("AI 偵測") < label && label < p.indexOf("規格中繼"), "位置：AI 偵測 之後、規格中繼 之前");
  const card = read("src/components/listing/ResultCard.tsx");
  assert.ok(card.includes("readSourceReviews(draft.raw_capture)"));
});

await check("E6 卡片圖片頁籤：已排除的共用宣傳圖可加回（沿用 vc-excluded 樣式、不新增 CSS）", () => {
  const p = read("src/components/listing/result-card/ResultCardImagesPanel.tsx");
  assert.ok(p.includes("張店家共用宣傳圖"));
  assert.ok(p.includes("CollapsibleSection") && p.includes("vc-excluded") && p.includes("vc-excluded-row"));
  assert.ok(p.includes('referrerPolicy="no-referrer"'));
  assert.ok(p.includes("加回"));
  const card = read("src/components/listing/ResultCard.tsx");
  assert.ok(card.includes("/excluded-images/restore"));
  assert.ok(card.includes("readExcludedDetailImages(draft.raw_capture)"));
});

console.log("\n[F] 小修：圖片警告亂碼");

await check("F1 fetchRemoteImages.ts 的中文警告恢復正常（10-08 被轉碼弄壞）", () => {
  const s = read("src/lib/import/fetchRemoteImages.ts");
  for (const good of [
    "主圖超過上限 ${MAX_MAIN_IMAGES} 張，已截斷（來源 ${input.mainImageUrls.length} 張）",
    "詳情圖超過上限 ${MAX_DETAIL_IMAGES} 張，已截斷（來源 ${input.detailImageUrls.length} 張）",
    "款式縮圖超過上限 ${MAX_VARIANT_IMAGES} 張，已截斷（來源 ${variantSrc.length} 張）",
    "圖片代抓失敗（${job.image_type}）：${fetched.error} · ${truncateUrl(job.url)}",
    "圖片上傳 Storage 失敗（${job.image_type}）：${uploadError.message} · ${truncateUrl(job.url)}",
    "圖片寫入 product_images 失敗（${job.image_type}）：${errMsg} · ${truncateUrl(job.url)}"
  ]) assert.ok(s.includes(good), "缺：" + good);
  assert.ok(!/撘蛛|憭望|銝餃|閰單|甈曉/.test(s), "還有亂碼");
});

await check("G1 已註冊：package.json verify:capture-4a、verify-all 有跑", () => {
  assert.equal(JSON.parse(read("package.json")).scripts["verify:capture-4a"], "node scripts/verify-capture-4a.mjs");
  assert.ok(read("scripts/verify-all.mjs").includes("scripts/verify-capture-4a.mjs"));
});

console.log(`\nverify-capture-4a: ${passed} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
