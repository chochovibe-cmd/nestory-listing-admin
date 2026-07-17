/**
 * UX-B T6/T10 pure helpers (no network).
 * Run: node scripts/verify-ux-b-station.mjs
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

// --- Inline mirrors of pipelineStage / stationJumpStrip / stationFilter ---

function isCopyFail(row) {
  return row.status === "failed" || row.generation_status === "failed";
}
function isImageFail(row) {
  return row.image_status === "failed";
}
function resolveStage(row) {
  return row.pipeline_stage || "input";
}
function isDraftStationFail(row) {
  const stage = resolveStage(row);
  if (stage === "copy_review") return isCopyFail(row);
  if (stage === "image_review") return isImageFail(row);
  return false;
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
      if (isCopyFail(row)) out.fail.copy_review += 1;
    } else if (stage === "image_review") {
      out.image_review += 1;
      if (isImageFail(row)) out.fail.image_review += 1;
    } else if (stage === "ready") {
      out.ready += 1;
    }
  }
  return out;
}
function stationNonFailCount(counts, key) {
  return Math.max(0, (counts[key] ?? 0) - (counts.fail?.[key] ?? 0));
}
function totalPipelineFailCount(counts) {
  return (
    (counts.fail?.copy_review ?? 0) +
    (counts.fail?.image_review ?? 0) +
    (counts.fail?.ready ?? 0)
  );
}
function filterFailDrafts(rows) {
  return rows.filter(isDraftStationFail);
}
function filterNonFailByStation(rows, stage) {
  return rows.filter((r) => resolveStage(r) === stage && !isDraftStationFail(r));
}

function buildJumpStripGroups(drafts, opts = {}) {
  const exclude = new Set(opts.excludeDraftIds ?? []);
  const buckets = { input: [], copy_review: [], image_review: [], ready: [] };
  for (const d of drafts) {
    const g = d.pipeline_stage === "input" || d.status === "pending_input" ? "input" : d.pipeline_stage;
    if (!buckets[g]) continue;
    if (g === "input" && exclude.has(d.id)) continue;
    buckets[g].push(d);
  }
  const groups = [];
  for (const key of ["input", "copy_review", "image_review", "ready"]) {
    if (buckets[key].length === 0) continue;
    groups.push({ key, items: buckets[key] });
  }
  return groups;
}

console.log("UX-B station checks\n");

check("source wiring: labels §2.2", () => {
  const sf = read("src/lib/drafts/stationFilter.ts");
  assert.match(sf, /審文案/);
  assert.match(sf, /標圖/);
  assert.match(sf, /待發布/);
  assert.match(sf, /ResultsFilterKey/);
  assert.match(sf, /filterDraftsByResultsFilter/);
  const sj = read("src/lib/drafts/stationJumpStrip.ts");
  assert.match(sj, /未完成草稿/);
  assert.match(sj, /excludeDraftIds/);
  assert.match(sj, /標圖/);
});

check("StageFilterPills always-on + fail", () => {
  const src = read("src/components/drafts/StageFilterPills.tsx");
  assert.doesNotMatch(src, /count === 0 && stage !== key/);
  assert.match(src, /stationNonFailCount/);
  assert.match(src, /failTotal > 0/);
  assert.match(src, /FAIL_FILTER_LABEL|⚠ 失敗/);
});

check("WorkbenchMobileShell T4 slots", () => {
  const src = read("src/components/listing/WorkbenchMobileShell.tsx");
  assert.match(src, /quickPreview/);
  assert.match(src, /快速預覽/);
  assert.match(src, /inputSub/);
  assert.match(src, /wb-form-slot/);
  assert.match(src, /wb-preview-slot/);
  assert.doesNotMatch(src, /◈ 結果/);
});

check("nav factory shortLabel 工廠", () => {
  const nav = read("src/lib/nav.ts");
  assert.match(nav, /shortLabel: "工廠"/);
  assert.doesNotMatch(nav, /shortLabel: "圖審"/);
});

check("WorkspaceInputPanel no jump strip embed", () => {
  const src = read("src/components/listing/WorkspaceInputPanel.tsx");
  assert.doesNotMatch(src, /StationJumpStrip/);
  assert.doesNotMatch(src, /jumpDrafts/);
  assert.match(src, /onDraftIdChange/);
});

check("QuickPreviewPanel exists", () => {
  assert.ok(fs.existsSync(path.join(root, "src/components/listing/QuickPreviewPanel.tsx")));
  const src = read("src/components/listing/QuickPreviewPanel.tsx");
  assert.match(src, /emitJumpToDraft/);
  assert.match(src, /excludeDraftIds/);
});

check("non-fail counts + fail list", () => {
  const rows = [
    { id: "a", pipeline_stage: "copy_review", status: "ready_for_review" },
    { id: "b", pipeline_stage: "copy_review", status: "failed", generation_status: "failed" },
    { id: "c", pipeline_stage: "image_review", image_status: "failed" },
    { id: "d", pipeline_stage: "image_review", image_status: "done" },
    { id: "e", pipeline_stage: "ready" }
  ];
  const counts = countPipelineStations(rows);
  assert.equal(counts.copy_review, 2);
  assert.equal(counts.fail.copy_review, 1);
  assert.equal(stationNonFailCount(counts, "copy_review"), 1);
  assert.equal(stationNonFailCount(counts, "image_review"), 1);
  assert.equal(stationNonFailCount(counts, "ready"), 1);
  assert.equal(totalPipelineFailCount(counts), 2);
  const fails = filterFailDrafts(rows);
  assert.equal(fails.length, 2);
  assert.deepEqual(
    fails.map((r) => r.id).sort(),
    ["b", "c"]
  );
  const copyOnly = filterNonFailByStation(rows, "copy_review");
  assert.equal(copyOnly.length, 1);
  assert.equal(copyOnly[0].id, "a");
});

check("T10 exclude current draft from input group", () => {
  const drafts = [
    { id: "cur", pipeline_stage: "input", status: "pending_input" },
    { id: "old", pipeline_stage: "input", status: "pending_input" },
    { id: "ok", pipeline_stage: "copy_review", status: "ready_for_review" }
  ];
  const withCur = buildJumpStripGroups(drafts);
  assert.ok(withCur.some((g) => g.key === "input" && g.items.some((i) => i.id === "cur")));
  const excl = buildJumpStripGroups(drafts, { excludeDraftIds: ["cur"] });
  const inputGroup = excl.find((g) => g.key === "input");
  assert.ok(inputGroup);
  assert.equal(inputGroup.items.length, 1);
  assert.equal(inputGroup.items[0].id, "old");
  assert.ok(excl.some((g) => g.key === "copy_review"));
  // empty input after exclude
  const onlyCur = buildJumpStripGroups(
    [{ id: "cur", pipeline_stage: "input", status: "pending_input" }],
    { excludeDraftIds: ["cur"] }
  );
  assert.equal(onlyCur.length, 0);
});

if (failures.length) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nAll UX-B station checks passed.");
