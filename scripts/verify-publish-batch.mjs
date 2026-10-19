/**
 * PUBLISH-BATCH verify (no network, no .env, no Supabase).
 *
 * Real modules (runPublishBatch / publishBatchStepwise / recoverStalePublishBatches /
 * reconcileDraft / productLifecycle / publishDraftSafe / publishBatchClient) driven through
 * scripts/publish-guard-loader.mjs with an in-memory Supabase fake and a fake Shopify.
 *
 *   A  channels: Online Store + Google & YouTube REQUIRED, POS optional (warning only)
 *   B  resume gate: api_failed + remote ACTIVE -> RECONCILED (active) / 409 (draft)
 *   C  reconcileDraftWithShopify outcomes
 *   D  stepwise create / step / atomic claim / finalize once
 *   E  stale recovery (killed function) + idle batch + cron wiring
 *   F  client helper (old response shape, progress, step retry, mock)
 *   L  PUBLISH-LITE: attempt counting, auto-resume, preflight, continue, media ids
 *   G  static wiring (callers, routes, package.json, verify-all)
 *
 * Run: node scripts/verify-publish-batch.mjs  |  npm run verify:publish-batch
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
process.chdir(root);
register(pathToFileURL(path.join(root, "scripts", "publish-guard-loader.mjs")).href);

const src = (rel) => pathToFileURL(path.join(root, rel)).href;
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const lifecycle = await import(src("src/lib/shopify/productLifecycle.ts"));
const { publishDraft } = await import(src("src/lib/shopify/publishDraftSafe.ts"));
const { reconcileDraftWithShopify } = await import(src("src/lib/shopify/reconcileDraft.ts"));
const { runPublishBatch } = await import(src("src/lib/shopify/runPublishBatch.ts"));
const { createStepwisePublishBatch, stepPublishBatch } = await import(
  src("src/lib/shopify/publishBatchStepwise.ts")
);
const { recoverStalePublishBatches, recoverStalePublishBatchesBestEffort } = await import(
  src("src/lib/shopify/recoverStalePublishBatches.ts")
);
const { runStepwisePublishBatch, continueStepwisePublishBatch } = await import(
  src("src/lib/drafts/publishBatchClient.ts")
);
const { writeBackMediaIds } = await import(src("src/lib/shopify/publishDraftSafe.ts"));
const { hashSource } = await import(src("src/lib/shopify/syncShopifyProduct.ts"));
const batchHelpers = await import(src("src/lib/drafts/publishBatch.ts"));
const { mapStatusToPipelineStage } = await import(src("src/lib/drafts/pipelineStage.ts"));
const { syncReconciledBatchItems } = await import(src("src/lib/shopify/syncReconciledBatchItems.ts"));

// --- harness ---------------------------------------------------------------
let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

// Network guard: only the Make webhook is "reachable" (and counted); anything else is refused.
const makeCalls = [];
const blockedFetches = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://make.invalid/")) {
    makeCalls.push(JSON.parse(init?.body ?? "{}"));
    return { ok: true, status: 200 };
  }
  blockedFetches.push(String(url));
  throw new Error("NETWORK_FORBIDDEN_IN_PUBLISH_BATCH_VERIFIER");
};

async function withEnv(patch, fn) {
  const before = {};
  for (const key of Object.keys(patch)) before[key] = process.env[key];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const LIVE = {
  SHOPIFY_PUBLISH_MOCK: "false",
  SHOPIFY_LIVE_TEST_DRAFT_ID: undefined,
  SHOPIFY_ACTIVE_PUBLISH_ENABLED: "true",
  SHOPIFY_ONLINE_STORE_PUBLICATION_ID: undefined,
  SHOPIFY_GOOGLE_PUBLICATION_ID: undefined,
  SHOPIFY_LOCATION_ID: undefined,
  SHOPIFY_STORE_DOMAIN: "test-shop.myshopify.com",
  MAKE_WEBHOOK_URL: "https://make.invalid/hook"
};
const live = (fn, extra = {}) => withEnv({ ...LIVE, ...extra }, fn);

const withItemDefaults = (row) => ({ attempt_count: 0, started_at: null, ...row });

/** In-memory Supabase fake. Every insert / update / upsert / delete lands in `writes`. */
function createFakeSupabase(seed) {
  const tables = {
    product_drafts: [],
    product_variants: [],
    product_images: [],
    team_settings: [],
    publish_batches: [],
    publish_batch_items: [],
    publish_jobs: [],
    ...structuredClone(seed)
  };
  // Model the column defaults of publish_batch_items (attempt_count 0, started_at null).
  tables.publish_batch_items = tables.publish_batch_items.map(withItemDefaults);
  const writes = [];
  const failures = [];
  let idCounter = 0;

  function from(table) {
    const state = { table, op: "select", filters: [], orders: [], range: null, payload: null, single: false, maybe: false };
    const matches = (row) => state.filters.every((f) => f(row));
    const withEmbeds = (row) =>
      table === "product_drafts"
        ? { ...row, product_images: (tables.product_images ?? []).filter((i) => i.draft_id === row.id) }
        : row;
    function execute() {
      const rows = tables[table] ?? [];
      const failureIndex = failures.findIndex((f) => f.table === table && f.op === state.op && (!f.match || f.match(state)));
      if (failureIndex >= 0) {
        const [{ error }] = failures.splice(failureIndex, 1);
        return { data: null, error };
      }
      if (state.op === "insert") {
        const list = Array.isArray(state.payload) ? state.payload : [state.payload];
        const inserted = list.map((row) => ({
          id: row.id ?? `fake-${table}-${++idCounter}`,
          ...(table === "publish_batch_items" ? withItemDefaults(row) : row)
        }));
        rows.push(...inserted);
        tables[table] = rows;
        return { data: state.single ? inserted[0] : inserted, error: null };
      }
      if (state.op === "update") {
        const hit = rows.filter(matches);
        for (const row of hit) Object.assign(row, state.payload);
        if (state.single || state.maybe) return { data: hit[0] ? { ...hit[0] } : null, error: null };
        return { data: hit.map((r) => ({ ...r })), error: null };
      }
      if (state.op === "delete" || state.op === "upsert") return { data: null, error: null };
      let hit = rows.filter(matches).map(withEmbeds);
      if (state.orders.length) {
        hit.sort((a, b) => {
          for (const { column, ascending } of state.orders) {
            const left = a[column] ?? null;
            const right = b[column] ?? null;
            if (left === right) continue;
            if (left === null) return ascending ? -1 : 1;
            if (right === null) return ascending ? 1 : -1;
            if (left !== right) return (left < right ? -1 : 1) * (ascending ? 1 : -1);
          }
          return 0;
        });
      }
      if (state.range) hit = hit.slice(state.range[0], state.range[1] + 1);
      if (state.limit != null) hit = hit.slice(0, state.limit);
      if (state.single) {
        return hit[0]
          ? { data: hit[0], error: null }
          : { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } };
      }
      if (state.maybe) return { data: hit[0] ?? null, error: null };
      return { data: hit, error: null };
    }
    const api = {
      select() {
        return api;
      },
      insert(payload) {
        state.op = "insert";
        state.payload = payload;
        writes.push({ op: "insert", table, payload });
        return api;
      },
      update(payload) {
        state.op = "update";
        state.payload = payload;
        writes.push({ op: "update", table, payload });
        return api;
      },
      upsert(payload) {
        state.op = "upsert";
        writes.push({ op: "upsert", table, payload });
        return api;
      },
      delete() {
        state.op = "delete";
        writes.push({ op: "delete", table });
        return api;
      },
      eq(column, value) {
        state.filters.push((row) => row[column] === value);
        return api;
      },
      neq(column, value) {
        state.filters.push((row) => row[column] !== value);
        return api;
      },
      in(column, values) {
        state.filters.push((row) => values.includes(row[column]));
        return api;
      },
      order(column, options = {}) {
        state.orders.push({ column, ascending: options.ascending !== false });
        return api;
      },
      range(from, to) {
        state.range = [from, to];
        return api;
      },
      limit(count) {
        state.limit = count;
        return api;
      },
      single() {
        state.single = true;
        return api;
      },
      maybeSingle() {
        state.maybe = true;
        return api;
      },
      then(resolve, reject) {
        return Promise.resolve(execute()).then(resolve, reject);
      }
    };
    return api;
  }

  return {
    from,
    writes,
    tables,
    failNext({ table, op, match, error = { message: "injected fake query error" } }) {
      failures.push({ table, op, match, error });
    }
  };
}

// --- fixtures ----------------------------------------------------------------
const PUB_ONLINE = "gid://shopify/Publication/192801177785";
const PUB_POS = "gid://shopify/Publication/192801243321";
const PUB_GOOGLE = "gid://shopify/Publication/210344378553";
const STORE_PUBS = [
  { id: PUB_ONLINE, name: "線上商店" },
  { id: PUB_POS, name: "銷售點" },
  { id: PUB_GOOGLE, name: "Google & YouTube" }
];
const PRODUCT = "gid://shopify/Product/9001";
const REMOTE_PUBLISHED_AT = "2026-10-12T01:23:45Z";

/** Fake Shopify Admin GraphQL (records calls, models publications). */
function createShop({
  productId = PRODUCT,
  remoteStatus = "ACTIVE",
  publications = STORE_PUBS,
  publishedOn = [],
  googleUserErrors = false,
  googleNeverSticks = false,
  posUserErrors = false,
  onlineUserErrors = false
} = {}) {
  const calls = [];
  const state = { status: remoteStatus, publishedOn: new Set(publishedOn) };
  const ok = (data) => ({ response: { ok: true, status: 200 }, result: { data } });
  const caller = async (query, variables) => {
    const m = /^\s*(query|mutation)\s+(\w+)/.exec(query);
    const name = m?.[2] ?? "unknown";
    calls.push({ kind: m?.[1] ?? "unknown", name, variables: structuredClone(variables) });
    switch (name) {
      case "ProductLifecycleStatus":
        return ok({ product: state.status ? { id: productId, status: state.status } : null });
      case "OnlineStorePublicationDiscovery":
        return ok({ channels: { nodes: [] }, publications: { nodes: publications } });
      case "SalesChannelPublicationDiscovery":
        return ok({ publications: { nodes: publications } });
      case "ProductUpdateStatus":
        state.status = variables.product.status;
        return ok({
          productUpdate: {
            product: { id: variables.product.id, status: state.status, updatedAt: "2026-10-14T00:00:00Z" },
            userErrors: []
          }
        });
      case "ResumeShopifyDraft":
        return ok({
          product: { id: productId, status: state.status, media: { nodes: [] }, variants: { nodes: [{ id: "gid://shopify/ProductVariant/5" }] } }
        });
      case "ResumeShopifyDraftVariant":
        return ok({
          product: {
            id: productId,
            status: state.status,
            variants: {
              pageInfo: { hasNextPage: false },
              nodes: [{ id: "gid://shopify/ProductVariant/5", title: "Default Title", sku: null, selectedOptions: [{ name: "Title", value: "Default Title" }] }]
            }
          }
        });
      case "ProductVariantsBulkUpdate":
        return ok({ productVariantsBulkUpdate: { productVariants: [], userErrors: [] } });
      case "PublishProductToOnlineStore": {
        if (onlineUserErrors) {
          return ok({ publishablePublish: { publishable: null, userErrors: [{ field: ["input"], message: "nope" }] } });
        }
        for (const p of variables.input) state.publishedOn.add(p.publicationId);
        return ok({
          publishablePublish: {
            publishable: { id: variables.id, status: state.status, publishedAt: REMOTE_PUBLISHED_AT },
            userErrors: []
          }
        });
      }
      case "PublishProductToGoogle": {
        if (googleUserErrors) {
          return ok({ publishablePublish: { publishable: null, userErrors: [{ field: ["input"], message: "google refused" }] } });
        }
        if (!googleNeverSticks) for (const p of variables.input) state.publishedOn.add(p.publicationId);
        return ok({
          publishablePublish: {
            publishable: { id: variables.id, status: state.status },
            userErrors: []
          }
        });
      }
      case "PublishProductToPos": {
        if (posUserErrors) {
          return ok({ publishablePublish: { publishable: null, userErrors: [{ field: ["input"], message: "pos refused" }] } });
        }
        for (const p of variables.input) state.publishedOn.add(p.publicationId);
        return ok({ publishablePublish: { publishable: { id: variables.id, status: state.status }, userErrors: [] } });
      }
      case "VerifyProductOnlineStore":
      case "ReconcileProductChannels":
        return ok({
          product: {
            id: variables.id,
            status: state.status,
            publishedAt: REMOTE_PUBLISHED_AT,
            publishedOnPublication: state.publishedOn.has(variables.publicationId)
          }
        });
      case "ProductChannelState":
        return ok({
          product: { id: variables.id, publishedOnPublication: state.publishedOn.has(variables.publicationId) }
        });
      default:
        throw new Error(`UNEXPECTED_SHOPIFY_CALL:${name}`);
    }
  };
  return {
    caller,
    calls,
    state,
    named: (n) => calls.filter((c) => c.name === n),
    mutationNames: () => calls.filter((c) => c.kind === "mutation").map((c) => c.name),
    publishedPublicationIds: () =>
      calls
        .filter((c) => c.kind === "mutation" && c.name.startsWith("PublishProductTo"))
        .flatMap((c) => c.variables.input.map((i) => i.publicationId))
  };
}

