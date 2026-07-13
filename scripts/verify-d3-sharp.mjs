/**
 * D3 / D-open verification (no secrets required for core path).
 *
 * - Static wiring: sharp dep, serverExternalPackages, routes, no client import
 * - Pure helpers: decideSharpAction / aggregate / path builders (inlined mirrors)
 * - Optional live sharp: if `sharp` is installed, process a tiny PNG buffer → WebP
 *
 * Run: node scripts/verify-d3-sharp.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const require = createRequire(import.meta.url);

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

// --- Inline mirrors of imagePipeline pure logic (keep in sync) ---

function isPipelineImageType(imageType) {
  return imageType === "main" || imageType === "spec" || imageType === "variant";
}

function decideSharpAction(input) {
  if (!isPipelineImageType(input.imageType)) {
    return {
      action: "skip",
      reason: `image_type=${input.imageType} is not a pipeline image (detail/Vision-only skipped)`
    };
  }
  if (!input.originalFileUrl?.trim()) {
    return { action: "skip", reason: "missing original_file_url" };
  }
  const intent = input.processIntent ?? null;
  if (intent === "de_text") {
    return {
      action: "skip",
      reason: "process_intent=de_text; needs D4 Image API (not sharp-only)"
    };
  }
  if (intent === "regenerate") {
    return {
      action: "skip",
      reason: "process_intent=regenerate; needs D4 Image API (not sharp-only)"
    };
  }
  if (intent === "keep") {
    return { action: "process_sharp", reason: "process_intent=keep" };
  }
  if (input.explicitImageIds) {
    return {
      action: "process_sharp",
      reason: "unmarked but imageIds explicitly requested (engineering mode)"
    };
  }
  return {
    action: "skip",
    reason:
      "unmarked process_intent; whole-draft mode skips until operator marks keep/de_text/regenerate"
  };
}

function aggregateImageStatusAfterSharp(counts) {
  if (counts.processed === 0 && counts.failed === 0) return null;
  if (counts.failed > 0 && counts.processed === 0) return "failed";
  if (counts.failed > 0) return "failed";
  return "done";
}

function buildProcessedStoragePath({ ownerSegment, draftId, imageId }) {
  return `${ownerSegment}/${draftId}/processed/${imageId}.webp`;
}

function isWebpBuffer(buf) {
  if (buf.length < 12) return false;
  return (
    buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP"
  );
}

/** Minimal 2x2 PNG (valid) for sharp smoke without network. */
function tinyPngBuffer() {
  // 1x1 red PNG
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return Buffer.from(b64, "base64");
}

console.log("verify-d3-sharp\n");

await check("package.json lists sharp dependency", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.dependencies?.sharp, "dependencies.sharp missing");
});

await check("pnpm-workspace allows sharp build", () => {
  const text = read("pnpm-workspace.yaml");
  assert.match(text, /sharp:\s*true/);
  assert.ok(!text.includes("ignoredBuiltDependencies:\n  - sharp"), "sharp still ignored");
});

