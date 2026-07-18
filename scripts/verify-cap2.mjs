/**
 * CAP-2 verify: extension DOM parse (linkedom) + contract shape vs captureTypes.
 * Run: node scripts/verify-cap2.mjs  |  pnpm run verify:cap2
 * No network. Does not load Next src/ at runtime (static string checks only).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const require = createRequire(import.meta.url);
// CJS require avoids broken dual-package nested deps under raw npm extract
const { parseHTML } = require("linkedom");
const failures = [];

function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

// Load extension libs into globalThis.NestoryCap (same order as background inject)
globalThis.NestoryCap = globalThis.NestoryCap || {};
const libFiles = [
  "extension/lib/selectors.js",
  "extension/lib/domUtil.js",
  "extension/lib/parsePrice.js",
  "extension/lib/flattenSku.js",
  "extension/lib/adapters/generic.js",
  "extension/lib/adapters/shopee.js",
  "extension/lib/adapters/taobao.js",
  "extension/lib/buildPayload.js"
];
for (const rel of libFiles) {
  require(path.join(root, rel));
}

const Cap = globalThis.NestoryCap;

function loadDoc(relHtml, href) {
  const html = read(relHtml);
  const { document } = parseHTML(html);
  // linkedom document has no default URL; we pass href into buildCapturePayload
  return { document, href };
}

console.log("verify-cap2:");

check("files: extension scaffold present", () => {
  const need = [
    "extension/manifest.json",
    "extension/background.js",
    "extension/README.md",
    "extension/lib/selectors.js",
    "extension/lib/domUtil.js",
    "extension/lib/parsePrice.js",
    "extension/lib/flattenSku.js",
    "extension/lib/buildPayload.js",
    "extension/lib/adapters/taobao.js",
    "extension/lib/adapters/shopee.js",
    "extension/lib/adapters/generic.js",
    "extension/content/capture.js",
    "extension/popup/popup.html",
    "extension/popup/popup.js",
    "extension/popup/popup.css",
    "extension/icons/icon16.png",
    "extension/icons/icon32.png",
    "extension/icons/icon48.png",
    "extension/icons/icon128.png",
    "scripts/fixtures/taobao-item-sample.html",
    "scripts/fixtures/taobao-item-missing-price.html",
    "scripts/fixtures/taobao-item-promo.html",
    "scripts/fixtures/taobao-item-promo-only.html"
  ];
  for (const f of need) assert.ok(exists(f), `missing ${f}`);
});

check("manifest: MV3 + min permissions + optional hosts", () => {
  const m = JSON.parse(read("extension/manifest.json"));
  assert.equal(m.manifest_version, 3);
  assert.ok(m.permissions.includes("activeTab"));
  assert.ok(m.permissions.includes("scripting"));
  assert.ok(m.permissions.includes("storage"));
  assert.ok(Array.isArray(m.host_permissions) && m.host_permissions.length > 0);
  assert.ok(
    m.host_permissions.some((p) => /taobao/i.test(p)),
    "taobao host_permissions"
  );
  assert.ok(
    m.host_permissions.some((p) => /shopee/i.test(p)),
    "shopee host_permissions"
  );
  assert.ok(
    m.host_permissions.some((p) => /localhost/i.test(p)),
    "localhost host_permissions"
  );
  assert.ok(
    Array.isArray(m.optional_host_permissions) &&
      m.optional_host_permissions.some((p) => p.includes("https://")),
    "optional_host_permissions for generic sites / API"
  );
  assert.ok(m.background?.service_worker === "background.js");
  assert.ok(m.options_ui?.page);
});

check("background: Bearer + contains only; no permissions.request", () => {
  const bg = read("extension/background.js");
  assert.match(bg, /permissions\.contains/);
  assert.doesNotMatch(
    bg,
    /permissions\.request\s*\(/,
    "background must not call permissions.request (user-gesture rule)"
  );
  assert.match(bg, /Authorization.*Bearer|Bearer.*captureToken/);
  assert.match(bg, /\/api\/import\/product-page/);
  assert.match(bg, /action\.onClicked/);
  const man = read("extension/manifest.json");
  assert.ok(!/"content_scripts"\s*:/.test(man), "must not register permanent content_scripts");
});

check("popup: permissions.request in save click path (user gesture)", () => {
  const popup = read("extension/popup/popup.js");
  assert.match(popup, /permissions\.request/);
  assert.match(popup, /permissions\.contains/);
  assert.match(popup, /storage\.local\.set/);
  assert.match(popup, /saveBtn|儲存/);
  assert.doesNotMatch(
    popup,
    /SAVE_SETTINGS/,
    "save must not delegate permission request via SAVE_SETTINGS message"
  );
});

check("selectors: single catalog has taobao/tmall/shopee/generic", () => {
  assert.ok(Cap.SELECTORS.taobao?.title);
  assert.ok(Cap.SELECTORS.tmall);
  assert.ok(Cap.SELECTORS.shopee);
  assert.ok(Cap.SELECTORS.generic?.ogTitle);
  const merged = Cap.mergeSelectors(Cap.SELECTORS.tmall, Cap.SELECTORS.taobao);
  assert.ok(merged.price);
  assert.ok(merged.skuRoot);
});

check("parsePrice: honest nulls", () => {
  assert.equal(Cap.parsePrice("¥29.90"), 29.9);
  assert.equal(Cap.parsePrice("29.9-39.9"), 29.9);
  assert.equal(Cap.parsePrice(""), null);
  assert.equal(Cap.parsePrice("abc"), null);
  assert.equal(Cap.parsePrice(0), null);
});

check("flattenSku: 2-dim → variants_flat + sku_dimensions", () => {
  const table = {
    axes: ["顏色", "尺寸"],
    rows: [
      { 顏色: "粉", 尺寸: "S", price: 29.9 },
      { 顏色: "粉", 尺寸: "M", price: 32.9 },
      { 顏色: "藍", 尺寸: "S", price: 29.9 }
    ]
  };
  const { variants_flat, sku_dimensions } = Cap.flattenSkuTable(table);
  assert.equal(sku_dimensions, 2);
  assert.equal(variants_flat.length, 3);
  assert.equal(variants_flat[0].option1_name, "顏色");
  assert.equal(variants_flat[0].option1_value, "粉");
  assert.equal(variants_flat[0].option2_name, "尺寸");
  assert.equal(variants_flat[0].option2_value, "S");
  assert.equal(variants_flat[0].cny_price, 29.9);
});

check("CAP-2.6/87: omitUniformVariantPrices clears equal product price", () => {
  const rows = [
    { option1_value: "粉", cny_price: 59.9 },
    { option1_value: "藍", cny_price: 59.9 },
    { option1_value: "綠", cny_price: 72 }
  ];
  const out = Cap.omitUniformVariantPrices(rows, 59.9);
  assert.equal(out[0].cny_price, undefined);
  assert.equal(out[1].cny_price, undefined);
  assert.equal(out[2].cny_price, 72);
  assert.equal(out[0].option1_value, "粉");
});

check("CAP-2.6/88: attachVariantImages by option value", () => {
  const rows = [
    { option1_value: "粉", option2_value: "S" },
    { option1_value: "藍", option2_value: "M" }
  ];
  const out = Cap.attachVariantImages(rows, {
    粉: "https://img.alicdn.com/imgextra/i1/example/sku-pink.jpg",
    藍: "https://img.alicdn.com/imgextra/i1/example/sku-blue.jpg"
  });
  assert.equal(out[0].image_url, "https://img.alicdn.com/imgextra/i1/example/sku-pink.jpg");
  assert.equal(out[1].image_url, "https://img.alicdn.com/imgextra/i1/example/sku-blue.jpg");
});

check("detectAdapter: taobao / tmall / shopee / generic", () => {
  assert.deepEqual(Cap.detectAdapter("item.taobao.com", "https://item.taobao.com/item.htm?id=1"), {
    adapter: "taobao",
    source_platform: "taobao"
  });
  assert.equal(
    Cap.detectAdapter("detail.tmall.com", "https://detail.tmall.com/item.htm?id=1").source_platform,
    "tmall"
  );
  assert.equal(
    Cap.detectAdapter("shopee.tw", "https://shopee.tw/product-i.1.2").adapter,
    "shopee"
  );
  assert.deepEqual(Cap.detectAdapter("www.example.com", "https://www.example.com/p/1"), {
    adapter: "generic",
    source_platform: null
  });
});

check("DOM: taobao fixture → CAP-1-shaped payload (CAP-2.6 原價/促銷/款式圖)", () => {
  const href = "https://item.taobao.com/item.htm?id=123456789012";
  const { document } = loadDoc("scripts/fixtures/taobao-item-sample.html", href);
  const body = Cap.buildCapturePayload(document, { href, host: "item.taobao.com" });

  assert.equal(body.source_url, href);
  assert.equal(body.source_platform, "taobao");
  assert.ok(body.title && body.title.includes("三麗鷗"));
  // 86: 劃線原價 → price_cny；現售促銷 → promo_price_cny
  assert.equal(body.price_cny, 59.9);
  assert.equal(body.capture_meta.promo_price_cny, 29.9);
  assert.ok(body.sku_table);
  assert.ok(Array.isArray(body.sku_table.axes));
  assert.ok(body.sku_table.axes.length >= 2);
  assert.ok(Array.isArray(body.variants_flat) && body.variants_flat.length >= 2);
  // 87: cartesian 同價 → 列 cny_price 省略
  assert.ok(
    body.variants_flat.every((v) => v.cny_price == null || v.cny_price === undefined),
    "equal product price must omit variant cny_price"
  );
  // 88: 顏色縮圖 → image_url
  const pink = body.variants_flat.find((v) => v.option1_value === "粉");
  assert.ok(pink, "expect 粉 variants");
  assert.match(String(pink.image_url || ""), /sku-pink\.jpg/);
  const blue = body.variants_flat.find((v) => v.option1_value === "蓝" || v.option1_value === "藍");
  assert.ok(blue, "expect 蓝 variants");
  assert.match(String(blue.image_url || ""), /sku-blue\.jpg/);
  assert.equal(body.capture_meta.adapter, "taobao");
  assert.equal(body.capture_meta.page_host, "item.taobao.com");
  assert.ok(body.capture_meta.sku_dimensions >= 2);
  assert.ok(Array.isArray(body.main_image_urls) && body.main_image_urls.length >= 1);
  assert.ok(body.main_image_urls[0].startsWith("https://"));
  assert.ok(Array.isArray(body.detail_image_urls) && body.detail_image_urls.length >= 1);
  // protocol-relative upgraded
  assert.ok(body.detail_image_urls.some((u) => u.startsWith("https://")));
  assert.ok(Array.isArray(body.video_urls) && body.video_urls.length >= 1);
  assert.ok(body.params && body.params["品牌"]);
  assert.ok(Array.isArray(body.capture_meta.warnings_from_client));
  assert.ok(body.captured_at);
});

check("DOM: promo fixture → 原價 price_cny + promo meta", () => {
  const href = "https://item.taobao.com/item.htm?id=888777666555";
  const { document } = loadDoc("scripts/fixtures/taobao-item-promo.html", href);
  const body = Cap.buildCapturePayload(document, { href, host: "item.taobao.com" });
  assert.equal(body.price_cny, 88);
  assert.ok(
    body.capture_meta.promo_price_cny === 66 || body.capture_meta.promo_price_cny === 59.9,
    `promo_price_cny expected 66 or 59.9, got ${body.capture_meta.promo_price_cny}`
  );
  assert.ok(Array.isArray(body.variants_flat) && body.variants_flat.length >= 1);
  const red = body.variants_flat.find((v) => v.option1_value === "红" || v.option1_value === "紅");
  assert.ok(red && /sku-red\.jpg/.test(String(red.image_url || "")), "red SKU thumb");
  const green = body.variants_flat.find((v) => v.option1_value === "绿" || v.option1_value === "綠");
  assert.ok(green, "green variant");
  assert.ok(!green.image_url, "no thumb → no image_url guess");
});

check("DOM: promo-only → price_cny + 白話 warning", () => {
  const href = "https://item.taobao.com/item.htm?id=111";
  const { document } = loadDoc("scripts/fixtures/taobao-item-promo-only.html", href);
  const body = Cap.buildCapturePayload(document, { href, host: "item.taobao.com" });
  assert.equal(body.price_cny, 19.9);
  assert.ok(
    body.capture_meta.warnings_from_client.some(
      (w) => /只看到促銷價/.test(w) && /成本請自行確認/.test(w)
    ),
    "expected B1 plain-language promo-only warning"
  );
});

check("DOM: missing price → omit price_cny + client warning", () => {
  const href = "https://item.taobao.com/item.htm?id=999";
  const { document } = loadDoc("scripts/fixtures/taobao-item-missing-price.html", href);
  const body = Cap.buildCapturePayload(document, { href, host: "item.taobao.com" });
  assert.equal(body.price_cny, undefined);
  assert.ok(
    body.capture_meta.warnings_from_client.some((w) => /price_cny/.test(w)),
    "expected price_cny warning"
  );
  assert.ok(body.title);
});

check("contract: static assert vs captureTypes.ts field names", () => {
  const types = read("src/lib/import/captureTypes.ts");
  const requiredMentions = [
    "source_url",
    "source_platform",
    "title",
    "price_cny",
    "list_price_cny",
    "sku_table",
    "variants_flat",
    "main_image_urls",
    "detail_image_urls",
    "video_urls",
    "params",
    "spec_text",
    "captured_at",
    "capture_meta",
    "sku_dimensions",
    "warnings_from_client",
    "option1_name",
    "cny_price",
    "image_url",
    "promo_price_cny",
    "MAX_VARIANT_IMAGES"
  ];
  for (const key of requiredMentions) {
    assert.ok(types.includes(key), `captureTypes missing ${key}`);
  }

  const href = "https://item.taobao.com/item.htm?id=123456789012";
  const { document } = loadDoc("scripts/fixtures/taobao-item-sample.html", href);
  const body = Cap.buildCapturePayload(document, { href, host: "item.taobao.com" });

  const allowedTop = new Set([
    "source_url",
    "source_platform",
    "title",
    "price_cny",
    "list_price_cny",
    "sku_table",
    "variants_flat",
    "main_image_urls",
    "detail_image_urls",
    "video_urls",
    "params",
    "spec_text",
    "captured_at",
    "capture_meta",
    "raw"
  ]);
  for (const k of Object.keys(body)) {
    assert.ok(allowedTop.has(k), `unexpected top-level key: ${k}`);
  }
  assert.ok(body.capture_meta.adapter);
  assert.ok("warnings_from_client" in body.capture_meta);
  if (body.variants_flat?.length) {
    const v = body.variants_flat[0];
    for (const k of Object.keys(v)) {
      assert.ok(
        /^(option[123]_(name|value)|cny_price|sku|image_url)$/.test(k),
        `unexpected variant key ${k}`
      );
    }
  }
});

check("README: numbered install steps + permission allow", () => {
  const md = read("extension/README.md");
  assert.match(md, /chrome:\/\/extensions/);
  assert.match(md, /載入未封裝|开发人员|開發人員/);
  assert.match(md, /允許/);
  assert.match(md, /ncap_/);
  assert.match(md, /API 網址/);
});

check("no third-party script injection in extension", () => {
  const bg = read("extension/background.js");
  const cap = read("extension/content/capture.js");
  assert.ok(!/cdn\.|googleapis|script\.src\s*=/.test(bg + cap));
});

if (failures.length) {
  console.error(`\nverify-cap2: ${failures.length} failed`);
  process.exit(1);
}
console.log("\nverify-cap2: ALL passed");