function draftRow(overrides = {}) {
  return {
    id: "d1",
    status: "approved",
    pipeline_stage: "ready",
    publish_status: "pending",
    title_zh: "測試商品",
    cny_price: 50,
    twd_price: 500,
    twd_cost: 200,
    shopify_product_id: null,
    shopify_admin_url: null,
    raw_capture: null,
    warnings: [],
    current_publish_batch_id: null,
    ...overrides
  };
}

const NOW = Date.parse("2026-10-14T12:00:00Z");
const minutesAgo = (m) => new Date(NOW - m * 60_000).toISOString();

/** A live batch already in the DB (created the way createPublishBatchRecords would). */
function seedBatch({
  batchId = "b1",
  publishMode = "active",
  updatedMinutesAgo = 0,
  items = [],
  drafts = []
} = {}) {
  return createFakeSupabase({
    product_drafts: drafts.length ? drafts : items.map((i) => draftRow({ id: i.draftId })),
    publish_batches: [
      {
        id: batchId,
        kind: "shopify_api",
        status: "processing",
        publish_mode: publishMode,
        total_count: items.length,
        done_count: 0,
        failed_count: 0,
        created_at: minutesAgo(updatedMinutesAgo + 1),
        updated_at: minutesAgo(updatedMinutesAgo),
        notify_sent_at: null,
        snapshot_json: items.map((i) => ({ draftId: i.draftId, title: `商品 ${i.draftId}` }))
      }
    ],
    publish_batch_items: items.map((i, idx) => ({
      id: `item-${i.draftId}`,
      batch_id: batchId,
      draft_id: i.draftId,
      item_status: i.status ?? "queued",
      error_message: null,
      attempt_count: i.attempt ?? 0,
      started_at: i.startedMinutesAgo != null ? minutesAgo(i.startedMinutesAgo) : null,
      created_at: minutesAgo(10 - idx)
    }))
  });
}

const itemRow = (fake, draftId) => fake.tables.publish_batch_items.find((i) => i.draft_id === draftId);
const batchRow = (fake, id = "b1") => fake.tables.publish_batches.find((b) => b.id === id);
const draftOf = (fake, id) => fake.tables.product_drafts.find((d) => d.id === id);

/** publishDraft bound to a fake Shopify, as the batch runner calls it. */
const publishWith = (shop) => (client, id, mode, opts) =>
  publishDraft(client, id, mode, { ...opts, callGraphQL: shop.caller });

console.log("\nPUBLISH-BATCH verify\n");

// =====================================================================
// A: channels
// =====================================================================
console.log("A — channels (Online Store + Google & YouTube REQUIRED, POS optional)");

const ALL_THREE = [PUB_ONLINE, PUB_GOOGLE, PUB_POS];

await check("publication name matching: Google & YouTube variants; POS variants; no cross-matches", () => {
  const { isGooglePublicationName, isPosPublicationName } = lifecycle;
  for (const n of ["Google & YouTube", "google & youtube", "Google 和 YouTube", "Google & YouTube 頻道"]) {
    assert.equal(isGooglePublicationName(n), true, n);
  }
  for (const n of ["線上商店", "銷售點", "Point of Sale", "Google Shopping", "YouTube"]) {
    assert.equal(isGooglePublicationName(n), false, n);
  }
  for (const n of ["銷售點", "Point of Sale", "POS", "销售点"]) assert.equal(isPosPublicationName(n), true, n);
  for (const n of ["線上商店", "Google & YouTube", "Possible"]) assert.equal(isPosPublicationName(n), false, n);
});

await check("publishes to Online Store, Google & YouTube AND POS (all three real ids), in that order", async () => {
  await live(async () => {
    const shop = createShop();
    const result = await lifecycle.publishShopifyProductToOnlineStore(PRODUCT, shop.caller);
    assert.equal(result.publicationId, PUB_ONLINE);
    assert.equal(result.googlePublicationId, PUB_GOOGLE);
    assert.equal(result.posPublicationId, PUB_POS);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(shop.publishedPublicationIds(), [PUB_ONLINE, PUB_GOOGLE, PUB_POS]);
    assert.deepEqual(shop.mutationNames(), ["PublishProductToOnlineStore", "PublishProductToGoogle", "PublishProductToPos"]);
    for (const id of shop.publishedPublicationIds()) assert.ok(ALL_THREE.includes(id), "only the three known ids are ever sent");
    assert.ok(ALL_THREE.every((id) => shop.state.publishedOn.has(id)));
  });
});

await check("POS missing -> still ok, warning only (Online Store + Google published)", async () => {
  await live(async () => {
    const shop = createShop({ publications: STORE_PUBS.filter((p) => p.id !== PUB_POS) });
    const result = await lifecycle.publishShopifyProductToOnlineStore(PRODUCT, shop.caller);
    assert.equal(result.googlePublicationId, PUB_GOOGLE);
    assert.equal(result.posPublicationId, null);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /找不到銷售點 \(POS\) 頻道/);
    assert.deepEqual(shop.publishedPublicationIds(), [PUB_ONLINE, PUB_GOOGLE]);
  });
});

await check("POS publish userErrors -> warning only, required channels stay published", async () => {
  await live(async () => {
    const shop = createShop({ posUserErrors: true });
    const result = await lifecycle.publishShopifyProductToOnlineStore(PRODUCT, shop.caller);
    assert.equal(result.posPublicationId, null);
    assert.match(result.warnings[0], /^銷售點 \(POS\) 頻道發布失敗，已略過（商品已正常上架）：/);
    assert.ok(shop.state.publishedOn.has(PUB_ONLINE) && shop.state.publishedOn.has(PUB_GOOGLE));
    assert.equal(shop.named("ProductUpdateStatus").length, 0);
  });
});

await check("two POS-named publications -> ambiguous warning; SHOPIFY_POS_PUBLICATION_ID picks one", async () => {
  const twoPos = [...STORE_PUBS, { id: "gid://shopify/Publication/777", name: "Point of Sale (2)" }];
  await live(async () => {
    const shop = createShop({ publications: twoPos });
    const result = await lifecycle.publishShopifyProductToOnlineStore(PRODUCT, shop.caller);
    assert.equal(result.posPublicationId, null);
    assert.match(result.warnings[0], /找到多個銷售點 \(POS\) 頻道/);
  });
  await live(
    async () => {
      const shop = createShop({ publications: twoPos });
      const result = await lifecycle.publishShopifyProductToOnlineStore(PRODUCT, shop.caller);
      assert.equal(result.posPublicationId, PUB_POS);
      assert.deepEqual(result.warnings, []);
    },
    { SHOPIFY_POS_PUBLICATION_ID: PUB_POS }
  );
});

await check("Google & YouTube missing -> publish THROWS (required), after Online Store, nothing for POS", async () => {
  await live(async () => {
    const shop = createShop({ publications: STORE_PUBS.filter((p) => p.id !== PUB_GOOGLE) });
    await assert.rejects(
      () => lifecycle.publishShopifyProductToOnlineStore(PRODUCT, shop.caller),
      /Google & YouTube publication could not be discovered/
    );
    assert.deepEqual(shop.publishedPublicationIds(), [PUB_ONLINE]);
    assert.equal(shop.named("PublishProductToPos").length, 0);
  });
});

await check("Google ambiguous / publish userErrors / not confirmed / transport error -> all THROW", async () => {
  await live(async () => {
    const dup = createShop({ publications: [...STORE_PUBS, { id: "gid://shopify/Publication/888", name: "Google 和 YouTube" }] });
    await assert.rejects(() => lifecycle.publishShopifyProductToOnlineStore(PRODUCT, dup.caller), /Google & YouTube publication is ambiguous/);

    const refused = createShop({ googleUserErrors: true });
    await assert.rejects(() => lifecycle.publishShopifyProductToOnlineStore(PRODUCT, refused.caller), /Google & YouTube publish userErrors/);

    const unconfirmed = createShop({ googleNeverSticks: true });
    await assert.rejects(() => lifecycle.publishShopifyProductToOnlineStore(PRODUCT, unconfirmed.caller), /Google & YouTube publication readback mismatch/);

    const down = createShop();
    const flaky = async (q, v) => {
      if (/GooglePublicationDiscovery|SalesChannelPublicationDiscovery/.test(q)) {
        return { response: { ok: false, status: 503 }, result: {} };
      }
      return down.caller(q, v);
    };
    await assert.rejects(() => lifecycle.publishShopifyProductToOnlineStore(PRODUCT, flaky), /publication discovery failed: HTTP 503/);
  });
});

await check("Online Store missing -> fails as before; Google / POS are never attempted", async () => {
  await live(async () => {
    const shop = createShop({ publications: STORE_PUBS.filter((p) => p.id !== PUB_ONLINE) });
    await assert.rejects(
      () => lifecycle.publishShopifyProductToOnlineStore(PRODUCT, shop.caller),
      /Online Store publication could not be discovered/
    );
    assert.deepEqual(shop.mutationNames(), []);
  });
});

await check("Online Store publish userErrors -> throws as before (no Google / POS publish)", async () => {
  await live(async () => {
    const shop = createShop({ onlineUserErrors: true });
    await assert.rejects(() => lifecycle.publishShopifyProductToOnlineStore(PRODUCT, shop.caller), /userErrors/);
    assert.deepEqual(shop.mutationNames(), ["PublishProductToOnlineStore"]);
  });
});

await check("SHOPIFY_GOOGLE_PUBLICATION_ID: valid gid used; POS-named id and Online Store id are errors", async () => {
  await live(
    async () => {
      const shop = createShop({ publications: STORE_PUBS.filter((p) => p.id !== PUB_GOOGLE) });
      const result = await lifecycle.publishShopifyProductToOnlineStore(PRODUCT, shop.caller);
      assert.equal(result.googlePublicationId, PUB_GOOGLE, "env override works even if the name list lacks it");
    },
    { SHOPIFY_GOOGLE_PUBLICATION_ID: PUB_GOOGLE }
  );
  await live(
    async () => {
      const shop = createShop();
      await assert.rejects(() => lifecycle.publishShopifyProductToOnlineStore(PRODUCT, shop.caller), /a Point of Sale publication/);
    },
    { SHOPIFY_GOOGLE_PUBLICATION_ID: PUB_POS }
  );
  await live(
    async () => {
      const shop = createShop();
      await assert.rejects(() => lifecycle.publishShopifyProductToOnlineStore(PRODUCT, shop.caller), /resolves to the Online Store publication/);
    },
    { SHOPIFY_GOOGLE_PUBLICATION_ID: PUB_ONLINE }
  );
  // a malformed override is ignored (name discovery)
  await live(
    async () => {
      const result = await lifecycle.publishShopifyProductToOnlineStore(PRODUCT, createShop().caller);
      assert.equal(result.googlePublicationId, PUB_GOOGLE);
    },
    { SHOPIFY_GOOGLE_PUBLICATION_ID: "12345" }
  );
});

await check("ACTIVE finalize in publishDraft: Google failure -> same rollback to DRAFT + api_failed as an Online Store failure", async () => {
  await live(async () => {
    for (const faults of [{ publications: STORE_PUBS.filter((p) => p.id !== PUB_GOOGLE) }, { googleUserErrors: true }]) {
      const fake = createFakeSupabase({
        product_drafts: [
          draftRow({
            status: "api_failed", publish_status: "api_failed", shopify_product_id: PRODUCT,
            error_message: "x", generated_payload_json: { media: [] }
          })
        ]
      });
      const shop = createShop({ remoteStatus: "DRAFT", resumable: true, ...faults });
      const result = await publishDraft(fake, "d1", "active", { mockMode: false, callGraphQL: shop.caller });
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.match(result.error, /ACTIVE\/Online Store publication failed after staged sync/);
      assert.match(result.error, /Google & YouTube/);
      const statuses = shop.named("ProductUpdateStatus").map((c) => c.variables.product.status);
      assert.deepEqual(statuses, ["ACTIVE", "DRAFT"], "promoted, then rolled back");
      assert.equal(shop.state.status, "DRAFT");
      assert.equal(draftOf(fake, "d1").status, "api_failed");
      assert.equal(draftOf(fake, "d1").shopify_product_id, PRODUCT);
    }
  });
});