await check("next.config serverExternalPackages includes sharp", () => {
  const text = read("next.config.mjs");
  assert.match(text, /serverExternalPackages/);
  assert.match(text, /["']sharp["']/);
});

await check("sharpProcess + imagePipeline + filesUpload modules exist", () => {
  assert.ok(exists("src/lib/images/sharpProcess.ts"));
  assert.ok(exists("src/lib/images/imagePipeline.ts"));
  assert.ok(exists("src/lib/shopify/filesUpload.ts"));
  assert.ok(exists("src/app/api/images/sharp-batch/route.ts"));
  assert.ok(exists("src/app/api/images/finalize/route.ts"));
});

await check("sharpProcess is server-oriented (no client components import sharp)", () => {
  const sharpSrc = read("src/lib/images/sharpProcess.ts");
  assert.match(sharpSrc, /from ["']sharp["']/);
  assert.match(sharpSrc, /SHARP_MAX_LONG_EDGE\s*=\s*2048/);
  assert.match(sharpSrc, /SHARP_WEBP_QUALITY\s*=\s*82/);

  // Scan client-ish trees for import sharp
  const banRoots = ["src/components", "src/app/drafts", "src/app/settings", "src/app/login"];
  for (const dir of banRoots) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    const stack = [abs];
    while (stack.length) {
      const cur = stack.pop();
      for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
        const p = path.join(cur, ent.name);
        if (ent.isDirectory()) {
          stack.push(p);
          continue;
        }
        if (!/\.(tsx|ts|jsx|js)$/.test(ent.name)) continue;
        const body = fs.readFileSync(p, "utf8");
        if (/from\s+["']sharp["']/.test(body) || /require\(["']sharp["']\)/.test(body)) {
          throw new Error(`client tree imports sharp: ${path.relative(root, p)}`);
        }
      }
    }
  }
});

await check("sharp-batch route: dual auth markers + limits + supabase_temp", () => {
  const src = read("src/app/api/images/sharp-batch/route.ts");
  const lib = read("src/lib/images/runSharpBatch.ts");
  assert.match(src, /export const runtime\s*=\s*["']nodejs["']/);
  assert.match(src, /requireWorkerToken/);
  assert.match(src, /canOperate/);
  assert.match(src, /runSharpBatchForDraft/);
  assert.match(src, /SHARP_BATCH_MAX_IMAGES|max.*12/);
  assert.match(src, /supabase_temp/);
  // Core transform lives in runSharpBatch (D2 thin shell)
  assert.match(lib, /processImageBuffer/);
  assert.match(lib, /supabase_temp|STORAGE_LABEL/);
  assert.ok(!/multipart/i.test(src) || /no multipart|not accept multipart/i.test(src));
  // Must not claim shopify CDN success
  assert.ok(!/cdn\.shopify\.com/.test(src) || /NOT.*CDN|not.*shopify/i.test(src));
});

await check("finalize route exists and wires Files upload (D1 real, not D-open 501 stub)", () => {
  const src = read("src/app/api/images/finalize/route.ts");
  const lib = read("src/lib/images/runFinalize.ts");
  // D1 replaced the 501 skeleton; thin shell → runFinalizeForDraft
  assert.match(src, /runFinalizeForDraft/);
  assert.match(src, /draftId/);
  assert.match(lib, /uploadProcessedImageToShopifyFiles/);
  assert.doesNotMatch(src, /D-open finalize stub only/);
});

await check("filesUpload implements stagedUploadsCreate + fileCreate (D1)", () => {
  const src = read("src/lib/shopify/filesUpload.ts");
  assert.match(src, /stagedUploadsCreate/);
  assert.match(src, /fileCreate/);
  assert.match(src, /uploadProcessedImageToShopifyFiles/);
  assert.doesNotMatch(src, /Shopify Files upload not implemented in D-open/);
});

await check("decideSharpAction: keep / de_text / detail / unmarked", () => {
  assert.equal(
    decideSharpAction({
      imageType: "main",
      processIntent: "keep",
      originalFileUrl: "https://example.com/o.jpg",
      explicitImageIds: false
    }).action,
    "process_sharp"
  );
  assert.equal(
    decideSharpAction({
      imageType: "main",
      processIntent: "de_text",
      originalFileUrl: "https://example.com/o.jpg",
      explicitImageIds: false
    }).action,
    "skip"
  );
  assert.equal(
    decideSharpAction({
      imageType: "main",
      processIntent: "regenerate",
      originalFileUrl: "https://example.com/o.jpg",
      explicitImageIds: true
    }).action,
    "skip"
  );
  assert.equal(
    decideSharpAction({
      imageType: "detail",
      processIntent: "keep",
      originalFileUrl: "https://example.com/o.jpg",
      explicitImageIds: true
    }).action,
    "skip"
  );
  assert.equal(
    decideSharpAction({
      imageType: "main",
      processIntent: null,
      originalFileUrl: "https://example.com/o.jpg",
      explicitImageIds: false
    }).action,
    "skip"
  );
  assert.equal(
    decideSharpAction({
      imageType: "main",
      processIntent: null,
      originalFileUrl: "https://example.com/o.jpg",
      explicitImageIds: true
    }).action,
    "process_sharp"
  );
});

await check("aggregateImageStatusAfterSharp Q3-A", () => {
  assert.equal(aggregateImageStatusAfterSharp({ processed: 0, failed: 0, skipped: 3 }), null);
  assert.equal(aggregateImageStatusAfterSharp({ processed: 2, failed: 0, skipped: 1 }), "done");
  assert.equal(aggregateImageStatusAfterSharp({ processed: 1, failed: 1, skipped: 0 }), "failed");
  assert.equal(aggregateImageStatusAfterSharp({ processed: 0, failed: 2, skipped: 0 }), "failed");
});

await check("buildProcessedStoragePath", () => {
  assert.equal(
    buildProcessedStoragePath({
      ownerSegment: "user-1",
      draftId: "draft-9",
      imageId: "img-3"
    }),
    "user-1/draft-9/processed/img-3.webp"
  );
});

await check("live sharp processImageBuffer (if installed)", async () => {
  let sharp;
  try {
    sharp = require("sharp");
  } catch {
    console.log("  · sharp not resolvable in this environment — skip live buffer test");
    return;
  }

  // Prefer importing compiled logic via dynamic path: re-implement with sharp directly
  // to avoid TS path aliases in plain node.
  const input = tinyPngBuffer();
  const out = await sharp(input, { failOn: "none" })
    .rotate()
    .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });

  assert.ok(isWebpBuffer(out.data), "output should be WebP");
  assert.ok(out.info.width >= 1 && out.info.height >= 1);
  assert.ok(out.info.width <= 2048 && out.info.height <= 2048);
  assert.equal(out.info.format, "webp");
});

await check("imagePipeline docs mention full chain steps", () => {
  const src = read("src/lib/images/imagePipeline.ts");
  assert.match(src, /sharp-batch/);
  assert.match(src, /Shopify Files|stagedUploadsCreate/);
  assert.match(src, /supabase_temp/);
  assert.match(src, /B14/);
});

// --- Summary ---
console.log("");
if (failures.length) {
  console.error(`FAIL: ${failures.length} check(s)`);
  process.exit(1);
}
console.log("ALL passed");
