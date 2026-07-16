/**
 * R3 pure-logic checks (no secrets / network).
 * - stationRoute advance_ready vs send_images
 * - station3 leave-queue / selection
 * - showmore multi-variant expand + SKU collapse + listing images
 * - export preflight stage gate + table columns
 *
 * Run: node scripts/verify-r3-station.mjs
 */
import assert from "node:assert/strict";
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

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

// --- Inline mirrors ---

function isPipelineImage(image) {
  return image.image_type === "main" || image.image_type === "spec" || image.image_type === "variant";
}

function countImageMarkSummary(images) {
  const pipeline = images.filter(isPipelineImage);
  const marks = {
    keep: 0,
    to_trad: 0,
    de_text: 0,
    regenerate: 0,
    unmarked: 0,
    pipeline: pipeline.length,
    aiCount: 0
  };
  for (const img of pipeline) {
    const intent = img.process_intent;
    if (intent == null) marks.unmarked += 1;
    else if (intent === "keep") marks.keep += 1;
    else if (intent === "to_trad") {
      marks.to_trad += 1;
      marks.aiCount += 1;
    } else if (intent === "de_text") {
      marks.de_text += 1;
      marks.aiCount += 1;
    } else if (intent === "regenerate") {
      marks.regenerate += 1;
      marks.aiCount += 1;
    }
  }
  return marks;
}

function decideStation2Review(images) {
  const pipeline = images.filter(isPipelineImage);
  if (pipeline.length === 0) return { action: "blocked" };
  const marks = countImageMarkSummary(images);
  if (marks.unmarked > 0) return { action: "blocked" };
  if (marks.aiCount === 0) return { action: "advance_ready", allKeep: true };
  return { action: "send_images", allKeep: false, aiCount: marks.aiCount };
}

function collapseSkuHyphens(sku) {
  if (sku == null) return "";
  return String(sku)
    .trim()
    .split("-")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join("-");
}

function shouldLeaveQueue({ selection, apiSucceeded, csvSucceeded }) {
  const wantsApi = selection.shopify !== "none";
  const wantsCsv = selection.matrixify || selection.showmore;
  if (wantsApi) {
    if (apiSucceeded !== true) return false;
    if (wantsCsv && csvSucceeded === false) return false;
    return true;
  }
  return csvSucceeded === true;
}

function isExportableDraft(draft) {
  if (draft.pipeline_stage === "ready") return true;
  if (draft.status === "csv_ready" || draft.status === "api_failed") return true;
  if (draft.status === "approved" && draft.pipeline_stage == null) return true;
  return false;
}

console.log("\nverify-r3-station\n");

check("all-keep → advance_ready (not send_images)", () => {
  const d = decideStation2Review([
    { image_type: "main", process_intent: "keep" },
    { image_type: "main", process_intent: "keep" }
  ]);
  assert.equal(d.action, "advance_ready");
});

check("AI mark → send_images", () => {
  const d = decideStation2Review([
    { image_type: "main", process_intent: "keep" },
    { image_type: "main", process_intent: "to_trad" }
  ]);
  assert.equal(d.action, "send_images");
  assert.equal(d.aiCount, 1);
});

check("SKU double hyphen collapse", () => {
  assert.equal(collapseSkuHyphens("CHO-KSH-SRO--001"), "CHO-KSH-SRO-001");
  assert.equal(collapseSkuHyphens("A--B---C"), "A-B-C");
});

check("leave queue: CSV-only success", () => {
  assert.equal(
    shouldLeaveQueue({
      selection: { shopify: "none", matrixify: true, showmore: false },
      apiSucceeded: null,
      csvSucceeded: true
    }),
    true
  );
});

check("leave queue: API fail + CSV ok → stay", () => {
  assert.equal(
    shouldLeaveQueue({
      selection: { shopify: "draft", matrixify: true, showmore: false },
      apiSucceeded: false,
      csvSucceeded: true
    }),
    false
  );
});

check("leave queue: API ok only", () => {
  assert.equal(
    shouldLeaveQueue({
      selection: { shopify: "active", matrixify: false, showmore: false },
      apiSucceeded: true,
      csvSucceeded: null
    }),
    true
  );
});

check("exportable: ready stage", () => {
  assert.equal(isExportableDraft({ status: "approved", pipeline_stage: "ready" }), true);
  assert.equal(isExportableDraft({ status: "approved", pipeline_stage: "image_review" }), false);
});

check("wiring: advance-ready route exists", () => {
  assert.ok(exists("src/app/api/drafts/batch/advance-ready/route.ts"));
});

check("wiring: return-stage route exists", () => {
  assert.ok(exists("src/app/api/drafts/[id]/return-stage/route.ts"));
});

check("wiring: Station3PublishModal + dual mode ExportPreflight", () => {
  assert.ok(exists("src/components/listing/Station3PublishModal.tsx"));
  const modal = read("src/components/listing/ExportPreflightModal.tsx");
  assert.match(modal, /條列摘要/);
  assert.match(modal, /表格模式/);
  assert.match(modal, /EXPORT_TABLE_COLUMNS/);
});

check("wiring: showmore multi-variant expand", () => {
  const sm = read("src/lib/csv/showmore.ts");
  assert.match(sm, /product_variants/);
  assert.match(sm, /collapseSkuHyphens/);
  assert.match(sm, /isDetailRetainedForListing|isShowmoreListingImage/);
  assert.match(sm, /index === 0/);
});

check("wiring: publishDraft prepareImagesForPublish", () => {
  const pub = read("src/lib/shopify/publishDraft.ts");
  assert.match(pub, /prepareImagesForPublish/);
  const prep = read("src/lib/images/prepareImagesForPublish.ts");
  assert.match(prep, /runSharpBatchForDraft/);
  assert.match(prep, /runFinalizeForDraft/);
});

check("wiring: stationRoute advance_ready", () => {
  const route = read("src/lib/drafts/stationRoute.ts");
  assert.match(route, /advance_ready/);
  assert.match(route, /直接進入「完成待發布」/);
});

check("wiring: markLeaveQueue on export routes", () => {
  assert.match(read("src/app/api/exports/showmore/route.ts"), /markLeaveQueue/);
  assert.match(read("src/app/api/exports/matrixify/route.ts"), /markLeaveQueue/);
});

check("wiring: ResultCard / DraftResultsPanel station3", () => {
  assert.match(read("src/components/listing/ResultCard.tsx"), /Station3PublishModal/);
  assert.match(read("src/components/listing/ResultCard.tsx"), /returnFromReady|return-stage/);
  assert.match(read("src/components/listing/DraftResultsPanel.tsx"), /advance-ready/);
  assert.match(read("src/components/listing/DraftResultsPanel.tsx"), /發布／匯出/);
});

if (failures.length) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nALL passed\n");