await check("ACTIVE finalize in publishDraft: all three channels ok -> active_published; POS problem is a stored warning", async () => {
  await live(async () => {
    const fake = createFakeSupabase({
      product_drafts: [
        draftRow({
          status: "api_failed", publish_status: "api_failed", shopify_product_id: PRODUCT,
          error_message: "x", generated_payload_json: { media: [] }
        })
      ]
    });
    const shop = createShop({ remoteStatus: "DRAFT", resumable: true, posUserErrors: true });
    const result = await publishDraft(fake, "d1", "active", { mockMode: false, callGraphQL: shop.caller });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(draftOf(fake, "d1").status, "active_published");
    assert.deepEqual(shop.publishedPublicationIds().slice(0, 2), [PUB_ONLINE, PUB_GOOGLE]);
    assert.ok(draftOf(fake, "d1").warnings.some((w) => /銷售點 \(POS\) 頻道發布失敗/.test(w)));
    assert.ok(result.warnings.some((w) => /銷售點 \(POS\)/.test(w)));
  });
});

// =====================================================================
// B: resume gate
// =====================================================================
console.log("\nB — resume gate (api_failed + remote ACTIVE)");

function gateSupabase(draftOverrides = {}) {
  return createFakeSupabase({
    product_drafts: [
      draftRow({
        status: "api_failed",
        publish_status: "api_failed",
        shopify_product_id: PRODUCT,
        error_message: "ACTIVE/Online Store publication failed",
        warnings: ["舊警告"],
        ...draftOverrides
      })
    ]
  });
}
const WRITE_MUTATIONS = [
  "ProductCreate",
  "ProductVariantsBulkUpdate",
  "ProductVariantsBulkCreate",
  "ProductAttachMedia",
  "ProductUpdateStatus"
];

await check("active mode: RECONCILED success, local state repaired, content never re-synced", async () => {
  await live(async () => {
    const fake = gateSupabase();
    const shop = createShop({ remoteStatus: "ACTIVE", publishedOn: ALL_THREE });
    const result = await publishDraft(fake, "d1", "active", { mockMode: false, callGraphQL: shop.caller });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.code, "RECONCILED");
    assert.equal(result.productId, PRODUCT);
    assert.match(result.message, /Shopify 已上架，已對帳（未重新同步內容）/);
    const draft = draftOf(fake, "d1");
    assert.equal(draft.status, "active_published");
    assert.equal(draft.publish_status, "active_published");
    assert.equal(draft.pipeline_stage, mapStatusToPipelineStage("active_published"));
    assert.equal(draft.error_message, null);
    assert.equal(draft.shopify_product_id, PRODUCT);
    assert.match(draft.shopify_admin_url, /9001/);
    assert.equal(draft.published_at, REMOTE_PUBLISHED_AT, "published_at comes from Shopify publishedAt");
    assert.ok(draft.warnings.includes("舊警告") && draft.warnings.includes("Shopify 已上架，已對帳（未重新同步內容）"));
    for (const name of WRITE_MUTATIONS) assert.equal(shop.named(name).length, 0, `${name} must not run`);
    assert.deepEqual(shop.mutationNames(), [], "already on every channel -> not a single Shopify write");
    assert.equal(fake.tables.publish_jobs.length, 0);
  });
});

await check("active mode: remote ACTIVE but on no channel -> Online Store + Google + POS ADDED, nothing else", async () => {
  await live(async () => {
    const fake = gateSupabase();
    const shop = createShop({ remoteStatus: "ACTIVE", publishedOn: [] });
    const result = await publishDraft(fake, "d1", "active", { mockMode: false, callGraphQL: shop.caller });
    assert.equal(result.code, "RECONCILED");
    assert.deepEqual(shop.publishedPublicationIds(), [PUB_ONLINE, PUB_GOOGLE, PUB_POS]);
    assert.deepEqual(
      [...new Set(shop.mutationNames())].sort(),
      ["PublishProductToGoogle", "PublishProductToOnlineStore", "PublishProductToPos"]
    );
  });
});

await check("draft mode + remote ACTIVE: still a clear 409, no write at all", async () => {
  await live(async () => {
    const fake = gateSupabase();
    const shop = createShop({ remoteStatus: "ACTIVE", publishedOn: ALL_THREE });
    const before = JSON.stringify(draftOf(fake, "d1"));
    const result = await publishDraft(fake, "d1", "draft", { mockMode: false, callGraphQL: shop.caller });
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.match(result.error, /ACTIVE while local state is api_failed/);
    assert.match(result.error, /Manual reconciliation required/);
    assert.equal(JSON.stringify(draftOf(fake, "d1")), before, "draft untouched");
    assert.deepEqual(shop.mutationNames(), []);
    assert.equal(fake.writes.length, 0);
  });
});

await check("remote ARCHIVED keeps the old 409 (other gate branches unchanged)", async () => {
  await live(async () => {
    const fake = gateSupabase();
    const shop = createShop({ remoteStatus: "ARCHIVED" });
    const result = await publishDraft(fake, "d1", "active", { mockMode: false, callGraphQL: shop.caller });
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.match(result.error, /is ARCHIVED; automatic recovery is blocked/);
    assert.equal(fake.writes.length, 0);
  });
});

await check("if the channels cannot be confirmed the gate fails and the draft stays api_failed", async () => {
  await live(async () => {
    const fake = gateSupabase();
    const shop = createShop({ remoteStatus: "ACTIVE", publishedOn: [], onlineUserErrors: true });
    const result = await publishDraft(fake, "d1", "active", { mockMode: false, callGraphQL: shop.caller });
    assert.equal(result.ok, false);
    assert.equal(draftOf(fake, "d1").status, "api_failed");
  });
});

// =====================================================================
// C: reconcileDraftWithShopify
// =====================================================================
console.log("\nC — reconcileDraftWithShopify outcomes");

await check("remote DRAFT -> remote_draft, no change anywhere", async () => {
  await live(async () => {
    const fake = gateSupabase();
    const shop = createShop({ remoteStatus: "DRAFT" });
    const r = await reconcileDraftWithShopify(fake, "d1", shop.caller);
    assert.equal(r.reconciled, false);
    assert.equal(r.outcome, "remote_draft");
    assert.match(r.message, /可按重試續傳/);
    assert.equal(fake.writes.length, 0);
    assert.deepEqual(shop.mutationNames(), []);
  });
});

await check("remote missing -> remote_missing (重試會重新建立), no change", async () => {
  await live(async () => {
    const fake = gateSupabase();
    const shop = createShop({ remoteStatus: null });
    const r = await reconcileDraftWithShopify(fake, "d1", shop.caller);
    assert.equal(r.outcome, "remote_missing");
    assert.match(r.message, /重試會重新建立/);
    assert.equal(fake.writes.length, 0);
    assert.equal(draftOf(fake, "d1").shopify_product_id, PRODUCT, "link is kept; the retry path clears it");
  });
});

await check("remote ARCHIVED -> remote_other, no change", async () => {
  await live(async () => {
    const fake = gateSupabase();
    const shop = createShop({ remoteStatus: "ARCHIVED" });
    const r = await reconcileDraftWithShopify(fake, "d1", shop.caller);
    assert.equal(r.outcome, "remote_other");
    assert.equal(r.reconciled, false);
    assert.equal(fake.writes.length, 0);
    assert.deepEqual(shop.mutationNames(), []);
  });
});

await check("remote ACTIVE, Online Store ok but Google & YouTube cannot be confirmed -> outcome error, draft UNTOUCHED", async () => {
  await live(async () => {
    for (const faults of [
      { publications: STORE_PUBS.filter((p) => p.id !== PUB_GOOGLE) },
      { googleUserErrors: true },
      { googleNeverSticks: true }
    ]) {
      const fake = gateSupabase();
      const shop = createShop({ remoteStatus: "ACTIVE", publishedOn: [PUB_ONLINE], ...faults });
      const r = await reconcileDraftWithShopify(fake, "d1", shop.caller);
      assert.equal(r.reconciled, false);
      assert.equal(r.outcome, "error");
      assert.match(r.message, /必要通路（線上商店／Google & YouTube）/);
      assert.equal(fake.writes.length, 0, "no DB write at all");
      assert.equal(draftOf(fake, "d1").status, "api_failed");
      assert.ok(!shop.publishedPublicationIds().includes(PUB_POS), "POS is not attempted after a required channel failed");
    }
  });
});

await check("remote ACTIVE: only the MISSING channels are published (onlyIfMissing); POS failure is just a warning", async () => {
  await live(async () => {
    const fake = gateSupabase();
    const shop = createShop({ remoteStatus: "ACTIVE", publishedOn: [PUB_ONLINE, PUB_GOOGLE], posUserErrors: true });
    const r = await reconcileDraftWithShopify(fake, "d1", shop.caller);
    assert.equal(r.reconciled, true);
    assert.deepEqual(shop.publishedPublicationIds(), [PUB_POS], "Online Store / Google are not re-published");
    assert.match(r.warnings[0], /銷售點 \(POS\) 頻道發布失敗/);
    assert.equal(draftOf(fake, "d1").status, "active_published");
    assert.ok(draftOf(fake, "d1").warnings.some((w) => /銷售點 \(POS\)/.test(w)));
    const mutations = shop.mutationNames();
    assert.ok(mutations.every((n) => n.startsWith("PublishProductTo")), "reconcile only ever adds publications");
  });
});

await check("no / mock product id -> no_product; other draft statuses -> not_applicable", async () => {
  await live(async () => {
    const shop = createShop();
    const a = await reconcileDraftWithShopify(gateSupabase({ shopify_product_id: null }), "d1", shop.caller);
    assert.equal(a.outcome, "no_product");
    const b = await reconcileDraftWithShopify(gateSupabase({ shopify_product_id: "mock-product-id" }), "d1", shop.caller);
    assert.equal(b.outcome, "no_product");
    const c = await reconcileDraftWithShopify(gateSupabase({ status: "draft_created" }), "d1", shop.caller);
    assert.equal(c.outcome, "not_applicable");
    assert.equal(shop.calls.length, 0, "no Shopify call for these");
  });
});

await check("remote ACTIVE already on both channels -> state repaired with ZERO Shopify writes", async () => {
  await live(async () => {
    const fake = gateSupabase();
    const shop = createShop({ remoteStatus: "ACTIVE", publishedOn: ALL_THREE });
    const r = await reconcileDraftWithShopify(fake, "d1", shop.caller);
    assert.equal(r.reconciled, true);
    assert.equal(r.outcome, "active_published");
    assert.deepEqual(shop.mutationNames(), []);
    assert.equal(draftOf(fake, "d1").status, "active_published");
  });
});

await check("reconcile never moves a draft that changed state meanwhile (conditional write)", async () => {
  await live(async () => {
    const fake = gateSupabase();
    const shop = createShop({ remoteStatus: "ACTIVE", publishedOn: ALL_THREE });
    // the draft gets re-queued while Shopify answers
    const slow = async (q, v) => {
      const out = await shop.caller(q, v);
      draftOf(fake, "d1").status = "approved";
      return out;
    };
    const r = await reconcileDraftWithShopify(fake, "d1", slow);
    assert.equal(r.reconciled, false);
    assert.equal(r.outcome, "error");
    assert.equal(draftOf(fake, "d1").status, "approved");
  });
});

await check("syncReconciledBatchItems: failed row in the current batch -> done, header recomputed", async () => {
  const fake = seedBatch({ items: [{ draftId: "d1", status: "failed" }, { draftId: "d2", status: "done" }] });
  batchRow(fake).status = "partial_failed";
  batchRow(fake).failed_count = 1;
  draftOf(fake, "d1").current_publish_batch_id = "b1";
  const out = await syncReconciledBatchItems(fake, "d1", PRODUCT, "https://admin/x");
  assert.equal(out.updatedItems, 1);
  assert.equal(itemRow(fake, "d1").item_status, "done");
  assert.equal(batchRow(fake).status, "completed");
  assert.equal(batchRow(fake).failed_count, 0);
  assert.equal(batchRow(fake).done_count, 2);
});

// =====================================================================
// D: stepwise create / step / claim / finalize
// =====================================================================
console.log("\nD — stepwise batch");

function stubPublish(log, behaviour = {}) {
  return async (_client, id, mode, opts) => {
    log.push({ id, mode, opts });
    if (behaviour.delayMs) await new Promise((r) => setTimeout(r, behaviour.delayMs));
    if (behaviour.throwFor?.includes(id)) throw new Error("boom");
    if (behaviour.failFor?.includes(id)) return { ok: false, status: 502, error: `fail ${id}` };
    return { ok: true, productId: `gid://shopify/Product/${id}`, adminUrl: `https://admin.shopify.test/products/${id}` };
  };
}

