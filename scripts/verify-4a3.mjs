/**
 * 4a-3 小修合集-1 verifier (written by Claude before construction).
 * ① 商品描述放哪幾張詳情圖 (image_flags.description_detail_ids) ② 商品庫搜尋全形／半形「｜」
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

console.log("\n[A] 商品描述放哪幾張詳情圖（image_flags.description_detail_ids）");

await check("A1 readDescriptionDetailSelection：沒設／非字串＝auto；\"none\"／空字串＝none；\"id,id\"＝picked（去重、去空白）", () => {
  for (const flags of [undefined, null, {}, [], "x", { description_detail_ids: 3 }, { generate_detail: "false" }]) {
    assert.deepEqual(embed.readDescriptionDetailSelection(flags), { mode: "auto" }, JSON.stringify(flags));
  }
  for (const v of ["none", " NONE ", "", " , "]) {
    assert.deepEqual(embed.readDescriptionDetailSelection({ description_detail_ids: v }), { mode: "none" }, v);
  }
  assert.deepEqual(embed.readDescriptionDetailSelection({ description_detail_ids: " d5, d3 ,d5,," }), { mode: "picked", ids: ["d5", "d3"] });
  assert.equal(embed.DESCRIPTION_DETAIL_PICK_MAX, 8);
});

await check("A2 mergeDescriptionDetailSelection 只改 description_detail_ids，其他旗標原樣；auto＝拿掉這個 key", () => {
  const existing = { generate_detail: "false", vision_status: "done", image_review: "approved" };
  const none = embed.mergeDescriptionDetailSelection(existing, { mode: "none" });
  assert.deepEqual(none, { ...existing, description_detail_ids: "none" });
  assert.equal(existing.description_detail_ids, undefined, "不可改到傳入的物件");
  assert.deepEqual(embed.mergeDescriptionDetailSelection(none, { mode: "picked", ids: ["d3", "d9"] }), { ...existing, description_detail_ids: "d3,d9" });
  assert.deepEqual(embed.mergeDescriptionDetailSelection(none, { mode: "picked", ids: [] }), { ...existing, description_detail_ids: "none" });
  assert.deepEqual(embed.mergeDescriptionDetailSelection(none, { mode: "auto" }), existing);
  assert.deepEqual(embed.mergeDescriptionDetailSelection(null, { mode: "none" }), { description_detail_ids: "none" });
});

await check("A3 auto（沒傳／mode auto）：主圖＋排序最前的詳情圖（sort_order 3），行為和現在一樣", () => {
  assert.deepEqual(ids(embed.pickDescriptionEmbedImages(IMAGES, "t")), ["m1", "d3"]);
  assert.deepEqual(ids(embed.pickDescriptionEmbedImages(IMAGES, "t", 2, { detailSelection: { mode: "auto" } })), ["m1", "d3"]);
  const html = embed.buildDescriptionEmbedHtml(IMAGES, "t");
  assert.equal(imgCount(html), 2);
  assert.ok(html.includes("/detail/d3.webp"));
});

await check("A4 none：描述只放主圖 1 張，不拿詳情圖／合成詳情圖／款式圖補位", () => {
  const none = { detailSelection: { mode: "none" } };
  assert.deepEqual(ids(embed.pickDescriptionEmbedImages(IMAGES, "t", 2, none)), ["m1"]);
  const html = embed.buildDescriptionEmbedHtml(IMAGES, "t", none);
  assert.equal(imgCount(html), 1);
  assert.ok(html.startsWith("<!-- nestory-desc-embed -->"));
  assert.ok(!/\/(detail|generated_detail|variant)\//.test(html), html);
});

await check("A5 picked：主圖＋勾的詳情圖，照工具排序（不是勾的先後）；不存在的 id、非詳情圖 id 忽略", () => {
  const sel = { detailSelection: { mode: "picked", ids: ["d9", "gone", "g1", "v1", "d3"] } };
  assert.deepEqual(ids(embed.pickDescriptionEmbedImages(IMAGES, "t", 2, sel)), ["m1", "d3", "d9"]);
  const html = embed.buildDescriptionEmbedHtml(IMAGES, "t", sel);
  assert.equal(imgCount(html), 3);
  assert.ok(html.indexOf("/detail/d3.webp") < html.indexOf("/detail/d9.webp"));
});

await check("A6 picked 最多 8 張詳情圖（照排序取前 8）；沒有主圖時第一張不能是詳情圖", () => {
  const many = [img("m1", "main", 0), ...Array.from({ length: 12 }, (_, i) => img(`k${i}`, "detail", 10 + i))];
  const picks = embed.pickDescriptionEmbedImages(many, "t", 2, { detailSelection: { mode: "picked", ids: many.slice(1).map((i) => i.id).reverse() } });
  assert.deepEqual(ids(picks), ["m1", "k0", "k1", "k2", "k3", "k4", "k5", "k6", "k7"]);
  const noMain = IMAGES.filter((i) => i.image_type !== "main");
  assert.deepEqual(ids(embed.pickDescriptionEmbedImages(noMain, "t", 2, { detailSelection: { mode: "none" } })), ["v1"]);
  assert.deepEqual(ids(embed.pickDescriptionEmbedImages(noMain, "t", 2, { detailSelection: { mode: "picked", ids: ["d5"] } })), ["v1", "d5"]);
  const onlyDetail = IMAGES.filter((i) => i.image_type === "detail");
  assert.equal(embed.buildDescriptionEmbedHtml(onlyDetail, "t", { detailSelection: { mode: "none" } }), "");
});

await check("A7 appendDescriptionEmbedIfEnabled 帶 detailSelection；環境變數關閉時仍完全不加圖；舊呼叫＝auto", () => {
  const picked = embed.appendDescriptionEmbedIfEnabled("<p>x</p>", IMAGES, "t", {}, { detailSelection: { mode: "picked", ids: ["d5", "d9"] } });
  const none = embed.appendDescriptionEmbedIfEnabled("<p>x</p>", IMAGES, "t", {}, { detailSelection: { mode: "none" } });
  assert.equal(imgCount(picked), 3);
  assert.equal(imgCount(none), 1);
  assert.equal(embed.appendDescriptionEmbedIfEnabled("<p>x</p>", IMAGES, "t", { DESCRIPTION_EMBED_IMAGES: "0" }, { detailSelection: { mode: "picked", ids: ["d5"] } }), "<p>x</p>");
  assert.equal(imgCount(embed.appendDescriptionEmbedIfEnabled("<p>x</p>", IMAGES, "t", {})), 2);
});

await check("A8 describeDescriptionDetail：回傳模式、會放的詳情圖 id 和「第幾張」（依排序）", () => {
  assert.deepEqual(embed.describeDescriptionDetail(IMAGES, {}), { mode: "auto", ids: ["d3"], positions: [1] });
  assert.deepEqual(embed.describeDescriptionDetail(IMAGES, { description_detail_ids: "none" }), { mode: "none", ids: [], positions: [] });
  assert.deepEqual(embed.describeDescriptionDetail(IMAGES, { description_detail_ids: "d9,d5" }), { mode: "picked", ids: ["d5", "d9"], positions: [2, 3] });
  assert.deepEqual(embed.describeDescriptionDetail([img("m1", "main", 0), img("v1", "variant", 1)], {}), { mode: "auto", ids: [], positions: [] });
});

await check("A9 toggleDescriptionDetailPick：從現在會放的那幾張開始加／減；減到 0＝none；超過 8＝over_max", () => {
  assert.deepEqual(embed.toggleDescriptionDetailPick(IMAGES, {}, "d9"), { mode: "picked", ids: ["d3", "d9"] });
  assert.deepEqual(embed.toggleDescriptionDetailPick(IMAGES, {}, "d3"), { mode: "none" });
  assert.deepEqual(embed.toggleDescriptionDetailPick(IMAGES, { description_detail_ids: "none" }, "d5"), { mode: "picked", ids: ["d5"] });
  assert.deepEqual(embed.toggleDescriptionDetailPick(IMAGES, { description_detail_ids: "d9" }, "d3"), { mode: "picked", ids: ["d3", "d9"] });
  assert.deepEqual(embed.toggleDescriptionDetailPick(IMAGES, { description_detail_ids: "d5" }, "d5"), { mode: "none" });
  const many = [img("m1", "main", 0), ...Array.from({ length: 9 }, (_, i) => img(`k${i}`, "detail", 10 + i))];
  const eight = { description_detail_ids: many.slice(1, 9).map((i) => i.id).join(",") };
  assert.equal(embed.toggleDescriptionDetailPick(many, eight, "k8"), "over_max");
  assert.equal(embed.toggleDescriptionDetailPick(many, eight, "k0").ids.length, 7);
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

await check("A10 buildShopifyProductPayload 讀 draft.image_flags：none＝只有主圖；picked＝主圖＋勾的；沒設＝跟現在一樣", () => {
  const html = (flags) => payloadLib.buildShopifyProductPayload(draft(flags), "draft").product.descriptionHtml;
  const none = html({ description_detail_ids: "none" });
  const picked = html({ description_detail_ids: "d9,d5" });
  assert.ok(none.includes("/main/m1.webp") && !none.includes("/detail/"), none);
  assert.ok(picked.includes("/detail/d5.webp") && picked.includes("/detail/d9.webp") && !picked.includes("/detail/d3.webp"), picked);
  assert.ok(html({}).includes("/detail/d3.webp"));
  assert.equal(html({ generate_detail: "false" }), html({}), "沒設＝auto，已上架商品同步時描述不變");
});

await check("A11 payload.ts／matrixify.ts 都把 readDescriptionDetailSelection(draft.image_flags) 傳進嵌圖；showmore.ts 不動", () => {
  for (const file of ["src/lib/shopify/payload.ts", "src/lib/csv/matrixify.ts"]) {
    assert.match(read(file), /detailSelection: readDescriptionDetailSelection\(draft\.image_flags\)/, file);
  }
  assert.ok(!read("src/lib/csv/showmore.ts").includes("readDescriptionDetailSelection"), "showmore 這包不改");
});

console.log("\n[B] 畫面（共用元件、沿用 .s2-compose-row／.img-mark-btn／.pthumb-spec-badge，不加新樣式）");

const ROW = "src/components/listing/result-card/DescriptionDetailPickRow.tsx";
await check("B1 DescriptionDetailPickRow／Badge：文案、class 照規格，不准 inline style", () => {
  const s = read(ROW);
  for (const text of [
    "export type DescriptionDetailControl",
    "export function DescriptionDetailPickRow",
    "export function DescriptionDetailPickBadge",
    "商品描述放哪幾張詳情圖",
    "主圖＋詳情圖第 ${positions.join(\"、\")} 張",
    "（預設）",
    "只放主圖，詳情圖都留在工具給 AI 讀字",
    "按詳情圖右上角「放描述」可多選（最多 8 張）；有淘寶店名、人民幣價格的圖別放",
    "已上架：改完要再按「同步 Shopify」，店面才會更新",
    "全部不放",
    "恢復預設",
    'className="s2-compose-row"',
    'className="s2-compose-copy"',
    'className="s2-compose-title"',
    'className="s2-compose-hint"',
    'className="imgmark-btns"',
    "img-mark-btn${mode === \"none\" ? \" active\" : \"\"}",
    "pthumb-spec-badge${inDescription ? \" active\" : \"\"}",
    '"✓ 描述" : "放描述"',
    "event.stopPropagation();"
  ]) assert.ok(s.includes(text), "缺：" + text);
  assert.ok(!s.includes("style="), "不准 inline style");
});

await check("B2 站③ 圖片頁籤：列放在詳情圖縮圖列正上方；每張詳情圖有「放描述」角標、✕ 移到左上", () => {
  const s = read("src/components/listing/result-card/ResultCardImagesPanel.tsx");
  const guard = s.indexOf('imageMarks.some((image) => image.image_type === "detail") ? (');
  const row = s.indexOf("<DescriptionDetailPickRow {...descriptionDetail} />");
  const thumbs = s.indexOf('<div className="thumbs">', guard);
  assert.ok(guard > 0 && row > guard && thumbs > row, `guard=${guard} row=${row} thumbs=${thumbs}`);
  assert.match(s, /descriptionDetail: DescriptionDetailControl;/);
  const block = s.slice(thumbs, s.indexOf(") : null}", thumbs));
  assert.ok(block.includes("thumb-wrap rc-img-thumb-wrap"), "縮圖外框用 rc-img-thumb-wrap");
  assert.ok(block.includes('className="thumb-remove rc-img-thumb-remove"'), "✕ 移到左上");
  assert.ok(block.includes("<DescriptionDetailPickBadge control={descriptionDetail} imageId={image.id} />"));
  assert.ok(block.includes(".sort((a, b) => a.sort_order - b.sort_order)"), "縮圖照排序，第幾張才對得上");
});

await check("B3 站② 標圖站：列只在「詳情圖」子分頁且有詳情圖時出現（生成詳情圖那列下面）；詳情圖卡片有角標與說明", () => {
  const s = read("src/components/listing/Station2ImagePanel.tsx");
  const compose = s.indexOf('aria-label="生成詳情圖"');
  const row = s.indexOf("<DescriptionDetailPickRow {...descriptionDetail} />");
  const subtabs = s.indexOf('className="s2-img-subtabs"');
  assert.ok(compose > 0 && row > compose && subtabs > row, `compose=${compose} row=${row} subtabs=${subtabs}`);
  assert.match(s, /descriptionDetail && subtab === "detail" && images\.some\(\(image\) => image\.image_type === "detail"\)/);
  assert.match(s, /descriptionDetail\?: DescriptionDetailControl;/);
  assert.match(s, /subtab === "detail" && descriptionDetail \? \(\s*<DescriptionDetailPickBadge control=\{descriptionDetail\} imageId=\{image\.id\} \/>/);
  for (const text of ["詳情圖（拖曳排序；右上角「放描述」可放進商品描述）", '"會放進商品描述"', '"只給 AI 讀字"', '"詳情圖僅供辨識，無需標記"']) {
    assert.ok(s.includes(text), "缺：" + text);
  }
});

await check("B4 ResultCard：merge 寫入 image_flags、成功才更新畫面、標成待同步、toast 文案、超過 8 張擋下", () => {
  const s = read("src/components/listing/ResultCard.tsx");
  const start = s.indexOf("async function saveDescriptionDetail(selection: DescriptionDetailSelection)");
  assert.ok(start > 0, "缺 saveDescriptionDetail");
  const body = s.slice(start, s.indexOf("\n  }\n", start));
  for (const text of [
    "mergeDescriptionDetailSelection(draftImageFlags, selection)",
    '.from("product_drafts")',
    ".update({ image_flags: nextFlags })",
    ".eq(\"id\", draft.id)",
    "商品描述詳情圖儲存失敗：${error.message}",
    "setDraftImageFlags(nextFlags)",
    "await markShopifyDirty()",
    "（已上架：按「同步 Shopify」後生效）",
    "商品描述會放：主圖＋詳情圖第 ${positions.join(\"、\")} 張${tail}",
    "商品描述只放主圖${tail}"
  ]) assert.ok(body.includes(text), "缺：" + text);
  assert.ok(body.indexOf("if (error)") < body.indexOf("setDraftImageFlags(nextFlags)"), "失敗時不可先改畫面");
  assert.ok(s.includes("商品描述最多放 ${DESCRIPTION_DETAIL_PICK_MAX} 張詳情圖"), "超過 8 張的提示");
  assert.ok(s.includes("describeDescriptionDetail(imageMarks, draftImageFlags)"));
  assert.match(s, /descriptionDetail=\{descriptionDetailControl\}[\s\S]{0,80}draftId=\{draft\.id\}/, "站② 傳入");
  assert.match(s, /<ResultCardImagesPanel\s+descriptionDetail=\{descriptionDetailControl\}/, "站③ 傳入");
});

await check("B5 不新增 CSS：globals.css 沒有這包的新 class、沒有新 !important", () => {
  const css = read("src/app/globals.css");
  assert.ok(!/description-detail|desc-detail|desc-pick|[\s,{}]\.detail-pick|s2-desc/i.test(css), "不准為這包加 class");
  for (const f of [ROW, "src/components/listing/result-card/ResultCardImagesPanel.tsx", "src/components/listing/Station2ImagePanel.tsx"]) {
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
