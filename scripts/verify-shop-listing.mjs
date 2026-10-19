/**
 * SHOP-LISTING verifier (offline): Shopify taxonomy category, blur-extend square images,
 * browser-side shrink + concurrent upload wiring. Real modules (TS transpiled by
 * scripts/publish-guard-loader.mjs), real sharp. No network, no Supabase, no Shopify.
 *
 * Run: node scripts/verify-shop-listing.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
register(pathToFileURL(path.join(root, "scripts", "publish-guard-loader.mjs")).href);
const src = (rel) => pathToFileURL(path.join(root, rel)).href;
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const taxonomy = await import(src("src/lib/shopify/taxonomyCategory.ts"));
const payload = await import(src("src/lib/shopify/payload.ts"));
const tagsV2 = await import(src("src/lib/nestoryTagsV2.ts"));
const labels = await import(src("src/lib/productTypeLabels.ts"));
const sharpProcess = await import(src("src/lib/images/sharpProcess.ts"));
const concurrency = await import(src("src/lib/images/runWithConcurrency.ts"));
const resize = await import(src("src/lib/images/clientImageResize.ts"));

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(name);
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

const G = "gid://shopify/TaxonomyCategory/";
const { resolveShopifyCategoryId, SHOPIFY_CATEGORY_BY_TYPE, SHOPIFY_CATEGORY_KEYWORDS } = taxonomy;

// ---------------------------------------------------------------- A: category
console.log("A — Shopify category");

await check("tag 類型_公仔模型 → figure gid", () => {
  assert.equal(resolveShopifyCategoryId({ tags: ["類型_公仔模型"], productType: null }), G + "tg-5-8-1-1");
});
await check("tag 類型_吊飾掛件 normalizes to 吊飾徽章 gid", () => {
  assert.equal(resolveShopifyCategoryId({ tags: ["類型_吊飾掛件"], productType: null }), G + "aa-4-1");
});
await check("first 類型_ tag wins (盲盒 before 公仔模型)", () => {
  assert.equal(
    resolveShopifyCategoryId({ tags: ["角色_孫悟空", "類型_盲盒", "類型_公仔模型"], productType: null }),
    SHOPIFY_CATEGORY_BY_TYPE["盲盒"]
  );
});
await check("unknown 類型_ tag falls through to productType", () => {
  assert.equal(resolveShopifyCategoryId({ tags: ["類型_不存在"], productType: "手錶" }), G + "aa-6-11");
});
await check("productType 手錶 (no tags) → watch gid", () => {
  assert.equal(resolveShopifyCategoryId({ tags: [], productType: "手錶" }), G + "aa-6-11");
});
await check("productType exact table-A key beats keywords (滑鼠 → mouse, 無線鼠標 → via keyword)", () => {
  assert.equal(resolveShopifyCategoryId({ tags: [], productType: "滑鼠" }), G + "el-7-9-12-11");
  assert.equal(resolveShopifyCategoryId({ tags: [], productType: "無線鼠標" }), G + "el-7-9-12-11");
});
await check("productType 絨毛娃娃鑰匙圈吊飾: documented outcome", () => {
  // Not a table-A key and no table-B keyword is a substring of it (掛飾/擺件/燈/手環… absent),
  // so the rules yield null. Plush items are classified through their 類型_絨毛娃娃 tag instead.
  assert.equal(resolveShopifyCategoryId({ tags: [], productType: "絨毛娃娃鑰匙圈吊飾" }), null);
  assert.equal(resolveShopifyCategoryId({ tags: ["類型_絨毛娃娃"], productType: "絨毛娃娃鑰匙圈吊飾" }), G + "tg-5-8-11");
});
await check("longest keyword wins (夜燈 over 燈; 手鍊/手環; 羽毛球拍握把套)", () => {
  assert.equal(resolveShopifyCategoryId({ tags: [], productType: "星空夜燈" }), G + "hg-13-10");
  assert.equal(resolveShopifyCategoryId({ tags: [], productType: "小燈" }), G + "hg-13-9");
  assert.equal(resolveShopifyCategoryId({ tags: [], productType: "羽毛球拍握把套" }), G + "sg-4-14-1-2-2");
  // 「保溫杯」(3) is longer than 「燈」 etc.; 「檯燈」(2) beats 「燈」(1)
  assert.equal(resolveShopifyCategoryId({ tags: [], productType: "LED檯燈" }), G + "hg-13-5");
});
await check("unmatched productType → null; nullish inputs → null", () => {
  assert.equal(resolveShopifyCategoryId({ tags: [], productType: "Runtime Test" }), null);
  assert.equal(resolveShopifyCategoryId({ tags: null, productType: null }), null);
  assert.equal(resolveShopifyCategoryId({ tags: undefined, productType: undefined }), null);
  assert.equal(resolveShopifyCategoryId({ tags: [], productType: "" }), null);
});
await check("Object.prototype keys are not treated as types", () => {
  assert.equal(resolveShopifyCategoryId({ tags: ["類型_constructor"], productType: "constructor" }), null);
});
await check("table A: 47 rows; every NESTORY_TAGS_V2 type (normalized) has a key", () => {
  assert.equal(Object.keys(SHOPIFY_CATEGORY_BY_TYPE).length, 47);
  for (const label of tagsV2.NESTORY_TAGS_V2_PRODUCT_TYPE_LABELS) {
    const normalized = labels.normalizeProductTypeForTags(label);
    assert.ok(normalized in SHOPIFY_CATEGORY_BY_TYPE, `missing table-A key for ${label} -> ${normalized}`);
  }
});
await check("table B: 25 keywords, all unique", () => {
  assert.equal(SHOPIFY_CATEGORY_KEYWORDS.length, 25);
  assert.equal(new Set(SHOPIFY_CATEGORY_KEYWORDS.map(([k]) => k)).size, 25);
});
await check("every gid matches the TaxonomyCategory shape", () => {
  const re = /^gid:\/\/shopify\/TaxonomyCategory\/[a-z]{2}(-\d+)*$/;
  for (const [type, id] of Object.entries(SHOPIFY_CATEGORY_BY_TYPE)) assert.match(id, re, type);
  for (const [keyword, id] of SHOPIFY_CATEGORY_KEYWORDS) assert.match(id, re, keyword);
});

const baseDraft = (overrides = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  title_zh: "SHOP-LISTING 測試商品",
  description_html: "測試內文",
  generated_faq_html: "",
  spec_text: "",
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

await check("payload: product.category set from 類型_ tag (shopify_tags); productType untouched", () => {
  const built = payload.buildShopifyProductPayload(
    baseDraft({ shopify_tags: ["類型_公仔模型"], product_type: "公仔模型" }),
    "draft"
  );
  assert.equal(built.product.category, G + "tg-5-8-1-1");
  assert.equal(built.product.productType, "公仔模型");
});
await check("payload: falls back to draft.tags and productType keyword", () => {
  const viaTags = payload.buildShopifyProductPayload(baseDraft({ tags: ["類型_盲盒"] }), "draft");
  assert.equal(viaTags.product.category, G + "tg-5-8-1-1");
  const viaType = payload.buildShopifyProductPayload(baseDraft({ product_type: "手錶" }), "draft");
  assert.equal(viaType.product.category, G + "aa-6-11");
  assert.equal(viaType.product.productType, "手錶");
});
await check("payload: AI-generated product.category is overridden by ours", () => {
  const built = payload.buildShopifyProductPayload(
    baseDraft({
      shopify_tags: ["類型_公仔模型"],
      generated_payload_json: { product: { category: "bad", vendor: "AI Vendor" } }
    }),
    "draft"
  );
  assert.equal(built.product.category, G + "tg-5-8-1-1");
  assert.equal(built.product.vendor, "AI Vendor"); // other generated keys still spread
});
await check("payload: no match → no category key, and AI category is dropped", () => {
  const plain = payload.buildShopifyProductPayload(baseDraft({ product_type: "Runtime Test" }), "draft");
  assert.equal("category" in plain.product, false);
  const withBad = payload.buildShopifyProductPayload(
    baseDraft({ product_type: "Runtime Test", generated_payload_json: { product: { category: "bad" } } }),
    "draft"
  );
  assert.equal("category" in withBad.product, false);
});
await check("category only flows into productCreate; sync/full-sync inputs untouched", () => {
  const safe = read("src/lib/shopify/publishDraftSafe.ts");
  assert.match(safe, /productCreate\(product: \$product\)/);
  assert.match(safe, /product: \{ \.\.\.payload\.product, status: "DRAFT" \}/);
  assert.doesNotMatch(read("src/lib/shopify/syncShopifyProduct.ts"), /category/);
  assert.doesNotMatch(read("src/lib/shopify/fullSyncGraphQL.ts"), /category/);
});

// ---------------------------------------------------------------- B: blur-extend
console.log("B — blur-extend square");

const { processImageBuffer } = sharpProcess;

async function gradientImage(width, height, { orientation } = {}) {
  // Horizontal red→blue gradient so the blurred background is clearly coloured.
  const channels = 3;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      const t = x / Math.max(1, width - 1);
      data[i] = Math.round(255 * (1 - t));
      data[i + 1] = 40;
      data[i + 2] = Math.round(255 * t);
    }
  }
  const img = sharp(data, { raw: { width, height, channels } });
  if (orientation) {
    return img.jpeg({ quality: 95 }).withMetadata({ orientation }).toBuffer();
  }
  return img.png().toBuffer();
}

async function transparentPng(width, height) {
  const channels = 4;
  const data = Buffer.alloc(width * height * channels); // fully transparent black
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x > width / 4 && x < (3 * width) / 4) {
        const i = (y * width + x) * channels;
        data[i] = 20;
        data[i + 1] = 160;
        data[i + 2] = 60;
        data[i + 3] = 128; // semi-transparent centre
      }
    }
  }
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

async function pixel(buffer, x, y) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 4;
  return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
}

await check("1000×500 → 1000×1000; corner opaque and not black; foreground centred", async () => {
  const out = await processImageBuffer(await gradientImage(1000, 500), { squareMode: "blur-extend" });
  assert.equal(out.width, 1000);
  assert.equal(out.height, 1000);
  assert.equal(out.format, "webp");
  const meta = await sharp(out.buffer).metadata();
  assert.equal(meta.width, 1000);
  assert.equal(meta.height, 1000);
  const corner = await pixel(out.buffer, 0, 0);
  assert.equal(corner.a, 255);
  assert.ok(corner.r + corner.g + corner.b > 60, `corner too dark: ${JSON.stringify(corner)}`);
  const left = await pixel(out.buffer, 20, 500);
  assert.ok(left.r > left.b, "foreground placed in the vertical centre");
});
await check("3000×1500 → 2048×2048 (long edge capped)", async () => {
  const out = await processImageBuffer(await gradientImage(3000, 1500), { squareMode: "blur-extend" });
  assert.equal(out.width, 2048);
  assert.equal(out.height, 2048);
});
await check("600×1200 portrait → 1200×1200", async () => {
  const out = await processImageBuffer(await gradientImage(600, 1200), { squareMode: "blur-extend" });
  assert.equal(out.width, 1200);
  assert.equal(out.height, 1200);
});
await check("800×800 stays 800×800 and is byte-identical to squareMode none", async () => {
  const input = await gradientImage(800, 800);
  const extended = await processImageBuffer(input, { squareMode: "blur-extend" });
  const plain = await processImageBuffer(input, { squareMode: "none" });
  assert.equal(extended.width, 800);
  assert.equal(extended.height, 800);
  assert.ok(extended.buffer.equals(plain.buffer), "bytes differ from none");
});
await check("1000×990 (1% off) not extended", async () => {
  const input = await gradientImage(1000, 990);
  const out = await processImageBuffer(input, { squareMode: "blur-extend" });
  assert.equal(out.width, 1000);
  assert.equal(out.height, 990);
  const plain = await processImageBuffer(input, { squareMode: "none" });
  assert.ok(out.buffer.equals(plain.buffer));
});
await check("EXIF orientation 6 on 1000×500 is treated as 500×1000 → 1000×1000", async () => {
  const input = await gradientImage(1000, 500, { orientation: 6 });
  const meta = await sharp(input).metadata();
  assert.equal(meta.orientation, 6);
  const plain = await processImageBuffer(input, { squareMode: "none" });
  assert.equal(plain.width, 500);
  assert.equal(plain.height, 1000);
  const out = await processImageBuffer(input, { squareMode: "blur-extend" });
  assert.equal(out.width, 1000);
  assert.equal(out.height, 1000);
});
await check("transparent PNG 600×300 → 600×600, four corners opaque", async () => {
  const out = await processImageBuffer(await transparentPng(600, 300), { squareMode: "blur-extend" });
  assert.equal(out.width, 600);
  assert.equal(out.height, 600);
  for (const [x, y] of [[0, 0], [599, 0], [0, 599], [599, 599]]) {
    assert.equal((await pixel(out.buffer, x, y)).a, 255, `corner ${x},${y}`);
  }
});
await check("squareMode omitted → same bytes as the pre-change pipeline (1000×500)", async () => {
  const input = await gradientImage(1000, 500);
  const out = await processImageBuffer(input);
  const legacy = await sharp(input, { failOn: "none" })
    .rotate()
    .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  assert.equal(out.width, 1000);
  assert.equal(out.height, 500);
  assert.ok(out.buffer.equals(legacy), "default output changed");
  const explicitFalse = await processImageBuffer(input, { square: false });
  assert.ok(explicitFalse.buffer.equals(legacy));
});
await check("legacy square:true === squareMode cover", async () => {
  const input = await gradientImage(1000, 500);
  const a = await processImageBuffer(input, { square: true });
  const b = await processImageBuffer(input, { squareMode: "cover" });
  assert.ok(a.buffer.equals(b.buffer));
  // pre-change cover pipeline (withoutEnlargement keeps a 1000x500 source at 1000x500)
  const legacyCover = await sharp(input, { failOn: "none" })
    .rotate()
    .resize(2048, 2048, { fit: "cover", position: "centre", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  assert.ok(a.buffer.equals(legacyCover));
});
await check("runSharpBatch: only main/variant use blur-extend", () => {
  const source = read("src/lib/images/runSharpBatch.ts");
  assert.equal((source.match(/processImageBuffer\(/g) ?? []).length, 1);
  assert.match(
    source,
    /squareMode: img\.image_type === "main" \|\| img\.image_type === "variant" \? "blur-extend" : "none"/
  );
});

// ---------------------------------------------------------------- C: upload speed
console.log("C — upload speed");

await check("runWithConcurrency: never more than `limit` in flight", async () => {
  let inFlight = 0;
  let peak = 0;
  const items = Array.from({ length: 12 }, (_, i) => i);
  const results = await concurrency.runWithConcurrency(items, 4, async (n) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5 + (n % 3) * 3));
    inFlight -= 1;
    return n * 2;
  });
  assert.equal(peak, 4);
  assert.equal(results.length, 12);
});
await check("runWithConcurrency: result order equals input order", async () => {
  const delays = [30, 5, 20, 1, 10];
  const results = await concurrency.runWithConcurrency(delays, 3, async (ms, index) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return `r${index}`;
  });
  assert.deepEqual(results.map((r) => r.value), ["r0", "r1", "r2", "r3", "r4"]);
});
await check("runWithConcurrency: one rejection does not stop the others (settled form)", async () => {
  const seen = [];
  const results = await concurrency.runWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
    seen.push(n);
    if (n === 2) throw new Error("boom");
    return n;
  });
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4, 5]);
  assert.equal(results[1].status, "rejected");
  assert.equal(results[1].reason.message, "boom");
  assert.deepEqual(
    results.filter((r) => r.status === "fulfilled").map((r) => r.value),
    [1, 3, 4, 5]
  );
});
await check("runWithConcurrency: empty list and limit larger than list", async () => {
  assert.deepEqual(await concurrency.runWithConcurrency([], 4, async () => 1), []);
  const two = await concurrency.runWithConcurrency(["a", "b"], 10, async (x) => x);
  assert.deepEqual(two.map((r) => r.value), ["a", "b"]);
});
await check("upload constants match the spec; buildDualSizeBlobs kept", () => {
  assert.equal(resize.UPLOAD_MAX_EDGE, 2048);
  assert.equal(resize.UPLOAD_WEBP_QUALITY, 0.9);
  assert.equal(resize.UPLOAD_PASSTHROUGH_MAX_BYTES, 800 * 1024);
  assert.equal(resize.UPLOAD_CONCURRENCY, 4);
  assert.equal(typeof resize.buildDualSizeBlobs, "function");
});
await check("decideUploadPassthrough: only small jpeg/webp within maxEdge pass through", () => {
  const d = resize.decideUploadPassthrough;
  const base = { type: "image/jpeg", size: 300 * 1024, longEdge: 1600, maxEdge: 2048 };
  assert.equal(d(base), true);
  assert.equal(d({ ...base, type: "image/webp" }), true);
  assert.equal(d({ ...base, type: "image/png" }), false);
  assert.equal(d({ ...base, size: 800 * 1024 }), true);
  assert.equal(d({ ...base, size: 800 * 1024 + 1 }), false);
  assert.equal(d({ ...base, longEdge: 2049 }), false);
  assert.equal(d({ ...base, maxEdge: 1000 }), false);
});
await check("buildUploadBlobs degrades to the original File outside a browser (no throw)", async () => {
  const file = new File([Buffer.from("not-an-image")], "x.png", { type: "image/png" });
  const out = await resize.buildUploadBlobs(file);
  assert.equal(out.upload, file);
  assert.equal(out.shrunk, false);
  assert.equal(out.uploadExt, "png");
  assert.equal(out.uploadContentType, "image/png");
  assert.equal(out.mid, null);
  assert.equal(out.thumb, null);
});

await check("ImageUploader: shrink + concurrency, keeps -orig naming, uploads dual.upload", () => {
  const s = read("src/components/listing/ImageUploader.tsx");
  assert.match(s, /buildUploadBlobs\(file\)/);
  assert.match(s, /runWithConcurrency\(pending, UPLOAD_CONCURRENCY/);
  assert.match(s, /-orig\.\$\{dual\.uploadExt\}/);
  assert.match(s, /upload\(origPath, dual\.upload,/);
  assert.match(s, /contentType: dual\.uploadContentType/);
  assert.doesNotMatch(s, /buildDualSizeBlobs/);
  assert.doesNotMatch(s, /\.upload\([^)]*,\s*file\s*,/);
  assert.match(s, /await Promise\.all\(\[\s*uploadMid\(\),\s*uploadThumb\(\),/);
  assert.match(s, /上傳失敗：\$\{storageError\.message\}/);
  assert.match(s, /圖片檔案已上傳，但寫入資料庫失敗/);
});
await check("Station2ImagePanel: sort fixed before parallel run, uploads shrunk blob", () => {
  const s = read("src/components/listing/Station2ImagePanel.tsx");
  assert.match(s, /buildUploadBlobs\(file\)/);
  assert.match(s, /runWithConcurrency\(files, UPLOAD_CONCURRENCY/);
  assert.match(s, /sort_order: baseSort \+ index/);
  assert.doesNotMatch(s, /nextSort\s*\+=\s*1/);
  assert.doesNotMatch(s, /\.upload\(path,\s*file\b/);
  assert.match(s, /\.upload\(path, blobs\.upload, \{ contentType: blobs\.uploadContentType/);
  assert.match(s, /已補 \$\{added\.length\} 張/);
});
await check("WorkspaceInputPanel screenshots: 3072 edge, parallel, cleanup on failure", () => {
  const s = read("src/components/listing/WorkspaceInputPanel.tsx");
  const start = s.indexOf("async function uploadTempScreenshots");
  const end = s.indexOf("async function removeTempScreenshots");
  assert.ok(start > 0 && end > start);
  const body = s.slice(start, end);
  assert.match(body, /buildUploadBlobs\(file, \{ maxEdge: 3072 \}\)/);
  assert.match(body, /Promise\.allSettled/);
  assert.match(body, /截圖上傳失敗：\$\{error\.message\}/);
  assert.match(body, /removeTempScreenshots\(uploadedOk\.map/);
  assert.doesNotMatch(body, /\.upload\(path,\s*file\b/);
});
await check("client-side helpers import nothing server-only", () => {
  assert.doesNotMatch(read("src/lib/images/runWithConcurrency.ts"), /^import /m);
  assert.doesNotMatch(read("src/lib/images/clientImageResize.ts"), /^import /m);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error("Failed:\n - " + failures.join("\n - "));
  process.exit(1);
}