function plainWorld(ids) {
  return createFakeSupabase({ product_drafts: ids.map((id) => draftRow({ id, title_zh: `商品 ${id}` })) });
}

await check("stepwise create: header + queued items only, returns at once, publishes nothing", async () => {
  await live(async () => {
    const fake = plainWorld(["d1", "d2", "d3"]);
    const log = [];
    const res = await createStepwisePublishBatch({
      serviceSupabase: fake,
      draftIds: ["d1", "d2", "d3", "d2"],
      publishMode: "active",
      createdBy: "u1",
      publishOne: stubPublish(log),
      now: () => NOW
    });
    assert.equal(res.ok, true);
    assert.equal(res.mock, false);
    assert.equal(res.batchStatus, "processing");
    assert.equal(res.total, 3);
    assert.deepEqual(res.items, [
      { draftId: "d1", itemStatus: "queued" },
      { draftId: "d2", itemStatus: "queued" },
      { draftId: "d3", itemStatus: "queued" }
    ]);
    assert.equal(log.length, 0, "publishOne must not run");
    assert.equal(fake.tables.publish_batches.length, 1);
    assert.equal(fake.tables.publish_batches[0].status, "processing");
    assert.equal(fake.tables.publish_batches[0].publish_mode, "active");
    assert.deepEqual(fake.tables.publish_batch_items.map((i) => i.item_status), ["queued", "queued", "queued"]);
    assert.ok(fake.tables.product_drafts.every((d) => d.status === "approved"), "drafts untouched");
    assert.equal(makeCalls.filter((c) => c.event === "publish_batch_submitted").length, 0, "no batch webhook before the batch finishes");
  });
});

await check("stepwise create validates like the one-shot batch (empty ids, live-test guard)", async () => {
  await live(async () => {
    const fake = plainWorld(["d1"]);
    const empty = await createStepwisePublishBatch({ serviceSupabase: fake, draftIds: [], publishMode: "draft", createdBy: "u1" });
    assert.equal(empty.ok, false);
    assert.equal(empty.status, 400);
    await withEnv({ SHOPIFY_LIVE_TEST_DRAFT_ID: "other" }, async () => {
      const blocked = await createStepwisePublishBatch({ serviceSupabase: fake, draftIds: ["d1"], publishMode: "draft", createdBy: "u1" });
      assert.equal(blocked.ok, false);
      assert.equal(blocked.status, 403);
    });
    await withEnv({ SHOPIFY_ACTIVE_PUBLISH_ENABLED: "false" }, async () => {
      const blocked = await createStepwisePublishBatch({ serviceSupabase: fake, draftIds: ["d1"], publishMode: "active", createdBy: "u1" });
      assert.equal(blocked.status, 403);
    });
    assert.equal(fake.writes.length, 0);
  });
});

await check("stepwise create in MOCK mode stays a dry run: zero writes, mock:true, no Make", async () => {
  await withEnv({ ...LIVE, SHOPIFY_PUBLISH_MOCK: "true" }, async () => {
    const fake = plainWorld(["d1"]);
    const before = makeCalls.length;
    const res = await createStepwisePublishBatch({
      serviceSupabase: fake,
      draftIds: ["d1"],
      publishMode: "draft",
      createdBy: "u1",
      publishOne: async () => ({ ok: true, mock: true, payload: {}, productId: null, adminUrl: null, mockNotes: [] })
    });
    assert.equal(res.ok, true);
    assert.equal(res.mock, true);
    assert.equal(res.batchId, batchHelpers.MOCK_DRY_RUN_BATCH_ID);
    assert.equal(fake.writes.length, 0);
    assert.equal(makeCalls.length, before);
    const step = await stepPublishBatch({ serviceSupabase: fake, batchId: batchHelpers.MOCK_DRY_RUN_BATCH_ID, actorId: "u1" });
    assert.equal(step.ok, false);
    assert.equal(step.status, 400);
  });
});

await check("step claims ONE item per call; finalize happens once; Make webhook sent exactly once", async () => {
  await live(async () => {
    const fake = plainWorld(["d1", "d2", "d3"]);
    const log = [];
    const publishOne = stubPublish(log, { failFor: ["d2"] });
    const created = await createStepwisePublishBatch({
      serviceSupabase: fake, draftIds: ["d1", "d2", "d3"], publishMode: "active", createdBy: "u1", publishOne, now: () => NOW
    });
    const batchId = created.batchId;
    const step = () => stepPublishBatch({ serviceSupabase: fake, batchId, actorId: "u-step", publishOne, now: () => NOW });
    const madeBefore = makeCalls.length;

    const s1 = await step();
    assert.equal(s1.done, false);
    assert.equal(s1.processed.draftId, "d1");
    assert.equal(s1.processed.ok, true);
    assert.deepEqual(
      { t: s1.counts.total, d: s1.counts.done, q: s1.counts.queued },
      { t: 3, d: 1, q: 2 }
    );
    assert.equal(log.length, 1, "exactly one publish per step");
    assert.equal(itemRow(fake, "d1").item_status, "done");
    assert.equal(itemRow(fake, "d1").shopify_product_id, "gid://shopify/Product/d1");
    assert.equal(itemRow(fake, "d2").item_status, "queued");

    const s2 = await step();
    assert.equal(s2.processed.draftId, "d2");
    assert.equal(s2.processed.ok, false);
    assert.equal(s2.processed.error, "fail d2");
    assert.equal(itemRow(fake, "d2").item_status, "failed");

    const s3 = await step();
    assert.equal(s3.processed.draftId, "d3");
    assert.equal(s3.done, false, "the finishing step is separate (keeps each request short)");
    assert.equal(batchRow(fake, batchId).status, "processing");
    assert.equal(makeCalls.length, madeBefore);

    const s4 = await step();
    assert.equal(s4.done, true);
    assert.equal(s4.processed, null);
    assert.equal(s4.batchStatus, "partial_failed");
    assert.deepEqual(s4.counts, { total: 3, done: 2, failed: 1, skipped: 0, queued: 0, processing: 0 });
    assert.match(s4.message, /成功 2 筆／失敗 1 筆/);
    const header = batchRow(fake, batchId);
    assert.equal(header.status, "partial_failed");
    assert.equal(header.done_count, 2);
    assert.equal(header.failed_count, 1);
    assert.ok(header.completed_at);
    assert.equal(makeCalls.length, madeBefore + 1, "webhook once");
    assert.equal(makeCalls.at(-1).event, "publish_batch_submitted");
    assert.equal(makeCalls.at(-1).doneCount, 2);
    assert.equal(makeCalls.at(-1).results.length, 3);

    const s5 = await step();
    assert.equal(s5.done, true);
    assert.equal(s5.batchStatus, "partial_failed");
    assert.equal(makeCalls.length, madeBefore + 1, "a second finalize attempt sends nothing");
    assert.equal(log.length, 3);
  });
});

await check("same publishMode + confirmedBy semantics as the one-shot batch", async () => {
  await live(async () => {
    const fake = plainWorld(["d1"]);
    const log = [];
    const publishOne = stubPublish(log);
    const created = await createStepwisePublishBatch({
      serviceSupabase: fake, draftIds: ["d1"], publishMode: "active", createdBy: "creator", publishOne, now: () => NOW
    });
    await stepPublishBatch({ serviceSupabase: fake, batchId: created.batchId, actorId: "actor", publishOne, now: () => NOW });
    assert.equal(log[0].mode, "active");
    assert.equal(log[0].opts.confirmedBy, "actor");
    assert.equal(log[0].opts.mockMode, false, "batch already decided live");
    assert.equal(log[0].opts.confirmVariantPrices, false);
  });
});

await check("two concurrent steps over 2 items: one claims the first and the other waits instead of skipping", async () => {
  await live(async () => {
    const fake = plainWorld(["d1", "d2"]);
    const log = [];
    const publishOne = stubPublish(log, { delayMs: 15 });
    const created = await createStepwisePublishBatch({
      serviceSupabase: fake, draftIds: ["d1", "d2"], publishMode: "draft", createdBy: "u1", publishOne, now: () => NOW
    });
    const run = () => stepPublishBatch({ serviceSupabase: fake, batchId: created.batchId, actorId: "u1", publishOne, now: () => NOW });
    const [a, b] = await Promise.all([run(), run()]);
    assert.ok(a.ok && b.ok);
    assert.equal(a.done, false);
    assert.equal(b.done, false);
    assert.equal([a, b].filter((r) => r.processed).length, 1);
    assert.equal(log.length, 1);
    assert.deepEqual(log.map((l) => l.id), ["d1"]);
    assert.equal([a, b].filter((r) => r.processed === null).length, 1);
    assert.equal(itemRow(fake, "d2").item_status, "queued");
  });
});

await check("two concurrent steps over 1 item: only ONE publishes, the other gets nothing to claim", async () => {
  await live(async () => {
    const fake = plainWorld(["d1"]);
    const log = [];
    const publishOne = stubPublish(log, { delayMs: 15 });
    const created = await createStepwisePublishBatch({
      serviceSupabase: fake, draftIds: ["d1"], publishMode: "draft", createdBy: "u1", publishOne, now: () => NOW
    });
    const run = () => stepPublishBatch({ serviceSupabase: fake, batchId: created.batchId, actorId: "u1", publishOne, now: () => NOW });
    const [a, b] = await Promise.all([run(), run()]);
    assert.equal(log.length, 1, "the same item is never published twice");
    const winners = [a, b].filter((r) => r.processed);
    const losers = [a, b].filter((r) => !r.processed);
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.equal(losers[0].done, false, "the batch is not finished while the winner is still publishing");
    assert.equal(losers[0].counts.processing, 1);
  });
});

await check("existing processing item blocks later queued item without publishing or finalizing", async () => {
  await live(async () => {
    const fake = plainWorld(["d1", "d2"]);
    const log = [];
    const created = await createStepwisePublishBatch({
      serviceSupabase: fake, draftIds: ["d1", "d2"], publishMode: "draft", createdBy: "u1", now: () => NOW
    });
    itemRow(fake, "d2").item_status = "processing";
    itemRow(fake, "d1").created_at = "2026-10-17T00:00:00.000Z";
    itemRow(fake, "d2").created_at = "2026-10-17T00:00:01.000Z";
    const res = await stepPublishBatch({ serviceSupabase: fake, batchId: created.batchId, actorId: "u1", publishOne: stubPublish(log), now: () => NOW });
    assert.equal(res.done, false);
    assert.equal(res.processed, null);
    assert.equal(log.length, 0);
    assert.equal(itemRow(fake, "d1").item_status, "queued");
    assert.equal(itemRow(fake, "d2").item_status, "processing");
    assert.equal(batchRow(fake, created.batchId).status, "processing");
  });
});

await check("CAS loser waits on the contested first item and does not claim the next", async () => {
  await live(async () => {
    const fake = plainWorld(["d1", "d2"]);
    const log = [];
    const created = await createStepwisePublishBatch({
      serviceSupabase: fake, draftIds: ["d1", "d2"], publishMode: "draft", createdBy: "u1", now: () => NOW
    });
    fake.failNext({
      table: "publish_batch_items", op: "update",
      match: (state) => state.filters.length > 0,
      error: null
    });
    // A zero-row conditional update is the ordinary CAS-loser result.
    const res = await stepPublishBatch({ serviceSupabase: fake, batchId: created.batchId, actorId: "u1", publishOne: stubPublish(log), now: () => NOW });
    assert.equal(res.processed, null);
    assert.equal(log.length, 0);
    assert.equal(itemRow(fake, "d2").item_status, "queued");
    assert.equal(batchRow(fake, created.batchId).status, "processing");
  });
});

await check("same created_at rows use id as deterministic tie-breaker", async () => {
  await live(async () => {
    const fake = plainWorld(["d1", "d2"]);
    const log = [];
    const created = await createStepwisePublishBatch({
      serviceSupabase: fake, draftIds: ["d1", "d2"], publishMode: "draft", createdBy: "u1", now: () => NOW
    });
    itemRow(fake, "d1").id = "z-item";
    itemRow(fake, "d2").id = "a-item";
    itemRow(fake, "d1").created_at = NOW;
    itemRow(fake, "d2").created_at = NOW;
    const res = await stepPublishBatch({ serviceSupabase: fake, batchId: created.batchId, actorId: "u1", publishOne: stubPublish(log), now: () => NOW });
    assert.equal(res.processed.draftId, "d2");
    assert.deepEqual(log.map((row) => row.id), ["d2"]);
  });
});

