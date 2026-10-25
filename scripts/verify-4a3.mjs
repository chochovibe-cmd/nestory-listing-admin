/**
 * 4a-3 小修合集-1 verifier (written by Claude before construction).
 * ① 詳情圖放上 Shopify switch (image_flags.description_detail) ② 商品庫搜尋全形／半形「｜」
 * ③ OpenAI 429 中文提示. No network, no database. Run from repo root with: npm run verify:4a3
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
const embed = await import(src("src/lib/contentGenerator/descriptionEmbed.ts"));
const payloadLib = await import(src("src/lib/shopify/payload.ts"));
const library = await import(src("src/lib/library/productLibrary.ts"));
const aiErr = await import(src("src/lib/drafts/aiErrorMessage.ts"));
const fail = await import(src("src/lib/drafts/failReasons.ts"));

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

const SUPA = "https://tbgtqwvuohmdxnxisrgr.supabase.co/storage/v1/object/public/product-images/u/d";
const img = (id, image_type, sort_order) => ({
  id,
  image_type,
  sort_order,
  alt_text: null,
  processed_file_url: null,
  original_file_url: `${SUPA}/${image_type}/${id}.webp`,
  generated_file_url: null
});
const IMAGES = [
  img("m1", "main", 0),
  img("v1", "variant", 1),
  img("d9", "detail", 9),
  img("d3", "detail", 3),
  img("d5", "detail", 5),
  img("g1", "generated_detail", 20)
];
const ids = (picks) => picks.map((p) => p.id);
const imgCount = (html) => (html.match(/<img /g) || []).length;

console.log("\n[A] 詳情圖放上 Shopify（image_flags.description_detail）");

await check("A1 isDescriptionDetailEnabled：沒設／其他值＝開；\"off\"（不分大小寫、前後空白）＝關", () => {
  const on = [undefined, null, {}, [], "off", { description_detail: "on" }, { description_detail: true }, { generate_detail: "false" }];
  for (const flags of on) assert.equal(embed.isDescriptionDetailEnabled(flags), true, JSON.stringify(flags));
  for (const v of ["off", " OFF ", "Off"]) assert.equal(embed.isDescriptionDetailEnabled({ description_detail: v }), false, v);
});

await check("A2 mergeDescriptionDetailFlag 只改 description_detail，其他旗標原樣保留", () => {
  const existing = { generate_detail: "false", vision_status: "done", image_review: "approved" };
  const off = embed.mergeDescriptionDetailFlag(existing, false);
  assert.deepEqual(off, { ...existing, description_detail: "off" });
  assert.equal(existing.description_detail, undefined, "不可改到傳入的物件");
  assert.deepEqual(embed.mergeDescriptionDetailFlag(off, true), { ...existing, description_detail: "on" });
  assert.deepEqual(embed.mergeDescriptionDetailFlag(null, false), { description_detail: "off" });
  assert.deepEqual(embed.mergeDescriptionDetailFlag(["x"], true), { description_detail: "on" });
});

await check("A3 沒傳 detailEnabled（現況）：主圖＋排序最前的詳情圖（sort_order 3），行為不變", () => {
  assert.deepEqual(ids(embed.pickDescriptionEmbedImages(IMAGES, "t")), ["m1", "d3"]);
  assert.deepEqual(ids(embed.pickDescriptionEmbedImages(IMAGES, "t", 2, { detailEnabled: true })), ["m1", "d3"]);
  const html = embed.buildDescriptionEmbedHtml(IMAGES, "t");
  assert.equal(imgCount(html), 2);
  assert.ok(html.includes("/detail/d3.webp"));
});

await check("A4 關：描述只放主圖 1 張，不拿詳情圖／合成詳情圖／款式圖補位", () => {
  assert.deepEqual(ids(embed.pickDescriptionEmbedImages(IMAGES, "t", 2, { detailEnabled: false })), ["m1"]);
  const html = embed.buildDescriptionEmbedHtml(IMAGES, "t", { detailEnabled: false });
  assert.equal(imgCount(html), 1);
  assert.ok(html.startsWith("<!-- nestory-desc-embed -->"));
  assert.ok(!/\/(detail|generated_detail|variant)\//.test(html), html);
});

await check("A5 關＋沒有主圖：第一張也不能是詳情圖（改用款式圖）；只有詳情圖時描述不放圖", () => {
  const noMain = IMAGES.filter((i) => i.image_type !== "main");
  assert.deepEqual(ids(embed.pickDescriptionEmbedImages(noMain, "t", 2, { detailEnabled: false })), ["v1"]);
  const onlyDetail = IMAGES.filter((i) => i.image_type === "detail");
  assert.deepEqual(embed.pickDescriptionEmbedImages(onlyDetail, "t", 2, { detailEnabled: false }), []);
  assert.equal(embed.buildDescriptionEmbedHtml(onlyDetail, "t", { detailEnabled: false }), "");
});

await check("A6 appendDescriptionEmbedIfEnabled 帶 detailEnabled；環境變數關閉時仍完全不加圖", () => {
  const on = embed.appendDescriptionEmbedIfEnabled("<p>x</p>", IMAGES, "t", {}, { detailEnabled: true });
  const off = embed.appendDescriptionEmbedIfEnabled("<p>x</p>", IMAGES, "t", {}, { detailEnabled: false });
  assert.equal(imgCount(on), 2);
  assert.equal(imgCount(off), 1);
  assert.equal(embed.appendDescriptionEmbedIfEnabled("<p>x</p>", IMAGES, "t", { DESCRIPTION_EMBED_IMAGES: "0" }, { detailEnabled: true }), "<p>x</p>");
  assert.equal(imgCount(embed.appendDescriptionEmbedIfEnabled("<p>x</p>", IMAGES, "t", {})), 2, "舊呼叫方式（不帶 opts）＝開");
});

await check("A7 embeddedDetailPosition：開＝描述放的是第幾張詳情圖（依 sort_order）；關／沒詳情圖＝null", () => {
  assert.equal(embed.embeddedDetailPosition(IMAGES, {}), 1);
  const shuffled = [img("m1", "main", 0), img("d7", "detail", 7), img("d2", "detail", 2)];
  assert.equal(embed.embeddedDetailPosition(shuffled, null), 1);
  assert.equal(embed.embeddedDetailPosition(IMAGES, { description_detail: "off" }), null);
  assert.equal(embed.embeddedDetailPosition([img("m1", "main", 0), img("v1", "variant", 1)], {}), null);
  assert.equal(embed.embeddedDetailPosition([], {}), null);
});

function draft(imageFlags) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    title_zh: "測試商品",
    taobao_title: null,
    description_html: "商品介紹",
    description_plain: null,
    generation_tone: null,
    sale_status: null,
    shopify_handle: "test-item",
    shopify_tags: [],
    tags: [],
    product_type: null,
    category: null,
    vendor: null,
    sku: null,
    ip_name: null,
    generated_payload_json: {},
    generated_faq_html: null,
    video_urls: [],
    image_flags: imageFlags,
    product_images: IMAGES.map((i) => ({ ...i, draft_id: "d", ocr_text: null, translated_text: null })),
    product_variants: []
  };
}

await check("A8 buildShopifyProductPayload 讀 draft.image_flags：關＝descriptionHtml 只有主圖；開／沒設＝主圖＋詳情圖", () => {
  const off = payloadLib.buildShopifyProductPayload(draft({ description_detail: "off" }), "draft").product.descriptionHtml;
  const on = payloadLib.buildShopifyProductPayload(draft({ description_detail: "on" }), "draft").product.descriptionHtml;
  const unset = payloadLib.buildShopifyProductPayload(draft({}), "draft").product.descriptionHtml;
  assert.ok(off.includes("/main/m1.webp") && !off.includes("/detail/"), off);
  assert.ok(on.includes("/detail/d3.webp"), on);
  assert.equal(unset, on, "沒設＝開，已上架商品同步時描述不變");
});

await check("A9 payload.ts／matrixify.ts 都把 isDescriptionDetailEnabled(draft.image_flags) 傳進嵌圖；showmore.ts 不動", () => {
  for (const file of ["src/lib/shopify/payload.ts", "src/lib/csv/matrixify.ts"]) {
    const s = read(file);
    assert.match(s, /isDescriptionDetailEnabled\(draft\.image_flags\)/, file);
  }
  assert.ok(!read("src/lib/csv/showmore.ts").includes("isDescriptionDetailEnabled"), "showmore 這包不改");
});

console.log("\n[B] 開關畫面（共用元件、沿用 .s2-compose-row／.toggle，不加新樣式）");

const ROW = "src/components/listing/result-card/DescriptionDetailToggleRow.tsx";
await check("B1 DescriptionDetailToggleRow：文案、class、aria-label 照規格", () => {
  const s = read(ROW);
  for (const text of [
    "詳情圖放上 Shopify",
    "開：商品描述最下面會放 1 張詳情圖",
    "（第 ${embeddedPosition} 張）",
    "關：詳情圖都不放上 Shopify，只留在工具給 AI 讀字",
    "已上架：改完要再按「同步 Shopify」，店面才會更新",
    'className="s2-compose-row"',
    'className="s2-compose-copy"',
    'className="s2-compose-title"',
    'className="s2-compose-hint"',
    'className="toggle"',
    'className="toggle-slider"',
    'aria-label="詳情圖放上 Shopify"',
    "export type DescriptionDetailControl"
  ]) assert.ok(s.includes(text), "缺：" + text);
  assert.ok(!s.includes("style="), "不准 inline style");
});

await check("B2 站③ 圖片頁籤：開關放在詳情圖縮圖列正上方（同一個「有詳情圖才顯示」區塊內）", () => {
  const s = read("src/components/listing/result-card/ResultCardImagesPanel.tsx");
  const guard = s.indexOf('imageMarks.some((image) => image.image_type === "detail") ? (');
  const row = s.indexOf("<DescriptionDetailToggleRow {...descriptionDetail} />");
  const thumbs = s.indexOf('<div className="thumbs">', guard);
  assert.ok(guard > 0 && row > guard && thumbs > row, `guard=${guard} row=${row} thumbs=${thumbs}`);
  assert.match(s, /descriptionDetail: DescriptionDetailControl;/);
});

await check("B3 站② 標圖站：只在「詳情圖」子分頁且有詳情圖時，放在「生成詳情圖」那列下面", () => {
  const s = read("src/components/listing/Station2ImagePanel.tsx");
  const compose = s.indexOf('aria-label="生成詳情圖"');
  const row = s.indexOf("<DescriptionDetailToggleRow {...descriptionDetail} />");
  const subtabs = s.indexOf('className="s2-img-subtabs"');
  assert.ok(compose > 0 && row > compose && subtabs > row, `compose=${compose} row=${row} subtabs=${subtabs}`);
  assert.match(s, /descriptionDetail && subtab === "detail" && images\.some\(\(image\) => image\.image_type === "detail"\)/);
  assert.match(s, /descriptionDetail\?: DescriptionDetailControl;/);
});

await check("B4 ResultCard：merge 寫入 image_flags、成功才更新畫面、標成待同步、toast 文案", () => {
  const s = read("src/components/listing/ResultCard.tsx");
  const start = s.indexOf("async function setDescriptionDetail(enabled: boolean)");
  assert.ok(start > 0, "缺 setDescriptionDetail");
  const body = s.slice(start, s.indexOf("\n  }\n", start));
  for (const text of [
    "mergeDescriptionDetailFlag(draftImageFlags, enabled)",
    '.from("product_drafts")',
    ".update({ image_flags: nextFlags })",
    ".eq(\"id\", draft.id)",
    "詳情圖上架開關儲存失敗：${error.message}",
    "setDraftImageFlags(nextFlags)",
    "await markShopifyDirty()",
    "（已上架：按「同步 Shopify」後生效）",
    "已開啟：描述會放 1 張詳情圖",
    "已關閉：詳情圖不放上 Shopify，仍留給 AI 讀字"
  ]) assert.ok(body.includes(text), "缺：" + text);
  assert.ok(body.indexOf("if (error)") < body.indexOf("setDraftImageFlags(nextFlags)"), "失敗時不可先改畫面");
  assert.match(s, /descriptionDetail=\{descriptionDetailControl\}[\s\S]{0,80}draftId=\{draft\.id\}/, "站② 傳入");
  assert.match(s, /<ResultCardImagesPanel\s+descriptionDetail=\{descriptionDetailControl\}/, "站③ 傳入");
});

await check("B5 不新增 CSS：globals.css 沒有這包的新 class、沒有新 !important", () => {
  const css = read("src/app/globals.css");
  assert.ok(!/description-detail|desc-detail|[\s,{}]\.detail-toggle|s2-desc/i.test(css), "不准為這包加 class");
  for (const f of [ROW, "src/components/listing/result-card/ResultCardImagesPanel.tsx"]) {
    assert.ok(!read(f).includes("!important"), f);
  }
});

console.log("\n[C] 商品庫搜尋：全形／半形一樣找得到");

const row = (title) => ({ title_zh: title, original_title: null, taobao_title: null, ip_name: null, character_name: null, shopify_product_id: null });
await check("C1 normalizeLibrarySearchText：全形轉半形、轉小寫、｜和 | 當空白、空白合併", () => {
  assert.equal(library.normalizeLibrarySearchText("七龍珠｜球拍"), "七龍珠 球拍");
  assert.equal(library.normalizeLibrarySearchText("  七龍珠 | 球拍  "), "七龍珠 球拍");
  assert.equal(library.normalizeLibrarySearchText("ＨＯＬＬＹ　ＢＯＸ１２３"), "holly box123");
  assert.equal(library.normalizeLibrarySearchText(null), "");
});

await check("C2 matchesLibraryQuery：「七龍珠｜球拍」「七龍珠|悟空」都找得到「七龍珠 | 球拍 悟空」", () => {
  const r = row("七龍珠 | 球拍 悟空");
  for (const q of ["七龍珠｜球拍", "七龍珠|球拍", "七龍珠 | 球拍", "七龍珠|悟空", "  ", ""]) {
    assert.equal(library.matchesLibraryQuery(r, q), true, q);
  }
  assert.equal(library.matchesLibraryQuery(row("Hello Kitty 貼紙"), "ｈｅｌｌｏ　ｋｉｔｔｙ"), true);
  assert.equal(library.matchesLibraryQuery(row("海賊王｜草帽"), "海賊王 | 草帽"), true);
  assert.equal(library.matchesLibraryQuery(r, "海賊王"), false);
});

console.log("\n[D] OpenAI 429 改中文");

const QUOTA_RAW = `OpenAI copy generation failed (429): {
    "error": {
        "message": "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.",
        "type": "insufficient_quota",
        "param": null,
        "code": "credit_balance_exhausted"
    }
}`;
await check("D1 正式資料庫 10-22 那 3 筆原文 → 額度用完", () => {
  assert.equal(aiErr.humanizeAiError(QUOTA_RAW), aiErr.AI_QUOTA_EXHAUSTED_MESSAGE);
  assert.equal(aiErr.AI_QUOTA_EXHAUSTED_MESSAGE, "OpenAI 額度用完了：請到 OpenAI 後台儲值，再重新生成");
  assert.equal(aiErr.humanizeAiError('OpenAI vision call failed (429): {"error":{"code":"insufficient_quota"}}'), aiErr.AI_QUOTA_EXHAUSTED_MESSAGE);
});

await check("D2 OpenAI 其他 429（太忙）→ 稍後再試", () => {
  const busy = 'OpenAI copy generation failed (429): {"error":{"type":"requests","code":"rate_limit_exceeded"}}';
  assert.equal(aiErr.humanizeAiError(busy), aiErr.AI_RATE_LIMITED_MESSAGE);
  assert.equal(aiErr.AI_RATE_LIMITED_MESSAGE, "OpenAI 暫時太忙（429）：稍等一兩分鐘再重新生成");
  assert.equal(aiErr.humanizeAiError("Product Brief failed (429): openai rate limit"), aiErr.AI_RATE_LIMITED_MESSAGE);
});

await check("D3 不是 OpenAI 429 的訊息原樣不動", () => {
  for (const t of [
    "Anthropic copy generation failed (429): overloaded",
    "OpenAI vision call failed (500): server error",
    "缺成本，請先確認",
    "OpenAI copy generation failed (4290)"
  ]) assert.equal(aiErr.humanizeAiError(t), t);
  assert.equal(aiErr.humanizeAiError(null), "");
  assert.equal(aiErr.humanizeAiError("  x  "), "x");
});

await check("D4 卡片失敗原因（formatDraftFailSummary）：舊的英文 generation_error 也顯示中文", () => {
  assert.equal(fail.formatDraftFailSummary({ generation_status: "failed", generation_error: QUOTA_RAW }), aiErr.AI_QUOTA_EXHAUSTED_MESSAGE);
  assert.equal(fail.formatDraftFailSummary({ status: "api_failed", generation_error: null, error_message: QUOTA_RAW }), aiErr.AI_QUOTA_EXHAUSTED_MESSAGE);
  assert.equal(fail.formatDraftFailSummary({ generation_status: "failed", generation_error: "Copy regen failed" }), "Copy regen failed");
  assert.equal(fail.formatDraftFailSummary({ generation_status: "completed", generation_error: QUOTA_RAW }), null);
});

await check("D5 GenerationQueueRunner：toast／進度顯示用中文，回報伺服器的 errorText 保持原文", () => {
  const s = read("src/components/listing/GenerationQueueRunner.tsx");
  assert.match(s, /import \{ humanizeAiError \} from "@\/lib\/drafts\/aiErrorMessage";/);
  assert.ok(s.includes("showToast(`${title}：${humanizeAiError(errorText)}`, \"error\")"), "重生 toast");
  assert.ok(s.includes("error: humanizeAiError(errorText),"), "重生狀態");
  assert.ok(s.includes("showToast(`${title}：${humanizeAiError(errorText)}（可單件重試）`, \"error\")"), "生成 toast");
  assert.ok(s.includes('["done", imageStep, "error", "pending"], humanizeAiError(errorText))'), "生成進度");
  assert.equal((s.match(/reportNetworkFailure\(job, errorText\)/g) || []).length, 2, "回報伺服器仍用原文");
  for (const f of ["src/lib/providers/openai-copy-provider.ts", "src/app/api/generate/route.ts"]) {
    assert.ok(!read(f).includes("humanizeAiError"), f + " 不改（資料庫保留原文）");
  }
});

console.log("\n[E] 接線");
await check("E1 package.json 有 verify:4a3、verify-all 有跑這支", () => {
  assert.match(read("package.json"), /"verify:4a3": "node scripts\/verify-4a3\.mjs"/);
  assert.ok(read("scripts/verify-all.mjs").includes('"scripts/verify-4a3.mjs"'));
});

console.log(`\n4a-3: ${passed} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
