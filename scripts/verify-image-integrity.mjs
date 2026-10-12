/**
 * IMAGE-INTEGRITY verification (no secrets, no network, no DB).
 *
 * Bug: the browser removed the Storage object FIRST and then deleted the
 * product_images row. When the DB refused (FK product_variants_image_id_fkey -> 409,
 * or an RLS silent no-op) the file was already gone -> broken images.
 *
 * Part A: behaviour of src/lib/images/deleteProductImages.ts against a fake supabase
 *         client (ordered call log): unbind -> DB delete -> Storage, never Storage first.
 * Part B: static source guards so no UI path can go back to Storage-first deletes.
 *
 * Run: node scripts/verify-image-integrity.mjs
 * Optional: --static-root=<dir> runs Part B against another tree laid out like the repo
 *           (used to prove the guards fail on the old code).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const staticRootArg = process.argv.find((arg) => arg.startsWith("--static-root="));
const staticRoot = staticRootArg ? path.resolve(staticRootArg.slice("--static-root=".length)) : root;

const HELPER_REL = "src/lib/images/deleteProductImages.ts";

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

// ---------------------------------------------------------------------------
// Load the TS helper standalone (transpile -> temp .mjs -> import)
// ---------------------------------------------------------------------------
const helperSource = fs.readFileSync(path.join(root, HELPER_REL), "utf8");
const helperJs = ts.transpileModule(helperSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  fileName: HELPER_REL
}).outputText;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nestory-image-integrity-"));
const helperFile = path.join(tmpDir, "deleteProductImages.mjs");
fs.writeFileSync(helperFile, helperJs);
const helper = await import(pathToFileURL(helperFile).href);
const {
  PRODUCT_IMAGES_BUCKET,
  productImagesStoragePathFromUrl,
  collectProductImageStoragePaths,
  findVariantBindings,
  deleteProductImages,
  deleteProductImagesFailureMessage
} = helper;

// ---------------------------------------------------------------------------
// Fake supabase client: records an ordered call log, tiny stateful "DB" with the
// real FK (a delete is rejected while any variant still points at the image).
// ---------------------------------------------------------------------------
const SB = "https://abc.supabase.co/storage/v1/object/public/product-images";

function makeFake(initial, opts = {}) {
  const state = {
    images: structuredClone(initial.images ?? []),
    variants: structuredClone(initial.variants ?? [])
  };
  const o = {
    imagesSelectError: null, // always fail product_images select
    remainingSelectError: null, // fail only the post-delete reference query (filter col draft_id)
    failThumbColumns: false, // fail only when list_thumb_url is requested (migration 039 missing)
    variantsSelectError: null,
    unbindMode: "ok", // ok | error | partial | noop
    unbindPartial: 1,
    restoreMode: "ok", // ok | error
    deleteMode: "ok", // ok | error | noop | partial
    deleteFailIds: [],
    storageMode: "ok", // ok | error | throw
    ...opts
  };
  const log = [];

  function execute(q) {
    const op = `${q.kind} ${q.table}`;
    if (q.table === "product_images" && q.kind === "select") {
      log.push({ op, col: q.filter.col });
      if (o.imagesSelectError) return { data: null, error: { message: o.imagesSelectError } };
      if (o.remainingSelectError && q.filter.col === "draft_id") {
        return { data: null, error: { message: o.remainingSelectError } };
      }
      if (o.failThumbColumns && q.columns.includes("list_thumb_url")) {
        return { data: null, error: { message: "column product_images.list_thumb_url does not exist" } };
      }
      const cols = q.columns.split(",").map((c) => c.trim());
      const rows = state.images
        .filter((row) => q.filter.vals.includes(row[q.filter.col]))
        .map((row) => Object.fromEntries(cols.map((c) => [c, row[c] ?? null])));
      return { data: rows, error: null };
    }
    if (q.table === "product_variants" && q.kind === "select") {
      log.push({ op });
      if (o.variantsSelectError) return { data: null, error: { message: o.variantsSelectError } };
      const rows = state.variants
        .filter((v) => !v.hidden && q.filter.vals.includes(v.image_id))
        .map((v) => ({ id: v.id, image_id: v.image_id }));
      return { data: rows, error: null };
    }
    if (q.table === "product_variants" && q.kind === "update") {
      const unbinding = q.patch.image_id === null;
      log.push({ op, patch: q.patch, ids: [...q.filter.vals] });
      const mode = unbinding ? o.unbindMode : o.restoreMode === "error" ? "error" : "ok";
      if (mode === "error") return { data: null, error: { message: "variants update failed" } };
      let hit = state.variants.filter((v) => !v.hidden && q.filter.vals.includes(v.id));
      if (mode === "noop") hit = [];
      if (mode === "partial") hit = hit.slice(0, o.unbindPartial);
      for (const v of hit) v.image_id = q.patch.image_id;
      return { data: q.returning ? hit.map((v) => ({ id: v.id })) : null, error: null };
    }
    if (q.table === "product_images" && q.kind === "delete") {
      log.push({ op, ids: [...q.filter.vals] });
      const fk = state.variants.some((v) => q.filter.vals.includes(v.image_id));
      if (o.deleteMode === "error" || fk) {
        return {
          data: null,
          error: {
            code: "23503",
            message:
              'update or delete on table "product_images" violates foreign key constraint "product_variants_image_id_fkey" on table "product_variants"'
          }
        };
      }
      if (o.deleteMode === "noop") return { data: [], error: null };
      const gone = state.images.filter(
        (row) => q.filter.vals.includes(row.id) && !(o.deleteMode === "partial" && o.deleteFailIds.includes(row.id))
      );
      state.images = state.images.filter((row) => !gone.includes(row));
      return { data: q.returning ? gone.map((row) => ({ id: row.id })) : null, error: null };
    }
    throw new Error(`fake supabase: unexpected ${op}`);
  }

  function builder(table) {
    const q = { table, kind: null, columns: null, patch: null, returning: false, filter: null };
    const b = {
      select(columns) {
        if (q.kind === null) {
          q.kind = "select";
          q.columns = columns;
        } else {
          q.returning = true;
        }
        return b;
      },
      update(patch) {
        q.kind = "update";
        q.patch = patch;
        return b;
      },
      delete() {
        q.kind = "delete";
        return b;
      },
      in(col, vals) {
        q.filter = { col, vals: [...vals] };
        return b;
      },
      then(resolve, reject) {
        try {
          return Promise.resolve(execute(q)).then(resolve, reject);
        } catch (err) {
          return Promise.reject(err).then(resolve, reject);
        }
      }
    };
    return b;
  }

  const client = {
    from: (table) => builder(table),
    storage: {
      from(bucket) {
        return {
          async remove(paths) {
            log.push({ op: "storage.remove", bucket, paths: [...paths] });
            if (o.storageMode === "throw") throw new Error("network down");
            if (o.storageMode === "error") return { data: null, error: { message: "storage 500" } };
            return { data: paths.map((name) => ({ name })), error: null };
          }
        };
      }
    }
  };
  return { client, state, log, ops: () => log.map((e) => e.op) };
}

function fullImage(id, extra = {}) {
  return {
    id,
    draft_id: "d1",
    original_file_url: `${SB}/u1/d1/main/${id}-orig.jpg`,
    processed_file_url: `${SB}/u1/d1/processed/${id}%20final.png?t=123`,
    generated_file_url: `${SB}/u1/d1/generated/${id}.png`,
    list_thumb_url: `${SB}/u1/d1/main/${id}-320.jpg`,
    vision_mid_url: `${SB}/u1/d1/main/${id}-1280.jpg`,
    ...extra
  };
}
const fullPaths = (id) => [
  `u1/d1/main/${id}-orig.jpg`,
  `u1/d1/processed/${id} final.png`,
  `u1/d1/generated/${id}.png`,
  `u1/d1/main/${id}-320.jpg`,
  `u1/d1/main/${id}-1280.jpg`
];
const mutating = (ops) => ops.filter((op) => /^(update|delete) |^storage\.remove$/.test(op));
const quiet = async (fn) => {
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    return { value: await fn(), warnings };
  } finally {
    console.warn = original;
  }
};

console.log("IMAGE-INTEGRITY verification");
console.log("Part A: deleteProductImages behaviour");

await check("helper is standalone (no runtime '@/' imports, no import statements after transpile)", () => {
  assert.doesNotMatch(helperSource, /^import\s+(?!type\b)[^;]*from\s+["']@\//m);
  assert.doesNotMatch(helperJs, /^\s*import\s/m);
  assert.equal(PRODUCT_IMAGES_BUCKET, "product-images");
});

await check("productImagesStoragePathFromUrl: decode, strip query/hash, reject foreign/empty", () => {
  const f = productImagesStoragePathFromUrl;
  assert.equal(f(`${SB}/u/d/a.jpg`), "u/d/a.jpg");
  assert.equal(f(`${SB}/u/d/a%20b%E4%B8%AD.jpg?t=1&x=2`), "u/d/a b中.jpg");
  assert.equal(f(`${SB}/u/d/a.jpg#frag`), "u/d/a.jpg");
  assert.equal(f(`${SB}/u/d/a%ZZ.jpg`), "u/d/a%ZZ.jpg", "malformed escape must not throw");
  assert.equal(f("https://cdn.shopify.com/s/files/1/0001/products/x.jpg"), null);
  assert.equal(f(`${SB}/`), null);
  assert.equal(f(""), null);
  assert.equal(f("   "), null);
  assert.equal(f(null), null);
  assert.equal(f(undefined), null);
});

await check("collectProductImageStoragePaths: all five columns, deduped, decoded, foreign URLs skipped", () => {
  const row = fullImage("a", {
    generated_file_url: "https://cdn.shopify.com/s/files/1/x.jpg",
    list_thumb_url: null
  });
  // processed == original must collapse to one path
  row.processed_file_url = row.original_file_url;
  assert.deepEqual(collectProductImageStoragePaths(row), ["u1/d1/main/a-orig.jpg", "u1/d1/main/a-1280.jpg"]);
  assert.deepEqual(collectProductImageStoragePaths(fullImage("b")), fullPaths("b"));
  assert.deepEqual(collectProductImageStoragePaths(null), []);
});

await check("1. no bindings: select rows -> select variants -> delete -> select remaining -> storage remove (all sizes, decoded, no Shopify CDN)", async () => {
  const shopifyRow = fullImage("i2", {
    processed_file_url: "https://cdn.shopify.com/s/files/1/0001/products/i2.jpg",
    generated_file_url: null
  });
  const fake = makeFake({ images: [fullImage("i1"), shopifyRow] });
  const res = await deleteProductImages(fake.client, ["i1", "i2", "i1"], { unbindVariants: false });
  assert.equal(res.ok, true);
  assert.deepEqual(res.deletedIds, ["i1", "i2"]);
  assert.deepEqual(res.failedIds, []);
  assert.deepEqual(res.unboundVariantIds, []);
  assert.deepEqual(res.storageWarnings, []);
  assert.deepEqual(fake.ops(), [
    "select product_images",
    "select product_variants",
    "delete product_images",
    "select product_images",
    "storage.remove"
  ]);
  assert.deepEqual(fake.log.filter((e) => e.op === "select product_images").map((e) => e.col), ["id", "draft_id"]);
  const removed = fake.log.find((e) => e.op === "storage.remove");
  assert.equal(removed.bucket, "product-images");
  const expected = new Set([
    ...fullPaths("i1"),
    "u1/d1/main/i2-orig.jpg",
    "u1/d1/main/i2-320.jpg",
    "u1/d1/main/i2-1280.jpg"
  ]);
  assert.deepEqual(new Set(removed.paths), expected);
  assert.equal(removed.paths.length, expected.size, "no duplicate paths");
  assert.ok(!removed.paths.some((p) => p.includes("shopify")));
});

await check("empty / duplicate-only input is a no-op success", async () => {
  const fake = makeFake({ images: [] });
  const res = await deleteProductImages(fake.client, [], { unbindVariants: false });
  assert.equal(res.ok, true);
  assert.deepEqual(fake.ops(), []);
});

await check("2. bindings + unbindVariants:false -> ok:false, blockedByVariants, nothing mutated", async () => {
  const fake = makeFake({
    images: [fullImage("i1")],
    variants: [
      { id: "v1", image_id: "i1" },
      { id: "v2", image_id: "i1" },
      { id: "v3", image_id: null }
    ]
  });
  const res = await deleteProductImages(fake.client, ["i1"], { unbindVariants: false });
  assert.equal(res.ok, false);
  assert.deepEqual(res.blockedByVariants, [{ imageId: "i1", count: 2 }]);
  assert.deepEqual(res.deletedIds, []);
  assert.deepEqual(mutating(fake.ops()), []);
  assert.deepEqual(fake.ops(), ["select product_images", "select product_variants"]);
  assert.equal(fake.state.images.length, 1);
  assert.deepEqual(fake.state.variants.map((v) => v.image_id), ["i1", "i1", null]);
  assert.ok(deleteProductImagesFailureMessage(res).length > 0);
});

await check("3. bindings + unbindVariants:true -> unbind before delete, delete before storage remove (reference check in between)", async () => {
  const fake = makeFake({
    images: [fullImage("i1")],
    variants: [
      { id: "v1", image_id: "i1" },
      { id: "v2", image_id: "i1" }
    ]
  });
  const res = await deleteProductImages(fake.client, ["i1"], { unbindVariants: true });
  assert.equal(res.ok, true);
  assert.deepEqual(res.deletedIds, ["i1"]);
  assert.deepEqual(res.unboundVariantIds.sort(), ["v1", "v2"]);
  assert.deepEqual(fake.ops(), [
    "select product_images",
    "select product_variants",
    "update product_variants",
    "delete product_images",
    "select product_images",
    "storage.remove"
  ]);
  const update = fake.log.find((e) => e.op === "update product_variants");
  assert.deepEqual(update.patch, { image_id: null });
  assert.deepEqual(fake.state.variants.map((v) => v.image_id), [null, null]);
  assert.equal(fake.state.images.length, 0);
});

await check("4. delete returns 0 rows (RLS no-op) -> ok:false, NO storage remove, bindings restored", async () => {
  const fake = makeFake(
    { images: [fullImage("i1")], variants: [{ id: "v1", image_id: "i1" }] },
    { deleteMode: "noop" }
  );
  const res = await deleteProductImages(fake.client, ["i1"], { unbindVariants: true });
  assert.equal(res.ok, false);
  assert.deepEqual(res.deletedIds, []);
  assert.deepEqual(res.failedIds, ["i1"]);
  assert.equal(res.error, undefined, "silent no-op carries no DB error text");
  assert.ok(deleteProductImagesFailureMessage(res).includes("未被刪除"));
  assert.ok(!fake.ops().includes("storage.remove"));
  assert.deepEqual(fake.ops().slice(-2), ["delete product_images", "update product_variants"]);
  assert.equal(fake.state.variants[0].image_id, "i1", "binding restored");
  assert.deepEqual(res.unboundVariantIds, []);
  assert.equal(fake.state.images.length, 1);
});

await check("4b. no bindings + RLS no-op -> ok:false, NO storage remove", async () => {
  const fake = makeFake({ images: [fullImage("i1")] }, { deleteMode: "noop" });
  const res = await deleteProductImages(fake.client, ["i1"], { unbindVariants: false });
  assert.equal(res.ok, false);
  assert.deepEqual(res.failedIds, ["i1"]);
  assert.ok(!fake.ops().includes("storage.remove"));
});

await check("5. delete returns error (simulated FK 409) -> ok:false, NO storage remove, restore attempted", async () => {
  const fake = makeFake(
    { images: [fullImage("i1")], variants: [{ id: "v1", image_id: "i1" }] },
    { deleteMode: "error" }
  );
  const res = await deleteProductImages(fake.client, ["i1"], { unbindVariants: true });
  assert.equal(res.ok, false);
  assert.match(res.error, /23503|foreign key|刪除圖片資料失敗/);
  assert.deepEqual(res.deletedIds, []);
  assert.deepEqual(res.failedIds, ["i1"]);
  assert.ok(!fake.ops().includes("storage.remove"));
  const lastUpdate = fake.log.filter((e) => e.op === "update product_variants").pop();
  assert.deepEqual(lastUpdate.patch, { image_id: "i1" }, "restore update was attempted");
  assert.equal(fake.state.variants[0].image_id, "i1");
});

await check("5b. FK still fires for a binding the SELECT could not see -> ok:false, files untouched", async () => {
  const fake = makeFake({
    images: [fullImage("i1")],
    variants: [{ id: "vh", image_id: "i1", hidden: true }]
  });
  const res = await deleteProductImages(fake.client, ["i1"], { unbindVariants: false });
  assert.equal(res.ok, false);
  assert.match(res.error, /23503|foreign key/);
  assert.ok(res.error.includes("款式"), "FK failure carries the variant hint");
  assert.ok(!fake.ops().includes("storage.remove"));
  assert.equal(fake.state.images.length, 1);
});

await check("5c. partial delete -> only deleted rows lose files; failed rows get their bindings back", async () => {
  const fake = makeFake(
    {
      images: [fullImage("i1"), fullImage("i2")],
      variants: [
        { id: "v1", image_id: "i1" },
        { id: "v2", image_id: "i2" }
      ]
    },
    { deleteMode: "partial", deleteFailIds: ["i2"] }
  );
  const res = await deleteProductImages(fake.client, ["i1", "i2"], { unbindVariants: true });
  assert.equal(res.ok, false);
  assert.deepEqual(res.deletedIds, ["i1"]);
  assert.deepEqual(res.failedIds, ["i2"]);
  assert.deepEqual(res.unboundVariantIds, ["v1"]);
  const removed = fake.log.find((e) => e.op === "storage.remove");
  assert.deepEqual(new Set(removed.paths), new Set(fullPaths("i1")));
  assert.equal(fake.state.variants.find((v) => v.id === "v2").image_id, "i2", "v2 restored");
  assert.equal(fake.state.variants.find((v) => v.id === "v1").image_id, null);
});

await check("10. shared file kept: generated_detail row reusing the MAIN image URL only loses its own file", async () => {
  const main = fullImage("m1");
  const detail = {
    id: "g1",
    draft_id: "d1",
    original_file_url: main.processed_file_url, // runComposeDetail: original_file_url = main image's URL
    processed_file_url: `${SB}/u1/d1/generated/g1-detail.png`,
    generated_file_url: null,
    list_thumb_url: null,
    vision_mid_url: null
  };
  const fake = makeFake({ images: [main, detail] });
  const res = await deleteProductImages(fake.client, ["g1"], { unbindVariants: false });
  assert.equal(res.ok, true);
  assert.deepEqual(res.deletedIds, ["g1"]);
  const removed = fake.log.find((e) => e.op === "storage.remove");
  assert.deepEqual(removed.paths, ["u1/d1/generated/g1-detail.png"]);
  assert.ok(!removed.paths.includes("u1/d1/processed/m1 final.png"), "main image file untouched");
  assert.deepEqual(res.storageWarnings, []);
});

await check("10b. every path still referenced by a remaining row -> no storage remove at all", async () => {
  const main = fullImage("m1");
  const detail = {
    id: "g1",
    draft_id: "d1",
    original_file_url: main.processed_file_url,
    processed_file_url: main.original_file_url,
    generated_file_url: null
  };
  const fake = makeFake({ images: [main, detail] });
  const res = await deleteProductImages(fake.client, ["g1"], { unbindVariants: false });
  assert.equal(res.ok, true);
  assert.ok(!fake.ops().includes("storage.remove"));
  assert.deepEqual(res.storageWarnings, []);
});

await check("11. folder guard: path whose 2nd segment is another draft is never removed", async () => {
  const row = fullImage("i1", {
    original_file_url: `${SB}/u1/OTHER-DRAFT/main/foreign-orig.jpg`,
    processed_file_url: `${SB}/u1/d1/processed/own.png`,
    generated_file_url: `${SB}/loose-file-at-root.png`,
    list_thumb_url: null,
    vision_mid_url: null
  });
  const fake = makeFake({ images: [row] });
  const res = await deleteProductImages(fake.client, ["i1"], { unbindVariants: false });
  assert.equal(res.ok, true);
  const removed = fake.log.find((e) => e.op === "storage.remove");
  assert.deepEqual(removed.paths, ["u1/d1/processed/own.png"]);
});

await check("11b. folder guard leaves nothing to remove -> no reference query, no storage call", async () => {
  const row = fullImage("i1", {
    original_file_url: `${SB}/u1/OTHER-DRAFT/main/a.jpg`,
    processed_file_url: null,
    generated_file_url: null,
    list_thumb_url: null,
    vision_mid_url: null
  });
  const fake = makeFake({ images: [row] });
  const res = await deleteProductImages(fake.client, ["i1"], { unbindVariants: false });
  assert.equal(res.ok, true);
  assert.deepEqual(fake.ops(), ["select product_images", "select product_variants", "delete product_images"]);
});

await check("12. reference query errors -> nothing removed, storageWarnings, ok stays true", async () => {
  const fake = makeFake({ images: [fullImage("i1")] }, { remainingSelectError: "refs boom" });
  const { value: res, warnings } = await quiet(() =>
    deleteProductImages(fake.client, ["i1"], { unbindVariants: false })
  );
  assert.equal(res.ok, true);
  assert.deepEqual(res.deletedIds, ["i1"]);
  assert.ok(!fake.ops().includes("storage.remove"));
  assert.ok(res.storageWarnings.length > 0);
  assert.match(res.storageWarnings[0], /refs boom/);
  assert.ok(warnings.length > 0, "console.warn emitted");
  assert.equal(fake.state.images.length, 0, "DB delete still happened");
});

await check("6a. storage remove returns error -> ok:true, storageWarnings, no throw", async () => {
  const fake = makeFake({ images: [fullImage("i1")] }, { storageMode: "error" });
  const { value: res, warnings } = await quiet(() =>
    deleteProductImages(fake.client, ["i1"], { unbindVariants: false })
  );
  assert.equal(res.ok, true);
  assert.deepEqual(res.deletedIds, ["i1"]);
  assert.ok(res.storageWarnings.length > 0);
  assert.ok(warnings.length > 0, "console.warn emitted");
});

await check("6b. storage remove throws -> ok:true, storageWarnings, no exception", async () => {
  const fake = makeFake({ images: [fullImage("i1")] }, { storageMode: "throw" });
  const { value: res } = await quiet(() =>
    deleteProductImages(fake.client, ["i1"], { unbindVariants: false })
  );
  assert.equal(res.ok, true);
  assert.deepEqual(res.deletedIds, ["i1"]);
  assert.ok(res.storageWarnings.length > 0);
  assert.match(res.storageWarnings[0], /network down/);
});

await check("7. unbind returns fewer rows than expected -> ok:false, no delete, no remove, partial unbind restored", async () => {
  const fake = makeFake(
    {
      images: [fullImage("i1")],
      variants: [
        { id: "v1", image_id: "i1" },
        { id: "v2", image_id: "i1" }
      ]
    },
    { unbindMode: "partial", unbindPartial: 1 }
  );
  const res = await deleteProductImages(fake.client, ["i1"], { unbindVariants: true });
  assert.equal(res.ok, false);
  assert.ok(!fake.ops().includes("delete product_images"));
  assert.ok(!fake.ops().includes("storage.remove"));
  assert.deepEqual(fake.state.variants.map((v) => v.image_id), ["i1", "i1"], "everything bound again");
  assert.equal(fake.state.images.length, 1);
});

await check("7b. unbind errors -> ok:false, no delete, no remove, bindings intact", async () => {
  const fake = makeFake(
    { images: [fullImage("i1")], variants: [{ id: "v1", image_id: "i1" }] },
    { unbindMode: "error" }
  );
  const res = await deleteProductImages(fake.client, ["i1"], { unbindVariants: true });
  assert.equal(res.ok, false);
  assert.match(res.error, /解除款式圖片綁定失敗/);
  assert.ok(!fake.ops().includes("delete product_images"));
  assert.ok(!fake.ops().includes("storage.remove"));
  assert.equal(fake.state.variants[0].image_id, "i1");
});

await check("7c. restore failing is reported, not swallowed", async () => {
  const fake = makeFake(
    { images: [fullImage("i1")], variants: [{ id: "v1", image_id: "i1" }] },
    { deleteMode: "noop", restoreMode: "error" }
  );
  const res = await deleteProductImages(fake.client, ["i1"], { unbindVariants: true });
  assert.equal(res.ok, false);
  assert.deepEqual(res.unboundVariantIds, ["v1"]);
  assert.match(res.error, /未能還原/);
});

await check("8. reading rows / bindings fails -> ok:false, nothing changed", async () => {
  const a = makeFake({ images: [fullImage("i1")] }, { imagesSelectError: "boom" });
  const ra = await deleteProductImages(a.client, ["i1"], { unbindVariants: true });
  assert.equal(ra.ok, false);
  assert.deepEqual(mutating(a.ops()), []);

  const b = makeFake({ images: [fullImage("i1")] }, { variantsSelectError: "boom" });
  const rb = await deleteProductImages(b.client, ["i1"], { unbindVariants: true });
  assert.equal(rb.ok, false);
  assert.deepEqual(mutating(b.ops()), []);
  assert.equal(b.state.images.length, 1);
});

await check("9. migration 039 missing (no thumb/mid columns) -> falls back to base columns and still deletes", async () => {
  const fake = makeFake({ images: [fullImage("i1")] }, { failThumbColumns: true });
  const res = await deleteProductImages(fake.client, ["i1"], { unbindVariants: false });
  assert.equal(res.ok, true);
  const removed = fake.log.find((e) => e.op === "storage.remove");
  assert.deepEqual(
    new Set(removed.paths),
    new Set([fullPaths("i1")[0], fullPaths("i1")[1], fullPaths("i1")[2]])
  );
});

await check("findVariantBindings: groups by image, counts, surfaces errors", async () => {
  const fake = makeFake({
    images: [],
    variants: [
      { id: "v1", image_id: "i1" },
      { id: "v2", image_id: "i1" },
      { id: "v3", image_id: "i2" }
    ]
  });
  const res = await findVariantBindings(fake.client, ["i1", "i2", "i3"]);
  assert.equal(res.ok, true);
  assert.equal(res.total, 3);
  assert.deepEqual(res.byImageId, { i1: ["v1", "v2"], i2: ["v3"] });
  const empty = await findVariantBindings(fake.client, []);
  assert.deepEqual(empty, { ok: true, byImageId: {}, total: 0 });
  const bad = makeFake({}, { variantsSelectError: "nope" });
  const err = await findVariantBindings(bad.client, ["i1"]);
  assert.equal(err.ok, false);
  assert.equal(err.error, "nope");
});

// ---------------------------------------------------------------------------
// Part B: static source guards (pure functions over { relPath: content })
// ---------------------------------------------------------------------------
console.log("Part B: static source guards");

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function loadSrcFiles(baseDir) {
  const files = {};
  for (const full of walk(path.join(baseDir, "src"))) {
    files[path.relative(baseDir, full).split(path.sep).join("/")] = fs.readFileSync(full, "utf8");
  }
  return files;
}

// Index just past the bracket that closes the one opened at `openIndex`.
// Skips // and /* */ comments and flat '"' / ` string literals.
function matchClose(src, openIndex) {
  const open = src[openIndex];
  const close = open === "(" ? ")" : open === "{" ? "}" : "]";
  let depth = 0;
  for (let i = openIndex; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
    } else if (ch === "/" && next === "*") {
      i = src.indexOf("*/", i + 2);
      if (i < 0) return -1;
      i += 1;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      i += 1;
      while (i < src.length && src[i] !== ch) {
        if (src[i] === "\\") i += 1;
        i += 1;
      }
    } else if (ch === open) {
      depth += 1;
    } else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

// Named functions in a file with the span of their body.
function findFunctions(src) {
  const found = [];
  const decl = /\b(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g;
  const arrow = /\b(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/g;
  for (const [re, isArrow] of [
    [decl, false],
    [arrow, true]
  ]) {
    let m;
    while ((m = re.exec(src))) {
      const parenOpen = m.index + m[0].length - 1;
      const parenClose = matchClose(src, parenOpen);
      if (parenClose < 0) continue;
      let cursor = parenClose;
      if (isArrow) {
        const rest = src.slice(cursor);
        const arrowMatch = /^\s*(?::[^=]*)?=>\s*/.exec(rest);
        if (!arrowMatch) continue;
        cursor += arrowMatch[0].length;
        if (src[cursor] !== "{") continue;
      } else {
        const brace = src.indexOf("{", cursor);
        if (brace < 0) continue;
        cursor = brace;
      }
      const end = matchClose(src, cursor);
      if (end < 0) continue;
      found.push({ name: m[1], start: m.index, bodyStart: cursor, end });
    }
  }
  return found;
}

function functionBody(src, name) {
  const fn = findFunctions(src).find((f) => f.name === name);
  return fn ? src.slice(fn.bodyStart, fn.end) : null;
}

function enclosingFunctionName(src, index) {
  const containing = findFunctions(src)
    .filter((f) => f.bodyStart <= index && index < f.end)
    .sort((a, b) => b.bodyStart - a.bodyStart);
  return containing[0]?.name ?? null;
}

// 1) Nothing outside the helper may delete product_images rows.
function findDirectImageRowDeletes(files) {
  const re = /\.from\(\s*["'`]product_images["'`]\s*\)\s*\.delete\(/g;
  const bad = [];
  for (const [rel, src] of Object.entries(files)) {
    if (rel === HELPER_REL) continue;
    if (re.test(src)) bad.push(rel);
    re.lastIndex = 0;
  }
  return bad;
}