await check("claim read and CAS errors throw and never publish or finalize", async () => {
  await live(async () => {
    for (const phase of ["read", "claim"]) {
      const fake = plainWorld(["d1", "d2"]);
      const log = [];
      const created = await createStepwisePublishBatch({
        serviceSupabase: fake, draftIds: ["d1", "d2"], publishMode: "draft", createdBy: "u1", now: () => NOW
      });
      fake.failNext({
        table: "publish_batch_items",
        op: phase === "read" ? "select" : "update",
        match: phase === "claim" ? (state) => state.filters.length > 0 : phase === "read" ? (state) => state.orders.length > 0 : undefined,
        error: { message: `${phase} failed` }
      });
      await assert.rejects(
        stepPublishBatch({ serviceSupabase: fake, batchId: created.batchId, actorId: "u1", publishOne: stubPublish(log), now: () => NOW }),
        new RegExp(`${phase} failed`)
      );
      assert.equal(log.length, 0);
      assert.equal(itemRow(fake, "d1").item_status, "queued");
      assert.equal(itemRow(fake, "d2").item_status, "queued");
      assert.equal(batchRow(fake, created.batchId).status, "processing");
    }
  });
});

await check("concurrent finalize: many tabs finishing at once still send ONE webhook / one terminal write", async () => {
  await live(async () => {
    const fake = plainWorld(["d1"]);
    const publishOne = stubPublish([]);
    const created = await createStepwisePublishBatch({
      serviceSupabase: fake, draftIds: ["d1"], publishMode: "draft", createdBy: "u1", publishOne, now: () => NOW
    });
    const run = () => stepPublishBatch({ serviceSupabase: fake, batchId: created.batchId, actorId: "u1", publishOne, now: () => NOW });
    await run();
    const before = makeCalls.length;
    const results = await Promise.all([run(), run(), run()]);
    assert.ok(results.every((r) => r.done === true));
    assert.equal(makeCalls.length - before, 1);
    assert.equal(batchRow(fake, created.batchId).status, "completed");
  });
});

await check("publishOne throwing -> that item failed, the batch continues", async () => {
  await live(async () => {
    const fake = plainWorld(["d1", "d2"]);
    const publishOne = stubPublish([], { throwFor: ["d1"] });
    const created = await createStepwisePublishBatch({
      serviceSupabase: fake, draftIds: ["d1", "d2"], publishMode: "draft", createdBy: "u1", publishOne, now: () => NOW
    });
    const run = () => stepPublishBatch({ serviceSupabase: fake, batchId: created.batchId, actorId: "u1", publishOne, now: () => NOW });
    const s1 = await run();
    assert.equal(s1.processed.ok, false);
    assert.equal(s1.processed.error, "boom");
    const s2 = await run();
    assert.equal(s2.processed.ok, true);
  });
});

await check("a missing draft is failed with 草稿不存在或無權限 without calling publish", async () => {
  await live(async () => {
    const fake = plainWorld(["d1"]);
    const log = [];
    const publishOne = stubPublish(log);
    const created = await createStepwisePublishBatch({
      serviceSupabase: fake, draftIds: ["d1", "ghost"], publishMode: "draft", createdBy: "u1", publishOne, now: () => NOW
    });
    const run = () => stepPublishBatch({ serviceSupabase: fake, batchId: created.batchId, actorId: "u1", publishOne, now: () => NOW });
    await run();
    const s2 = await run();
    assert.equal(s2.processed.draftId, "ghost");
    assert.equal(s2.processed.error, "草稿不存在或無權限");
    assert.deepEqual(log.map((l) => l.id), ["d1"]);
  });
});

await check("step on an unknown batch -> 404; on a terminal batch -> done:true, nothing published", async () => {
  await live(async () => {
    const fake = plainWorld(["d1"]);
    const log = [];
    const publishOne = stubPublish(log);
    const missing = await stepPublishBatch({ serviceSupabase: fake, batchId: "nope", actorId: "u", publishOne });
    assert.equal(missing.ok, false);
    assert.equal(missing.status, 404);
    const created = await createStepwisePublishBatch({
      serviceSupabase: fake, draftIds: ["d1"], publishMode: "draft", createdBy: "u1", publishOne, now: () => NOW
    });
    batchRow(fake, created.batchId).status = "completed";
    const done = await stepPublishBatch({ serviceSupabase: fake, batchId: created.batchId, actorId: "u", publishOne });
    assert.equal(done.done, true);
    assert.equal(log.length, 0);
  });
});

await check("step: live-test guard still applies (allowlist / ACTIVE disabled)", async () => {
  const fake = plainWorld(["d1"]);
  let batchId;
  await live(async () => {
    const created = await createStepwisePublishBatch({
      serviceSupabase: fake, draftIds: ["d1"], publishMode: "active", createdBy: "u1", publishOne: stubPublish([]), now: () => NOW
    });
    batchId = created.batchId;
  });
  await live(
    async () => {
      const res = await stepPublishBatch({ serviceSupabase: fake, batchId, actorId: "u", publishOne: stubPublish([]) });
      assert.equal(res.ok, false);
      assert.equal(res.status, 403);
      assert.equal(itemRow(fake, "d1").item_status, "queued");
    },
    { SHOPIFY_ACTIVE_PUBLISH_ENABLED: "false" }
  );
});

await check("real publishDraft path: api_failed + remote ACTIVE inside a step -> item done, reconciled:true", async () => {
  await live(async () => {
    const fake = createFakeSupabase({
      product_drafts: [
        draftRow({
          id: "d1",
          status: "api_failed",
          publish_status: "api_failed",
          shopify_product_id: PRODUCT,
          error_message: "x"
        })
      ]
    });
    const shop = createShop({ remoteStatus: "ACTIVE", publishedOn: ALL_THREE });
    const publishOne = publishWith(shop);
    const created = await createStepwisePublishBatch({
      serviceSupabase: fake, draftIds: ["d1"], publishMode: "active", createdBy: "u1", publishOne, now: () => NOW
    });
    const s = await stepPublishBatch({ serviceSupabase: fake, batchId: created.batchId, actorId: "u1", publishOne, now: () => NOW });
    assert.equal(s.processed.ok, true);
    assert.equal(s.processed.reconciled, true);
    assert.equal(s.processed.productId, PRODUCT);
    assert.equal(itemRow(fake, "d1").item_status, "done");
    assert.equal(draftOf(fake, "d1").status, "active_published");
  });
});

await check("one-shot runPublishBatch (no stepwise flag) still publishes everything in one call", async () => {
  await live(async () => {
    const fake = plainWorld(["d1", "d2"]);
    const log = [];
    const res = await runPublishBatch({
      serviceSupabase: fake, draftIds: ["d1", "d2"], publishMode: "draft", createdBy: "u1",
      publishOne: stubPublish(log, { failFor: ["d2"] }), gapMs: 0, now: () => NOW
    });
    assert.equal(res.ok, true);
    assert.equal(res.succeeded, 1);
    assert.equal(res.failed, 1);
    assert.equal(res.batchStatus, "partial_failed");
    assert.equal(log.length, 2);
    assert.equal(batchRow(fake, res.batchId).status, "partial_failed");
    assert.equal(res.makeWebhook, "sent");
  });
});

// =====================================================================
// E: stale recovery
// =====================================================================
console.log("\nE — stale recovery");

const recoverOpts = (shop, extra = {}) => ({ now: () => NOW, caller: shop?.caller, ...extra });

await check("stale processing item + remote ACTIVE (active batch) -> reconciled to done, draft active_published, batch finalized", async () => {
  await live(async () => {
    const fake = seedBatch({
      updatedMinutesAgo: 8,
      items: [{ draftId: "d1", status: "processing", attempt: 3 }],
      drafts: [
        draftRow({ id: "d1", status: "api_failed", publish_status: "api_failed", shopify_product_id: PRODUCT, current_publish_batch_id: "b1" })
      ]
    });
    const shop = createShop({ remoteStatus: "ACTIVE", publishedOn: ALL_THREE });
    const before = makeCalls.length;
    const out = await recoverStalePublishBatches(fake, recoverOpts(shop, { batchId: "b1" }));
    assert.equal(out.itemsReconciled, 1);
    assert.equal(out.batchesFinalized, 1);
    assert.equal(itemRow(fake, "d1").item_status, "done");
    assert.equal(itemRow(fake, "d1").shopify_product_id, PRODUCT);
    assert.equal(itemRow(fake, "d1").error_message, null);
    assert.equal(draftOf(fake, "d1").status, "active_published");
    assert.equal(batchRow(fake).status, "completed");
    assert.equal(makeCalls.length, before + 1);
  });
});

await check("stale processing item, remote not live -> item failed + draft publishing -> api_failed (resume-able)", async () => {
  await live(async () => {
    const fake = seedBatch({
      updatedMinutesAgo: 8,
      items: [{ draftId: "d1", status: "processing", attempt: 3 }],
      drafts: [
        draftRow({ id: "d1", status: "publishing", publish_status: "publishing", shopify_product_id: PRODUCT, current_publish_batch_id: "b1" })
      ]
    });
    // reconcile must not even try to mark it live: remote is DRAFT
    const shop = createShop({ remoteStatus: "DRAFT" });
    const out = await recoverStalePublishBatches(fake, recoverOpts(shop, { batchId: "b1" }));
    assert.equal(out.itemsFailed, 1);
    assert.equal(itemRow(fake, "d1").item_status, "failed");
    assert.equal(itemRow(fake, "d1").error_message, "已自動續跑 3 次仍逾時，請到發布紀錄按「重送失敗件」");
    const draft = draftOf(fake, "d1");
    assert.equal(draft.status, "api_failed");
    assert.equal(draft.publish_status, "api_failed");
    assert.equal(draft.pipeline_stage, mapStatusToPipelineStage("api_failed"));
    assert.equal(draft.error_message, "上次發布被中斷（逾時），可在發布紀錄重試");
    assert.equal(draft.shopify_product_id, PRODUCT, "the Shopify link is kept so retry resumes the same product");
    assert.equal(batchRow(fake).status, "failed");
    assert.deepEqual(shop.mutationNames(), []);
  });
});

await check("stale item whose draft never got a product id -> failed + api_failed (no Shopify call)", async () => {
  await live(async () => {
    const fake = seedBatch({
      updatedMinutesAgo: 8,
      items: [{ draftId: "d1", status: "processing", attempt: 3 }],
      drafts: [draftRow({ id: "d1", status: "publishing", publish_status: "publishing", current_publish_batch_id: "b1" })]
    });
    const shop = createShop();
    await recoverStalePublishBatches(fake, recoverOpts(shop, { batchId: "b1" }));
    assert.equal(itemRow(fake, "d1").item_status, "failed");
    assert.equal(draftOf(fake, "d1").status, "api_failed");
    assert.equal(shop.calls.length, 0);
  });
});

await check("a draft that was never moved to publishing (killed during image prep) keeps its status", async () => {
  await live(async () => {
    const fake = seedBatch({
      updatedMinutesAgo: 8,
      items: [{ draftId: "d1", status: "processing", attempt: 3 }],
      drafts: [draftRow({ id: "d1", status: "approved", current_publish_batch_id: "b1" })]
    });
    await recoverStalePublishBatches(fake, recoverOpts(createShop(), { batchId: "b1" }));
    assert.equal(itemRow(fake, "d1").item_status, "failed");
    assert.equal(draftOf(fake, "d1").status, "approved");
  });
});

await check("a 'publishing' draft now owned by a NEWER batch is not touched", async () => {
  await live(async () => {
    const fake = seedBatch({
      updatedMinutesAgo: 8,
      items: [{ draftId: "d1", status: "processing", attempt: 3 }],
      drafts: [draftRow({ id: "d1", status: "publishing", publish_status: "publishing", current_publish_batch_id: "newer" })]
    });
    await recoverStalePublishBatches(fake, recoverOpts(createShop(), { batchId: "b1" }));
    assert.equal(itemRow(fake, "d1").item_status, "failed");
    assert.equal(draftOf(fake, "d1").status, "publishing");
  });
});

await check("a processing item that is NOT stale (batch active 1 min ago) is left alone", async () => {
  await live(async () => {
    const fake = seedBatch({
      updatedMinutesAgo: 1,
      items: [{ draftId: "d1", status: "processing" }, { draftId: "d2", status: "queued" }]
    });
    const out = await recoverStalePublishBatches(fake, recoverOpts(createShop()));
    assert.equal(out.itemsFailed + out.itemsReconciled + out.itemsSkipped + out.batchesFinalized, 0);
    assert.equal(itemRow(fake, "d1").item_status, "processing");
    assert.equal(itemRow(fake, "d2").item_status, "queued");
    assert.equal(batchRow(fake).status, "processing");
    assert.equal(fake.writes.length, 0);
  });
});

