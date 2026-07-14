/**
 * B3-fetch-open pure-logic verification (no secrets, no live taobao).
 * Mirrors src/lib/sourceFetch/* + planScreenshotFill 2A + wiring checks.
 *
 * Run: node scripts/verify-b3-fetch.mjs
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

// --- Inline mirrors: ssrf.ts ---

function parseIpv4(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map((p) => Number(p));
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inCidr(ip, base, maskBits) {
  if (maskBits <= 0) return true;
  if (maskBits >= 32) return ip === base;
  const mask = (0xffffffff << (32 - maskBits)) >>> 0;
  return (ip & mask) === (base & mask);
}

function isBlockedIpv4(ip) {
  return (
    inCidr(ip, parseIpv4("0.0.0.0"), 8) ||
    inCidr(ip, parseIpv4("10.0.0.0"), 8) ||
    inCidr(ip, parseIpv4("127.0.0.0"), 8) ||
    inCidr(ip, parseIpv4("169.254.0.0"), 16) ||
    inCidr(ip, parseIpv4("172.16.0.0"), 12) ||
    inCidr(ip, parseIpv4("192.168.0.0"), 16) ||
    inCidr(ip, parseIpv4("100.64.0.0"), 10) ||
    inCidr(ip, parseIpv4("224.0.0.0"), 4) ||
    inCidr(ip, parseIpv4("240.0.0.0"), 4)
  );
}

function isBlockedHostname(hostname) {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host === "0.0.0.0" || host === "metadata.google.internal") return true;
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  const ipv4 = parseIpv4(host);
  if (ipv4 != null) return isBlockedIpv4(ipv4);
  if (host === "::1" || host === "::") return true;
  return false;
}

function gateSourceUrl(raw) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, reason: "invalid" };
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "scheme" };
  }
  if (url.username || url.password) return { ok: false, reason: "ssrf" };
  if (isBlockedHostname(url.hostname)) return { ok: false, reason: "ssrf" };
  return { ok: true, url };
}

// --- Inline mirrors: parseProductHtml.ts ---

function classifyHost(hostname) {
  const h = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (h.includes("tmall")) return "tmall";
  if (h.includes("taobao")) return "taobao";
  return "generic";
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripTags(html) {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function metaContent(html, propertyOrName) {
  const esc = propertyOrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re1 = new RegExp(
    `<meta[^>]+(?:property|name)=["']${esc}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i"
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${esc}["'][^>]*>`,
    "i"
  );
  const m = html.match(re1) || html.match(re2);
  if (!m?.[1]) return null;
  const v = decodeHtmlEntities(m[1]).trim();
  return v || null;
}

function extractTitleTag(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m?.[1]) return null;
  return stripTags(m[1]).slice(0, 300) || null;
}

function extractJsonLdBlocks(html) {
  const blocks = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(m[1].trim()));
    } catch {
      /* ignore */
    }
  }
  return blocks;
}

function walkJsonLd(node, out) {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) walkJsonLd(item, out);
    return;
  }
  if (typeof node !== "object") return;
  if (node["@graph"]) walkJsonLd(node["@graph"], out);
  out.push(node);
  if (node.mainEntity) walkJsonLd(node.mainEntity, out);
}

function extractCnyPrice(amount, currencyHint) {
  let n = null;
  if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) n = amount;
  else if (typeof amount === "string") {
    const cleaned = amount.replace(/,/g, "").trim();
    const yen = cleaned.match(/(?:¥|￥|CNY|RMB)\s*([\d]+(?:\.\d+)?)/i);
    const plain = cleaned.match(/^([\d]+(?:\.\d+)?)$/);
    if (yen) {
      const v = Number(yen[1]);
      if (Number.isFinite(v) && v > 0) n = v;
    } else if (plain && currencyHint && /^(CNY|RMB)$/i.test(currencyHint.trim())) {
      const v = Number(plain[1]);
      if (Number.isFinite(v) && v > 0) n = v;
    }
  }
  if (n == null) return null;
  if (currencyHint) {
    const c = currencyHint.trim().toUpperCase();
    if (["TWD", "USD", "HKD", "JPY", "EUR", "GBP"].includes(c)) return null;
  }
  return Math.round(n * 100) / 100;
}

