/**
 * D5 image review pure-logic verification (no secrets).
 * Run: node scripts/verify-d5-image-review.mjs
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

// --- Inline mirrors of imageReview pure logic (keep in sync) ---
const IMAGE_REVIEW_FLAG_KEY = "image_review";
const IMAGE_REVIEW_APPROVED = "approved";
const IMAGE_REVIEWED_AT_KEY = "image_reviewed_at";

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

function mergeImageReviewApproved(existing, reviewedAtIso) {
  return {
    ...parseImageFlags(existing),
    [IMAGE_REVIEW_FLAG_KEY]: IMAGE_REVIEW_APPROVED,
    [IMAGE_REVIEWED_AT_KEY]: reviewedAtIso
  };
}

function clearImageReviewApproved(existing) {
  const next = { ...parseImageFlags(existing) };
  delete next[IMAGE_REVIEW_FLAG_KEY];
  delete next[IMAGE_REVIEWED_AT_KEY];
  return next;
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

function hasComparableProcessed(originalUrl, processedUrl) {
  const original = originalUrl?.trim() ?? "";
  const processed = processedUrl?.trim() ?? "";
  if (!processed) return false;
  if (!original) return true;
  return processed !== original;
}

function mergeRejectWarnings(existing, reason) {
  const list = Array.isArray(existing) ? existing.filter((w) => typeof w === "string") : [];
  const line = reason?.trim() ? `圖審拒絕：${reason.trim()}` : "圖審拒絕";
  if (!list.includes(line)) list.push(line);
  return list;
}

function canBatchConfirmAll(pendingIds, viewedIds) {
  const unviewedIds = pendingIds.filter((id) => !viewedIds.has(id));
  return {
    allowed: pendingIds.length > 0 && unviewedIds.length === 0,
    unviewedCount: unviewedIds.length
  };
}

console.log("D5 image review verify\n");

await check("files exist", () => {
  assert.ok(exists("src/lib/images/imageReview.ts"));
  assert.ok(exists("src/app/review/page.tsx"));
  assert.ok(exists("src/components/review/ImageReviewPanel.tsx"));
  assert.ok(exists("src/components/review/ImageCompareSlider.tsx"));
  assert.ok(exists("src/app/api/images/review-confirm/route.ts"));
  assert.ok(exists("src/app/api/images/review-reject/route.ts"));
});

await check("page not ComingSoon", () => {
  const page = read("src/app/review/page.tsx");
  assert.ok(!page.includes("ComingSoonPage"), "should replace ComingSoon");
  assert.ok(page.includes("ImageReviewPanel"));
});

await check("API merge flags / no whole wipe / no reviewed_at misuse", () => {
  const confirm = read("src/app/api/images/review-confirm/route.ts");
  const reject = read("src/app/api/images/review-reject/route.ts");
  assert.ok(confirm.includes("mergeImageReviewApproved"));
  // Must not write copy-review columns (substring-safe: image_reviewed_at is OK)
  assert.ok(!/[^_a-z]reviewed_at\s*:/.test(confirm));
  assert.ok(!/reviewed_by\s*:/.test(confirm));
  assert.ok(!/[^_a-z]reviewed_at\s*:/.test(reject));
  assert.ok(!/reviewed_by\s*:/.test(reject));
  assert.ok(reject.includes('image_status: "failed"') || reject.includes("image_status: 'failed'"));
  assert.ok(reject.includes("clearImageReviewApproved"));
  assert.ok(reject.includes("mergeRejectWarnings"));
  assert.ok(reject.includes("Does NOT call Image API") || reject.includes("Does NOT call"));
});

await check("CSS layout classes present", () => {
  const css = read("src/app/globals.css");
  assert.ok(css.includes(".irq-banner"));
  assert.ok(css.includes(".ir-card"));
  assert.ok(css.includes(".cmp-range"));
  assert.ok(css.includes(".cmp-lb"));
});

await check("parse + merge flags preserve other keys", () => {
  const merged = mergeImageReviewApproved({ foo: "bar", image_review: "nope" }, "2026-07-13T00:00:00.000Z");
  assert.equal(merged.foo, "bar");
  assert.equal(merged.image_review, "approved");
  assert.equal(merged.image_reviewed_at, "2026-07-13T00:00:00.000Z");
  const cleared = clearImageReviewApproved(merged);
  assert.equal(cleared.foo, "bar");
  assert.equal(cleared.image_review, undefined);
});

await check("classify queue kinds Q3-A", () => {
  assert.equal(
    classifyReviewQueueItem({ status: "ready_for_review", image_status: "done", image_flags: {} }),
    "pending_review"
  );
  assert.equal(
    classifyReviewQueueItem({
      status: "ready_for_review",
      image_status: "done",
      image_flags: { image_review: "approved" }
    }),
    null
  );
  assert.equal(
    classifyReviewQueueItem({ status: "ready_for_review", image_status: "processing", image_flags: {} }),
    "processing"
  );
  assert.equal(
    classifyReviewQueueItem({ status: "ready_for_review", image_status: "failed", image_flags: {} }),
    "failed"
  );
  assert.equal(
    classifyReviewQueueItem({ status: "archived", image_status: "done", image_flags: {} }),
    null
  );
  assert.equal(
    classifyReviewQueueItem({ status: "ready_for_review", image_status: "pending", image_flags: {} }),
    null
  );
});

await check("slider comparable rule", () => {
  assert.equal(hasComparableProcessed("a", "b"), true);
  assert.equal(hasComparableProcessed("a", "a"), false);
  assert.equal(hasComparableProcessed("a", null), false);
  assert.equal(hasComparableProcessed(null, "b"), true);
});

await check("reject warnings", () => {
  const w = mergeRejectWarnings(["既有"], "字太大");
  assert.deepEqual(w, ["既有", "圖審拒絕：字太大"]);
  const w2 = mergeRejectWarnings([], "");
  assert.deepEqual(w2, ["圖審拒絕"]);
});

await check("batch confirm viewed hard-block Q4-A", () => {
  const pending = ["a", "b", "c"];
  const partial = canBatchConfirmAll(pending, new Set(["a", "b"]));
  assert.equal(partial.allowed, false);
  assert.equal(partial.unviewedCount, 1);
  const full = canBatchConfirmAll(pending, new Set(["a", "b", "c"]));
  assert.equal(full.allowed, true);
  const empty = canBatchConfirmAll([], new Set());
  assert.equal(empty.allowed, false);
});

await check("imageReview.ts exports key symbols", () => {
  const src = read("src/lib/images/imageReview.ts");
  for (const sym of [
    "mergeImageReviewApproved",
    "clearImageReviewApproved",
    "classifyReviewQueueItem",
    "canBatchConfirmAll",
    "hasComparableProcessed",
    "formatUnviewedBlockMessage"
  ]) {
    assert.ok(src.includes(`export function ${sym}`), `missing ${sym}`);
  }
});

console.log("");
if (failures.length) {
  console.error(`FAILED ${failures.length} check(s)`);
  process.exit(1);
}
console.log("ALL passed");