await check("draft-mode batches never reconcile (a live product there is not 'success')", async () => {
  await live(async () => {
    const fake = seedBatch({
      publishMode: "draft",
      updatedMinutesAgo: 8,
      items: [{ draftId: "d1", status: "processing", attempt: 3 }],
      drafts: [draftRow({ id: "d1", status: "publishing", publish_status: "publishing", shopify_product_id: PRODUCT, current_publish_batch_id: "b1" })]
    });
    let reconcileCalls = 0;
    await recoverStalePublishBatches(fake, {
      now: () => NOW,
      reconcile: async () => {
        reconcileCalls += 1;
        return { reconciled: true };
      }
    });
    assert.equal(reconcileCalls, 0);
    assert.equal(itemRow(fake, "d1").item_status, "failed");
  });
});

await check("idle batch (>20 min): queued items skipped 批次中斷，未執行, batch finalized, notification once", async () => {
  await live(async () => {
    const fake = seedBatch({
      updatedMinutesAgo: 21,
      items: [
        { draftId: "d1", status: "done" },
        { draftId: "d2", status: "queued" },
        { draftId: "d3", status: "queued" }
      ]
    });
    const before = makeCalls.length;
    const out = await recoverStalePublishBatches(fake, recoverOpts(createShop()));
    assert.equal(out.itemsSkipped, 2);
    assert.equal(out.batchesFinalized, 1);
    for (const id of ["d2", "d3"]) {
      assert.equal(itemRow(fake, id).item_status, "skipped");
      assert.equal(itemRow(fake, id).error_message, "批次中斷，未執行");
    }
    assert.equal(batchRow(fake).status, "partial_failed");
    assert.equal(batchRow(fake).done_count, 1);
    assert.match(batchRow(fake).error_summary, /略過 2（批次中斷）/);
    assert.equal(makeCalls.length, before + 1);
    // a second sweep (cron racing a new batch creation) must not notify again
    const again = await recoverStalePublishBatches(fake, recoverOpts(createShop()));
    assert.equal(again.batchesChecked, 0, "terminal batches are not swept");
    assert.equal(makeCalls.length, before + 1);
  });
});

await check("processing batch with 5 min idle keeps its queued items (still alive)", async () => {
  await live(async () => {
    const fake = seedBatch({
      updatedMinutesAgo: 5,
      items: [{ draftId: "d1", status: "done" }, { draftId: "d2", status: "queued" }]
    });
    const out = await recoverStalePublishBatches(fake, recoverOpts(createShop()));
    assert.equal(out.itemsSkipped, 0);
    assert.equal(itemRow(fake, "d2").item_status, "queued");
    assert.equal(batchRow(fake).status, "processing");
  });
});

await check("processing batch with zero queued/processing items -> finalized", async () => {
  await live(async () => {
    const fake = seedBatch({
      updatedMinutesAgo: 0,
      items: [{ draftId: "d1", status: "done" }, { draftId: "d2", status: "failed" }]
    });
    const out = await recoverStalePublishBatches(fake, recoverOpts(createShop()));
    assert.equal(out.batchesFinalized, 1);
    assert.equal(batchRow(fake).status, "partial_failed");
  });
});

await check("a header whose items are not inserted yet is not closed prematurely", async () => {
  await live(async () => {
    const fake = seedBatch({ updatedMinutesAgo: 0, items: [] });
    const out = await recoverStalePublishBatches(fake, recoverOpts(createShop()));
    assert.equal(out.batchesFinalized, 0);
    assert.equal(batchRow(fake).status, "processing");
  });
});

await check("step route recovers a killed item first, then continues with the next queued one", async () => {
  await live(async () => {
    const fake = seedBatch({
      updatedMinutesAgo: 8,
      items: [
        { draftId: "d1", status: "processing", attempt: 3 },
        { draftId: "d2", status: "queued" }
      ],
      drafts: [
        draftRow({ id: "d1", status: "publishing", publish_status: "publishing", current_publish_batch_id: "b1" }),
        draftRow({ id: "d2" })
      ]
    });
    const log = [];
    const res = await stepPublishBatch({
      serviceSupabase: fake, batchId: "b1", actorId: "u1", publishOne: stubPublish(log), now: () => NOW
    });
    assert.equal(itemRow(fake, "d1").item_status, "failed");
    assert.equal(itemRow(fake, "d1").error_message, "已自動續跑 3 次仍逾時，請到發布紀錄按「重送失敗件」");
    assert.equal(draftOf(fake, "d1").status, "api_failed");
    assert.equal(res.processed.draftId, "d2");
    assert.equal(res.processed.ok, true);
    assert.equal(batchRow(fake).status, "processing");
  });
});

await check("step route on a batch that died long ago closes it (queued skipped, finalized) and answers done", async () => {
  await live(async () => {
    const fake = seedBatch({
      updatedMinutesAgo: 30,
      items: [{ draftId: "d1", status: "done" }, { draftId: "d2", status: "queued" }]
    });
    const log = [];
    const res = await stepPublishBatch({
      serviceSupabase: fake, batchId: "b1", actorId: "u1", publishOne: stubPublish(log), now: () => NOW
    });
    assert.equal(res.done, true);
    assert.equal(log.length, 0, "nothing is published after the abandon window");
    assert.equal(itemRow(fake, "d2").item_status, "skipped");
    assert.equal(batchRow(fake).status, "partial_failed");
  });
});

await check("recoverStalePublishBatchesBestEffort: mock mode does nothing (dry runs stay write-free)", async () => {
  const fake = seedBatch({ updatedMinutesAgo: 30, items: [{ draftId: "d1", status: "processing" }] });
  await withEnv({ SHOPIFY_PUBLISH_MOCK: "true" }, async () => {
    const out = await recoverStalePublishBatchesBestEffort(fake, { now: () => NOW });
    assert.equal(out, null);
    assert.equal(fake.writes.length, 0);
  });
  const swallowed = await recoverStalePublishBatchesBestEffort(
    { from() { throw new Error("db down"); } },
    { mockMode: false, now: () => NOW }
  );
  assert.equal(swallowed, null, "never throws into the caller");
});

// =====================================================================
// F: client helper
// =====================================================================
console.log("\nF — client helper (runStepwisePublishBatch)");

/** Routes the helper's fetch calls into the REAL create/step functions over a fake DB. */
function serverFetch(fake, { publishOne, failStepCalls = [], mockMode = false, createFail = null } = {}) {
  const calls = { create: 0, step: 0 };
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetchImpl = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    if (url === "/api/drafts/batch/publish") {
      calls.create += 1;
      if (createFail) return json(createFail.status, createFail.body);
      assert.equal(body.stepwise, true, "the helper always asks for stepwise mode");
      const created = await createStepwisePublishBatch({
        serviceSupabase: fake, draftIds: body.draftIds, publishMode: body.publishMode, createdBy: "u1",
        publishOne, now: () => NOW, mockMode
      });
      if (!created.ok) return json(created.status, { error: created.error, hint: created.hint });
      if ("total" in created) return json(200, { ...created, stepwise: true });
      return json(200, {
        ok: true, mock: true, batchId: created.batchId, batchStatus: created.batchStatus,
        succeeded: created.succeeded, failed: created.failed, skipped: created.skipped,
        results: created.results.map((r) => ({ id: r.draftId, ok: r.ok, error: r.error, mock: r.mock, itemStatus: r.itemStatus })),
        message: created.message
      });
    }
    const m = /^\/api\/publish-batches\/([^/]+)\/step$/.exec(url);
    assert.ok(m, `unexpected url ${url}`);
    calls.step += 1;
    if (failStepCalls.includes(calls.step)) throw new TypeError("network down");
    const result = await stepPublishBatch({
      serviceSupabase: fake, batchId: m[1], actorId: "u1", publishOne, now: () => NOW
    });
    if (!result.ok) return json(result.status, { error: result.error });
    return json(200, result);
  };
  return { fetchImpl, calls };
}

const noSleep = async () => {};

await check("aggregates the stepwise run into the OLD batch response shape + progress text", async () => {
  await live(async () => {
    const fake = plainWorld(["d1", "d2", "d3"]);
    const publishOne = stubPublish([], { failFor: ["d2"] });
    const { fetchImpl, calls } = serverFetch(fake, { publishOne });
    const progress = [];
    const out = await runStepwisePublishBatch({
      draftIds: ["d1", "d2", "d3"], publishMode: "active", confirmActive: true,
      onProgress: (p) => progress.push(p.text), fetchImpl, sleep: noSleep
    });
    assert.equal(out.ok, true);
    assert.equal(out.mock, false);
    assert.ok(out.batchId && out.batchId !== "mock-dry-run");
    assert.equal(out.batchStatus, "partial_failed");
    assert.equal(out.succeeded, 2);
    assert.equal(out.failed, 1);
    assert.equal(out.skipped, 0);
    assert.deepEqual(out.results.map((r) => r.id), ["d1", "d2", "d3"]);
    assert.deepEqual(out.results.map((r) => r.ok), [true, false, true]);
    assert.equal(out.results[1].error, "fail d2");
    assert.equal(out.results[0].productId, "gid://shopify/Product/d1");
    assert.equal(out.results[0].itemStatus, "done");
    assert.match(out.message, /成功 2 筆／失敗 1 筆/);
    assert.equal(calls.create, 1);
    assert.equal(calls.step, 4, "3 items + 1 finishing call");
    assert.deepEqual(progress.slice(0, 1), ["發布中 0/3…（請勿關閉此頁）"]);
    assert.ok(progress.includes("發布中 1/3…（請勿關閉此頁）") && progress.includes("發布中 2/3…（請勿關閉此頁）") && progress.includes("發布中 3/3…（請勿關閉此頁）"));
  });
});

await check("a step request that fails at network level is retried (up to 2x) and the run still completes", async () => {
  await live(async () => {
    const fake = plainWorld(["d1", "d2"]);
    const { fetchImpl, calls } = serverFetch(fake, { publishOne: stubPublish([]), failStepCalls: [2, 3] });
    const out = await runStepwisePublishBatch({
      draftIds: ["d1", "d2"], publishMode: "draft", fetchImpl, sleep: noSleep
    });
    assert.equal(out.ok, true);
    assert.equal(out.succeeded, 2);
    assert.equal(calls.step, 3 + 2, "2 failed attempts + 3 normal calls");
    assert.equal(batchRow(fake, out.batchId).status, "completed");
  });
});

await check("a step that keeps failing is skipped (server recovery settles it); other items still run", async () => {
  await live(async () => {
    const fake = plainWorld(["d1", "d2"]);
    // step calls 1..3 are all attempts of the FIRST logical step -> that logical step is given up on
    const { fetchImpl } = serverFetch(fake, { publishOne: stubPublish([]), failStepCalls: [1, 2, 3] });
    const out = await runStepwisePublishBatch({
      draftIds: ["d1", "d2"], publishMode: "draft", fetchImpl, sleep: noSleep
    });
    assert.equal(out.ok, true, "the batch itself continued");
    assert.equal(out.succeeded, 2);
  });
});

await check("server totally unreachable for 3 logical steps -> ok:false with an honest message", async () => {
  await live(async () => {
    const fake = plainWorld(["d1"]);
    const { fetchImpl } = serverFetch(fake, { publishOne: stubPublish([]), failStepCalls: Array.from({ length: 30 }, (_, i) => i + 1) });
    const out = await runStepwisePublishBatch({ draftIds: ["d1"], publishMode: "draft", fetchImpl, sleep: noSleep });
    assert.equal(out.ok, false);
    assert.match(out.error, /發布紀錄/);
    assert.equal(out.results.length, 1);
    assert.equal(out.results[0].ok, false, "an unreported item is never shown as success");
  });
});

await check("mock mode: create answers with the dry-run result, no step calls, nothing written", async () => {
  await withEnv({ ...LIVE, SHOPIFY_PUBLISH_MOCK: "true" }, async () => {
    const fake = plainWorld(["d1", "d2"]);
    const publishOne = async (_c, id) =>
      id === "d2"
        ? { ok: false, status: 409, error: "blocked" }
        : { ok: true, mock: true, payload: {}, productId: null, adminUrl: null, mockNotes: [] };
    const { fetchImpl, calls } = serverFetch(fake, { publishOne, mockMode: true });
    const out = await runStepwisePublishBatch({ draftIds: ["d1", "d2"], publishMode: "draft", fetchImpl, sleep: noSleep });
    assert.equal(out.ok, true);
    assert.equal(out.mock, true);
    assert.equal(out.batchId, "mock-dry-run");
    assert.equal(out.succeeded, 1);
    assert.equal(out.failed, 1);
    assert.match(out.message, /【模擬】/);
    assert.equal(calls.step, 0);
    assert.equal(fake.writes.length, 0);
  });
});

