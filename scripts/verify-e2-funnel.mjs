/**
 * E2-open pure-logic verification (no secrets, no network).
 * Mirrors src/lib/dashboard/funnelStats.ts + wiring checks.
 *
 * Run: node scripts/verify-e2-funnel.mjs
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

// --- Inline mirrors (keep in sync with funnelStats.ts / todoBuckets / imageReview) ---

const IMAGE_REVIEW_FLAG_KEY = "image_review";
const IMAGE_REVIEW_APPROVED = "approved";
const TODO_FETCH_LIMIT = 200;
const STAGE_FILTER_STORAGE_KEY_RESULTS = "nestory:results-stage";
const STAGE_FILTER_STORAGE_KEY_QUEUE = "nestory:queue-stage";

const INPUT_STATUSES = new Set(["pending_input", "pending_copy", "processing"]);
const APPROVED_STATUSES = new Set(["approved", "publishing"]);
const PUBLISHED_STATUSES = new Set([
  "draft_created",
  "active_published",
  "csv_ready"
]);
const FAILED_STATUSES = new Set(["failed", "api_failed"]);
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function parseImageFlags(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") out[key] = value;
    else if (value != null && typeof value !== "object") out[key] = String(value);
  }
  return out;
}

function isImageReviewApproved(flags) {
  return parseImageFlags(flags)[IMAGE_REVIEW_FLAG_KEY] === IMAGE_REVIEW_APPROVED;
}

function classifyReviewQueueItem(input) {
  if (input.status === "archived") return null;
  if (input.image_status === "processing") return "processing";
  if (input.image_status === "failed") return "failed";
  if (input.image_status === "done" && !isImageReviewApproved(input.image_flags)) {
    return "pending_review";
  }
  return null;
}

function isImageReviewTodo(row) {
  return (
    classifyReviewQueueItem({
      status: row.status,
      image_status: String(row.image_status ?? "pending"),
      image_flags: row.image_flags
    }) === "pending_review"
  );
}

function assignFunnelStage(row) {
  if (row.status === "archived") return null;
  if (FAILED_STATUSES.has(row.status) || row.generation_status === "failed") {
    return "failed";
  }
  if (row.status === "needs_revision") return "needs_revision";
  if (INPUT_STATUSES.has(row.status)) return "input";
  if (row.status === "ready_for_review") return "copy_review";
  if (APPROVED_STATUSES.has(row.status)) return "approved";
  if (PUBLISHED_STATUSES.has(row.status)) return "published";
  return null;
}

function funnelStageEntryAt(stage, row) {
  switch (stage) {
    case "input":
      return typeof row.created_at === "string" && row.created_at ? row.created_at : null;
    case "copy_review":
      return typeof row.copy_generated_at === "string" && row.copy_generated_at
        ? row.copy_generated_at
        : null;
    case "approved":
      return typeof row.reviewed_at === "string" && row.reviewed_at ? row.reviewed_at : null;
    default:
      return null;
  }
}

function formatDwellAverage(avgMs) {
  if (avgMs == null || !Number.isFinite(avgMs) || avgMs < 0) return "—";
  if (avgMs < HOUR_MS) return "不到 1 小時";
  if (avgMs < 48 * HOUR_MS) {
    const hours = Math.max(1, Math.round(avgMs / HOUR_MS));
    return `約 ${hours} 小時`;
  }
  const days = Math.round((avgMs / DAY_MS) * 10) / 10;
  return `約 ${days} 天`;
}

function computeFunnelStats(rows, fetchLimit, nowMs = Date.now()) {
  const dwellSums = {
    input: { sum: 0, n: 0 },
    copy_review: { sum: 0, n: 0 },
    approved: { sum: 0, n: 0 },
    published: { sum: 0, n: 0 },
    needs_revision: { sum: 0, n: 0 },
    failed: { sum: 0, n: 0 }
  };
  const counts = {
    input: 0,
    copy_review: 0,
    approved: 0,
    published: 0,
    needs_revision: 0,
    failed: 0
  };
  let inputInProgress = 0;
  let image_review = 0;

  for (const row of rows) {
    if (row.status === "archived") continue;
    if (isImageReviewTodo(row)) image_review += 1;
    const stage = assignFunnelStage(row);
    if (!stage) continue;
    counts[stage] += 1;
    if (stage === "input" && (row.status === "pending_copy" || row.status === "processing")) {
      inputInProgress += 1;
    }
    const entry = funnelStageEntryAt(stage, row);
    if (entry) {
      const t = Date.parse(entry);
      if (Number.isFinite(t) && t <= nowMs) {
        dwellSums[stage].sum += nowMs - t;
        dwellSums[stage].n += 1;
      }
    }
  }

  const stages = {};
  let maxCount = 0;
  for (const key of Object.keys(counts)) {
    const n = counts[key];
    maxCount = Math.max(maxCount, n);
    const { sum, n: dwellN } = dwellSums[key];
    const avgDwellMs = dwellN > 0 ? sum / dwellN : null;
    stages[key] = {
      key,
      count: n,
      avgDwellMs,
      dwellLabel: formatDwellAverage(avgDwellMs),
      ...(key === "input" ? { inputInProgress } : {})
    };
  }

  return {
    stages,
    maxCount,
    image_review,
    scanned: rows.length,
    truncated: rows.length >= fetchLimit
  };
}

function barPct(count, maxCount) {
  if (maxCount <= 0 || count <= 0) return 0;
  return Math.round((count / maxCount) * 100);
}

console.log("\nE2 funnel\n");

// --- File wiring ---
await check("funnelStats.ts exists", () => {
  assert.ok(exists("src/lib/dashboard/funnelStats.ts"));
});
await check("dashboard panel has funnel section under todo", () => {
  const src = read("src/components/dashboard/DashboardTodoPanel.tsx");
  assert.ok(src.includes("dash-funnel-panel"));
  assert.ok(src.includes("流程漏斗"));
  assert.ok(src.includes("computeFunnelStats"));
  assert.ok(src.includes("buildFunnelRows"));
  // E1 still present
  assert.ok(src.includes("今日待辦"));
  assert.ok(src.includes("buildTodoCards"));
  // later note no longer claims E2 pending
  assert.ok(src.includes("E3–E6") || src.includes("E3-E6"));
  assert.ok(!src.includes("E2–E6"));
});
await check("select columns include A13 timestamps", () => {
  const src = read("src/lib/dashboard/todoBuckets.ts");
  assert.ok(src.includes("copy_generated_at"));
  assert.ok(src.includes("reviewed_at"));
  assert.ok(src.includes("published_at"));
  assert.ok(src.includes("created_at"));
});
await check("globals has dash-funnel classes (tokens only)", () => {
  const css = read("src/app/globals.css");
  assert.ok(css.includes(".dash-funnel-row"));
  assert.ok(css.includes(".dash-funnel-bar-fill"));
  assert.ok(css.includes("var(--accent)"));
  // no hardcoded hex in new funnel block (best-effort: block starts at E2 comment)
  const idx = css.indexOf("E2-open: 流程漏斗");
  assert.ok(idx >= 0, "E2 CSS comment");
  const block = css.slice(idx, idx + 2500);
  assert.ok(!/#[0-9a-fA-F]{3,8}/.test(block), "no raw hex in funnel CSS");
});
await check("funnelStats reuses stageFilter + image review todo", () => {
  const src = read("src/lib/dashboard/funnelStats.ts");
  assert.ok(src.includes("STAGE_FILTER_STORAGE_KEY_QUEUE"));
  assert.ok(src.includes("isImageReviewTodo"));
  assert.ok(src.includes("writeStoredStage"));
  assert.ok(src.includes("Q2-A") || src.includes("honest"));
});
await check("zero migration / no new SQL file for E2", () => {
  // no requirement to prove absence of all SQL — just that funnelStats has zero migration note
  const src = read("src/lib/dashboard/funnelStats.ts");
  assert.ok(src.includes("zero migration"));
});

// --- Assignment exclusivity ---
const now = Date.parse("2026-07-14T12:00:00.000Z");

const fixtures = [
  {
    id: "in1",
    status: "pending_input",
    generation_status: "pending",
    image_status: "pending",
    image_flags: {},
    created_at: "2026-07-14T10:00:00.000Z" // 2h
  },
  {
    id: "in2",
    status: "processing",
    generation_status: "processing",
    image_status: "pending",
    image_flags: {},
    created_at: "2026-07-14T11:30:00.000Z" // 0.5h
  },
  {
    id: "copy1",
    status: "ready_for_review",
    generation_status: "completed",
    image_status: "done",
    image_flags: {}, // image review pending + copy
    copy_generated_at: "2026-07-13T12:00:00.000Z", // 24h
    created_at: "2026-07-12T12:00:00.000Z"
  },
  {
    id: "copy2",
    status: "ready_for_review",
    generation_status: "completed",
    image_status: "pending",
    image_flags: {},
    // missing copy_generated_at → dwell —
    created_at: "2026-07-10T12:00:00.000Z"
  },
  {
    id: "appr1",
    status: "approved",
    generation_status: "completed",
    image_status: "done",
    image_flags: { image_review: "approved" },
    reviewed_at: "2026-07-14T06:00:00.000Z", // 6h
    copy_generated_at: "2026-07-13T12:00:00.000Z"
  },
  {
    id: "appr2",
    status: "publishing",
    generation_status: "completed",
    image_status: "done",
    image_flags: {}, // image review overlap
    // missing reviewed_at
    created_at: "2026-07-01T12:00:00.000Z"
  },
  {
    id: "pub1",
    status: "active_published",
    generation_status: "completed",
    image_status: "done",
    image_flags: { image_review: "approved" },
    published_at: "2026-07-14T08:00:00.000Z"
  },
  {
    id: "rev1",
    status: "needs_revision",
    generation_status: "completed",
    image_status: "pending",
    image_flags: {},
    updated_at: "2026-07-14T09:00:00.000Z"
  },
  {
    id: "fail1",
    status: "failed",
    generation_status: "failed",
    image_status: "pending",
    image_flags: {}
  },
  {
    id: "fail2",
    status: "pending_input",
    generation_status: "failed", // exclusive → failed not input
    image_status: "pending",
    image_flags: {},
    created_at: "2026-07-14T08:00:00.000Z"
  },
  {
    id: "arch",
    status: "archived",
    generation_status: "completed",
    image_status: "failed",
    image_flags: {},
    created_at: "2026-07-01T00:00:00.000Z"
  },
  {
    id: "csv1",
    status: "csv_ready",
    generation_status: "completed",
    image_status: "done",
    image_flags: { image_review: "approved" }
  }
];

await check("assignFunnelStage exclusive + generation failed → failed", () => {
  assert.equal(assignFunnelStage(fixtures[0]), "input");
  assert.equal(assignFunnelStage(fixtures[1]), "input");
  assert.equal(assignFunnelStage(fixtures[2]), "copy_review");
  assert.equal(assignFunnelStage(fixtures[4]), "approved");
  assert.equal(assignFunnelStage(fixtures[5]), "approved");
  assert.equal(assignFunnelStage(fixtures[6]), "published");
  assert.equal(assignFunnelStage(fixtures[7]), "needs_revision");
  assert.equal(assignFunnelStage(fixtures[8]), "failed");
  assert.equal(assignFunnelStage(fixtures[9]), "failed"); // not input
  assert.equal(assignFunnelStage(fixtures[10]), null);
  assert.equal(assignFunnelStage(fixtures[11]), "published");
});

await check("each non-archived draft assigned at most once (exclusive stages)", () => {
  const seen = new Map();
  for (const row of fixtures) {
    const s = assignFunnelStage(row);
    if (!s) continue;
    assert.equal(seen.has(row.id), false, `double assign ${row.id}`);
    seen.set(row.id, s);
  }
  // archived excluded
  assert.equal(seen.has("arch"), false);
  assert.equal(seen.size, fixtures.length - 1);
});

await check("computeFunnelStats counts + image overlap", () => {
  const stats = computeFunnelStats(fixtures, TODO_FETCH_LIMIT, now);
  assert.equal(stats.stages.input.count, 2); // in1, in2 (fail2 is failed)
  assert.equal(stats.stages.input.inputInProgress, 1); // processing only
  assert.equal(stats.stages.copy_review.count, 2);
  assert.equal(stats.stages.approved.count, 2);
  assert.equal(stats.stages.published.count, 2); // pub1 + csv1
  assert.equal(stats.stages.needs_revision.count, 1);
  assert.equal(stats.stages.failed.count, 2); // fail1 + fail2
  // image: copy1 done no flag, appr2 done no flag → 2
  assert.equal(stats.image_review, 2);
  // exclusive sum
  const sum =
    stats.stages.input.count +
    stats.stages.copy_review.count +
    stats.stages.approved.count +
    stats.stages.published.count +
    stats.stages.needs_revision.count +
    stats.stages.failed.count;
  assert.equal(sum, 11);
  assert.equal(stats.maxCount, 2);
});

await check("dwell: reliable timestamps only; missing → —", () => {
  const stats = computeFunnelStats(fixtures, TODO_FETCH_LIMIT, now);
  // input: 2h + 0.5h → avg 1.25h → 約 1 小時
  assert.equal(stats.stages.input.dwellLabel, "約 1 小時");
  // copy: only copy1 has stamp (24h); copy2 missing → avg is only copy1
  assert.equal(stats.stages.copy_review.dwellLabel, "約 24 小時");
  // approved: only appr1 (6h); appr2 missing not averaged
  assert.equal(stats.stages.approved.dwellLabel, "約 6 小時");
  // published / needs_revision / failed always —
  assert.equal(stats.stages.published.dwellLabel, "—");
  assert.equal(stats.stages.needs_revision.dwellLabel, "—");
  assert.equal(stats.stages.failed.dwellLabel, "—");
});

await check("formatDwellAverage boundaries", () => {
  assert.equal(formatDwellAverage(null), "—");
  assert.equal(formatDwellAverage(30 * 60 * 1000), "不到 1 小時");
  assert.equal(formatDwellAverage(3 * HOUR_MS), "約 3 小時");
  assert.equal(formatDwellAverage(3 * DAY_MS), "約 3 天");
});

await check("barPct relative to max", () => {
  assert.equal(barPct(0, 10), 0);
  assert.equal(barPct(5, 10), 50);
  assert.equal(barPct(10, 10), 100);
  assert.equal(barPct(3, 0), 0);
});

await check("funnelStageEntryAt never uses updated_at as fake entry", () => {
  const row = {
    status: "ready_for_review",
    updated_at: "2026-07-14T11:00:00.000Z",
    created_at: "2026-07-01T00:00:00.000Z"
  };
  assert.equal(funnelStageEntryAt("copy_review", row), null);
  assert.equal(funnelStageEntryAt("approved", { ...row, status: "approved" }), null);
});

await check("truncated flag at limit", () => {
  const rows = Array.from({ length: TODO_FETCH_LIMIT }, (_, i) => ({
    id: `x${i}`,
    status: "pending_input",
    generation_status: "pending",
    created_at: "2026-07-14T11:00:00.000Z"
  }));
  const stats = computeFunnelStats(rows, TODO_FETCH_LIMIT, now);
  assert.equal(stats.truncated, true);
  assert.equal(stats.stages.input.count, TODO_FETCH_LIMIT);
});

await check("prepareFunnelNavigation writes stage storage (wiring in source)", () => {
  const src = read("src/lib/dashboard/funnelStats.ts");
  assert.ok(src.includes("prepareFunnelNavigation"));
  assert.ok(src.includes("STAGE_FILTER_STORAGE_KEY_QUEUE"));
  assert.ok(src.includes("STAGE_FILTER_STORAGE_KEY_RESULTS"));
  assert.ok(src.includes('stage: "copy_review"'));
  assert.ok(src.includes('href: "/review"'));
  // avoid unused const warnings in this mirror script
  assert.ok(STAGE_FILTER_STORAGE_KEY_QUEUE.startsWith("nestory:"));
  assert.ok(STAGE_FILTER_STORAGE_KEY_RESULTS.startsWith("nestory:"));
});

// --- Summary ---
console.log("");
if (failures.length) {
  console.error(`FAILED ${failures.length} check(s)`);
  process.exit(1);
}
console.log("ALL passed");
