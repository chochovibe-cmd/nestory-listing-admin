/**
 * D2-open verification (no secrets / no live Shopify).
 *
 * - Static wiring: auto chain modules, thin shells, no HTTP self-fetch
 * - Pure decision helpers mirrored from sendImagesAutoChain
 * - verify-b14 path allows notifyMake; webhook failure must not 500
 *
 * Run: node scripts/verify-d2-auto-chain.mjs
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

// --- Inline mirrors of pure helpers (keep in sync with sendImagesAutoChain.ts) ---

function decideDraftAutoChainFromSnapshot(snapshotImages) {
  if (!snapshotImages.length) {
    return { action: "no_pipeline_images", reason: "snapshot has no pipeline images" };
  }
  const hasD4 = snapshotImages.some(
    (img) => img.processIntent === "de_text" || img.processIntent === "regenerate"
  );
  if (hasD4) {
    return {
      action: "run_mixed",
      reason: "contains de_text/regenerate; hybrid keep + limited D4 (Q1-C)"
    };
  }
  const allKeep = snapshotImages.every((img) => img.processIntent === "keep");
  if (allKeep) {
    return {
      action: "run_all_keep",
      reason: "all pipeline images process_intent=keep"
    };
  }
  return {
    action: "awaiting_d4",
    reason: "non-keep intents present; skip auto sharp"
  };
}

function remainingBudgetMs(startedAtMs, nowMs, deadlineMs = 60_000) {
  return deadlineMs - (nowMs - startedAtMs);
}

function shouldStopForTimeBudget(startedAtMs, nowMs, opts = {}) {
  const deadlineMs = opts.deadlineMs ?? 60_000;
  const minRemainingMs = opts.minRemainingMs ?? 8_000;
  return remainingBudgetMs(startedAtMs, nowMs, deadlineMs) < minRemainingMs;
}

function mergeAutoChainWarning(existing, line) {
  const list = Array.isArray(existing) ? existing.filter((w) => typeof w === "string") : [];
  const trimmed = String(line).trim().slice(0, 200);
  if (!trimmed) return list;
  if (!list.includes(trimmed)) list.push(trimmed);
  return list.slice(-30);
}

function aggregateBatchStatusAfterChain(summaries) {
  let doneCount = 0;
  let failedCount = 0;
  let awaitingOnly = 0;
  let timeBudget = 0;
  let emptySkip = 0;

  for (const s of summaries) {
    if (s.outcome === "done" || s.outcome === "skipped_empty") {
      doneCount += 1;
      if (s.outcome === "skipped_empty") emptySkip += 1;
    } else if (s.outcome === "failed") {
      failedCount += 1;
    } else if (s.outcome === "awaiting_d4") {
      awaitingOnly += 1;
    } else if (s.outcome === "time_budget") {
      timeBudget += 1;
    }
  }

  const n = summaries.length;
  if (n === 0) return { batchStatus: "queued", doneCount: 0, failedCount: 0 };
  if (awaitingOnly === n) return { batchStatus: "queued", doneCount: 0, failedCount: 0 };
  if (timeBudget === n) return { batchStatus: "queued", doneCount: 0, failedCount: 0 };
  if (failedCount === n) return { batchStatus: "failed", doneCount: 0, failedCount };
  if (doneCount === n) return { batchStatus: "completed", doneCount, failedCount: 0 };
  if (failedCount === 0 && timeBudget === 0 && doneCount + awaitingOnly + emptySkip === n) {
    return {
      batchStatus: doneCount > 0 ? "completed" : "queued",
      doneCount,
      failedCount: 0
    };
  }
  return { batchStatus: "partial_failed", doneCount, failedCount };
}

console.log("\nD2-open auto chain verify\n");

await check("core modules exist", () => {
  assert.ok(exists("src/lib/images/runSharpBatch.ts"));
  assert.ok(exists("src/lib/images/runFinalize.ts"));
  assert.ok(exists("src/lib/images/sendImagesAutoChain.ts"));
  assert.ok(exists("src/app/api/drafts/batch/send-images/route.ts"));
  assert.ok(exists("src/lib/notifications/make.ts"));
  assert.ok(exists("docs/Make接Webhook最短說明.md"));
});

await check("send-images wires auto chain + notifyMake (no self HTTP)", () => {
  const src = read("src/app/api/drafts/batch/send-images/route.ts");
  assert.match(src, /runSendImagesAutoChain/);
  assert.match(src, /notifyMake/);
  assert.match(src, /image_batch_submitted/);
  assert.match(src, /maxDuration\s*=\s*60/);
  assert.match(src, /formatAutoChainOperatorMessage/);
  // Must not fetch own sharp/finalize endpoints
  assert.doesNotMatch(src, /fetch\s*\(\s*[^)]*\/api\/images\/sharp-batch/);
  assert.doesNotMatch(src, /fetch\s*\(\s*[^)]*\/api\/images\/finalize/);
  assert.doesNotMatch(src, /localhost:.*\/api\/images/);
});

await check("runSharpBatch + runFinalize are in-process (used by routes)", () => {
  const sharpRoute = read("src/app/api/images/sharp-batch/route.ts");
  const finRoute = read("src/app/api/images/finalize/route.ts");
  const sharpLib = read("src/lib/images/runSharpBatch.ts");
  const finLib = read("src/lib/images/runFinalize.ts");
  assert.match(sharpRoute, /runSharpBatchForDraft/);
  assert.match(finRoute, /runFinalizeForDraft/);
  assert.match(sharpLib, /export async function runSharpBatchForDraft/);
  assert.match(finLib, /export async function runFinalizeForDraft/);
  assert.match(sharpLib, /processImageBuffer/);
  assert.match(finLib, /uploadProcessedImageToShopifyFilesWithRetry/);
  assert.doesNotMatch(sharpLib, /fetch\s*\(\s*[^)]*\/api\/images\//);
  assert.doesNotMatch(finLib, /fetch\s*\(\s*[^)]*\/api\/images\//);
});

await check("auto chain exports Q1/Q2/Q4 constants and helpers", () => {
  const src = read("src/lib/images/sendImagesAutoChain.ts");
  assert.match(src, /AUTO_CHAIN_DEADLINE_MS\s*=\s*60_?000/);
  assert.match(src, /AUTO_CHAIN_MIN_REMAINING_MS\s*=\s*8_?000/);
  assert.match(src, /decideDraftAutoChainFromSnapshot/);
  assert.match(src, /runSendImagesAutoChain/);
  assert.match(src, /aggregateBatchStatusAfterChain/);
  assert.match(src, /mergeAutoChainWarning/);
  assert.match(src, /runSharpBatchForDraft/);
  assert.match(src, /runFinalizeForDraft/);
  assert.match(src, /awaiting_d4/);
  assert.match(src, /run_mixed/);
  assert.match(src, /runAiProcessForDraft/);
});

await check("notifyMake skips when MAKE_WEBHOOK_URL empty; catches errors", () => {
  const src = read("src/lib/notifications/make.ts");
  assert.match(src, /MAKE_WEBHOOK_URL/);
  assert.match(src, /if\s*\(\s*!url\s*\)\s*return/);
  assert.match(src, /\.catch\s*\(/);
});

await check("decideDraftAutoChainFromSnapshot: all keep → run", () => {
  const d = decideDraftAutoChainFromSnapshot([
    { processIntent: "keep" },
    { processIntent: "keep" }
  ]);
  assert.equal(d.action, "run_all_keep");
});

await check("decideDraftAutoChainFromSnapshot: de_text → run_mixed (Q1-C hybrid)", () => {
  const d = decideDraftAutoChainFromSnapshot([
    { processIntent: "keep" },
    { processIntent: "de_text" }
  ]);
  assert.equal(d.action, "run_mixed");
});

await check("decideDraftAutoChainFromSnapshot: regenerate → run_mixed", () => {
  const d = decideDraftAutoChainFromSnapshot([{ processIntent: "regenerate" }]);
  assert.equal(d.action, "run_mixed");
});

await check("time budget: remaining < 8s stops", () => {
  const started = 1_000_000;
  // 53s elapsed → 7s remaining → stop
  assert.equal(shouldStopForTimeBudget(started, started + 53_000), true);
  // 10s elapsed → 50s remaining → continue
  assert.equal(shouldStopForTimeBudget(started, started + 10_000), false);
  assert.ok(remainingBudgetMs(started, started + 10_000) === 50_000);
});

await check("aggregateBatchStatus: all awaiting_d4 → queued (Q5a-A)", () => {
  const agg = aggregateBatchStatusAfterChain([
    { outcome: "awaiting_d4" },
    { outcome: "awaiting_d4" }
  ]);
  assert.equal(agg.batchStatus, "queued");
  assert.equal(agg.doneCount, 0);
});

await check("aggregateBatchStatus: all done → completed", () => {
  const agg = aggregateBatchStatusAfterChain([
    { outcome: "done" },
    { outcome: "done" }
  ]);
  assert.equal(agg.batchStatus, "completed");
  assert.equal(agg.doneCount, 2);
});

await check("aggregateBatchStatus: mix fail → partial_failed", () => {
  const agg = aggregateBatchStatusAfterChain([
    { outcome: "done" },
    { outcome: "failed" },
    { outcome: "time_budget" }
  ]);
  assert.equal(agg.batchStatus, "partial_failed");
});

await check("mergeAutoChainWarning dedupes and caps", () => {
  const a = mergeAutoChainWarning([], "送圖自動處理失敗：圖片轉檔");
  const b = mergeAutoChainWarning(a, "送圖自動處理失敗：圖片轉檔");
  assert.equal(b.length, 1);
  const c = mergeAutoChainWarning(b, "送圖自動處理失敗：上傳圖床");
  assert.equal(c.length, 2);
});

await check("imagePipeline documents D2-open auto chain", () => {
  const src = read("src/lib/images/imagePipeline.ts");
  assert.match(src, /D2-open auto chain|runSendImagesAutoChain|runSharpBatchForDraft/);
  assert.match(src, /image_batch_submitted|MAKE_WEBHOOK/);
  assert.match(src, /awaiting_d4|all-keep|all keep/i);
});

await check("Mockup diff 23 documents D2 override of diff 20", () => {
  const src = read("docs/Mockup差異備忘.md");
  assert.match(src, /差異 23/);
  assert.match(src, /D2|自動鏈|auto chain|送圖後/);
});

await check("no UI layout change required (b15 skip note path)", () => {
  // D2-open is API/docs only — components should not import runSharpBatch
  const ban = ["src/components/listing/ResultCard.tsx", "src/components/listing/DraftResultsPanel.tsx"];
  for (const rel of ban) {
    const src = read(rel);
    assert.doesNotMatch(src, /runSharpBatchForDraft|runSendImagesAutoChain/);
  }
});

console.log("");
if (failures.length) {
  console.error(`FAILED ${failures.length} check(s)`);
  process.exit(1);
}
console.log("ALL passed");