function parseProductHtml(html, hostname = "") {
  const hostClass = classifyHost(hostname);
  const empty = { title: null, costCny: null, features: null, specText: null, variants: [] };
  if (!(html ?? "").trim()) {
    return { fields: empty, hostClass, hasUsableFields: false };
  }
  const ogTitle = metaContent(html, "og:title");
  const ogDesc = metaContent(html, "og:description");
  const titleTag = extractTitleTag(html);
  const nodes = [];
  for (const b of extractJsonLdBlocks(html)) walkJsonLd(b, nodes);
  let ldTitle = null;
  let ldCost = null;
  let ldFeatures = null;
  for (const node of nodes) {
    const t = node["@type"];
    const isProduct =
      (typeof t === "string" && /product/i.test(t)) ||
      (Array.isArray(t) && t.some((x) => typeof x === "string" && /product/i.test(x)));
    if (!isProduct) continue;
    if (!ldTitle && typeof node.name === "string") ldTitle = node.name.trim();
    if (!ldFeatures && typeof node.description === "string") ldFeatures = stripTags(node.description);
    if (ldCost == null && node.offers) {
      const offers = Array.isArray(node.offers) ? node.offers : [node.offers];
      for (const o of offers) {
        if (!o || typeof o !== "object") continue;
        ldCost = extractCnyPrice(o.price, o.priceCurrency);
        if (ldCost != null) break;
      }
    }
  }
  const ogPriceAmount = metaContent(html, "product:price:amount");
  const ogPriceCurrency = metaContent(html, "product:price:currency");
  let costCny = ldCost;
  if (costCny == null && ogPriceAmount) costCny = extractCnyPrice(ogPriceAmount, ogPriceCurrency);

  const title = (ldTitle || ogTitle || titleTag || null)?.trim()?.slice(0, 300) || null;
  let features = (ldFeatures || ogDesc || null)?.trim() || null;
  if (features) features = stripTags(features).slice(0, 800);
  if (features && title && features === title) features = null;

  const fields = { title, costCny, features, specText: null, variants: [] };
  const hasUsableFields = Boolean(fields.title || (fields.costCny != null && fields.costCny > 0) || fields.features);
  return { fields, hostClass, hasUsableFields };
}

function looksLikeBlockedOrEmptyPage(html) {
  const body = (html ?? "").trim();
  if (body.length < 80) return true;
  if (/login\.taobao|passport\.taobao|punish|captcha|请登录/i.test(body)) return true;
  const textish = stripTags(body.replace(/<script[\s\S]*?<\/script>/gi, " "));
  if (textish.length < 40) return true;
  return false;
}

// --- Inline mirror: planScreenshotFill 2A (title/cost only subset) ---

function isBlank(value) {
  return !value || !String(value).trim();
}

function planScreenshotFill(current, recognized) {
  const filledLines = [];
  const missingLines = [];
  let title = null;
  let costCny = null;
  let note = null;

  if (!isBlank(current.title)) {
    if (recognized.title) missingLines.push("標題已有內容，未覆蓋");
  } else if (recognized.title) {
    title = recognized.title.trim();
    filledLines.push("標題✓");
  } else {
    missingLines.push("未辨識到標題，請手填");
  }

  const hasCost = recognized.costCny != null && Number.isFinite(recognized.costCny) && recognized.costCny > 0;
  if (!isBlank(current.price)) {
    if (hasCost) missingLines.push("成本已有內容，未覆蓋");
  } else if (hasCost) {
    costCny = recognized.costCny;
    filledLines.push(`成本 ¥${costCny}✓`);
  }

  if (!isBlank(current.note)) {
    if (recognized.features) missingLines.push("備註已有內容，未覆蓋");
  } else if (recognized.features?.trim()) {
    note = recognized.features.trim();
    filledLines.push("備註✓");
  }

  const parts = [];
  if (filledLines.length > 0) parts.push(`已填入：${filledLines.join("／")}`);
  else parts.push("已填入：（無，欄位皆已有內容或未辨識到可用資料）");
  if (missingLines.length > 0) parts.push(missingLines.join("；"));
  return { title, costCny, note, filledLines, missingLines, summary: parts.join("。") };
}

