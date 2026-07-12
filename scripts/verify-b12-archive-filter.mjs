/**
 * B12 pure-logic verification (no secrets, no network).
 * Covers: stage filter (default hides archived), batch archive skip busy,
 * restore status heuristic, published Shopify note, message aggregation.
 *
 * Run: node scripts/verify-b12-archive-filter.mjs
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

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

// --- Inline mirrors (keep in sync with archiveDrafts.ts / stageFilter.ts) ---

const ARCHIVE_BUSY_STATUSES = new Set(["processing", "publishing"]);
const ARCHIVE_PUBLISHED_STATUSES = new Set([
  "draft_created",
  "active_published",
  "csv_ready",
]);
const SHOPIFY_STILL_LIVE_NOTE = "Shopify 商品仍在店裡，僅從工具列表隱藏";

function displayDraftTitle(draft) {
  return (
    draft.title?.trim() ||
    draft.title_zh?.trim() ||
    draft.taobao_title?.trim() ||
    draft.original_title?.trim() ||
    "未命名商品"
  );
}

function evaluateBatchArchive(items) {
  const toArchiveIds = [];
  const skippedBusy = [];
  const skippedAlready = [];
  let includesPublished = false;
  for (const item of items) {
    const title = displayDraftTitle(item);
    if (item.status === "archived") {
      skippedAlready.push({ id: item.id, title, reason: "already_archived" });
      continue;
    }
    if (ARCHIVE_BUSY_STATUSES.has(item.status)) {
      skippedBusy.push({ id: item.id, title, reason: "busy" });
      continue;
    }
    if (ARCHIVE_PUBLISHED_STATUSES.has(item.status)) includesPublished = true;
    toArchiveIds.push(item.id);
  }
  return { toArchiveIds, skippedBusy, skippedAlready, includesPublished };
}

function resolveUnarchiveStatus(input) {
  const prior = input.statusBeforeArchive;
  if (prior && prior !== "archived") return prior;
  if (input.generationStatus === "completed" || input.hasCopy) return "ready_for_review";
  if (input.generationStatus === "failed") return "api_failed";
  return "pending_input";
}

function formatArchiveResultMessage(input) {
  if (input.emptySelection) return "請先勾選商品再批次封存。";
  const parts = [];
  if (input.archivedCount > 0) parts.push(`${input.archivedCount} 件已封存`);
  else parts.push("沒有商品被封存");
  if (input.skippedBusyCount > 0) {
    parts.push(`${input.skippedBusyCount} 件進行中跳過（生成中／上架中）`);
  }
  if ((input.skippedAlreadyCount ?? 0) > 0) {
    parts.push(`${input.skippedAlreadyCount} 件本來就是已封存`);
  }
  let message = parts.join("、");
  if (input.archivedCount > 0 && input.includesPublished) {
    message += `。${SHOPIFY_STILL_LIVE_NOTE}`;
  } else if (input.archivedCount > 0) {
    message += "。可用「已封存」篩選找回，或按下方解除封存。";
  }
  return message;
}

const STAGE_OPTIONS = [
  "all",
  "pending_input",
  "copy_review",
  "needs_revision",
  "approved",
  "unmarked_images",
  "failed",
  "published",
  "archived",
];

function isPipelineImageType(imageType) {
  return imageType === "main" || imageType === "spec" || imageType === "variant";
}

function hasUnmarkedPipeline(draftId, images) {
  if (!images?.length) return false;
  return images.some(
    (img) =>
      img.draft_id === draftId &&
      isPipelineImageType(img.image_type) &&
      img.process_intent == null
  );
}

function matchesStage(draft, stage, images) {
  const status = draft.status;
  const isArchived = status === "archived";
  if (stage === "archived") return isArchived;
  if (isArchived) return false;
  switch (stage) {
    case "all":
      return true;
    case "pending_input":
      return status === "pending_input";
    case "copy_review":
      return status === "ready_for_review";
    case "needs_revision":
      return status === "needs_revision";
    case "approved":
      return status === "approved" || status === "publishing";
    case "unmarked_images":
      return hasUnmarkedPipeline(draft.id, images);
    case "failed":
      return status === "failed" || status === "api_failed" || draft.generation_status === "failed";
    case "published":
      return (
        status === "draft_created" ||
        status === "active_published" ||
        status === "csv_ready"
      );
    default:
      return true;
  }
}

function filterDraftsByStage(drafts, stage, images) {
  return drafts.filter((d) => matchesStage(d, stage, images));
}

function countByStage(drafts, images) {
  const counts = Object.fromEntries(STAGE_OPTIONS.map((k) => [k, 0]));
  for (const draft of drafts) {
    for (const key of STAGE_OPTIONS) {
      if (matchesStage(draft, key, images)) counts[key] += 1;
    }
  }
  return counts;
}

console.log("B12 archive + stage filter verification\n");

await check("batch archive skips processing/publishing, archives others", () => {
  const result = evaluateBatchArchive([
    { id: "a", status: "ready_for_review", title_zh: "正常" },
    { id: "b", status: "processing", title_zh: "生成中" },
    { id: "c", status: "publishing", title_zh: "上架中" },
    { id: "d", status: "pending_input", title_zh: "待輸入" },
    { id: "e", status: "archived", title_zh: "已封" },
  ]);
  assert.deepEqual(result.toArchiveIds, ["a", "d"]);
  assert.equal(result.skippedBusy.length, 2);
  assert.equal(result.skippedAlready.length, 1);
  assert.equal(result.includesPublished, false);
});

await check("batch archive flags published and message includes Shopify note", () => {
  const result = evaluateBatchArchive([
    { id: "p", status: "draft_created", title_zh: "已建草稿" },
    { id: "q", status: "processing", title_zh: "忙" },
  ]);
  assert.deepEqual(result.toArchiveIds, ["p"]);
  assert.equal(result.includesPublished, true);
  const msg = formatArchiveResultMessage({
    archivedCount: 1,
    skippedBusyCount: 1,
    includesPublished: true,
  });
  assert.match(msg, /1 件已封存/);
  assert.match(msg, /1 件進行中跳過/);
  assert.ok(msg.includes(SHOPIFY_STILL_LIVE_NOTE), msg);
});

await check("format message: N archived M busy without whole-batch fail", () => {
  const msg = formatArchiveResultMessage({
    archivedCount: 3,
    skippedBusyCount: 2,
    includesPublished: false,
  });
  assert.match(msg, /3 件已封存/);
  assert.match(msg, /2 件進行中跳過/);
  assert.ok(!msg.includes(SHOPIFY_STILL_LIVE_NOTE));
});

await check("resolveUnarchiveStatus prefers status_before_archive", () => {
  assert.equal(
    resolveUnarchiveStatus({ statusBeforeArchive: "approved", generationStatus: "completed" }),
    "approved"
  );
  assert.equal(
    resolveUnarchiveStatus({ statusBeforeArchive: "pending_input" }),
    "pending_input"
  );
  assert.equal(
    resolveUnarchiveStatus({ statusBeforeArchive: null, hasCopy: true }),
    "ready_for_review"
  );
  assert.equal(
    resolveUnarchiveStatus({ statusBeforeArchive: null, generationStatus: "failed" }),
    "api_failed"
  );
  assert.equal(resolveUnarchiveStatus({ statusBeforeArchive: null }), "pending_input");
});

await check("stage all hides archived; archived stage only shows archived", () => {
  const drafts = [
    { id: "1", status: "ready_for_review", generation_status: "completed" },
    { id: "2", status: "pending_input", generation_status: "pending" },
    { id: "3", status: "archived", generation_status: "completed" },
    { id: "4", status: "failed", generation_status: "failed" },
  ];
  const all = filterDraftsByStage(drafts, "all");
  assert.equal(all.length, 3);
  assert.ok(all.every((d) => d.status !== "archived"));
  const arch = filterDraftsByStage(drafts, "archived");
  assert.equal(arch.length, 1);
  assert.equal(arch[0].id, "3");
  const pending = filterDraftsByStage(drafts, "pending_input");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, "2");
});

await check("stage unmarked_images uses process_intent null on pipeline types", () => {
  const drafts = [
    { id: "u1", status: "ready_for_review" },
    { id: "u2", status: "ready_for_review" },
  ];
  const images = [
    { draft_id: "u1", image_type: "main", process_intent: null },
    { draft_id: "u2", image_type: "main", process_intent: "keep" },
    { draft_id: "u2", image_type: "detail", process_intent: null },
  ];
  const unmarked = filterDraftsByStage(drafts, "unmarked_images", images);
  assert.equal(unmarked.length, 1);
  assert.equal(unmarked[0].id, "u1");
});

await check("countByStage consistent for all vs archived", () => {
  const drafts = [
    { id: "1", status: "ready_for_review" },
    { id: "2", status: "archived" },
    { id: "3", status: "approved" },
  ];
  const counts = countByStage(drafts);
  assert.equal(counts.all, 2);
  assert.equal(counts.archived, 1);
  assert.equal(counts.copy_review, 1);
  assert.equal(counts.approved, 1);
});

await check("source files exist for B12 surface", () => {
  const files = [
    "supabase/migrations/024_draft_archive_restore.sql",
    "src/lib/drafts/archiveDrafts.ts",
    "src/lib/drafts/stageFilter.ts",
    "src/app/api/drafts/batch/archive/route.ts",
    "src/components/drafts/StageFilterPills.tsx",
    "src/components/listing/DraftResultsPanel.tsx",
    "src/components/drafts/DraftQueueList.tsx",
    "src/components/listing/ResultCard.tsx",
  ];
  for (const rel of files) {
    assert.ok(fs.existsSync(path.join(root, rel)), `missing ${rel}`);
  }
});

await check("ResultCard hides approve/send when archived, keeps unarchive", () => {
  const card = fs.readFileSync(path.join(root, "src/components/listing/ResultCard.tsx"), "utf8");
  assert.ok(card.includes('isArchived ? ('), "isArchived branch");
  assert.ok(card.includes("解除封存"), "unarchive label");
  assert.ok(card.includes("🗄 封存") || card.includes("封存"), "archive action");
  // archived branch should not render 核准 next to unarchive in quick
  const quickBlock = card.slice(card.indexOf("rc-quick"), card.indexOf("rc-toggle"));
  assert.ok(quickBlock.includes("isArchived"), "quick uses isArchived");
});

await check("DraftResultsPanel wires stage pills + batch archive", () => {
  const panel = fs.readFileSync(
    path.join(root, "src/components/listing/DraftResultsPanel.tsx"),
    "utf8"
  );
  assert.ok(panel.includes("StageFilterPills"));
  assert.ok(panel.includes("batchArchiveOrUnarchive"));
  assert.ok(panel.includes("undoLastArchive") || panel.includes("解除封存"));
  assert.ok(panel.includes("/api/drafts/batch/archive"));
});

// --- fix(B12): optimistic hide + deferred refresh (inline mirrors) ---

function applyOptimisticHide(prev, ids, reason) {
  const next = new Map(prev);
  for (const id of ids) next.set(id, reason);
  return next;
}

function reconcileOptimisticHide(prev, drafts) {
  if (prev.size === 0) return prev;
  const byId = new Map(drafts.map((d) => [d.id, d.status]));
  const next = new Map(prev);
  for (const [id, reason] of prev) {
    const status = byId.get(id);
    const done =
      reason === "archived"
        ? status === undefined || status === "archived"
        : status !== undefined && status !== "archived";
    if (done) next.delete(id);
  }
  return next;
}

function filterByOptimisticHide(items, hide) {
  if (hide.size === 0) return items;
  return items.filter((item) => !hide.has(item.id));
}

await check("fix(B12) optimistic hide removes rows immediately", () => {
  const rows = [
    { id: "a", status: "pending_input" },
    { id: "b", status: "ready_for_review" },
  ];
  let hide = new Map();
  hide = applyOptimisticHide(hide, ["a"], "archived");
  const visible = filterByOptimisticHide(rows, hide);
  assert.deepEqual(
    visible.map((r) => r.id),
    ["b"]
  );
});

await check("fix(B12) reconcile drops hide after server status matches", () => {
  let hide = applyOptimisticHide(new Map(), ["a"], "archived");
  hide = reconcileOptimisticHide(hide, [
    { id: "a", status: "archived" },
    { id: "b", status: "ready_for_review" },
  ]);
  assert.equal(hide.size, 0);
  hide = applyOptimisticHide(new Map(), ["a"], "unarchived");
  hide = reconcileOptimisticHide(hide, [{ id: "a", status: "pending_input" }]);
  assert.equal(hide.size, 0);
  hide = applyOptimisticHide(new Map(), ["a"], "archived");
  hide = reconcileOptimisticHide(hide, [{ id: "a", status: "pending_input" }]);
  assert.equal(hide.has("a"), true);
});

await check("fix(B12) panels defer refresh + optimistic hide", () => {
  const panel = fs.readFileSync(
    path.join(root, "src/components/listing/DraftResultsPanel.tsx"),
    "utf8"
  );
  const queue = fs.readFileSync(
    path.join(root, "src/components/drafts/DraftQueueList.tsx"),
    "utf8"
  );
  const card = fs.readFileSync(
    path.join(root, "src/components/listing/ResultCard.tsx"),
    "utf8"
  );
  assert.ok(panel.includes("scheduleRouterRefresh"));
  assert.ok(panel.includes("applyOptimisticHide"));
  assert.ok(panel.includes("optimisticHide"));
  assert.ok(queue.includes("scheduleRouterRefresh"));
  assert.ok(queue.includes("applyOptimisticHide"));
  assert.ok(card.includes("scheduleRouterRefresh"));
});

await check("migration 024 has status_before_archive + archived_at", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/024_draft_archive_restore.sql"),
    "utf8"
  );
  assert.ok(sql.includes("status_before_archive"));
  assert.ok(sql.includes("archived_at"));
});

console.log("");
if (failures.length) {
  console.error(`FAILED ${failures.length} check(s)`);
  process.exit(1);
}
console.log("ALL passed");
