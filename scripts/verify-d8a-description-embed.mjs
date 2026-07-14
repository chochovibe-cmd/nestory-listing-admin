/**
 * D8a-open: description embed images (Shopify / Matrixify boundary).
 * Pure + static wiring — no real Shopify / DB.
 *
 * Run: node scripts/verify-d8a-description-embed.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const failures = [];
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

// --- Pure mirrors (keep in sync with descriptionEmbed.ts) ---

const DESCRIPTION_EMBED_MAX = 2;

function normalizeEnvFlag(raw) {
  if (raw == null) return null;
  const v = String(raw).trim().toLowerCase();
  if (!v) return null;
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  return null;
}

function isDescriptionEmbedEnabled(env) {
  const parsed = normalizeEnvFlag(
    env.DESCRIPTION_EMBED_IMAGES ?? env.NESTORY_DESCRIPTION_EMBED_IMAGES
  );
  return parsed !== false;
}

function isShowmoreDescriptionEmbedEnabled(env) {
  const parsed = normalizeEnvFlag(env.SHOWMORE_DESCRIPTION_EMBED_IMAGES);
  return parsed === true;
}

function resolveImageSourceUrl(image) {
  const url =
    (image.processed_file_url || "").trim() ||
    (image.original_file_url || "").trim() ||
    (image.generated_file_url || "").trim() ||
    "";
  return url || null;
}

function isShopifyCdnUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.includes("cdn.shopify.com") || host.includes("shopifycdn.com");
  } catch {
    return /cdn\.shopify\.com|shopifycdn\.com/i.test(url);
  }
}

function escapeHtmlAttr(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fallbackAlt(image, titleFallback) {
  const alt = (image.alt_text || "").trim();
  if (alt) return alt;
  const title = (titleFallback || "").trim();
  if (title) return title;
  return "Nestory product image";
}

function toCandidate(image, titleFallback) {
  if (image.image_type === "spec") return null;
  const url = resolveImageSourceUrl(image);
  if (!url) return null;
  return {
    id: image.id,
    imageType: image.image_type,
    url,
    alt: fallbackAlt(image, titleFallback),
    isShopifyCdn: isShopifyCdnUrl(url)
  };
}

function preferCdn(a, b) {
  if (a.isShopifyCdn === b.isShopifyCdn) return 0;
  return a.isShopifyCdn ? -1 : 1;
}

function pickDescriptionEmbedImages(images, titleFallback, max = DESCRIPTION_EMBED_MAX) {
  if (!images?.length || max <= 0) return [];
  const sorted = [...images].sort((a, b) => a.sort_order - b.sort_order);
  const candidates = sorted
    .map((img) => toCandidate(img, titleFallback))
    .filter(Boolean);
  if (!candidates.length) return [];

  const byType = (type) =>
    candidates.filter((c) => c.imageType === type).sort(preferCdn);

  const picked = [];
  const usedIds = new Set();
  const usedUrls = new Set();

  const take = (list) => {
    for (const c of list) {
      if (picked.length >= max) return;
      if (usedIds.has(c.id) || usedUrls.has(c.url)) continue;
      usedIds.add(c.id);
      usedUrls.add(c.url);
      picked.push(c);
      return;
    }
  };

  const mains = byType("main");
  if (mains.length) take(mains);
  else take(candidates.slice().sort(preferCdn));

  if (picked.length >= max) return picked;
  take(byType("detail"));
  if (picked.length >= max) return picked;
  take(byType("generated_detail"));
  if (picked.length >= max) return picked;
  take(
    candidates
      .filter(
        (c) =>
          c.imageType !== "main" &&
          c.imageType !== "detail" &&
          c.imageType !== "generated_detail" &&
          c.imageType !== "variant"
      )
      .sort(preferCdn)
  );
  if (picked.length >= max) return picked;
  take(byType("variant"));
  if (picked.length >= max) return picked;
  take(candidates.filter((c) => !usedIds.has(c.id)));
  return picked;
}

function buildDescriptionEmbedHtml(images, titleFallback, opts = {}) {
  if (opts.enabled === false) return "";
  const picks = pickDescriptionEmbedImages(images, titleFallback, opts.max ?? DESCRIPTION_EMBED_MAX);
  if (!picks.length) return "";
  const parts = picks.map(
    (p) =>
      `<p><img src="${escapeHtmlAttr(p.url)}" alt="${escapeHtmlAttr(p.alt)}" loading="lazy" style="max-width:100%;height:auto;" /></p>`
  );
  return `<!-- nestory-desc-embed -->${parts.join("")}`;
}

function appendDescriptionEmbedIfEnabled(bodyHtml, images, titleFallback, env) {
  if (!isDescriptionEmbedEnabled(env)) return bodyHtml;
  return bodyHtml + buildDescriptionEmbedHtml(images, titleFallback);
}

console.log("\nD8a-open description embed verification\n");

await check("module files exist", () => {
  assert.ok(exists("src/lib/contentGenerator/descriptionEmbed.ts"));
  assert.ok(exists("src/lib/shopify/payload.ts"));
  assert.ok(exists("src/lib/csv/matrixify.ts"));
  assert.ok(exists("src/lib/csv/showmore.ts"));
});

await check("payload wires append after formatPlainTextAsHtml, before internal link", () => {
  const src = read("src/lib/shopify/payload.ts");
  assert.ok(src.includes("appendDescriptionEmbedIfEnabled"), "import/call");
  assert.ok(src.includes("formatPlainTextAsHtml"), "body html");
  assert.ok(src.includes("buildInternalLinkHtml"), "internal link kept");
  assert.ok(src.includes("buildFaqJsonLdScriptTag"), "faq ld kept");
  // Call-site order inside descriptionHtml (ignore earlier imports)
  const descBlockStart = src.indexOf("descriptionHtml:");
  assert.ok(descBlockStart > 0, "descriptionHtml field");
  const descBlock = src.slice(descBlockStart, descBlockStart + 600);
  const embedIdx = descBlock.indexOf("appendDescriptionEmbedIfEnabled");
  const linkIdx = descBlock.indexOf("buildInternalLinkHtml");
  const faqIdx = descBlock.indexOf("buildFaqJsonLdScriptTag");
  assert.ok(embedIdx >= 0 && linkIdx > embedIdx, "embed before internal link in descriptionHtml");
  assert.ok(faqIdx > linkIdx, "faq after link in descriptionHtml");
  // Must not assign embed into DB column shape
  assert.ok(!src.includes("description_html:"), "no write to description_html column in payload");
});

await check("matrixify Body HTML uses appendDescriptionEmbedIfEnabled", () => {
  const src = read("src/lib/csv/matrixify.ts");
  assert.ok(src.includes("appendDescriptionEmbedIfEnabled"));
  assert.ok(src.includes('"Body HTML"') || src.includes("'Body HTML'"));
});

await check("showmore uses Showmore-specific helper (default off path)", () => {
  const src = read("src/lib/csv/showmore.ts");
  assert.ok(src.includes("appendShowmoreDescriptionEmbedIfEnabled"));
  assert.ok(!src.includes("appendDescriptionEmbedIfEnabled("), "must not use Shopify default-on helper");
});

await check(".env.example documents D8a flags", () => {
  const env = read(".env.example");
  assert.ok(env.includes("DESCRIPTION_EMBED_IMAGES") || env.includes("NESTORY_DESCRIPTION_EMBED"));
  assert.ok(env.includes("SHOWMORE_DESCRIPTION_EMBED_IMAGES"));
});

await check("env: shopify default on; false off", () => {
  assert.equal(isDescriptionEmbedEnabled({}), true);
  assert.equal(isDescriptionEmbedEnabled({ DESCRIPTION_EMBED_IMAGES: "" }), true);
  assert.equal(isDescriptionEmbedEnabled({ DESCRIPTION_EMBED_IMAGES: "false" }), false);
  assert.equal(isDescriptionEmbedEnabled({ DESCRIPTION_EMBED_IMAGES: "0" }), false);
  assert.equal(isDescriptionEmbedEnabled({ DESCRIPTION_EMBED_IMAGES: "off" }), false);
  assert.equal(isDescriptionEmbedEnabled({ DESCRIPTION_EMBED_IMAGES: "true" }), true);
  assert.equal(
    isDescriptionEmbedEnabled({ NESTORY_DESCRIPTION_EMBED_IMAGES: "false" }),
    false
  );
});

await check("env: showmore default off", () => {
  assert.equal(isShowmoreDescriptionEmbedEnabled({}), false);
  assert.equal(isShowmoreDescriptionEmbedEnabled({ SHOWMORE_DESCRIPTION_EMBED_IMAGES: "true" }), true);
  assert.equal(isShowmoreDescriptionEmbedEnabled({ SHOWMORE_DESCRIPTION_EMBED_IMAGES: "1" }), true);
  assert.equal(isShowmoreDescriptionEmbedEnabled({ SHOWMORE_DESCRIPTION_EMBED_IMAGES: "false" }), false);
});

const sampleImages = [
  {
    id: "s1",
    image_type: "spec",
    sort_order: 0,
    alt_text: "規格",
    processed_file_url: "https://cdn.example/spec.webp",
    original_file_url: null,
    generated_file_url: null
  },
  {
    id: "m1",
    image_type: "main",
    sort_order: 1,
    alt_text: "主圖 ALT",
    processed_file_url: "https://cdn.shopify.com/main.webp",
    original_file_url: "https://supabase.example/main.jpg",
    generated_file_url: null
  },
  {
    id: "d1",
    image_type: "detail",
    sort_order: 2,
    alt_text: null,
    processed_file_url: null,
    original_file_url: "https://supabase.example/detail.jpg",
    generated_file_url: null
  },
  {
    id: "g1",
    image_type: "generated_detail",
    sort_order: 3,
    alt_text: "情境",
    processed_file_url: "https://cdn.example/scene.webp",
    original_file_url: null,
    generated_file_url: null
  },
  {
    id: "v1",
    image_type: "variant",
    sort_order: 4,
    alt_text: "款式",
    processed_file_url: "https://cdn.example/var.webp",
    original_file_url: null,
    generated_file_url: null
  }
];

await check("pick: skips spec; main + detail; max 2", () => {
  const picks = pickDescriptionEmbedImages(sampleImages, "商品標題");
  assert.equal(picks.length, 2);
  assert.equal(picks[0].id, "m1");
  assert.equal(picks[1].id, "d1");
  assert.ok(!picks.some((p) => p.id === "s1"));
});

await check("pick: detail missing → generated_detail", () => {
  const imgs = sampleImages.filter((i) => i.image_type !== "detail");
  const picks = pickDescriptionEmbedImages(imgs, "T");
  assert.equal(picks[0].id, "m1");
  assert.equal(picks[1].id, "g1");
});

await check("pick: alt prefers alt_text else title", () => {
  const picks = pickDescriptionEmbedImages(sampleImages, "商品標題");
  assert.equal(picks[0].alt, "主圖 ALT");
  assert.equal(picks[1].alt, "商品標題");
});

await check("pick: empty / no url → empty", () => {
  assert.deepEqual(pickDescriptionEmbedImages([], "t"), []);
  assert.deepEqual(
    pickDescriptionEmbedImages(
      [
        {
          id: "x",
          image_type: "main",
          sort_order: 0,
          alt_text: null,
          processed_file_url: null,
          original_file_url: null,
          generated_file_url: null
        }
      ],
      "t"
    ),
    []
  );
});

await check("HTML: max 2 imgs + escape + marker", () => {
  const html = buildDescriptionEmbedHtml(sampleImages, 'A"B');
  assert.ok(html.includes("nestory-desc-embed"));
  assert.equal((html.match(/<img /g) || []).length, 2);
  assert.ok(html.includes('alt="主圖 ALT"'));
  assert.ok(html.includes("cdn.shopify.com/main.webp"));
  const noDetail = sampleImages.filter((i) => i.image_type !== "detail");
  // generated_detail with title fallback when needed
  const html2 = buildDescriptionEmbedHtml(
    [
      {
        id: "m",
        image_type: "main",
        sort_order: 0,
        alt_text: null,
        processed_file_url: 'https://x.com/a.jpg?x="1"',
        original_file_url: null,
        generated_file_url: null
      }
    ],
    '標題<>&"'
  );
  assert.ok(html2.includes("&quot;") || html2.includes("&#"));
  assert.ok(html2.includes("&lt;") || html2.includes("標題"));
  void noDetail;
});

await check("append: env off leaves body unchanged", () => {
  const body = "<p>hello</p>";
  const out = appendDescriptionEmbedIfEnabled(body, sampleImages, "T", {
    DESCRIPTION_EMBED_IMAGES: "false"
  });
  assert.equal(out, body);
  assert.ok(!out.includes("<img"));
});

await check("append: env on adds imgs", () => {
  const body = "<p>hello</p>";
  const out = appendDescriptionEmbedIfEnabled(body, sampleImages, "T", {});
  assert.ok(out.startsWith(body));
  assert.ok(out.includes("<img"));
  assert.ok(out.includes("nestory-desc-embed"));
});

await check("descriptionEmbed.ts exports and Q rules present", () => {
  const src = read("src/lib/contentGenerator/descriptionEmbed.ts");
  assert.ok(src.includes("DESCRIPTION_EMBED_MAX"));
  assert.ok(src.includes("isDescriptionEmbedEnabled"));
  assert.ok(src.includes("isShowmoreDescriptionEmbedEnabled"));
  assert.ok(src.includes("pickDescriptionEmbedImages"));
  assert.ok(src.includes("buildDescriptionEmbedHtml"));
  assert.ok(src.includes("generated_detail"));
  assert.ok(src.includes("spec"));
  assert.ok(!src.includes("notify-api.line.me"));
});

console.log("");
if (failures.length) {
  console.error(`FAILED ${failures.length} check(s)`);
  process.exit(1);
}
console.log("All D8a-open checks passed.\n");
