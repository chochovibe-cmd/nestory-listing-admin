/**
 * CAP-1 verify: static contract + pure function mirrors (no network, no .env).
 * Run: node scripts/verify-cap1.mjs  |  pnpm run verify:cap1
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
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

// --- mirrors (keep in sync with src/lib/import + checkDuplicate + productBrand) ---

const CAPTURE_TOKEN_PREFIX = "ncap_";
const PRICE_PLACEHOLDER_CNY = 0.01;
const WARNING_MISSING_PRICE = "未抓到售價，已用占位值，請在表單填實際成本";
const WARNING_MULTIDIM_SKU =
  "多維規格已壓平為單維／列舉款式，展開待包二；完整表見 raw_capture.sku_table";
const RAW_CAPTURE_FIELD_MAX_BYTES = 256 * 1024;
const MAX_VIDEO_URLS = 3;

function extractUrlMatchKey(rawUrl) {
  const url = rawUrl.trim();
  if (!url) return "";
  const idMatch = url.match(/[?&](?:id|itemId|item_id)=(\d{6,})/i);
  if (idMatch) return idMatch[1];
  let core = url
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("#")[0]
    .split("?")[0]
    .replace(/\/+$/, "")
    .toLowerCase();
  core = core.replace(/[(),*]/g, "");
  return core;
}

function generateCaptureToken() {
  return `${CAPTURE_TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
}

function isCaptureTokenFormat(token) {
  return /^ncap_[0-9a-f]{64}$/i.test(token.trim());
}

function hashCaptureToken(token) {
  return createHash("sha256").update(token.trim(), "utf8").digest("hex");
}

function captureTokenDisplayPrefix(token) {
  const t = token.trim();
  if (!isCaptureTokenFormat(t)) return `${CAPTURE_TOKEN_PREFIX}••••`;
  const body = t.slice(CAPTURE_TOKEN_PREFIX.length);
  return `${CAPTURE_TOKEN_PREFIX}${body.slice(0, 4)}…${body.slice(-4)}`;
}

function mirrorNormalizeBrand(raw) {
  if (raw == null) return null;
  let s = String(raw).normalize("NFKC").trim();
  if (!s) return null;
  const TRAILING =
    /(官方旗艦店|官方旗舰店|旗艦店|旗舰店|官方店|專賣店|专卖店|官方|正版|旗艦|旗舰)$/u;
  s = s.replace(TRAILING, "").trim();
  if (!s) return null;
  s = s.replace(/旗舰/g, "旗艦").replace(/专卖/g, "專賣");
  s = s.replace(TRAILING, "").trim();
  if (s.length > 40) s = s.slice(0, 40).trim();
  if (s.length < 2) return null;
  if (/^(正版|官方|品牌|無|无|未知|没有|none|n\/a|na|unknown|null|undefined|—|-|－)$/i.test(s)) {
    return null;
  }
  if (!/[\p{L}\p{N}]/u.test(s)) return null;
  return s;
}

function extractBrandFromParams(params) {
  if (!params || typeof params !== "object") return null;
  for (const key of ["品牌", "brand", "Brand", "Trademark", "商标", "商標"]) {
    if (!(key in params)) continue;
    const cleaned = mirrorNormalizeBrand(String(params[key] ?? ""));
    if (cleaned) return cleaned;
  }
  return null;
}

function formatParamsAsSpecText(params) {
  if (!params || typeof params !== "object") return null;
  const lines = [];
  for (const [key, raw] of Object.entries(params)) {
    const k = key.trim();
    if (!k || raw == null) continue;
    const v = String(raw).trim();
    if (!v) continue;
    lines.push(`${k}：${v}`);
  }
  return lines.length ? lines.join("\n") : null;
}

function normalizeVideoUrls(raw) {
  const list = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") list.push(item);
    }
  } else if (typeof raw === "string") {
    list.push(...raw.split(/\r?\n/));
  }
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const t = item.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_VIDEO_URLS) break;
  }
  return out;
}

function detectMultiDimSku(body) {
  const dim = body.capture_meta?.sku_dimensions;
  if (typeof dim === "number" && dim >= 2) return true;
  const table = body.sku_table;
  if (table && typeof table === "object" && !Array.isArray(table)) {
    const axes = table.axes ?? table.dimensions;
    if (Array.isArray(axes) && axes.length >= 2) return true;
  }
  const flats = Array.isArray(body.variants_flat) ? body.variants_flat : [];
  if (flats.some((r) => String(r.option2_value ?? "").trim())) return true;
  return false;
}

function asPositiveNumber(value) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function mapPrice(price_cny) {
  const price = asPositiveNumber(price_cny);
  if (price == null) {
    return { cny_price: PRICE_PLACEHOLDER_CNY, warning: WARNING_MISSING_PRICE, filled: false };
  }
  return { cny_price: price, warning: null, filled: true };
}

function stripOversizedCaptureFields(value, pathName = "payload") {
  const warnings = [];
  function walk(node, p) {
    if (typeof node === "string") {
      const bytes = Buffer.byteLength(node, "utf8");
      if (bytes > RAW_CAPTURE_FIELD_MAX_BYTES) {
        warnings.push(`raw_capture 欄位過大已截斷：${p}`);
        let end = RAW_CAPTURE_FIELD_MAX_BYTES;
        while (Buffer.byteLength(node.slice(0, end), "utf8") > RAW_CAPTURE_FIELD_MAX_BYTES && end > 0) {
          end -= 1;
        }
        return `${node.slice(0, end)}…[truncated]`;
      }
      return node;
    }
    if (Array.isArray(node)) return node.map((item, i) => walk(item, `${p}[${i}]`));
    if (node && typeof node === "object") {
      const out = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v, `${p}.${k}`);
      return out;
    }
    return node;
  }
  return { value: walk(value, pathName), warnings };
}

function routeExportsOnlyHttpMethods(src) {
  const exports = [...src.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1]);
  const constExports = [...src.matchAll(/export\s+const\s+(\w+)/g)].map((m) => m[1]);
  const all = [...exports, ...constExports];
  const allowed = new Set([
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "HEAD",
    "OPTIONS",
    "maxDuration",
    "dynamic",
    "runtime",
    "preferredRegion",
    "fetchCache",
    "revalidate"
  ]);
  const bad = all.filter((name) => !allowed.has(name));
  return { all, bad };
}

console.log("verify-cap1:");

// --- static: files exist ---
check("files: migration 036 + lib + routes + fixture", () => {
  assert.ok(exists("supabase/migrations/036_capture_token_and_raw_capture.sql"));
  assert.ok(exists("src/lib/import/captureAuth.ts"));
  assert.ok(exists("src/lib/import/captureTypes.ts"));
  assert.ok(exists("src/lib/import/mapCaptureFields.ts"));
  assert.ok(exists("src/lib/import/createCaptureDraft.ts"));
  assert.ok(exists("src/lib/import/fetchRemoteImages.ts"));
  assert.ok(exists("src/app/api/import/product-page/route.ts"));
  assert.ok(exists("src/app/api/settings/capture-token/route.ts"));
  assert.ok(exists("scripts/fixtures/cap1-sample.json"));
});

check("migration 036: required column strings", () => {
  const sql = read("supabase/migrations/036_capture_token_and_raw_capture.sql");
  assert.match(sql, /capture_token_hash/);
  assert.match(sql, /capture_token_prefix/);
  assert.match(sql, /capture_token_created_at/);
  assert.match(sql, /raw_capture/);
  assert.match(sql, /product_drafts/);
  assert.match(sql, /profiles/);
});

check("fixture: contract fields present", () => {
  const fixture = JSON.parse(read("scripts/fixtures/cap1-sample.json"));
  assert.ok(typeof fixture.source_url === "string" && fixture.source_url.length > 0);
  assert.ok("title" in fixture);
  assert.ok("price_cny" in fixture);
  assert.ok("sku_table" in fixture);
  assert.ok(Array.isArray(fixture.variants_flat));
  assert.ok(Array.isArray(fixture.main_image_urls));
  assert.ok(Array.isArray(fixture.detail_image_urls));
  assert.ok("params" in fixture);
  assert.ok(fixture.capture_meta?.sku_dimensions === 2);
});

check("route: product-page only HTTP method exports", () => {
  const src = read("src/app/api/import/product-page/route.ts");
  const { all, bad } = routeExportsOnlyHttpMethods(src);
  assert.ok(all.includes("POST"), "must export POST");
  assert.deepEqual(bad, [], `unexpected exports: ${bad.join(",")}`);
  assert.match(src, /maxDuration\s*=\s*60/);
  assert.match(src, /verifyCaptureToken/);
  assert.match(src, /createCaptureDraft/);
});

check("route: capture-token only HTTP method exports", () => {
  const src = read("src/app/api/settings/capture-token/route.ts");
  const { all, bad } = routeExportsOnlyHttpMethods(src);
  assert.ok(all.includes("POST"), "must export POST");
  assert.deepEqual(bad, [], `unexpected exports: ${bad.join(",")}`);
  assert.match(src, /issueCaptureToken/);
  assert.match(src, /canOperate/);
});

check("source: mapCaptureFields honesty + warnings + source_type capture", () => {
  const src = read("src/lib/import/mapCaptureFields.ts");
  assert.match(src, /source_type:\s*"capture"/);
  assert.match(src, /WARNING_MISSING_PRICE|未抓到售價，已用占位值/);
  assert.match(src, /WARNING_MULTIDIM_SKU|多維規格已壓平/);
  assert.match(src, /normalizeDetectedProductBrand/);
  assert.match(src, /stripOversizedCaptureFields/);
  assert.match(src, /pending_input/);
});

check("source: createCaptureDraft dedupe excludes archived + no overwrite", () => {
  const src = read("src/lib/import/createCaptureDraft.ts");
  assert.match(src, /status !== ["']archived["']/);
  assert.match(src, /status:\s*["']exists["']/);
  assert.match(src, /queryDuplicateMatches|extractUrlMatchKey/);
  assert.match(src, /fetchAndStoreCaptureImages/);
});

check("source: image fetch 10s timeout + referer + limits", () => {
  const src = read("src/lib/import/fetchRemoteImages.ts");
  assert.match(src, /IMAGE_FETCH_TIMEOUT_MS|10_000|10000/);
  assert.match(src, /Referer/);
  assert.match(src, /MAX_MAIN_IMAGES|MAX_DETAIL_IMAGES/);
  assert.match(src, /gateSourceUrl/);
});

check("source: settings UI double-confirm not window.confirm", () => {
  const src = read("src/components/settings/SettingsPanel.tsx");
  assert.match(src, /captureResetArm|確定重設/);
  assert.match(src, /capture-token/);
  assert.doesNotMatch(src, /window\.confirm/);
});

check("package.json: verify:cap1 script present; verify-all includes cap1", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["verify:cap1"], "node scripts/verify-cap1.mjs");
  const allRunner = read("scripts/verify-all.mjs");
  assert.match(allRunner, /verify-cap1\.mjs/);
});

// --- pure: url key ---
check("pure: extractUrlMatchKey taobao item id", () => {
  assert.equal(
    extractUrlMatchKey("https://item.taobao.com/item.htm?id=123456789012&spm=a"),
    "123456789012"
  );
  assert.equal(
    extractUrlMatchKey("https://detail.tmall.com/item.htm?id=999888777666"),
    "999888777666"
  );
});

// --- pure: token ---
check("pure: token format + hash stable + prefix mask", () => {
  const token = generateCaptureToken();
  assert.ok(isCaptureTokenFormat(token));
  assert.equal(hashCaptureToken(token), hashCaptureToken(token));
  assert.notEqual(hashCaptureToken(token), hashCaptureToken(generateCaptureToken()));
  const prefix = captureTokenDisplayPrefix(token);
  assert.match(prefix, /^ncap_[0-9a-f]{4}…[0-9a-f]{4}$/i);
  assert.ok(!prefix.includes(token.slice(5, 20)));
});

// --- pure: field mapping ---
check("pure: price placeholder + warning", () => {
  const missing = mapPrice(null);
  assert.equal(missing.cny_price, 0.01);
  assert.equal(missing.warning, WARNING_MISSING_PRICE);
  assert.equal(missing.filled, false);
  const ok = mapPrice(29.9);
  assert.equal(ok.cny_price, 29.9);
  assert.equal(ok.warning, null);
  assert.equal(ok.filled, true);
});

check("pure: title empty stays empty; params→spec; brand 75a", () => {
  assert.equal(extractBrandFromParams({ 品牌: "TOYUKI官方" }), "TOYUKI");
  assert.equal(extractBrandFromParams({ 品牌: "正版" }), null);
  assert.equal(extractBrandFromParams({}), null);
  const spec = formatParamsAsSpecText({ 品牌: "TOYUKI", 材質: "PVC" });
  assert.ok(spec.includes("品牌：TOYUKI"));
  assert.ok(spec.includes("材質：PVC"));
});

check("pure: multi-dim → warning string required", () => {
  const fixture = JSON.parse(read("scripts/fixtures/cap1-sample.json"));
  assert.equal(detectMultiDimSku(fixture), true);
  assert.ok(WARNING_MULTIDIM_SKU.includes("raw_capture.sku_table"));
  assert.equal(
    detectMultiDimSku({
      variants_flat: [{ option1_name: "顏色", option1_value: "粉" }],
      capture_meta: { sku_dimensions: 1 }
    }),
    false
  );
});

check("pure: video normalize max 3", () => {
  const many = normalizeVideoUrls(["a", "b", "c", "d", "e"]);
  assert.equal(many.length, 3);
  assert.deepEqual(many, ["a", "b", "c"]);
});

check("pure: strip oversized fields >256KB", () => {
  const big = "x".repeat(RAW_CAPTURE_FIELD_MAX_BYTES + 1000);
  const { value, warnings } = stripOversizedCaptureFields({ blob: big }, "payload");
  assert.ok(warnings.length >= 1);
  assert.ok(String(value.blob).includes("[truncated]"));
  assert.ok(Buffer.byteLength(String(value.blob), "utf8") < Buffer.byteLength(big, "utf8"));
});

// --- summary ---
if (failures.length) {
  console.error(`\nverify-cap1 FAILED: ${failures.length} check(s)`);
  process.exit(1);
}
console.log("\nverify-cap1 ALL passed");
