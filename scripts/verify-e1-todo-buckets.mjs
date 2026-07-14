/**
 * E1-open pure-logic verification (no secrets, no network).
 * Mirrors src/lib/dashboard/todoBuckets.ts + file wiring checks.
 *
 * Run: node scripts/verify-e1-todo-buckets.mjs
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

// --- Inline mirrors (keep in sync with todoBuckets.ts / imageReview.ts / stageFilter) ---

const IMAGE_REVIEW_FLAG_KEY = "image_review";
const IMAGE_REVIEW_APPROVED = "approved";
const TODO_FETCH_LIMIT = 200;
const STAGE_FILTER_STORAGE_KEY_RESULTS = "nestory:results-stage";
const STAGE_FILTER_STORAGE_KEY_QUEUE = "nestory:queue-stage";

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

function isCopyReviewTodo(row) {
  if (row.status === "archived") return false;
  return row.status === "ready_for_review";
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

function isFlowFailedTodo(row) {
  if (row.status === "archived") return false;
  return (
    row.status === "failed" ||
    row.status === "api_failed" ||
    row.generation_status === "failed"
  );
}

function isImageFailedTodo(row) {
  if (row.status === "archived") return false;
  return row.image_status === "failed";
}

function isFailedUnionTodo(row) {
  return isFlowFailedTodo(row) || isImageFailedTodo(row);
}

function isReadyToPublishTodo(row) {
  if (row.status === "archived") return false;
  return row.status === "approved" || row.status === "publishing";
}

function countTodoBuckets(rows, fetchLimit = TODO_FETCH_LIMIT) {
  let copy_review = 0;
  let image_review = 0;
  let failed = 0;
  let failed_image = 0;
  let ready_to_publish = 0;
  for (const row of rows) {
    if (row.status === "archived") continue;
    if (isCopyReviewTodo(row)) copy_review += 1;
    if (isImageReviewTodo(row)) image_review += 1;
    if (isFailedUnionTodo(row)) failed += 1;
    if (isImageFailedTodo(row)) failed_image += 1;
    if (isReadyToPublishTodo(row)) ready_to_publish += 1;
  }
  return {
    copy_review,
    image_review,
    failed,
    failed_image,
    ready_to_publish,
    scanned: rows.length,
    truncated: rows.length >= fetchLimit
  };
}

function buildTodoCards(counts) {
  const failedSub = counts.failed_image > 0 ? `含圖失敗 ${counts.failed_image}` : null;
  return [
    {
      key: "copy_review",
      label: "文案待審",
      count: counts.copy_review,
      href: "/drafts/new",
      stage: "copy_review",
      stageStorageKey: STAGE_FILTER_STORAGE_KEY_RESULTS
    },
    {
      key: "image_review",
      label: "圖片待審",
      count: counts.image_review,
      href: "/review"
    },
    {
      key: "failed",
      label: "失敗",
      count: counts.failed,
      sub: failedSub,
      href: "/drafts",
      stage: "failed",
      stageStorageKey: STAGE_FILTER_STORAGE_KEY_QUEUE
    },
    {
      key: "ready_to_publish",
      label: "待發布",
      count: counts.ready_to_publish,
      href: "/drafts",
      stage: "approved",
      stageStorageKey: STAGE_FILTER_STORAGE_KEY_QUEUE
    }
  ];
}

function prepareTodoNavigation(card, storage) {
  if (card.stage && card.stageStorageKey && storage) {
    storage.setItem(card.stageStorageKey, card.stage);
  }
  return card.href;
}

console.log("\nE1 todo buckets\n");

// --- File wiring ---
await check("todoBuckets.ts exists", () => {
  assert.ok(exists("src/lib/dashboard/todoBuckets.ts"));
});
await check("DashboardTodoPanel.tsx exists", () => {
  assert.ok(exists("src/components/dashboard/DashboardTodoPanel.tsx"));
});
await check("dashboard page uses DashboardTodoPanel not ComingSoon", () => {
  const src = read("src/app/dashboard/page.tsx");
  assert.ok(src.includes("DashboardTodoPanel"), "must import panel");
  assert.ok(!src.includes("ComingSoonPage"), "must not use ComingSoon");
  assert.ok(src.includes("redirect") || src.includes("login"), "auth gate");
});
await check("globals has dash-todo classes", () => {
  const css = read("src/app/globals.css");
  assert.ok(css.includes(".dash-todo-grid"));
  assert.ok(css.includes(".dash-todo-card"));
  assert.ok(css.includes("E1 dashboard") || css.includes("dash-todo"));
});
await check("panel wires session + scope mine default", () => {
  const src = read("src/components/dashboard/DashboardTodoPanel.tsx");
  assert.ok(src.includes('useState<ScopeMode>("mine")'));
  assert.ok(src.includes("created_by"));
  assert.ok(src.includes("prepareTodoNavigation"));
  assert.ok(src.includes("TODO_FETCH_LIMIT"));
  assert.ok(src.includes("isAdmin"));
});
await check("todoBuckets imports stageFilter + imageReview helpers", () => {
  const src = read("src/lib/dashboard/todoBuckets.ts");
  assert.ok(src.includes("classifyReviewQueueItem"));
  assert.ok(src.includes("writeStoredStage"));
  assert.ok(src.includes("STAGE_FILTER_STORAGE_KEY_RESULTS"));
  assert.ok(src.includes("TODO_FETCH_LIMIT = 200"));
});

// --- Bucket classification ---
const fixtures = [
  {
    id: "a",
    status: "ready_for_review",
    generation_status: "completed",
    image_status: "pending",
    image_flags: {}
  },
  {
    id: "b",
    status: "approved",
    generation_status: "completed",
    image_status: "done",
    image_flags: {} // pending image review while approved — can be both image_review + ready
  },
  {
    id: "c",
    status: "approved",
    generation_status: "completed",
    image_status: "done",
    image_flags: { image_review: "approved" }
  },
  {
    id: "d",
    status: "failed",
    generation_status: "failed",
    image_status: "pending",
    image_flags: {}
  },
  {
    id: "e",
    status: "api_failed",
    generation_status: "completed",
    image_status: "pending",
    image_flags: {}
  },
  {
    id: "f",
    status: "ready_for_review",
    generation_status: "completed",
    image_status: "failed",
    image_flags: {} // copy review + failed union + image failed
  },
  {
    id: "g",
    status: "publishing",
    generation_status: "completed",
    image_status: "done",
    image_flags: { image_review: "approved" }
  },
  {
    id: "h",
    status: "archived",
    generation_status: "completed",
    image_status: "failed",
    image_flags: {}
  },
  {
    id: "i",
    status: "active_published",
    generation_status: "completed",
    image_status: "done",
    image_flags: { image_review: "approved" }
  },
  {
    id: "j",
    status: "pending_input",
    generation_status: "failed",
    image_status: "pending",
    image_flags: {} // generation failed → failed union even if status not failed
  },
  {
    id: "k",
    status: "draft_created",
    generation_status: "completed",
    image_status: "done",
    image_flags: {} // published draft — image pending review still? yes if done without flag
  }
];

await check("isCopyReviewTodo only ready_for_review", () => {
  assert.equal(isCopyReviewTodo(fixtures[0]), true);
  assert.equal(isCopyReviewTodo(fixtures[1]), false);
  assert.equal(isCopyReviewTodo(fixtures[7]), false); // archived
});

await check("isImageReviewTodo = done + not approved", () => {
  assert.equal(isImageReviewTodo(fixtures[1]), true);
  assert.equal(isImageReviewTodo(fixtures[2]), false);
  assert.equal(isImageReviewTodo(fixtures[5]), false); // failed image, not pending_review
  assert.equal(isImageReviewTodo(fixtures[10]), true); // k draft_created + done no flag
});

await check("failed union = flow ∪ image, no double count", () => {
  assert.equal(isFailedUnionTodo(fixtures[3]), true); // d failed
  assert.equal(isFailedUnionTodo(fixtures[4]), true); // e api_failed
  assert.equal(isFailedUnionTodo(fixtures[5]), true); // f image failed
  assert.equal(isFailedUnionTodo(fixtures[9]), true); // j generation_status failed
  assert.equal(isFailedUnionTodo(fixtures[0]), false);
  // same row both flow+image still one draft
  assert.equal(isFlowFailedTodo(fixtures[5]), false);
  assert.equal(isImageFailedTodo(fixtures[5]), true);
});

await check("ready_to_publish = approved | publishing", () => {
  assert.equal(isReadyToPublishTodo(fixtures[1]), true);
  assert.equal(isReadyToPublishTodo(fixtures[6]), true);
  assert.equal(isReadyToPublishTodo(fixtures[8]), false); // published
  assert.equal(isReadyToPublishTodo(fixtures[0]), false);
});

await check("archived excluded from all buckets", () => {
  const onlyArchived = [fixtures[7]];
  const c = countTodoBuckets(onlyArchived);
  assert.equal(c.copy_review, 0);
  assert.equal(c.image_review, 0);
  assert.equal(c.failed, 0);
  assert.equal(c.failed_image, 0);
  assert.equal(c.ready_to_publish, 0);
});

await check("countTodoBuckets aggregates fixture set", () => {
  const c = countTodoBuckets(fixtures);
  // copy: a, f
  assert.equal(c.copy_review, 2);
  // image pending: b (approved done no flag), k (draft_created done no flag)
  // not a (pending), not c (approved flag), not f (failed)
  assert.equal(c.image_review, 2);
  // failed union: d, e, f, j (h archived skipped)
  assert.equal(c.failed, 4);
  // image failed only: f (h archived)
  assert.equal(c.failed_image, 1);
  // ready: b, c, g
  assert.equal(c.ready_to_publish, 3);
  assert.equal(c.scanned, fixtures.length);
  assert.equal(c.truncated, false);
});

await check("truncated when length >= limit", () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({
    id: String(i),
    status: "pending_input",
    generation_status: "pending",
    image_status: "pending",
    image_flags: {}
  }));
  const c = countTodoBuckets(rows, 200);
  assert.equal(c.truncated, true);
  assert.equal(c.scanned, 200);
});

await check("buildTodoCards always 4 cards including zeros", () => {
  const empty = countTodoBuckets([]);
  const cards = buildTodoCards(empty);
  assert.equal(cards.length, 4);
  assert.ok(cards.every((x) => x.count === 0));
  assert.equal(cards[2].sub, null);
});

await check("failed card sub shows 含圖失敗 n", () => {
  const c = countTodoBuckets(fixtures);
  const cards = buildTodoCards(c);
  const failedCard = cards.find((x) => x.key === "failed");
  assert.equal(failedCard.sub, "含圖失敗 1");
});

await check("Q4-A navigation writes stage storage", () => {
  const store = new Map();
  const storage = {
    setItem(k, v) {
      store.set(k, v);
    }
  };
  const cards = buildTodoCards(countTodoBuckets(fixtures));
  const copy = cards.find((x) => x.key === "copy_review");
  assert.equal(prepareTodoNavigation(copy, storage), "/drafts/new");
  assert.equal(store.get(STAGE_FILTER_STORAGE_KEY_RESULTS), "copy_review");

  const ready = cards.find((x) => x.key === "ready_to_publish");
  assert.equal(prepareTodoNavigation(ready, storage), "/drafts");
  assert.equal(store.get(STAGE_FILTER_STORAGE_KEY_QUEUE), "approved");

  const fail = cards.find((x) => x.key === "failed");
  assert.equal(prepareTodoNavigation(fail, storage), "/drafts");
  assert.equal(store.get(STAGE_FILTER_STORAGE_KEY_QUEUE), "failed");

  const img = cards.find((x) => x.key === "image_review");
  assert.equal(prepareTodoNavigation(img, storage), "/review");
});

await check("one draft can land in multiple buckets", () => {
  // f: ready_for_review + image failed → copy + failed
  assert.equal(isCopyReviewTodo(fixtures[5]), true);
  assert.equal(isFailedUnionTodo(fixtures[5]), true);
  // b: approved + image pending → ready + image_review
  assert.equal(isReadyToPublishTodo(fixtures[1]), true);
  assert.equal(isImageReviewTodo(fixtures[1]), true);
});

// --- Summary ---
console.log("");
if (failures.length) {
  console.error(`FAIL ${failures.length} check(s)`);
  process.exit(1);
}
console.log("ALL passed");