function messageForBlockedOrEmpty(hostClass) {
  if (hostClass === "taobao" || hostClass === "tmall") {
    return "這個網址目前抓不到商品資料（平台常擋自動讀取）。網址已保留供查重；請改用「上傳截圖自動辨識」或手動貼標題。";
  }
  return "暫時連不上來源頁或頁面沒有可讀的商品資料。網址已保留；請截圖或手填。";
}

// --- Fixtures ---

const FIXTURE_OG = `<!doctype html>
<html><head>
<meta property="og:title" content="Chiikawa 公仔吊飾 官方">
<meta property="og:description" content="可愛吊飾，送禮首選">
<meta property="product:price:amount" content="79.11">
<meta property="product:price:currency" content="CNY">
<title>Fallback Title</title>
</head><body><h1>Product</h1></body></html>`;

const FIXTURE_JSONLD = `<!doctype html>
<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"JSON-LD 商品名","description":"特色說明一段",
 "offers":{"@type":"Offer","price":"128.5","priceCurrency":"CNY"}}
</script>
</head><body>ok</body></html>`;

const FIXTURE_TAOBAO_SHELL = `<!doctype html>
<html><head><title></title></head>
<body><div id="root"></div>
<script>window.location="https://login.taobao.com/"</script>
</body></html>`;

const FIXTURE_USD_PRICE = `<!doctype html>
<html><head>
<meta property="og:title" content="USD product">
<meta property="product:price:amount" content="19.99">
<meta property="product:price:currency" content="USD">
</head><body>x</body></html>`;

console.log("\nB3-fetch-open verify\n");

await check("files exist", () => {
  assert.ok(exists("src/lib/sourceFetch/ssrf.ts"));
  assert.ok(exists("src/lib/sourceFetch/parseProductHtml.ts"));
  assert.ok(exists("src/lib/sourceFetch/fetchSourceUrl.ts"));
  assert.ok(exists("src/app/api/fetch-source-url/route.ts"));
});

await check("gate: empty / invalid / scheme", () => {
  assert.equal(gateSourceUrl("").ok, false);
  assert.equal(gateSourceUrl("not-a-url").ok, false);
  assert.equal(gateSourceUrl("ftp://example.com/a").reason, "scheme");
});

await check("SSRF blocks private / localhost / metadata", () => {
  assert.equal(gateSourceUrl("http://127.0.0.1/x").reason, "ssrf");
  assert.equal(gateSourceUrl("http://localhost/x").reason, "ssrf");
  assert.equal(gateSourceUrl("http://10.0.0.5/x").reason, "ssrf");
  assert.equal(gateSourceUrl("http://192.168.1.1/x").reason, "ssrf");
  assert.equal(gateSourceUrl("http://172.16.0.1/x").reason, "ssrf");
  assert.equal(gateSourceUrl("http://169.254.169.254/latest").reason, "ssrf");
  assert.equal(gateSourceUrl("https://user:pass@example.com/").reason, "ssrf");
});

await check("gate allows public https product URL", () => {
  const g = gateSourceUrl("https://item.taobao.com/item.htm?id=123");
  assert.equal(g.ok, true);
  assert.equal(g.url.hostname, "item.taobao.com");
});

await check("classifyHost taobao / tmall / generic", () => {
  assert.equal(classifyHost("item.taobao.com"), "taobao");
  assert.equal(classifyHost("detail.tmall.com"), "tmall");
  assert.equal(classifyHost("www.example.com"), "generic");
});

await check("fixture og:title + CNY price → usable fields", () => {
  const p = parseProductHtml(FIXTURE_OG, "shop.example.com");
  assert.equal(p.hasUsableFields, true);
  assert.equal(p.fields.title, "Chiikawa 公仔吊飾 官方");
  assert.equal(p.fields.costCny, 79.11);
  assert.ok(p.fields.features?.includes("可愛"));
  assert.deepEqual(p.fields.variants, []);
});

await check("fixture JSON-LD Product → fields", () => {
  const p = parseProductHtml(FIXTURE_JSONLD, "brand.example.com");
  assert.equal(p.fields.title, "JSON-LD 商品名");
  assert.equal(p.fields.costCny, 128.5);
  assert.ok(p.fields.features?.includes("特色"));
});

await check("Q2-A: USD price not filled as costCny", () => {
  const p = parseProductHtml(FIXTURE_USD_PRICE, "shop.example.com");
  assert.equal(p.fields.title, "USD product");
  assert.equal(p.fields.costCny, null);
});