await check("create failures surface as ok:false with the server error + hint (old response.ok=false path)", async () => {
  const out = await runStepwisePublishBatch({
    draftIds: ["d1"], publishMode: "active", sleep: noSleep,
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: "Reviewer role is required to publish", hint: "h" }) })
  });
  assert.equal(out.ok, false);
  assert.equal(out.status, 403);
  assert.equal(out.error, "Reviewer role is required to publish");
  assert.equal(out.hint, "h");
  const net = await runStepwisePublishBatch({
    draftIds: ["d1"], publishMode: "active", sleep: noSleep,
    fetchImpl: async () => { throw new TypeError("offline"); }
  });
  assert.equal(net.ok, false);
});

await check("waiting on another tab: polls (does not give up) until that item finishes", async () => {
  await live(async () => {
    const fake = plainWorld(["d1"]);
    const publishOne = stubPublish([], { delayMs: 20 });
    const created = await createStepwisePublishBatch({
      serviceSupabase: fake, draftIds: ["d1"], publishMode: "draft", createdBy: "u1", publishOne, now: () => NOW
    });
    // "another tab" is publishing d1 while this helper drives the same batch
    const other = stepPublishBatch({ serviceSupabase: fake, batchId: created.batchId, actorId: "u2", publishOne, now: () => NOW });
    const handler = serverFetch(fake, { publishOne });
    const out = await runStepwisePublishBatch({
      draftIds: ["d1"], publishMode: "draft", sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))),
      fetchImpl: async (url, init) => {
        if (url === "/api/drafts/batch/publish") {
          return { ok: true, status: 200, json: async () => ({ ok: true, mock: false, batchId: created.batchId, total: 1, items: [{ draftId: "d1" }] }) };
        }
        return handler.fetchImpl(url, init);
      }
    });
    await other;
    assert.equal(out.ok, true);
    assert.equal(out.succeeded, 1);
    assert.equal(out.failed, 0);
  });
});

// =====================================================================
// L: PUBLISH-LITE (attempt counting, auto-resume, preflight, continue, media ids)
// =====================================================================
console.log("\nL — PUBLISH-LITE");

const MAX_EXHAUSTED = "已自動續跑 3 次仍逾時，請到發布紀錄按「重送失敗件」";

await check("L1 claim writes attempt_count+1 and started_at; a CAS loser changes nothing", async () => {
  await live(async () => {
    const fake = seedBatch({ items: [{ draftId: "d1" }, { draftId: "d2" }] });
    let during = null;
    const publishOne = async (_c, id) => {
      during = { ...itemRow(fake, id) };
      await new Promise((r) => setTimeout(r, 20));
      return { ok: true, productId: `gid://shopify/Product/${id}`, adminUrl: null };
    };
    const winner = stepPublishBatch({ serviceSupabase: fake, batchId: "b1", actorId: "u1", publishOne, now: () => NOW });
    const loser = stepPublishBatch({ serviceSupabase: fake, batchId: "b1", actorId: "u2", publishOne, now: () => NOW });
    const [a, b] = await Promise.all([winner, loser]);
    assert.equal(during.item_status, "processing");
    assert.equal(during.attempt_count, 1);
    assert.equal(during.started_at, new Date(NOW).toISOString());
    assert.equal([a, b].filter((r) => r.processed).length, 1, "only one request published");
    assert.equal(itemRow(fake, "d1").attempt_count, 1, "the loser did not bump the counter");
    assert.equal(itemRow(fake, "d2").attempt_count, 0, "the next item was not touched");

    // The claim is a CAS on attempt_count too: a stale read cannot win.
    const stale = seedBatch({ items: [{ draftId: "d1" }] });
    const realFrom = stale.from;
    let raced = false;
    stale.from = (table) => {
      const api = realFrom(table);
      if (table !== "publish_batch_items") return api;
      const realThen = api.then;
      const realLimit = api.limit;
      let isClaimRead = false;
      api.limit = (count) => {
        isClaimRead = true; // only the claim's candidate read uses limit(1)
        return realLimit.call(api, count);
      };
      api.then = (resolve, reject) =>
        realThen.call(
          api,
          (res) => {
            if (!raced && isClaimRead && Array.isArray(res?.data) && res.data[0]?.item_status === "queued") {
              raced = true;
              // the caller keeps its (now stale) copy of the row
              res = { ...res, data: res.data.map((row) => ({ ...row })) };
              itemRow(stale, "d1").attempt_count = 1; // somebody else claimed + requeued meanwhile
            }
            return resolve(res);
          },
          reject
        );
      return api;
    };
    const log = [];
    const lost = await stepPublishBatch({
      serviceSupabase: stale, batchId: "b1", actorId: "u1", publishOne: stubPublish(log), now: () => NOW
    });
    assert.equal(raced, true);
    assert.equal(log.length, 0, "CAS loser never publishes");
    assert.equal(lost.processed, null);
    assert.equal(itemRow(stale, "d1").item_status, "queued");
    assert.equal(itemRow(stale, "d1").attempt_count, 1);
  });
});

await check("L2 per-item clock: <6.5 min untouched; stale + attempt<3 -> queued + draft api_failed; 3rd -> failed", async () => {
  await live(async () => {
    // started 6 min ago (batch itself is old): still inside the window
    const young = seedBatch({
      updatedMinutesAgo: 9,
      items: [{ draftId: "d1", status: "processing", attempt: 1, startedMinutesAgo: 6 }],
      drafts: [draftRow({ id: "d1", status: "publishing", publish_status: "publishing", shopify_product_id: PRODUCT, current_publish_batch_id: "b1" })]
    });
    const none = await recoverStalePublishBatches(young, recoverOpts(createShop({ remoteStatus: "DRAFT" }), { batchId: "b1" }));
    assert.equal(none.itemsRequeued + none.itemsFailed + none.itemsReconciled, 0);
    assert.equal(itemRow(young, "d1").item_status, "processing");
    assert.equal(young.writes.length, 0);

    // started 7 min ago, batch header fresh: the item's own started_at decides
    const dead = seedBatch({
      updatedMinutesAgo: 1,
      items: [{ draftId: "d1", status: "processing", attempt: 1, startedMinutesAgo: 7 }],
      drafts: [draftRow({ id: "d1", status: "publishing", publish_status: "publishing", shopify_product_id: PRODUCT, current_publish_batch_id: "b1" })]
    });
    const out = await recoverStalePublishBatches(dead, recoverOpts(createShop({ remoteStatus: "DRAFT" }), { batchId: "b1" }));
    assert.equal(out.itemsRequeued, 1);
    assert.equal(out.itemsFailed, 0);
    const item = itemRow(dead, "d1");
    assert.equal(item.item_status, "queued");
    assert.equal(item.error_message, "上次發布逾時，系統自動續跑（第 1 次）");
    assert.equal(item.started_at, null);
    assert.equal(item.attempt_count, 1, "the counter is only bumped by a claim");
    assert.equal(draftOf(dead, "d1").status, "api_failed");
    assert.equal(draftOf(dead, "d1").shopify_product_id, PRODUCT);
    assert.equal(batchRow(dead).status, "processing", "the batch stays open");

    // the next step claims the SAME item again (attempt 2) before anything later
    dead.tables.publish_batch_items.push({
      id: "item-d2", batch_id: "b1", draft_id: "d2", item_status: "queued", error_message: null,
      attempt_count: 0, started_at: null, created_at: minutesAgo(1)
    });
    dead.tables.product_drafts.push(draftRow({ id: "d2" }));
    const log = [];
    const res = await stepPublishBatch({
      serviceSupabase: dead, batchId: "b1", actorId: "u1", publishOne: stubPublish(log), now: () => NOW
    });
    assert.equal(res.processed.draftId, "d1");
    assert.equal(itemRow(dead, "d1").attempt_count, 2);
    assert.equal(itemRow(dead, "d2").item_status, "queued");

    // third attempt dies too: failed with the new wording
    const last = seedBatch({
      updatedMinutesAgo: 1,
      items: [{ draftId: "d1", status: "processing", attempt: 3, startedMinutesAgo: 7 }],
      drafts: [draftRow({ id: "d1", status: "publishing", publish_status: "publishing", shopify_product_id: PRODUCT, current_publish_batch_id: "b1" })]
    });
    const done = await recoverStalePublishBatches(last, recoverOpts(createShop({ remoteStatus: "DRAFT" }), { batchId: "b1" }));
    assert.equal(done.itemsFailed, 1);
    assert.equal(done.itemsRequeued, 0);
    assert.equal(itemRow(last, "d1").item_status, "failed");
    assert.equal(itemRow(last, "d1").error_message, MAX_EXHAUSTED);
    assert.equal(draftOf(last, "d1").status, "api_failed");
    assert.equal(batchRow(last).status, "failed");
  });
});

await check("L3 ACTIVE reconcile still wins over auto-resume", async () => {
  await live(async () => {
    const fake = seedBatch({
      updatedMinutesAgo: 1,
      items: [{ draftId: "d1", status: "processing", attempt: 1, startedMinutesAgo: 8 }],
      drafts: [draftRow({ id: "d1", status: "api_failed", publish_status: "api_failed", shopify_product_id: PRODUCT, current_publish_batch_id: "b1" })]
    });
    const shop = createShop({ remoteStatus: "ACTIVE", publishedOn: ALL_THREE });
    const out = await recoverStalePublishBatches(fake, recoverOpts(shop, { batchId: "b1" }));
    assert.equal(out.itemsReconciled, 1);
    assert.equal(out.itemsRequeued, 0);
    assert.equal(itemRow(fake, "d1").item_status, "done");
    assert.equal(draftOf(fake, "d1").status, "active_published");
  });
});

await check("L4 preflight: blocked draft fails up front (no publishOne, draft untouched); others run; preflightBlocked returned", async () => {
  await live(async () => {
    const fake = createFakeSupabase({
      product_drafts: ["d1", "d2", "d3"].map((id) => draftRow({ id, title_zh: `商品 ${id}` })),
      product_variants: [
        { id: "v1", draft_id: "d2", option1_value: "勿拍", twd_price: 100, sort_order: 0 },
        { id: "v2", draft_id: "d2", option1_value: "紅色", twd_price: 100, sort_order: 1 },
        { id: "v3", draft_id: "d1", option1_value: "紅色", twd_price: 100, sort_order: 0 }
      ]
    });
    const created = await createStepwisePublishBatch({
      serviceSupabase: fake, draftIds: ["d1", "d2", "d3"], publishMode: "draft", createdBy: "u1", now: () => NOW
    });
    assert.equal(created.ok, true);
    assert.equal(created.preflightBlocked.length, 1);
    assert.equal(created.preflightBlocked[0].draftId, "d2");
    assert.equal(created.preflightBlocked[0].title, "商品 d2");
    assert.match(created.preflightBlocked[0].error, /^發布前檢查擋下：/);
    assert.match(created.preflightBlocked[0].error, /勿拍/);
    assert.equal(itemRow(fake, "d2").item_status, "failed");
    assert.equal(itemRow(fake, "d2").error_message, created.preflightBlocked[0].error);
    assert.ok(itemRow(fake, "d2").completed_at);
    assert.equal(itemRow(fake, "d1").item_status, "queued");
    assert.equal(itemRow(fake, "d3").item_status, "queued");
    assert.equal(draftOf(fake, "d2").status, "approved", "the blocked draft is not moved");
    const log = [];
    let last;
    for (let i = 0; i < 6; i += 1) {
      last = await stepPublishBatch({
        serviceSupabase: fake, batchId: created.batchId, actorId: "u1", publishOne: stubPublish(log), now: () => NOW
      });
      if (last.done) break;
    }
    assert.deepEqual(log.map((c) => c.id), ["d1", "d3"], "publishOne never sees the blocked draft");
    assert.equal(last.done, true);
    assert.equal(batchRow(fake, created.batchId).status, "partial_failed");
    assert.equal(batchRow(fake, created.batchId).done_count, 2);
    assert.equal(batchRow(fake, created.batchId).failed_count, 1);
  });
});

/** Clock-driven server: sleep() advances `clock`, so waiting out the stale window is instant. */
function clockServer(fake, publishOne, clock, { killFirstStepFor = null } = {}) {
  const calls = { create: 0, step: 0, urls: [] };
  let killed = false;
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetchImpl = async (url) => {
    calls.urls.push(url);
    if (url === "/api/drafts/batch/publish") {
      calls.create += 1;
      return json(500, { error: "create must not be called" });
    }
    const m = /^\/api\/publish-batches\/([^/]+)\/step$/.exec(url);
    calls.step += 1;
    if (killFirstStepFor && !killed) {
      killed = true;
      // the function claimed the item, then Vercel killed it: 504 with no JSON
      const row = itemRow(fake, killFirstStepFor);
      row.item_status = "processing";
      row.attempt_count += 1;
      row.started_at = new Date(clock.t).toISOString();
      draftOf(fake, killFirstStepFor).status = "publishing";
      draftOf(fake, killFirstStepFor).publish_status = "publishing";
      return json(504, null);
    }
    const result = await stepPublishBatch({
      serviceSupabase: fake, batchId: m[1], actorId: "u1", publishOne, now: () => clock.t
    });
    return json(result.ok ? 200 : result.status, result);
  };
  return { fetchImpl, calls };
}

