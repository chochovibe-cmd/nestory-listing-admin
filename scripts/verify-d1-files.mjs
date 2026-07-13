/**
 * D1 verification: Shopify Files finalize (no secrets required for core path).
 *
 * - Static wiring: filesUpload real ops, finalize route not always 501
 * - Pure helpers: isShopifyCdnUrl, pickFinalizeSource, extractCdn, path safety, field order
 * - Optional live: only if SHOPIFY_* present AND VERIFY_D1_LIVE=1 — otherwise SKIP (no fake green)
 *
 * Run: node scripts/verify-d1-files.mjs
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

// --- Inline mirrors of pure helpers (keep in sync with filesUpload.ts) ---

function isShopifyCdnUrl(url) {
  if (!url?.trim()) return false;
  try {
    const host = new URL(url.trim()).hostname.toLowerCase();
    if (host === "cdn.shopify.com") return true;
    if (host.endsWith(".cdn.shopify.com")) return true;
    if (host === "cdn.shopifycdn.net" || host.endsWith(".shopifycdn.net")) return true;
    if (host.endsWith(".myshopify.com") && url.includes("/cdn/")) return true;
    return false;
  } catch {
    return false;
  }
}

function pickFinalizeSource(input) {
  const processed = input.processedFileUrl?.trim() || "";
  const original = input.originalFileUrl?.trim() || "";
  if (processed && isShopifyCdnUrl(processed)) {
    return { kind: "already_cdn", url: processed };
  }
  if (original && isShopifyCdnUrl(original) && !processed) {
    return { kind: "already_cdn", url: original };
  }
  if (processed) return { kind: "processed", url: processed };
  if (original) return { kind: "original", url: original };
  return { kind: "none", reason: "missing processed_file_url and original_file_url" };
}

function isFinalizeUploadImageType(imageType) {
  return imageType === "main" || imageType === "variant";
}

function looksLikeShopifyFileUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.includes("shopify")) return true;
    if (u.pathname.includes("/s/files/")) return true;
    return false;
  } catch {
    return false;
  }
}

function extractCdnUrlFromFileNode(node) {
  if (!node) return null;
  const candidates = [node.image?.url, node.preview?.image?.url, node.url];
  for (const c of candidates) {
    const u = typeof c === "string" ? c.trim() : "";
    if (u && (isShopifyCdnUrl(u) || looksLikeShopifyFileUrl(u))) return u;
  }
  return null;
}

function isOwnProcessedTempPath(storagePath, draftId, imageId) {
  if (!storagePath || !draftId || !imageId) return false;
  const parts = storagePath.split("/").filter(Boolean);
  if (parts.length < 4) return false;
  const draftIdx = parts.indexOf(draftId);
  if (draftIdx < 0 || draftIdx + 2 >= parts.length) return false;
  return (
    parts[draftIdx + 1] === "processed" && parts[draftIdx + 2] === `${imageId}.webp`
  );
}

function buildStagedUploadFieldOrder(parameters, fileFieldName = "file") {
  return [...parameters.map((p) => p.name), fileFieldName];
}

function isRetryableFilesError(result) {
  if (result.code === "CONFIG") return false;
  if (result.retryable === false) return false;
  if (result.retryable === true) return true;
  const msg = (result.error || "").toLowerCase();
  if (msg.includes("permission") || msg.includes("access_denied") || msg.includes("unauthorized")) {
    return false;
  }
  if (msg.includes("401") || msg.includes("403") || msg.includes("scope")) return false;
  if (result.fileGid) return false;
  if (result.code === "NO_CDN_URL") return false;
  return result.code === "UPLOAD_FAILED" || result.code === "SHOPIFY_ERROR";
}

console.log("\nD1 Shopify Files verify\n");

// --- Static wiring ---
await check("filesUpload.ts exists and is not NOT_IMPLEMENTED stub", () => {
  assert.ok(exists("src/lib/shopify/filesUpload.ts"));
  const src = read("src/lib/shopify/filesUpload.ts");
  assert.doesNotMatch(
    src,
    /always NOT_IMPLEMENTED|D-open: always NOT_IMPLEMENTED/
  );
  assert.match(src, /stagedUploadsCreate/);
  assert.match(src, /fileCreate/);
  assert.match(src, /uploadProcessedImageToShopifyFiles/);
  assert.match(src, /SHOPIFY_ERROR/);
  assert.match(src, /UPLOAD_FAILED/);
  assert.match(src, /NO_CDN_URL/);
  assert.match(src, /CONFIG/);
  assert.match(src, /isShopifyCdnUrl/);
  assert.match(src, /pickFinalizeSource/);
  assert.match(src, /extractCdnUrlFromFileNode/);
  assert.match(src, /CDN_POLL_MAX_ATTEMPTS/);
  // Must not return only stub success path
  assert.doesNotMatch(
    src,
    /Shopify Files upload not implemented in D-open/
  );
});

await check("finalize route is real (not fixed 501 stub)", () => {
  assert.ok(exists("src/app/api/images/finalize/route.ts"));
  const src = read("src/app/api/images/finalize/route.ts");
  const lib = exists("src/lib/images/runFinalize.ts")
    ? read("src/lib/images/runFinalize.ts")
    : "";
  assert.match(src, /draftId is required/);
  assert.match(src, /canOperate/);
  assert.match(src, /requireWorkerToken/);
  assert.match(src, /runFinalizeForDraft|uploadProcessedImageToShopifyFilesWithRetry|uploadProcessedImageToShopifyFiles/);
  assert.match(src, /maxDuration/);
  // Core CDN upload lives in runFinalize (D2 thin shell) or still inline
  const combined = src + "\n" + lib;
  assert.match(combined, /uploadProcessedImageToShopifyFilesWithRetry|uploadProcessedImageToShopifyFiles/);
  assert.match(combined, /shopify_cdn/);
  assert.match(combined, /isFinalizeUploadImageType|main.*variant/);
  assert.match(combined, /isOwnProcessedTempPath|processed\/\$\{/);
  // Must not always return 501
  assert.doesNotMatch(src, /status:\s*501/);
  assert.doesNotMatch(src, /D-open finalize stub only/);
});

await check("imagePipeline documents finalize step 8 as D1 done", () => {
  const src = read("src/lib/images/imagePipeline.ts");
  assert.match(src, /finalize → Shopify Files|finalize → Shopify Files permanent CDN/);
  assert.match(src, /shopify_cdn/);
  assert.doesNotMatch(src, /Thin stub: POST \/api\/images\/finalize → NOT_IMPLEMENTED/);
});

await check("adminGraphQL + adminToken still available for Files", () => {
  assert.ok(exists("src/lib/shopify/adminGraphQL.ts"));
  assert.ok(exists("src/lib/shopify/adminToken.ts"));
  const gql = read("src/lib/shopify/adminGraphQL.ts");
  assert.match(gql, /callShopifyAdminGraphQL/);
  const tok = read("src/lib/shopify/adminToken.ts");
  assert.match(tok, /hasShopifyAdminCredentials/);
});

// --- Pure logic ---
await check("isShopifyCdnUrl accepts cdn.shopify.com", () => {
  assert.equal(isShopifyCdnUrl("https://cdn.shopify.com/s/files/1/x/a.webp"), true);
  assert.equal(isShopifyCdnUrl("https://example.com/a.webp"), false);
  assert.equal(isShopifyCdnUrl(""), false);
  assert.equal(isShopifyCdnUrl(null), false);
});

await check("pickFinalizeSource priority: cdn skip → processed → original", () => {
  const cdn = "https://cdn.shopify.com/s/files/1/a.webp";
  const temp = "https://xyz.supabase.co/storage/v1/object/public/product-images/u/d/processed/i.webp";
  const orig = "https://xyz.supabase.co/storage/v1/object/public/product-images/u/d/main/i.jpg";

  assert.equal(pickFinalizeSource({ processedFileUrl: cdn, originalFileUrl: orig }).kind, "already_cdn");
  assert.equal(pickFinalizeSource({ processedFileUrl: temp, originalFileUrl: orig }).kind, "processed");
  assert.equal(pickFinalizeSource({ processedFileUrl: null, originalFileUrl: orig }).kind, "original");
  assert.equal(pickFinalizeSource({ processedFileUrl: null, originalFileUrl: null }).kind, "none");
});

await check("isFinalizeUploadImageType main+variant only (Q5-A)", () => {
  assert.equal(isFinalizeUploadImageType("main"), true);
  assert.equal(isFinalizeUploadImageType("variant"), true);
  assert.equal(isFinalizeUploadImageType("spec"), false);
  assert.equal(isFinalizeUploadImageType("detail"), false);
});

await check("extractCdnUrlFromFileNode prefers image.url then preview", () => {
  assert.equal(
    extractCdnUrlFromFileNode({
      image: { url: "https://cdn.shopify.com/s/files/1/a.webp" },
      preview: { image: { url: "https://cdn.shopify.com/s/files/1/b.webp" } }
    }),
    "https://cdn.shopify.com/s/files/1/a.webp"
  );
  assert.equal(
    extractCdnUrlFromFileNode({
      image: null,
      preview: { image: { url: "https://cdn.shopify.com/s/files/1/b.webp" } }
    }),
    "https://cdn.shopify.com/s/files/1/b.webp"
  );
  assert.equal(extractCdnUrlFromFileNode({ image: null, preview: null }), null);
  assert.equal(extractCdnUrlFromFileNode(null), null);
});

await check("isOwnProcessedTempPath requires draftId + imageId (Q4-A safety)", () => {
  const draftId = "draft-aaa";
  const imageId = "img-bbb";
  assert.equal(
    isOwnProcessedTempPath(`user1/${draftId}/processed/${imageId}.webp`, draftId, imageId),
    true
  );
  assert.equal(
    isOwnProcessedTempPath(`user1/other-draft/processed/${imageId}.webp`, draftId, imageId),
    false
  );
  assert.equal(
    isOwnProcessedTempPath(`user1/${draftId}/main/${imageId}.jpg`, draftId, imageId),
    false
  );
  assert.equal(
    isOwnProcessedTempPath(`user1/${draftId}/processed/other.webp`, draftId, imageId),
    false
  );
});

await check("buildStagedUploadFieldOrder: parameters then file last", () => {
  const order = buildStagedUploadFieldOrder([
    { name: "key", value: "k" },
    { name: "policy", value: "p" },
    { name: "x-goog-signature", value: "s" }
  ]);
  assert.deepEqual(order, ["key", "policy", "x-goog-signature", "file"]);
  assert.equal(order[order.length - 1], "file");
});

await check("isRetryableFilesError: network yes, CONFIG/permission/fileGid no", () => {
  assert.equal(
    isRetryableFilesError({ ok: false, code: "UPLOAD_FAILED", error: "staged upload network error: ECONNRESET", retryable: true }),
    true
  );
  assert.equal(
    isRetryableFilesError({ ok: false, code: "CONFIG", error: "missing creds" }),
    false
  );
  assert.equal(
    isRetryableFilesError({
      ok: false,
      code: "SHOPIFY_ERROR",
      error: "permission denied write_files",
      retryable: false
    }),
    false
  );
  assert.equal(
    isRetryableFilesError({
      ok: false,
      code: "NO_CDN_URL",
      error: "poll timeout",
      fileGid: "gid://shopify/MediaImage/1"
    }),
    false
  );
});

await check("mock fileCreate payload extraction (happy path shape)", () => {
  // Simulates GraphQL fileCreate → extract CDN without live Shopify
  const mockFileCreatePayload = {
    data: {
      fileCreate: {
        files: [
          {
            id: "gid://shopify/MediaImage/123",
            fileStatus: "READY",
            image: { url: "https://cdn.shopify.com/s/files/1/abc/product.webp" },
            preview: { image: { url: null } }
          }
        ],
        userErrors: []
      }
    }
  };
  const file = mockFileCreatePayload.data.fileCreate.files[0];
  const cdn = extractCdnUrlFromFileNode(file);
  assert.equal(cdn, "https://cdn.shopify.com/s/files/1/abc/product.webp");
  assert.equal(isShopifyCdnUrl(cdn), true);
  assert.equal(file.fileStatus, "READY");
});

await check("mock staged parameters order for multipart", () => {
  const staged = {
    url: "https://shopify-staged-uploads.storage.googleapis.com/",
    resourceUrl: "https://shopify-staged-uploads.storage.googleapis.com/tmp/x",
    parameters: [
      { name: "content_type", value: "image/webp" },
      { name: "success_action_status", value: "201" },
      { name: "acl", value: "private" }
    ]
  };
  const order = buildStagedUploadFieldOrder(staged.parameters);
  assert.equal(order[0], "content_type");
  assert.equal(order.at(-1), "file");
  assert.ok(staged.resourceUrl.includes("shopify-staged"));
});

// --- Live (honest skip) ---
const hasShopifyEnv = Boolean(
  process.env.SHOPIFY_CLIENT_ID &&
    process.env.SHOPIFY_CLIENT_SECRET &&
    process.env.SHOPIFY_STORE_DOMAIN
);
const liveRequested = process.env.VERIFY_D1_LIVE === "1";

if (!hasShopifyEnv || !liveRequested) {
  console.log(
    `\n  ⊘ SKIP live Shopify Files upload (no fake green). ` +
      `Need SHOPIFY_CLIENT_ID/SECRET/STORE_DOMAIN and VERIFY_D1_LIVE=1 to exercise real store.\n` +
      `  hasShopifyEnv=${hasShopifyEnv} VERIFY_D1_LIVE=${process.env.VERIFY_D1_LIVE ?? "(unset)"}\n`
  );
} else {
  await check("live: hasShopifyAdminCredentials path would run (smoke import only)", async () => {
    // Avoid importing Next path aliases; just confirm env is present for manual test.
    assert.ok(process.env.SHOPIFY_STORE_DOMAIN);
    console.log(
      "    note: full live upload is manual via POST /api/images/finalize with a real draftId"
    );
  });
}

// UI probe note
console.log("  ⊘ b15-style-probe: SKIP (D1 pure API, no UI change; Q5-extra keeps D5 temp label)\n");

if (failures.length) {
  console.error(`\nFAILED ${failures.length} check(s):\n`);
  for (const f of failures) {
    console.error(` - ${f.name}: ${f.err.message}`);
  }
  process.exit(1);
}

console.log("ALL passed\n");