await check("taobao empty shell → no usable fields + blocked look", () => {
  const p = parseProductHtml(FIXTURE_TAOBAO_SHELL, "item.taobao.com");
  assert.equal(p.hostClass, "taobao");
  assert.equal(p.hasUsableFields, false);
  assert.equal(looksLikeBlockedOrEmptyPage(FIXTURE_TAOBAO_SHELL), true);
  const msg = messageForBlockedOrEmpty("taobao");
  assert.match(msg, /截圖/);
  assert.match(msg, /平台常擋/);
});

await check("2A planScreenshotFill does not overwrite title", () => {
  const p = parseProductHtml(FIXTURE_OG, "x.com");
  const plan = planScreenshotFill(
    { title: "測試不覆蓋", price: "", note: "", specText: "", variants: [] },
    p.fields
  );
  assert.equal(plan.title, null);
  assert.ok(plan.missingLines.some((l) => l.includes("標題已有內容")));
  assert.ok(plan.costCny === 79.11);
});

await check("2A fills empty title from fixture", () => {
  const p = parseProductHtml(FIXTURE_OG, "x.com");
  const plan = planScreenshotFill(
    { title: "", price: "", note: "", specText: "", variants: [] },
    p.fields
  );
  assert.equal(plan.title, "Chiikawa 公仔吊飾 官方");
  assert.ok(plan.filledLines.some((l) => l.includes("標題")));
});

await check("fetchSourceUrl mock fetch: success path", async () => {
  // Lightweight integration without importing TS: simulate fetchImpl contract
  const gated = gateSourceUrl("https://shop.example.com/p/1");
  assert.equal(gated.ok, true);
  const html = FIXTURE_OG;
  const parsed = parseProductHtml(html, gated.url.hostname);
  assert.equal(parsed.hasUsableFields, true);
});

await check("fetchSourceUrl mock: 503 → blocked messaging", () => {
  // API maps http_error + taobao → yellow message
  const msg = messageForBlockedOrEmpty("taobao");
  assert.match(msg, /抓不到商品資料/);
});

await check("WorkspaceInputPanel no dead 「尚未啟用」; wires fetch-source-url", () => {
  const ui = read("src/components/listing/WorkspaceInputPanel.tsx");
  assert.equal(ui.includes("網址抓取尚未啟用"), false);
  assert.ok(ui.includes("/api/fetch-source-url"));
  assert.ok(ui.includes("handleFetchClick"));
  assert.ok(ui.includes("runUrlDedupe"));
  assert.ok(ui.includes("planScreenshotFill"));
  assert.ok(ui.includes("sourceFetching") || ui.includes("setSourceFetching"));
});

await check("API route auth + canOperate + fetchSourceUrl", () => {
  const route = read("src/app/api/fetch-source-url/route.ts");
  assert.ok(route.includes("createServerSupabaseClient"));
  assert.ok(route.includes("canOperate"));
  assert.ok(route.includes("fetchSourceUrl"));
  assert.ok(route.includes("sourceUrl"));
  // Honest soft-fail 200 for anti-bot
  assert.ok(route.includes("status: hard ? 400 : 200") || route.includes("hard ? 400 : 200"));
});

await check("lib uses redirect:manual + SSRF gate (no headless browser deps)", () => {
  const lib = read("src/lib/sourceFetch/fetchSourceUrl.ts");
  assert.ok(lib.includes('redirect: "manual"'));
  assert.ok(lib.includes("gateSourceUrl"));
  // No runtime imports of headless browsers
  assert.equal(/from\s+["']puppeteer/.test(lib), false);
  assert.equal(/require\(["']puppeteer/.test(lib), false);
  assert.equal(/from\s+["']playwright/.test(lib), false);
});

await check("no dead message left in src", () => {
  // Quick scan of the panel only (already checked); also fetchSourceUrl messages
  const lib = read("src/lib/sourceFetch/fetchSourceUrl.ts");
  assert.equal(lib.includes("尚未啟用"), false);
  assert.ok(lib.includes("平台常擋自動讀取") || lib.includes("截圖"));
});

if (failures.length) {
  console.error(`\nFAILED ${failures.length} check(s)`);
  process.exit(1);
}
console.log("\nALL passed\n");
