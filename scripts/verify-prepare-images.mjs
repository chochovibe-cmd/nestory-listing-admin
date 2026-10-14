/**
 * Pre-publish image prep with >12 image rows (no network, no Supabase).
 * Real prepareImagesForPublish driven with fake runners that enforce the real 12-row/id caps.
 * Run: node scripts/verify-prepare-images.mjs  |  npm run verify:prepare-images
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
register(pathToFileURL(path.join(root, "scripts", "publish-guard-loader.mjs")).href);
const src = (rel) => pathToFileURL(path.join(root, rel)).href;

const { prepareImagesForPublish, chunkImageIds } = await import(
  src("src/lib/images/prepareImagesForPublish.ts")
);

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

const MAX = 12;

function keepRow(id, type, i) {
  return {
    id,
    image_type: type,
    process_intent: "keep",
    original_file_url: `https://x/o/${id}.jpg`,
    processed_file_url: null,
    processing_status: "pending",
    sort_order: i
  };
}

function fixture() {
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push(keepRow(`main${i}`, "main", i));
  for (let i = 0; i < 2; i++) rows.push(keepRow(`var${i}`, "variant", 10 + i));
  for (let i = 0; i < 18; i++) {
    rows.push({ ...keepRow(`det${i}`, "detail", 20 + i), process_intent: null });
  }
  return rows;
}

function manyKeep(n) {
  return Array.from({ length: n }, (_, i) => keepRow(`m${i}`, "main", i));
}

function capError(rows) {
  return {
    ok: false,
    draftId: "d",
    error: `Draft has ${rows.length} candidate rows; max ${MAX} per request. Pass imageIds to chunk.`,
    httpStatus: 400
  };
}

function harness(rows, { sharpFailChunk = -1, finalizeFailChunk = -1 } = {}) {
  const calls = { sharp: [], finalize: [] };
  const sb = {
    from(table) {
      assert.equal(table, "product_images");
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        then: (res) => res({ data: rows.map((r) => ({ ...r })), error: null })
      };
      return q;
    }
  };
  const runSharp = async ({ imageIds }) => {
    if (!imageIds) {
      return rows.length > MAX ? capError(rows) : { ok: true, processed: 0, skipped: 0, failed: 0 };
    }
    assert.ok(imageIds.length <= MAX, "sharp chunk > 12");
    calls.sharp.push(imageIds);
    if (calls.sharp.length - 1 === sharpFailChunk) {
      return { ok: false, draftId: "d", error: "sharp boom", httpStatus: 500 };
    }
    for (const id of imageIds) {
      const r = rows.find((x) => x.id === id);
      r.processed_file_url = `https://x/p/${id}.webp`;
      r.processing_status = "done";
    }
    return { ok: true, processed: imageIds.length, skipped: 0, failed: 0 };
  };
  const runFinalize = async ({ imageIds }) => {
    if (!imageIds) {
      return rows.length > MAX ? capError(rows) : { ok: true, uploaded: 0, skipped: 0, failed: 0 };
    }
    assert.ok(imageIds.length <= MAX, "finalize chunk > 12");
    calls.finalize.push(imageIds);
    if (calls.finalize.length - 1 === finalizeFailChunk) {
      return { ok: false, draftId: "d", error: "finalize boom", httpStatus: 500 };
    }
    for (const id of imageIds) {
      const r = rows.find((x) => x.id === id);
      r.processed_file_url = `https://cdn.shopify.com/s/files/${id}.webp`;
    }
    return { ok: true, uploaded: imageIds.length, skipped: 0, failed: 0 };
  };
  return { sb, calls, deps: { runSharp, runFinalize } };
}

console.log("prepareImagesForPublish with >12 rows");

await check("chunkImageIds splits at 12", () => {
  const sizes = chunkImageIds(Array.from({ length: 25 }, (_, i) => String(i))).map((c) => c.length);
  assert.deepEqual(sizes, [12, 12, 1]);
  assert.deepEqual(chunkImageIds([]), []);
});

await check("25-row fixture: no 'candidate rows' warning; keep rows processed; detail untouched", async () => {
  const rows = fixture();
  const h = harness(rows);
  const r = await prepareImagesForPublish({ serviceSupabase: h.sb, draftId: "d", deps: h.deps });
  assert.equal(r.warnings.length, 0, JSON.stringify(r.warnings));
  assert.ok(!r.warnings.some((w) => w.includes("candidate rows")));
  const sharpIds = h.calls.sharp.flat().sort();
  assert.deepEqual(sharpIds, ["main0", "main1", "main2", "main3", "main4", "var0", "var1"]);
  assert.deepEqual(h.calls.finalize.flat().sort(), sharpIds);
  assert.ok(h.calls.sharp.every((c) => c.length <= MAX));
  assert.ok(h.calls.finalize.every((c) => c.length <= MAX));
  for (const d of rows.filter((x) => x.image_type === "detail")) {
    assert.equal(d.processed_file_url, null);
    assert.ok(![...h.calls.sharp.flat(), ...h.calls.finalize.flat()].includes(d.id));
  }
  assert.equal(r.sharp, "done");
  assert.equal(r.finalize, "done");
  assert.equal(r.sharpProcessed, 7);
  assert.equal(r.finalizeUploaded, 7);
});

await check("unmarked (null intent) main row is NOT pulled in (no engineering-mode widening)", async () => {
  const rows = fixture();
  rows.push({ ...keepRow("mainNull", "main", 99), process_intent: null });
  const h = harness(rows);
  await prepareImagesForPublish({ serviceSupabase: h.sb, draftId: "d", deps: h.deps });
  assert.ok(!h.calls.sharp.flat().includes("mainNull"));
});

await check("30 keep rows -> chunks of 12/12/6 for each step", async () => {
  const rows = manyKeep(30);
  const h = harness(rows);
  const r = await prepareImagesForPublish({ serviceSupabase: h.sb, draftId: "d", deps: h.deps });
  assert.deepEqual(h.calls.sharp.map((c) => c.length), [12, 12, 6]);
  assert.deepEqual(h.calls.finalize.map((c) => c.length), [12, 12, 6]);
  assert.equal(r.warnings.length, 0);
});

await check("zero eligible (only detail rows) -> skipped, no calls, no warning", async () => {
  const rows = fixture().filter((x) => x.image_type === "detail");
  const h = harness(rows);
  const r = await prepareImagesForPublish({ serviceSupabase: h.sb, draftId: "d", deps: h.deps });
  assert.equal(h.calls.sharp.length + h.calls.finalize.length, 0);
  assert.equal(r.sharp, "skipped");
  assert.equal(r.finalize, "skipped");
  assert.equal(r.warnings.length, 0);
});

await check("already-CDN main row is skipped by both steps", async () => {
  const rows = [
    {
      ...keepRow("c1", "main", 0),
      processed_file_url: "https://cdn.shopify.com/s/files/c1.webp",
      processing_status: "done"
    }
  ];
  const h = harness(rows);
  const r = await prepareImagesForPublish({ serviceSupabase: h.sb, draftId: "d", deps: h.deps });
  assert.equal(h.calls.sharp.length + h.calls.finalize.length, 0);
  assert.equal(r.warnings.length, 0);
});

await check("a failing sharp chunk yields ONE warning; later chunks still run", async () => {
  const h = harness(manyKeep(30), { sharpFailChunk: 0 });
  const r = await prepareImagesForPublish({ serviceSupabase: h.sb, draftId: "d", deps: h.deps });
  assert.equal(h.calls.sharp.length, 3, "later sharp chunks still run");
  assert.equal(r.warnings.filter((w) => w.includes("boom")).length, 1);
  assert.equal(r.ok, true);
  assert.ok(h.calls.finalize.length > 0, "finalize still runs");
});

await check("a failing finalize chunk yields ONE warning; later chunks still run", async () => {
  const h = harness(manyKeep(30), { finalizeFailChunk: 1 });
  const r = await prepareImagesForPublish({ serviceSupabase: h.sb, draftId: "d", deps: h.deps });
  assert.equal(h.calls.finalize.length, 3);
  assert.equal(r.warnings.filter((w) => w.includes("boom")).length, 1);
  assert.equal(r.finalizeUploaded, 18);
});

await check("static: package.json + verify-all wiring", () => {
  const pkg = fs.readFileSync("package.json", "utf8");
  assert.match(pkg, /"verify:prepare-images": "node scripts\/verify-prepare-images\.mjs"/);
  assert.match(fs.readFileSync("scripts/verify-all.mjs", "utf8"), /verify-prepare-images\.mjs/);
  assert.match(fs.readFileSync("src/lib/images/prepareImagesForPublish.ts", "utf8"), /imageIds: ids/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
