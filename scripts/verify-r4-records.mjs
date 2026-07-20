/**
 * R4 pure-logic + wiring checks (no secrets / network).
 * - processTag snapshot helpers
 * - jump strip grouping
 * - nav mobile tabs
 * - deep link URL builders
 * - /drafts permanentRedirect
 *
 * Run: node scripts/verify-r4-records.mjs
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

function processTagFromImageIntents(images) {
  const pipeline = images.filter((img) => {
    const t = img.image_type;
    return t === "main" || t === "spec" || t === "variant";
  });
  const ai = pipeline.some(
    (img) =>
      img.process_intent === "de_text" ||
      img.process_intent === "regenerate" ||
      img.process_intent === "to_trad"
  );
  return ai ? "含生圖" : "原圖直發";
}

function batchProcessTagFromItems(tags) {
  let sawAny = false;
  let sawAi = false;
  for (const t of tags) {
    if (t !== "含生圖" && t !== "原圖直發") continue;
    sawAny = true;
    if (t === "含生圖") sawAi = true;
  }
  if (!sawAny) return null;
  return sawAi ? "含生圖" : "原圖直發";
}

function buildPublishSnapshot(items) {
  return items.map((item) => {
    const row = {
      draftId: item.draftId,
      title: (item.title || "未命名草稿").trim() || "未命名草稿"
    };
    if (item.processTag === "含生圖" || item.processTag === "原圖直發") {
      row.processTag = item.processTag;
    }
    return row;
  });
}

function batchProcessTagLabel(snapshotJson) {
  if (!Array.isArray(snapshotJson)) return null;
  const tags = [];
  for (const row of snapshotJson) {
    if (!row || typeof row !== "object") continue;
    if (row.processTag === "含生圖" || row.processTag === "原圖直發") {
      tags.push(row.processTag);
    } else {
      tags.push(null);
    }
  }
  if (tags.length === 0 || tags.every((t) => t == null)) return null;
  return batchProcessTagFromItems(tags);
}

function mapStatusToPipelineStage(status, opts) {
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
      return opts?.shopifyProductId ? "published" : "image_review";
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

function buildJumpStripGroups(drafts) {
  const ORDER = ["input", "copy_review", "image_review", "ready"];
  const LABELS = {
    input: "待輸入",
    copy_review: "文案審核",
    image_review: "圖片審核",
    ready: "完成待發布"
  };
  const buckets = new Map(ORDER.map((k) => [k, []]));
  for (const d of drafts) {
    const stage = d.pipeline_stage || mapStatusToPipelineStage(d.status);
    if (!buckets.has(stage)) continue;
    buckets.get(stage).push(d);
  }
  const groups = [];
  for (const key of ORDER) {
    const items = buckets.get(key) || [];
    if (items.length === 0) continue;
    groups.push({ key, label: LABELS[key], count: items.length });
  }
  return groups;
}

function parseRecordsTab(raw) {
  if (
    raw === "batches" ||
    raw === "failed" ||
    raw === "shopify_drafts" ||
    raw === "published"
  ) {
    return raw;
  }
  return "batches";
}

function workbenchPaneFromSearch(search) {
  if (!search) return "input";
  const q = search.startsWith("?") ? search.slice(1) : search;
  const pane = new URLSearchParams(q).get("pane");
  return pane === "results" ? "results" : "input";
}

console.log("verify-r4-records");

check("processTag: all keep → 原圖直發", () => {
  assert.equal(
    processTagFromImageIntents([
      { image_type: "main", process_intent: "keep" },
      { image_type: "spec", process_intent: "keep" }
    ]),
    "原圖直發"
  );
});

check("processTag: de_text → 含生圖", () => {
  assert.equal(
    processTagFromImageIntents([
      { image_type: "main", process_intent: "keep" },
      { image_type: "main", process_intent: "de_text" }
    ]),
    "含生圖"
  );
});

check("processTag: to_trad / regenerate → 含生圖", () => {
  assert.equal(
    processTagFromImageIntents([{ image_type: "main", process_intent: "to_trad" }]),
    "含生圖"
  );
  assert.equal(
    processTagFromImageIntents([{ image_type: "variant", process_intent: "regenerate" }]),
    "含生圖"
  );
});

check("processTag: detail-only images ignored for AI", () => {
  assert.equal(
    processTagFromImageIntents([
      { image_type: "detail", process_intent: "regenerate" },
      { image_type: "main", process_intent: "keep" }
    ]),
    "原圖直發"
  );
});

check("batchProcessTag: old snapshot without tags → null (honest)", () => {
  assert.equal(
    batchProcessTagLabel([{ draftId: "a", title: "x" }, { draftId: "b", title: "y" }]),
    null
  );
});

check("batchProcessTag: mixed → 含生圖", () => {
  assert.equal(
    batchProcessTagLabel([
      { draftId: "a", title: "x", processTag: "原圖直發" },
      { draftId: "b", title: "y", processTag: "含生圖" }
    ]),
    "含生圖"
  );
});

check("buildPublishSnapshot preserves processTag only when set", () => {
  const snap = buildPublishSnapshot([
    { draftId: "1", title: "A", processTag: "含生圖" },
    { draftId: "2", title: "B" }
  ]);
  assert.equal(snap[0].processTag, "含生圖");
  assert.equal(snap[1].processTag, undefined);
});

check("jump strip groups by station; omits published", () => {
  const groups = buildJumpStripGroups([
    { id: "1", status: "ready_for_review", pipeline_stage: "copy_review" },
    { id: "2", status: "approved", pipeline_stage: "image_review" },
    { id: "3", status: "pending_input", pipeline_stage: "input" },
    { id: "4", status: "active_published", pipeline_stage: "published" }
  ]);
  assert.deepEqual(
    groups.map((g) => g.key),
    ["input", "copy_review", "image_review"]
  );
  assert.equal(groups.find((g) => g.key === "input").count, 1);
});

check("parseRecordsTab default batches", () => {
  assert.equal(parseRecordsTab(null), "batches");
  assert.equal(parseRecordsTab("failed"), "failed");
  assert.equal(parseRecordsTab("nope"), "batches");
});

check("workbenchPaneFromSearch", () => {
  assert.equal(workbenchPaneFromSearch(""), "input");
  assert.equal(workbenchPaneFromSearch("?pane=results"), "results");
  assert.equal(workbenchPaneFromSearch("pane=results&x=1"), "results");
});

check("source: publishBatch has processTagFromImageIntents", () => {
  const src = read("src/lib/drafts/publishBatch.ts");
  assert.match(src, /processTagFromImageIntents/);
  assert.match(src, /含生圖/);
  assert.match(src, /原圖直發/);
});

check("source: runPublishBatch freezes processTag into snapshot", () => {
  const src = read("src/lib/shopify/runPublishBatch.ts");
  assert.match(src, /processTagFromImageIntents/);
  assert.match(src, /product_images/);
});

check("source: nav R4 mobile tabs 新增/審核/圖審", () => {
  const src = read("src/lib/nav.ts");
  assert.match(src, /pane=results/);
  assert.match(src, /shortLabel: \"審核\"/);
  assert.match(src, /shortLabel: \"圖審\"/);
  assert.doesNotMatch(src, /QUEUE_NAV/);
  assert.match(src, /MOBILE_MORE_LINKS[\s\S]*\/records/);
});

check("source: /drafts permanentRedirect", () => {
  const src = read("src/app/drafts/page.tsx");
  assert.match(src, /permanentRedirect/);
  assert.match(src, /\/records/);
});

check("source: jump strip lib + WorkbenchMobileShell continue", () => {
  // UX-PKG1 1-6a: StationJumpStrip.tsx removed; lib + QuickPreview remain
  assert.ok(!exists("src/components/listing/StationJumpStrip.tsx"));
  assert.ok(exists("src/lib/drafts/stationJumpStrip.ts"));
  assert.ok(exists("src/lib/drafts/jumpToDraft.ts"));
  assert.ok(exists("src/components/listing/QuickPreviewPanel.tsx"));
  const shell = read("src/components/listing/WorkbenchMobileShell.tsx");
  assert.match(shell, /繼續新增/);
  assert.match(shell, /pane=results|setPaneAndUrl\(\"results\"\)/);
  const input = read("src/components/listing/WorkspaceInputPanel.tsx");
  assert.doesNotMatch(input, /StationJumpStrip/);
  assert.match(input, /規則引擎 → Vision/);
});

check("source: PublishRecordsPanel four tabs", () => {
  const panel = read("src/components/records/PublishRecordsPanel.tsx");
  const lib = read("src/lib/drafts/publishRecords.ts");
  assert.match(lib, /批次紀錄/);
  assert.match(lib, /失敗重試/);
  assert.match(lib, /Shopify 草稿/);
  assert.match(lib, /已發布／封存/);
  assert.match(lib, /PUBLISH_RECORDS_TABS/);
  assert.match(panel, /batchProcessTagLabel/);
  assert.match(panel, /flattenFailedItems|FailedRetrySection/);
  assert.match(panel, /PUBLISH_RECORDS_TABS/);
  assert.match(panel, /轉正式上架/);
});

check("source: notify deep links §12", () => {
  const cfg = read("src/lib/notifications/config.ts");
  assert.match(cfg, /section=pending/);
  assert.match(cfg, /tab=batches/);
  const img = read("src/lib/notifications/tryNotifyImageBatchIfComplete.ts");
  assert.match(img, /buildImageReviewPendingUrl/);
  const pub = read("src/lib/notifications/tryNotifyPublishBatchIfComplete.ts");
  assert.match(pub, /buildPublishRecordsBatchUrl/);
});

check("source: ResultCard draft-card id for jump", () => {
  const src = read("src/components/listing/ResultCard.tsx");
  assert.match(src, /draft-card-\$\{draft\.id\}/);
});

if (failures.length) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nALL passed");
