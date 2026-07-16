/**
 * R1 pure-logic verification (no secrets, no network).
 * Mirrors src/lib/drafts/pipelineStage.ts + dual-write / migration wiring checks.
 *
 * Run: node scripts/verify-r1-stage.mjs
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

// --- Inline mirrors (keep in sync with pipelineStage.ts) ---

const PIPELINE_STAGES = [
  "input",
  "copy_review",
  "image_review",
  "ready",
  "published",
  "archived"
];

function hasShopifyProductId(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function mapStatusToPipelineStage(status, opts = {}) {
  switch (status ?? "") {
    case "pending_input":
    case "pending_copy":
    case "processing":
      return "input";
    case "ready_for_review":
    case "needs_revision":
    case "failed":
      return "copy_review";
    case "approved":
      return hasShopifyProductId(opts.shopifyProductId)
        ? "published"
        : "image_review";
    case "publishing":
      return "ready";
    case "csv_ready":
    case "draft_created":
    case "active_published":
    case "api_failed":
      return "published";
    case "archived":
      return "archived";
    default:
      return "input";
  }
}

function isPipelineStage(value) {
  return typeof value === "string" && PIPELINE_STAGES.includes(value);
}

function resolveStage(row) {
  if (isPipelineStage(row.pipeline_stage)) return row.pipeline_stage;
  return mapStatusToPipelineStage(row.status, {
    shopifyProductId: row.shopify_product_id
  });
}

function countPipelineStations(rows) {
  const out = {
    copy_review: 0,
    image_review: 0,
    ready: 0,
    fail: { copy_review: 0, image_review: 0, ready: 0 }
  };
  for (const row of rows) {
    const stage = resolveStage(row);
    if (stage === "copy_review") {
      out.copy_review += 1;
      if (row.status === "failed" || row.generation_status === "failed") {
        out.fail.copy_review += 1;
      }
    } else if (stage === "image_review") {
      out.image_review += 1;
      if (row.image_status === "failed") out.fail.image_review += 1;
    } else if (stage === "ready") {
      out.ready += 1;
      // Q5-A: publish fails not counted on station badges
    }
  }
  return out;
}

console.log("\nverify-r1-stage\n");

await check("migration 029 exists", () => {
  assert.equal(exists("supabase/migrations/029_pipeline_stage.sql"), true);
});

await check("migration 029: column + check + index + idempotent backfill", () => {
  const sql = read("supabase/migrations/029_pipeline_stage.sql");
  assert.match(sql, /pipeline_stage/);
  assert.match(sql, /add column if not exists pipeline_stage/i);
  assert.match(sql, /product_drafts_pipeline_stage_check/);
  assert.match(sql, /product_drafts_pipeline_stage_work_idx/);
  assert.match(sql, /where pipeline_stage not in \('published', 'archived'\)/i);
  assert.match(sql, /when 'approved' then/i);
  assert.match(sql, /shopify_product_id/i);
  assert.match(sql, /when 'publishing' then 'ready'/i);
  assert.match(sql, /when 'api_failed' then 'published'/i);
  assert.match(sql, /is distinct from/i); // idempotent re-run
  assert.match(sql, /pipeline_stage is null/i);
});

await check("mapStatusToPipelineStage §2.2 + Q2/Q4", () => {
  assert.equal(mapStatusToPipelineStage("pending_input"), "input");
  assert.equal(mapStatusToPipelineStage("pending_copy"), "input");
  assert.equal(mapStatusToPipelineStage("processing"), "input");
  assert.equal(mapStatusToPipelineStage("ready_for_review"), "copy_review");
  assert.equal(mapStatusToPipelineStage("needs_revision"), "copy_review");
  assert.equal(mapStatusToPipelineStage("failed"), "copy_review");
  assert.equal(mapStatusToPipelineStage("approved"), "image_review");
  assert.equal(
    mapStatusToPipelineStage("approved", { shopifyProductId: "gid://shopify/Product/1" }),
    "published"
  );
  assert.equal(
    mapStatusToPipelineStage("approved", { shopifyProductId: "  " }),
    "image_review"
  );
  assert.equal(mapStatusToPipelineStage("publishing"), "ready");
  assert.equal(mapStatusToPipelineStage("csv_ready"), "published");
  assert.equal(mapStatusToPipelineStage("draft_created"), "published");
  assert.equal(mapStatusToPipelineStage("active_published"), "published");
  assert.equal(mapStatusToPipelineStage("api_failed"), "published");
  assert.equal(mapStatusToPipelineStage("archived"), "archived");
  assert.equal(mapStatusToPipelineStage("unknown_x"), "input");
});

await check("countPipelineStations three stations + fail lights (Q5-A)", () => {
  const counts = countPipelineStations([
    { pipeline_stage: "copy_review", generation_status: "completed" },
    { pipeline_stage: "copy_review", generation_status: "failed" },
    { status: "failed" }, // maps to copy_review, status fail
    { pipeline_stage: "image_review", image_status: "done" },
    { pipeline_stage: "image_review", image_status: "failed" },
    { pipeline_stage: "ready" },
    {
      pipeline_stage: "ready",
      status: "api_failed",
      publish_status: "api_failed"
    }, // must NOT bump fail.ready
    { pipeline_stage: "published", status: "api_failed" }, // excluded from stations
    { pipeline_stage: "input" },
    { pipeline_stage: "archived" }
  ]);
  assert.equal(counts.copy_review, 3);
  assert.equal(counts.fail.copy_review, 2);
  assert.equal(counts.image_review, 2);
  assert.equal(counts.fail.image_review, 1);
  assert.equal(counts.ready, 2);
  assert.equal(counts.fail.ready, 0);
});

await check("resolveStage falls back to status map", () => {
  assert.equal(resolveStage({ status: "approved" }), "image_review");
  assert.equal(
    resolveStage({ status: "approved", shopify_product_id: "gid://x" }),
    "published"
  );
  assert.equal(
    resolveStage({ pipeline_stage: "ready", status: "approved" }),
    "ready"
  );
});

await check("pipelineStage.ts module exports present", () => {
  const src = read("src/lib/drafts/pipelineStage.ts");
  for (const name of [
    "mapStatusToPipelineStage",
    "countPipelineStations",
    "filterByPipelineStage",
    "pipelineStagePatch",
    "hasShopifyProductId",
    "PIPELINE_STAGES"
  ]) {
    assert.match(src, new RegExp(name));
  }
  assert.match(src, /Q5-A/);
  assert.match(src, /Q4/);
});

await check("domain ProductDraft has pipeline_stage", () => {
  const src = read("src/types/domain.ts");
  assert.match(src, /export type PipelineStage/);
  assert.match(src, /pipeline_stage\?:/);
});

const dualWriteFiles = [
  ["src/app/api/generate/route.ts", "pipeline_stage"],
  ["src/app/api/drafts/[id]/approve/route.ts", "pipeline_stage"],
  ["src/app/api/drafts/batch/approve/route.ts", "pipeline_stage"],
  ["src/app/api/drafts/[id]/request-revision/route.ts", "pipeline_stage"],
  ["src/app/api/exports/matrixify/route.ts", "pipeline_stage"],
  ["src/app/api/exports/showmore/route.ts", "pipeline_stage"],
  ["src/app/api/drafts/batch/archive/route.ts", "pipeline_stage"],
  ["src/app/api/worker/complete/route.ts", "pipeline_stage"],
  ["src/app/api/worker/fail/route.ts", "pipeline_stage"],
  ["src/app/api/worker/claim/route.ts", "pipeline_stage"],
  ["src/lib/shopify/publishDraft.ts", "pipeline_stage"],
  ["src/components/listing/WorkspaceInputPanel.tsx", "pipeline_stage"]
];

for (const [rel, needle] of dualWriteFiles) {
  await check(`dual-write wired: ${rel}`, () => {
    assert.equal(exists(rel), true, `missing ${rel}`);
    const src = read(rel);
    assert.match(src, new RegExp(needle));
    assert.match(src, /mapStatusToPipelineStage/);
  });
}

await check("Q7 generate failure parks copy_review", () => {
  const src = read("src/app/api/generate/route.ts");
  assert.match(src, /generation_status:\s*"failed"/);
  assert.match(src, /mapStatusToPipelineStage\("failed"\)/);
});

await check("Q6 unarchive maps from restore status", () => {
  const src = read("src/app/api/drafts/batch/archive/route.ts");
  assert.match(src, /mapStatusToPipelineStage\(restoreStatus/);
  assert.match(src, /shopify_product_id/);
  assert.match(src, /mapStatusToPipelineStage\("archived"\)/);
});

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log("\nALL passed\n");
