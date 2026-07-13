/**
 * D7-open verification (no secrets / no live Shopify).
 *
 * - Pure helpers: gap, time budget, summarize status, snapshot, messages
 * - Static wiring: runPublishBatch, thin publish routes, records UI, migration 027
 * - No HTTP self-fetch; publishDraft GraphQL not reimplemented in batch runner
 *
 * Run: node scripts/verify-d7-publish-batch.mjs
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

// --- Inline mirrors of pure helpers (keep in sync with publishBatch.ts) ---

const DEFAULT_PUBLISH_ITEM_GAP_MS = 600;
const PUBLISH_BATCH_DEADLINE_MS = 60_000;
const PUBLISH_BATCH_MIN_REMAINING_MS = 8_000;
const TIME_BUDGET_SKIP_REASON = "時間不足略過（time_budget）";

function resolvePublishItemGapMs(envValue) {
  if (envValue == null || String(envValue).trim() === "") return DEFAULT_PUBLISH_ITEM_GAP_MS;
  const n = Number(envValue);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_PUBLISH_ITEM_GAP_MS;
  return Math.floor(n);
}

function remainingBudgetMs(startedAtMs, nowMs, deadlineMs = PUBLISH_BATCH_DEADLINE_MS) {
  return deadlineMs - (nowMs - startedAtMs);
}

function shouldStopForTimeBudget(startedAtMs, nowMs, opts = {}) {
  const deadlineMs = opts.deadlineMs ?? PUBLISH_BATCH_DEADLINE_MS;
  const minRemainingMs = opts.minRemainingMs ?? PUBLISH_BATCH_MIN_REMAINING_MS;
  return remainingBudgetMs(startedAtMs, nowMs, deadlineMs) < minRemainingMs;
}

function summarizePublishBatchStatus(counts) {
  const total = Math.max(0, counts.total);
  const done = Math.max(0, counts.done);
  const failed = Math.max(0, counts.failed);
  const skipped =
    counts.skipped != null ? Math.max(0, counts.skipped) : Math.max(0, total - done - failed);

  if (total === 0) return "failed";
  if (done === total) return "completed";
  if (failed === total) return "failed";
  if (done === 0 && failed === 0 && skipped >= total) return "failed";
  if (done === 0) return "failed";
  return "partial_failed";
}

function buildPublishSnapshot(items) {
  return items.map((item) => ({
    draftId: item.draftId,
    title: (item.title || "未命名草稿").trim() || "未命名草稿"
  }));
}

function filterPublishBatches(rows, filter) {
  if (filter === "has_failed") {
    return rows.filter(
      (r) => r.failed_count > 0 || r.status === "failed" || r.status === "partial_failed"
    );
  }
  return rows;
}

function failedDraftIdsFromItems(items) {
  return items.filter((i) => i.item_status === "failed").map((i) => i.draft_id);
}

function isMissingPublishBatchesError(message) {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("publish_batches") ||
    m.includes("publish_batch_items") ||
    m.includes("current_publish_batch_id") ||
    m.includes("schema cache") ||
    (m.includes("does not exist") && m.includes("publish"))
  );
}

console.log("\nD7-open verify-d7-publish-batch\n");

await check("migration 027 exists with publish_batches + items + current_publish_batch_id", () => {
  assert.ok(exists("supabase/migrations/027_publish_batches.sql"));
  const sql = read("supabase/migrations/027_publish_batches.sql");
  assert.match(sql, /create table if not exists public\.publish_batches/);
  assert.match(sql, /create table if not exists public\.publish_batch_items/);
  assert.match(sql, /current_publish_batch_id/);
  assert.match(sql, /notify_sent_at/);
  assert.match(sql, /shopify_api/);
  // kind check allows only shopify_api this package (comment may mention Showmore later)
  assert.match(sql, /check \(kind in \('shopify_api'\)\)/);
  assert.doesNotMatch(sql, /check \(kind in \([^)]*showmore/i);
});

await check("resolvePublishItemGapMs default 600; env override", () => {
  assert.equal(resolvePublishItemGapMs(undefined), 600);
  assert.equal(resolvePublishItemGapMs(""), 600);
  assert.equal(resolvePublishItemGapMs("900"), 900);
  assert.equal(resolvePublishItemGapMs("0"), 0);
  assert.equal(resolvePublishItemGapMs("nope"), 600);
  assert.equal(resolvePublishItemGapMs("-1"), 600);
});

await check("time budget stop when remaining < 8s", () => {
  const t0 = 1_000_000;
  assert.equal(shouldStopForTimeBudget(t0, t0 + 51_000), false); // 9s left
  assert.equal(shouldStopForTimeBudget(t0, t0 + 52_500), true); // 7.5s left
  assert.equal(remainingBudgetMs(t0, t0 + 10_000), 50_000);
});

await check("summarizePublishBatchStatus Q2-A terminal", () => {
  assert.equal(summarizePublishBatchStatus({ total: 3, done: 3, failed: 0, skipped: 0 }), "completed");
  assert.equal(summarizePublishBatchStatus({ total: 3, done: 0, failed: 3, skipped: 0 }), "failed");
  assert.equal(summarizePublishBatchStatus({ total: 3, done: 1, failed: 1, skipped: 1 }), "partial_failed");
  assert.equal(summarizePublishBatchStatus({ total: 3, done: 0, failed: 0, skipped: 3 }), "failed");
  assert.equal(summarizePublishBatchStatus({ total: 2, done: 1, failed: 0, skipped: 1 }), "partial_failed");
  assert.equal(summarizePublishBatchStatus({ total: 0, done: 0, failed: 0 }), "failed");
});

await check("buildPublishSnapshot + filter + failed ids (Q3 A-lite)", () => {
  const snap = buildPublishSnapshot([
    { draftId: "a", title: " 甲 " },
    { draftId: "b", title: "" }
  ]);
  assert.equal(snap[0].title, "甲");
  assert.equal(snap[1].title, "未命名草稿");

  const rows = [
    { id: "1", failed_count: 0, status: "completed" },
    { id: "2", failed_count: 2, status: "partial_failed" },
    { id: "3", failed_count: 0, status: "failed" }
  ];
  assert.equal(filterPublishBatches(rows, "all").length, 3);
  assert.equal(filterPublishBatches(rows, "has_failed").length, 2);

  const ids = failedDraftIdsFromItems([
    { draft_id: "x", item_status: "done" },
    { draft_id: "y", item_status: "failed" },
    { draft_id: "z", item_status: "skipped" }
  ]);
  assert.deepEqual(ids, ["y"]);
});

await check("missing table error detection", () => {
  assert.equal(isMissingPublishBatchesError('relation "publish_batches" does not exist'), true);
  assert.equal(isMissingPublishBatchesError("Could not find the table in the schema cache"), true);
  assert.equal(isMissingPublishBatchesError("permission denied"), false);
  assert.ok(TIME_BUDGET_SKIP_REASON.includes("time_budget"));
});

await check("runPublishBatch module wiring (no HTTP self-fetch)", () => {
  assert.ok(exists("src/lib/shopify/runPublishBatch.ts"));
  assert.ok(exists("src/lib/drafts/publishBatch.ts"));
  const run = read("src/lib/shopify/runPublishBatch.ts");
  assert.match(run, /publishDraft/);
  assert.match(run, /publish_batches/);
  assert.match(run, /PUBLISH_BATCH_DEADLINE_MS|60_000/);
  assert.match(run, /TIME_BUDGET_SKIP_REASON|time_budget/);
  assert.match(run, /publish_batch_submitted/);
  assert.doesNotMatch(run, /fetch\(\s*[`'"]\/api\/drafts/);
  assert.doesNotMatch(run, /productCreate/);
});

await check("batch + single publish routes use runPublishBatch", () => {
  const batch = read("src/app/api/drafts/batch/publish/route.ts");
  const single = read("src/app/api/drafts/[id]/publish/route.ts");
  assert.match(batch, /runPublishBatch/);
  assert.match(batch, /maxDuration\s*=\s*60/);
  assert.match(batch, /canPublish/);
  assert.match(single, /runPublishBatch/);
  assert.match(single, /draftIds:\s*\[id\]/);
  assert.match(single, /batchId/);
});

await check("records page is not ComingSoon; panel + helpers exist", () => {
  const page = read("src/app/records/page.tsx");
  assert.doesNotMatch(page, /ComingSoonPage/);
  assert.match(page, /PublishRecordsPanel/);
  assert.ok(exists("src/components/records/PublishRecordsPanel.tsx"));
  const panel = read("src/components/records/PublishRecordsPanel.tsx");
  assert.match(panel, /重送失敗件|retryFailed/);
  assert.match(panel, /\/api\/drafts\/batch\/publish/);
  assert.match(panel, /MIGRATION_027|027/);
  assert.ok(exists("src/lib/drafts/publishRecords.ts"));
});

await check("domain types include PublishBatch*", () => {
  const domain = read("src/types/domain.ts");
  assert.match(domain, /PublishBatchStatus/);
  assert.match(domain, /current_publish_batch_id/);
  assert.match(domain, /export interface PublishBatch/);
});

await check("globals has rec-* layout classes using tokens", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /\.rec-card|\.rec-head|\.rec-item/);
  assert.match(css, /\.rec-dot--ok/);
  assert.match(css, /var\(--success\)/);
  assert.match(css, /var\(--danger\)/);
});

console.log("");
if (failures.length) {
  console.error(`FAILED ${failures.length} check(s)`);
  process.exit(1);
}
console.log("ALL passed");