// 2) Browser/page code may only .remove() Storage objects in these two places
//    (rollback of a just-uploaded file / temp screenshots: no DB row involved).
const STORAGE_REMOVE_WHITELIST = [
  { file: "src/components/listing/ImageUploader.tsx", fn: "uploadOneFile" },
  { file: "src/components/listing/WorkspaceInputPanel.tsx", fn: "removeTempScreenshots" }
];
function findStorageRemoveViolations(files) {
  const re = /\.storage\s*\.from\([^)]*\)\s*\.remove\(/g;
  const bad = [];
  for (const [rel, src] of Object.entries(files)) {
    if (!rel.startsWith("src/components/") && !rel.startsWith("src/app/")) continue;
    let m;
    while ((m = re.exec(src))) {
      const fn = enclosingFunctionName(src, m.index);
      const allowed = STORAGE_REMOVE_WHITELIST.some((w) => w.file === rel && w.fn === fn);
      if (!allowed) bad.push(`${rel} :: ${fn ?? "(top level)"}`);
    }
  }
  return bad;
}

// 3) The entry points must go through the helper; the UI ones must also confirm variant-bound images.
const ENTRY_POINTS = [
  { file: "src/components/listing/ResultCard.tsx", fn: "removeImage", ui: true },
  { file: "src/components/listing/Station2ImagePanel.tsx", fn: "removeImage", ui: true },
  { file: "src/components/listing/ImageUploader.tsx", fn: "deleteImage", ui: true },
  { file: "src/components/listing/WorkspaceInputPanel.tsx", fn: "discardRestore", ui: false }
];
function findEntryViolations(files) {
  const bad = [];
  for (const { file, fn, ui } of ENTRY_POINTS) {
    const src = files[file];
    const body = src ? functionBody(src, fn) : null;
    if (body == null) {
      bad.push(`${file} :: ${fn} (function not found)`);
      continue;
    }
    if (!/\bdeleteProductImages\(/.test(body)) bad.push(`${file} :: ${fn} (no deleteProductImages call)`);
    if (!/unbindVariants\s*:/.test(body)) bad.push(`${file} :: ${fn} (no unbindVariants option)`);
    if (/\.storage\b/.test(body)) bad.push(`${file} :: ${fn} (touches Storage directly)`);
    if (ui) {
      if (!/\bfindVariantBindings\(/.test(body)) bad.push(`${file} :: ${fn} (no findVariantBindings call)`);
      if (!body.includes("款式圖")) bad.push(`${file} :: ${fn} (no 款式圖 confirm prompt)`);
    } else if (!/unbindVariants\s*:\s*true/.test(body)) {
      bad.push(`${file} :: ${fn} (discard must unbind its own variants)`);
    }
  }
  return bad;
}

// 4) Server-side finalize stays DB-first: the DB update precedes the Storage remove.
function findFinalizeOrderViolations(files) {
  const rel = "src/lib/images/runFinalize.ts";
  const src = files[rel];
  if (!src) return [`${rel} (missing)`];
  const update = src.indexOf("processed_file_url: upload.cdnUrl");
  const remove = src.indexOf(".remove([storagePath])");
  if (update < 0 || remove < 0) return [`${rel} (update/remove markers not found)`];
  return update < remove ? [] : [`${rel} (Storage remove runs before DB update)`];
}

// 5) Inside the helper, Storage remove must come after unbind, DB delete and the draft_id reference query.
function findHelperOrderViolations(src) {
  const unbind = src.search(/\.update\(\s*\{\s*image_id\s*:\s*null\s*\}\s*\)/);
  const del = src.search(/\.delete\(\)/);
  const ref = src.search(/\.in\(\s*["'`]draft_id["'`]/);
  const remove = src.search(/\.storage\s*\.from\([^)]*\)\s*\.remove\(/);
  if ([unbind, del, ref, remove].some((i) => i < 0)) {
    return [`${HELPER_REL} (unbind/delete/draft_id reference query/storage remove marker missing)`];
  }
  const bad = [];
  if (!(unbind < del)) bad.push("variant unbind must come before the DB delete");
  if (!(del < ref)) bad.push("reference query must come after the DB delete");
  if (!(ref < remove)) bad.push("storage remove must come after the draft_id reference query");
  return bad;
}

const realFiles = loadSrcFiles(staticRoot);
if (staticRoot !== root) console.log(`  (static root: ${staticRoot})`);

await check('no .from("product_images").delete( outside deleteProductImages.ts', () => {
  assert.deepEqual(findDirectImageRowDeletes(realFiles), []);
});
await check("Storage .remove( in components/app only inside whitelisted functions", () => {
  assert.deepEqual(findStorageRemoveViolations(realFiles), []);
});
await check("entry points call deleteProductImages (UI ones also findVariantBindings + 款式圖)", () => {
  assert.deepEqual(findEntryViolations(realFiles), []);
});
await check("runFinalize keeps DB update before Storage remove", () => {
  assert.deepEqual(findFinalizeOrderViolations(realFiles), []);
});
await check("helper source order: unbind -> delete -> .in(\"draft_id\") reference query -> storage .remove(", () => {
  assert.deepEqual(findHelperOrderViolations(helperSource), []);
});

// The guards must bite: feed them old-style code and require a failure.
await check("static guards flag Storage-first delete code (synthetic old-style fixtures)", () => {
  const oldStyle = {
    "src/components/listing/ResultCard.tsx": `
      async function removeImage(image) {
        const path = storagePathFromUrl(image.processed_file_url);
        await supabase.storage.from("product-images").remove([path]);
        const { error } = await supabase
          .from('product_images')
          .delete()
          .eq("id", image.id);
      }`,
    "src/components/listing/ImageUploader.tsx": `
      async function deleteImage(item) {
        await supabase.storage.from("product-images").remove([item.url]).catch(() => null);
        await supabase.from("product_images").delete().eq("id", item.id);
      }
      async function uploadOneFile() {
        await supabase.storage.from("product-images").remove(toRemove);
      }`
  };
  assert.deepEqual(findDirectImageRowDeletes(oldStyle).sort(), [
    "src/components/listing/ImageUploader.tsx",
    "src/components/listing/ResultCard.tsx"
  ]);
  assert.deepEqual(findStorageRemoveViolations(oldStyle).sort(), [
    "src/components/listing/ImageUploader.tsx :: deleteImage",
    "src/components/listing/ResultCard.tsx :: removeImage"
  ]);
  const entry = findEntryViolations(oldStyle);
  assert.ok(entry.some((e) => e.includes("ResultCard.tsx :: removeImage (no deleteProductImages call)")));
  assert.ok(entry.some((e) => e.includes("ImageUploader.tsx :: deleteImage (no deleteProductImages call)")));
  assert.ok(entry.some((e) => e.includes("Station2ImagePanel.tsx") && e.includes("function not found")));
  assert.ok(entry.some((e) => e.includes("WorkspaceInputPanel.tsx") && e.includes("function not found")));

  const newStyle = {
    "src/components/listing/ResultCard.tsx": `
      async function removeImage(image) {
        const b = await findVariantBindings(supabase, [image.id]);
        showToast("這是款式圖，綁定 1 個款式");
        await deleteProductImages(supabase, [image.id], { unbindVariants: armed });
      }`
  };
  assert.deepEqual(findDirectImageRowDeletes(newStyle), []);
  assert.deepEqual(findStorageRemoveViolations(newStyle), []);
  assert.ok(!findEntryViolations(newStyle).some((e) => e.startsWith("src/components/listing/ResultCard.tsx")));

  const finalizeWrongOrder = {
    "src/lib/images/runFinalize.ts": `
      await s.storage.from(B).remove([storagePath]);
      await s.from("product_images").update({ processed_file_url: upload.cdnUrl });`
  };
  assert.equal(findFinalizeOrderViolations(finalizeWrongOrder).length, 1);

  const helperNoRefQuery = `
    await s.from("product_variants").update({ image_id: null }).in("id", v);
    await s.from("product_images").delete().in("id", ids);
    await s.storage.from(B).remove(paths);`;
  assert.equal(findHelperOrderViolations(helperNoRefQuery).length, 1);
  const helperRemoveFirst = `
    await s.storage.from(B).remove(paths);
    await s.from("product_variants").update({ image_id: null }).in("id", v);
    await s.from("product_images").delete().in("id", ids);
    await s.from("product_images").select(c).in("draft_id", d);`;
  assert.ok(findHelperOrderViolations(helperRemoveFirst).length >= 1);
});

await check("whitelist is per file+function (same function name elsewhere is flagged)", () => {
  const files = {
    "src/components/listing/Other.tsx": `
      async function uploadOneFile() {
        await supabase.storage.from("product-images").remove(x);
      }`,
    "src/components/listing/ImageUploader.tsx": `
      async function uploadOneFile() {
        await supabase.storage.from("product-images").remove(x).catch(() => null);
      }
      function Component() {
        const run = async () => {
          await supabase.storage.from("product-images").remove(y);
        };
      }`
  };
  assert.deepEqual(findStorageRemoveViolations(files).sort(), [
    "src/components/listing/ImageUploader.tsx :: run",
    "src/components/listing/Other.tsx :: uploadOneFile"
  ]);
});

// ---------------------------------------------------------------------------
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log("");
if (failures.length) {
  console.error(`FAILED ${failures.length} check(s)`);
  process.exit(1);
}
console.log("ALL passed");
