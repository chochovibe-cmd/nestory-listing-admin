/**
 * 14 PERF PUBLISH-SPEED, entirely mocked: no network, Supabase, Shopify, or live DB.
 * Run from repository root: node scripts/verify-publish-speed.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
register(pathToFileURL(path.join(root, 'scripts', 'publish-guard-loader.mjs')).href);
const source = (rel) => pathToFileURL(path.join(root, rel)).href;
const { runSharpBatchForDraft } = await import(source('src/lib/images/runSharpBatch.ts'));
const { runFinalizeForDraft } = await import(source('src/lib/images/runFinalize.ts'));
const { prepareImagesForPublish, PUBLISH_IMAGE_CONCURRENCY } = await import(source('src/lib/images/prepareImagesForPublish.ts'));
const DRAFT = 'draft-publish-speed';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function row(id, type, order) {
  return {
    id, draft_id: DRAFT, image_type: type, process_intent: 'keep',
    original_file_url: 'https://assets.test/storage/v1/object/public/product-images/u/' + DRAFT + '/' + type + '/' + id + '.jpg',
    processed_file_url: null, generated_file_url: null,
    processing_status: 'uploaded', processing_error: null, alt_text: 'alt ' + id, sort_order: order
  };
}
function rows12() {
  return [...Array.from({ length: 10 }, (_, i) => row('m' + i, i % 3 === 0 ? 'variant' : 'main', i)),
    row('detail0', 'detail', 10), row('detail1', 'detail', 11)];
}

/** A minimal Supabase table + storage emulator, preserving row writes across calls. */
function db(images) {
  const draft = { id: DRAFT, image_status: 'pending' };
  const updates = [];
  const storage = {
    from(bucket) {
      assert.equal(bucket, 'product-images');
      return {
        async upload(_path, _buffer, options) { assert.equal(options.contentType, 'image/webp'); return { error: null }; },
        getPublicUrl(p) { return { data: { publicUrl: 'https://assets.test/storage/v1/object/public/product-images/' + p } }; },
        async remove(paths) { assert.equal(paths.length, 1); return { error: null }; }
      };
    }
  };
  function from(table) {
    assert.ok(['product_drafts', 'product_images'].includes(table), table);
    let mode = 'select';
    let changes = null;
    const filters = [];
    let filterIds = null;
    const q = {
      select() { return q; },
      eq(field, value) { filters.push([field, value]); return q; },
      order() { return q; },
      in(field, ids) { assert.equal(field, 'id'); filterIds = ids; return q; },
      update(values) { mode = 'update'; changes = values; return q; },
      async maybeSingle() {
        assert.equal(table, 'product_drafts');
        return { data: draft, error: null };
      },
      then(resolve, reject) {
        const task = async () => {
          let target = table === 'product_drafts' ? [draft] : images;
          for (const [field, value] of filters) target = target.filter((r) => r[field] === value);
          if (filterIds) target = target.filter((r) => filterIds.includes(r.id));
          if (mode === 'update') {
            for (const r of target) {
              Object.assign(r, changes);
              updates.push({ table, id: r.id, values: { ...changes } });
            }
            return { data: null, error: null };
          }
          return { data: target.map((r) => ({ ...r })), error: null };
        };
        return task().then(resolve, reject);
      }
    };
    return q;
  }
  return { serviceSupabase: { from, storage }, images, draft, updates };
}

function counter() {
  let active = 0, max = 0, calls = 0;
  const enter = () => { active++; calls++; max = Math.max(max, active); };
  const leave = () => { active--; };
  return { enter, leave, get max() { return max; }, get calls() { return calls; }, get active() { return active; } };
}
function sharpDeps(meter, fetchFailure = null) {
  return {
    fetchBytes: async (url) => {
      if (fetchFailure && url.endsWith('/' + fetchFailure + '.jpg')) throw new Error('synthetic fetch exception');
      return Buffer.from(url);
    },
    processImage: async (bytes, options) => {
      assert.equal(options.squareMode, 'blur-extend');
      meter.enter();
      try {
        const text = bytes.toString();
        const match = text.match(/m(\d+)\.jpg$/);
        await sleep(match ? 2 + (9 - Number(match[1])) * 2 : 5);
        return { buffer: Buffer.from('WEBP'), width: 512, height: 512, bytes: 4, format: 'webp' };
      } finally { meter.leave(); }
    }
  };
}
function finalizeDeps(meter, fetchFailure = null, uploadedIds = []) {
  return {
    fetchBytes: async (url) => {
      const id = url.match(/\/(m\d+)\.(?:webp|jpg)(?:\?|$)/)?.[1];
      if (id === fetchFailure) throw new Error('synthetic fetch exception');
      return Buffer.from(url);
    },
    upload: async ({ filename, mimeType, fileSize, bytes, alt }) => {
      meter.enter();
      try {
        assert.ok(['image/jpeg', 'image/webp'].includes(mimeType));
        assert.ok(fileSize > 0);
        assert.equal(fileSize, bytes.length);
        assert.ok(alt?.startsWith('alt '));
        await sleep(filename.startsWith('m0') ? 23 : 5);
        uploadedIds.push(filename);
        return { ok: true, cdnUrl: 'https://cdn.shopify.com/s/files/' + filename, fileGid: 'gid://shopify/MediaImage/' + filename, storage: 'shopify_cdn' };
      } finally { meter.leave(); }
    }
  };
}