await check("L5 client: killed step (504) -> waits, item returns to queued, SAME item continues (no skip); no-progress timeout stops", async () => {
  await live(async () => {
    const clock = { t: NOW };
    const fake = seedBatch({ publishMode: "draft", items: [{ draftId: "d1" }, { draftId: "d2" }] });
    const log = [];
    const server = clockServer(fake, stubPublish(log), clock, { killFirstStepFor: "d1" });
    const out = await continueStepwisePublishBatch({
      batchId: "b1", total: 2, draftIds: ["d1", "d2"], fetchImpl: server.fetchImpl,
      sleep: async (ms) => { clock.t += ms; }, now: () => clock.t
    });
    assert.equal(out.ok, true);
    assert.equal(out.succeeded, 2);
    assert.deepEqual(log.map((c) => c.id), ["d1", "d2"], "d1 resumed first, d2 not started early");
    assert.equal(itemRow(fake, "d1").attempt_count, 2);
    assert.equal(itemRow(fake, "d2").attempt_count, 1);
    assert.equal(itemRow(fake, "d1").item_status, "done");
    assert.ok(clock.t - NOW >= 390_000, "the client really waited out the stale window");
    assert.equal(batchRow(fake).status, "completed");
  });

  // Nothing ever changes: the client gives up only after PUBLISH_STALE_ITEM_MS + 120s of no progress.
  const clock = { t: NOW };
  let calls = 0;
  const idle = await continueStepwisePublishBatch({
    batchId: "b1", total: 1, draftIds: ["d1"],
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true, status: 200,
        json: async () => ({
          ok: true, done: false, processed: null, batchStatus: "processing",
          counts: { total: 1, done: 0, failed: 0, skipped: 0, queued: 0, processing: 1 }
        })
      };
    },
    sleep: async (ms) => { clock.t += ms; }, now: () => clock.t
  });
  assert.equal(idle.ok, false);
  assert.equal(idle.stoppedEarly, true);
  assert.ok(clock.t - NOW > batchHelpers.PUBLISH_STALE_ITEM_MS + 120_000, "waited the full window");
  assert.ok(clock.t - NOW < batchHelpers.PUBLISH_STALE_ITEM_MS + 120_000 + 10_000, "and stopped right after it");
  assert.ok(calls > 50, "polling, not a fixed small iteration count");
});

await check("L6 continueStepwisePublishBatch never calls the create API; runStepwise writes preflightBlocked into results", async () => {
  await live(async () => {
    const fake = seedBatch({ publishMode: "draft", items: [{ draftId: "d1" }, { draftId: "d2" }] });
    const { fetchImpl, calls } = serverFetch(fake, { publishOne: stubPublish([]) });
    const urls = [];
    const out = await continueStepwisePublishBatch({
      batchId: "b1", total: 2, draftIds: ["d1", "d2"], sleep: noSleep,
      fetchImpl: async (url, init) => { urls.push(url); return fetchImpl(url, init); }
    });
    assert.equal(out.ok, true);
    assert.equal(out.succeeded, 2);
    assert.equal(calls.create, 0);
    assert.ok(!urls.includes("/api/drafts/batch/publish"));
    assert.ok(urls.every((u) => u === "/api/publish-batches/b1/step"));

    const world = createFakeSupabase({
      product_drafts: ["d1", "d2"].map((id) => draftRow({ id, title_zh: `商品 ${id}` })),
      product_variants: [{ id: "v1", draft_id: "d2", option1_value: "補差價", twd_price: 100, sort_order: 0 }]
    });
    const handler = serverFetch(world, { publishOne: stubPublish([]) });
    const run = await runStepwisePublishBatch({
      draftIds: ["d1", "d2"], publishMode: "draft", fetchImpl: handler.fetchImpl, sleep: noSleep
    });
    assert.equal(run.ok, true);
    const blocked = run.results.find((r) => r.id === "d2");
    assert.equal(blocked.ok, false);
    assert.equal(blocked.itemStatus, "failed");
    assert.match(blocked.error, /^發布前檢查擋下：/);
    assert.equal(run.succeeded, 1);
    assert.equal(run.failed, 1);
  });
});

await check("L7 maxDuration literals equal PUBLISH_STEP_MAX_SECONDS; stale window > the max duration", () => {
  const literal = (rel) => {
    const m = /^export const maxDuration = (\d+);$/m.exec(read(rel));
    assert.ok(m, `${rel} needs a literal maxDuration`);
    return Number(m[1]);
  };
  const seconds = batchHelpers.PUBLISH_STEP_MAX_SECONDS;
  assert.equal(literal("src/app/api/publish-batches/[batchId]/step/route.ts"), seconds);
  assert.equal(literal("src/app/api/drafts/[id]/publish/route.ts"), seconds);
  assert.equal(seconds, 300);
  assert.ok(batchHelpers.PUBLISH_STALE_ITEM_MS > seconds * 1000);
  assert.equal(batchHelpers.PUBLISH_STALE_ITEM_MS, 390_000);
  assert.equal(batchHelpers.PUBLISH_IDLE_BATCH_MS, 20 * 60_000);
  assert.equal(batchHelpers.PUBLISH_MAX_ATTEMPTS, 3);
});

await check("L8 media ids are written back in order; count mismatch -> warning only; one failed write -> warning only", async () => {
  const inputs = [
    { originalSource: "https://img.test/a.jpg", mediaContentType: "IMAGE" },
    { originalSource: "https://img.test/b.jpg", mediaContentType: "IMAGE" },
    { originalSource: "https://img.test/c.jpg", mediaContentType: "IMAGE" },
    { originalSource: "https://video.test/v", mediaContentType: "EXTERNAL_VIDEO" }
  ];
  const nodes = [
    { id: "gid://shopify/MediaImage/1", mediaContentType: "IMAGE" },
    { id: "gid://shopify/MediaImage/2", mediaContentType: "IMAGE" },
    { id: "gid://shopify/MediaImage/3", mediaContentType: "IMAGE" },
    { id: "gid://shopify/Video/9", mediaContentType: "EXTERNAL_VIDEO" }
  ];
  const seedImages = () => [
    { id: "i1", draft_id: "d1", image_type: "main", sort_order: 0 },
    { id: "i2", draft_id: "d1", image_type: "main", sort_order: 1 },
    { id: "i3", draft_id: "d1", image_type: "variant", sort_order: 2 }
  ];
  const imageUpdates = (fake) => fake.writes.filter((w) => w.table === "product_images" && w.op === "update");

  const fake = createFakeSupabase({ product_images: seedImages() });
  const warnings = await writeBackMediaIds(fake, fake.tables.product_images, inputs, nodes);
  assert.deepEqual(warnings, []);
  assert.deepEqual(
    imageUpdates(fake).map((w) => w.payload),
    ["a", "b", "c"].map((name, i) => ({
      shopify_media_id: `gid://shopify/MediaImage/${i + 1}`,
      shopify_source_hash: hashSource(`https://img.test/${name}.jpg`)
    }))
  );

  // already identical -> skipped (no writes)
  const again = createFakeSupabase({ product_images: seedImages() });
  const done = again.tables.product_images.map((row, i) => ({
    ...row,
    shopify_media_id: `gid://shopify/MediaImage/${i + 1}`,
    shopify_source_hash: hashSource(inputs[i].originalSource)
  }));
  assert.deepEqual(await writeBackMediaIds(again, done, inputs, nodes), []);
  assert.equal(imageUpdates(again).length, 0);

  // count mismatch -> one warning, zero writes
  const mismatch = createFakeSupabase({ product_images: seedImages() });
  const short = await writeBackMediaIds(mismatch, mismatch.tables.product_images, inputs, nodes.slice(1));
  assert.deepEqual(short, ["圖片編號未寫回：數量不一致"]);
  assert.equal(imageUpdates(mismatch).length, 0);

  // one write fails -> warning, the others still land
  const flaky = createFakeSupabase({ product_images: seedImages() });
  flaky.failNext({ table: "product_images", op: "update" });
  const partial = await writeBackMediaIds(flaky, flaky.tables.product_images, inputs, nodes);
  assert.equal(partial.length, 1);
  assert.match(partial[0], /圖片編號未寫回/);
  assert.equal(imageUpdates(flaky).length, 3);
  assert.equal(flaky.tables.product_images[1].shopify_media_id, "gid://shopify/MediaImage/2");

  // wiring: the media mutation asks for the nodes and the helper runs after a successful attach
  const safe = read("src/lib/shopify/publishDraftSafe.ts");
  assert.match(safe, /media\(first: 250\) \{ nodes \{ id mediaContentType \} \}/);
  assert.match(safe, /writeBackMediaIds\(serviceSupabase, mediaRows, mediaInputs, attachedMediaNodes\)/);
});

// =====================================================================
// G: static wiring
// =====================================================================
console.log("\nG — static wiring");

await check("batch callers use the stepwise helper instead of one long request", () => {
  for (const rel of [
    "src/components/listing/DraftResultsPanel.tsx",
    "src/components/drafts/DraftQueueList.tsx",
    "src/components/records/PublishRecordsPanel.tsx"
  ]) {
    const text = read(rel);
    assert.match(text, /runStepwisePublishBatch/, `${rel} uses the helper`);
    assert.match(text, /from "@\/lib\/drafts\/publishBatchClient"/);
    assert.doesNotMatch(text, /fetch\(\s*["']\/api\/drafts\/batch\/publish["']/, `${rel} no longer posts the whole batch in one request`);
    assert.match(text, /onProgress/);
  }
  const helper = read("src/lib/drafts/publishBatchClient.ts");
  assert.match(helper, /stepwise: true/);
  assert.match(helper, /\/api\/publish-batches\/\$\{batchId\}\/step/);
  assert.match(helper, /發布中 \$\{/);
  // the single-card path keeps its one request
  assert.match(read("src/components/listing/ResultCard.tsx"), /\/api\/drafts\/\$\{[^}]+\}\/publish/);
});

await check("routes: step (nodejs/300s/canPublish), stepwise flag on the batch route, reconcile route", () => {
  const step = read("src/app/api/publish-batches/[batchId]/step/route.ts");
  assert.match(step, /export const runtime = "nodejs"/);
  assert.match(step, /export const maxDuration = 300/);
  assert.match(step, /canPublish/);
  assert.match(step, /stepPublishBatch/);
  const batch = read("src/app/api/drafts/batch/publish/route.ts");
  assert.match(batch, /body\.stepwise === true/);
  assert.match(batch, /createStepwisePublishBatch/);
  assert.match(batch, /runPublishBatch/);
  assert.match(batch, /recoverStalePublishBatchesBestEffort/);
  const rec = read("src/app/api/drafts/[id]/reconcile-shopify/route.ts");
  assert.match(rec, /canPublish/);
  assert.match(rec, /reconcileDraftWithShopify/);
  assert.match(rec, /checkLiveTestGuard/);
});

await check("stuck-batches cron also sweeps publish_batches and keeps the image-batch scan", () => {
  const cron = read("src/app/api/cron/stuck-batches/route.ts");
  assert.match(cron, /scanStuckBatches\(\{ catchUpTerminal: true \}\)/);
  assert.match(cron, /recoverStalePublishBatches/);
  assert.match(cron, /publishBatches/);
});

await check("publishDraft gate: reconcile only in active mode; no manual-only dead end for api_failed+ACTIVE", () => {
  const text = read("src/lib/shopify/publishDraftSafe.ts");
  assert.match(text, /reconcileDraftWithShopify\(serviceSupabase, id, caller\)/);
  assert.match(text, /publishMode === "active"/);
  assert.match(text, /RECONCILED_CODE/);
  assert.doesNotMatch(read("src/lib/shopify/reconcileDraft.ts"), /\.delete\(|unpublish|publishableUnpublish/);
});

await check("records panel: 對帳 button wired to /reconcile-shopify (Button, no !important)", () => {
  const panel = read("src/components/records/PublishRecordsPanel.tsx");
  assert.match(panel, /對帳/);
  assert.match(panel, /\/reconcile-shopify/);
  assert.doesNotMatch(panel, /!important/);
});

await check("package.json + verify-all register verify:publish-batch", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["verify:publish-batch"], "node scripts/verify-publish-batch.mjs");
  assert.match(read("scripts/verify-all.mjs"), /scripts\/verify-publish-batch\.mjs/);
});

await check("no verifier path touched the real network", () => {
  assert.deepEqual(blockedFetches, []);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.error(`\nFAIL: ${f.name}\n${f.err.stack}`);
  process.exit(1);
}
console.log("PUBLISH-BATCH checks passed");