let passed = 0;
let failed = 0;
async function test(label, fn) {
  try { await fn(); passed++; console.log('  ✓', label); }
  catch (err) { failed++; console.error('  ✗', label, err.stack || err); }
}
function assertResultOrder(result, rows) {
  assert.deepEqual(result.results.map((r) => r.imageId), rows.map((r) => r.id));
}

await test('sharp 10 main/variant + 2 detail, concurrency=4, ordered and accurate counts', async () => {
  const images = rows12();
  const h = db(images), m = counter();
  const r = await runSharpBatchForDraft({ serviceSupabase: h.serviceSupabase, draftId: DRAFT, concurrency: 4, deps: sharpDeps(m) });
  assert.equal(r.ok, true);
  assertResultOrder(r, images);
  assert.deepEqual([r.processed, r.skipped, r.failed], [10, 2, 0]);
  assert.ok(m.max >= 2 && m.max <= 4, 'sharp concurrency ' + m.max);
  assert.equal(h.updates.filter((u) => u.table === 'product_drafts' && u.values.image_status === 'processing').length, 1);
  assert.equal(h.updates.filter((u) => u.table === 'product_drafts' && u.values.image_status === 'done').length, 1);
});
await test('sharp default concurrency=1, old serial behavior', async () => {
  const h = db(rows12()), m = counter();
  const r = await runSharpBatchForDraft({ serviceSupabase: h.serviceSupabase, draftId: DRAFT, deps: sharpDeps(m) });
  assert.equal(r.ok, true); assert.equal(m.max, 1); assert.equal(m.calls, 10);
});
await test('sharp third fetch fails only that row and writes processing_error', async () => {
  const images = rows12(), h = db(images), m = counter();
  const r = await runSharpBatchForDraft({ serviceSupabase: h.serviceSupabase, draftId: DRAFT, concurrency: 4, deps: sharpDeps(m, 'm2') });
  assert.equal(r.ok, false); assertResultOrder(r, images);
  assert.deepEqual([r.processed, r.skipped, r.failed], [9, 2, 1]);
  assert.equal(r.results[2].status, 'failed');
  assert.equal(images[2].processing_status, 'failed');
  assert.match(images[2].processing_error, /synthetic fetch exception/);
  assert.equal(images.filter((x) => /^m\d+$/.test(x.id) && x.processing_status === 'done').length, 9);
});
await test('finalize 10 images + 2 detail, concurrency=4, ordered and accurate counts', async () => {
  const images = rows12(), h = db(images), m = counter();
  const uploadedIds = [];
  const r = await runFinalizeForDraft({ serviceSupabase: h.serviceSupabase, draftId: DRAFT, concurrency: 4, deps: finalizeDeps(m, null, uploadedIds) });
  assert.equal(r.ok, true); assertResultOrder(r, images);
  assert.deepEqual([r.uploaded, r.skipped, r.failed], [10, 2, 0]);
  assert.equal(uploadedIds.length, 10);
  assert.ok(m.max >= 2 && m.max <= 4, 'finalize concurrency ' + m.max);
});
await test('finalize default concurrency=1, old serial behavior', async () => {
  const h = db(rows12()), m = counter();
  const r = await runFinalizeForDraft({ serviceSupabase: h.serviceSupabase, draftId: DRAFT, deps: finalizeDeps(m) });
  assert.equal(r.ok, true); assert.equal(m.max, 1);
});
await test('finalize third fetch fails only that row; other rows uploaded', async () => {
  const images = rows12(), h = db(images), m = counter();
  const r = await runFinalizeForDraft({ serviceSupabase: h.serviceSupabase, draftId: DRAFT, concurrency: 4, deps: finalizeDeps(m, 'm2') });
  assert.equal(r.ok, false); assertResultOrder(r, images);
  assert.deepEqual([r.uploaded, r.skipped, r.failed], [9, 2, 1]);
  assert.equal(r.results[2].code, 'FETCH_OR_UPLOAD');
  assert.match(images[2].processing_error, /synthetic fetch exception/);
  assert.equal(images.filter((x) => /^m\d+$/.test(x.id) && x.processed_file_url?.startsWith('https://cdn.shopify.com')).length, 9);
});
await test('finalize already_cdn skips upload; rerunning never uploads same image twice', async () => {
  const images = rows12();
  images[0].processed_file_url = 'https://cdn.shopify.com/s/files/m0.webp';
  const h = db(images), m = counter(), uploadedIds = [];
  const deps = finalizeDeps(m, null, uploadedIds);
  const first = await runFinalizeForDraft({ serviceSupabase: h.serviceSupabase, draftId: DRAFT, concurrency: 4, deps });
  assert.equal(first.ok, true);
  assert.equal(first.uploaded, 9); assert.equal(first.skipped, 3);
  assert.equal(first.results[0].reason, 'already shopify_cdn (idempotent)');
  assert.equal(uploadedIds.includes('m0.webp'), false);
  assert.equal(uploadedIds.includes('m0.jpg'), false);
  const second = await runFinalizeForDraft({ serviceSupabase: h.serviceSupabase, draftId: DRAFT, concurrency: 4, deps });
  assert.equal(second.ok, true); assert.equal(second.uploaded, 0); assert.equal(second.skipped, 12);
  assert.equal(uploadedIds.length, 9);
});
await test('prepare excludes spec, passes concurrency=4 to both runners, exposes numeric timings', async () => {
  assert.equal(PUBLISH_IMAGE_CONCURRENCY, 4);
  const images = [row('m0', 'main', 0), row('m1', 'variant', 1), row('spec0', 'spec', 2), row('detail0', 'detail', 3)];
  const h = db(images), sharpCalls = [], finCalls = [];
  let tick = 0;
  const r = await prepareImagesForPublish({
    serviceSupabase: h.serviceSupabase,
    draftId: DRAFT,
    deps: {
      now: () => (tick += 7),
      async runSharp(input) {
        sharpCalls.push(input);
        for (const id of input.imageIds ?? []) {
          const v = images.find((row) => row.id === id);
          v.processed_file_url = 'https://assets.test/storage/v1/object/public/product-images/u/' + DRAFT + '/processed/' + id + '.webp';
          v.processing_status = 'done';
        }
        return { ok: true, draftId: DRAFT, processed: input.imageIds.length, skipped: 0, failed: 0, results: [], imageStatus: 'done', storageDefault: 'supabase_temp' };
      },
      async runFinalize(input) {
        finCalls.push(input);
        return { ok: true, draftId: DRAFT, uploaded: input.imageIds.length, skipped: 0, failed: 0, results: [], storage: 'shopify_cdn', operations: {} };
      }
    }
  });
  assert.equal(r.ok, true);
  assert.deepEqual(sharpCalls.flatMap((c) => c.imageIds), ['m0', 'm1']);
  assert.ok(!sharpCalls.some((c) => c.imageIds?.includes('spec0')));
  assert.deepEqual(finCalls.flatMap((c) => c.imageIds), ['m0', 'm1']);
  assert.ok(sharpCalls.every((c) => c.concurrency === 4));
  assert.ok(finCalls.every((c) => c.concurrency === 4));
  assert.equal(typeof r.timingsMs.sharp, 'number');
  assert.equal(typeof r.timingsMs.finalize, 'number');
  assert.ok(r.timingsMs.sharp > 0 && r.timingsMs.finalize > 0);
});
await test('source guard: publish success payload timings_ms; square blur-extend unchanged', () => {
  const src = fs.readFileSync('src/lib/shopify/publishDraftSafe.ts', 'utf8');
  const start = src.indexOf('const finalStatus =');
  assert.ok(start > 0);
  const end = src.indexOf('const finalPersist =', start);
  const successJob = src.slice(start, end);
  for (const key of ['timings_ms:', 'prepare_sharp:', 'prepare_finalize:', 'description_upload:', 'total:', '...createResult', 'resumeWarnings:', 'videoWarnings:', 'warning:']) {
    assert.ok(successJob.includes(key), 'missing ' + key);
  }
  assert.match(src, /const startedAt = clock\(\)/);
  const sharp = fs.readFileSync('src/lib/images/runSharpBatch.ts', 'utf8');
  assert.match(sharp, /squareMode:\s*img\.image_type === "main" \|\| img\.image_type === "variant" \? "blur-extend" : "none"/);
  assert.match(sharp, /const fetchBytes = input\.deps\?\.fetchBytes \?\? fetchOriginalBuffer/);
  assert.match(fs.readFileSync('scripts/verify-all.mjs', 'utf8'), /verify-publish-speed\.mjs/);
});
console.log('\nverify-publish-speed: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
