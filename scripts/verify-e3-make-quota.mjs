/**
 * E3-open pure-logic verification (no secrets, no network).
 * Mirrors src/lib/dashboard/makeQuotaStats.ts + wiring checks.
 *
 * Run: node scripts/verify-e3-make-quota.mjs
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

// --- Inline mirrors (keep in sync with makeQuotaStats.ts) ---

const DEFAULT_MAKE_OPS_LIMIT = 1000;
const DEFAULT_OPS_PER_IMAGE_ITEM = 8;
const DEFAULT_OPS_PER_PUBLISH_ITEM = 3;
const MAKE_QUOTA_WARN_RATIO = 0.8;

function taiwanYmdParts(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const bag = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day)
  };
}

function taiwanYmdHmsParts(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const bag = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second)
  };
}

function taipeiLocalToUtcIso(year, month, day, hour = 0, minute = 0, second = 0) {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 3; i++) {
    const asIf = new Date(utcMs);
    const parts = taiwanYmdHmsParts(asIf);
    const want = Date.UTC(year, month - 1, day, hour, minute, second);
    const got = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    const delta = want - got;
    if (delta === 0) break;
    utcMs += delta;
  }
  return new Date(utcMs).toISOString();
}

function taiwanMonthRange(now = new Date()) {
  const parts = taiwanYmdParts(now);
  const y = parts.year;
  const m = parts.month;
  const startIso = taipeiLocalToUtcIso(y, m, 1, 0, 0, 0);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const endIso = taipeiLocalToUtcIso(nextY, nextM, 1, 0, 0, 0);
  return {
    startIso,
    endIso,
    labelYm: `${y}/${String(m).padStart(2, "0")}`,
    rangeHint: `${m}/1～今天`
  };
}

function isCreatedInTaiwanMonth(createdAt, range) {
  if (!createdAt || typeof createdAt !== "string") return false;
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return false;
  const start = Date.parse(range.startIso);
  const end = Date.parse(range.endIso);
  return t >= start && t < end;
}

function sumBatchTotalCount(rows) {
  let sum = 0;
  for (const r of rows) {
    const n = r.total_count;
    if (typeof n === "number" && Number.isFinite(n) && n > 0) {
      sum += Math.floor(n);
    }
  }
  return sum;
}

function estimateMakeOps({ imageItemCount, publishItemCount, weights }) {
  const perImage = weights?.perImageItem ?? DEFAULT_OPS_PER_IMAGE_ITEM;
  const perPub = weights?.perPublishItem ?? DEFAULT_OPS_PER_PUBLISH_ITEM;
  return (
    Math.max(0, Math.floor(imageItemCount)) * perImage +
    Math.max(0, Math.floor(publishItemCount)) * perPub
  );
}

function computeMakeQuotaView(input) {
  const month = taiwanMonthRange(input.now ?? new Date());
  const imageInMonth = input.imageBatches.filter((r) =>
    isCreatedInTaiwanMonth(r.created_at, month)
  );
  const publishInMonth = input.publishBatches.filter((r) =>
    isCreatedInTaiwanMonth(r.created_at, month)
  );
  const imageItemCount = sumBatchTotalCount(imageInMonth);
  const publishItemCount = sumBatchTotalCount(publishInMonth);
  const used = estimateMakeOps({
    imageItemCount,
    publishItemCount,
    weights: input.weights
  });
  const limitRaw = input.limit ?? DEFAULT_MAKE_OPS_LIMIT;
  const limit =
    typeof limitRaw === "number" && Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.floor(limitRaw)
      : DEFAULT_MAKE_OPS_LIMIT;
  const remaining = Math.max(0, limit - used);
  const usedRatio = limit > 0 ? used / limit : 0;
  const barPct = Math.min(100, Math.round(usedRatio * 100));
  const warn = usedRatio >= MAKE_QUOTA_WARN_RATIO;
  return {
    used,
    limit,
    remaining,
    barPct,
    usedRatio,
    warn,
    honestyLabel: "估算 · 非 Make 帳單",
    imageItemCount,
    publishItemCount,
    imageBatchCount: imageInMonth.length,
    publishBatchCount: publishInMonth.length,
    month
  };
}

/** P1-4: require missing-table phrase + batch table name (not bare name / 42P17). */
function isMissingBatchTableError(message) {
  if (!message) return false;
  const m = message.toLowerCase();
  const mentionsBatchTable =
    m.includes("image_batches") ||
    m.includes("image_batch_items") ||
    m.includes("publish_batches") ||
    m.includes("publish_batch_items");
  if (m.includes("42p01") || m.includes("pgrst205")) {
    return mentionsBatchTable || m.includes("batch");
  }
  if (!mentionsBatchTable) return false;
  return (
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    m.includes("could not find the table")
  );
}

function makeQuotaMigrationHint(imageError, publishError) {
  const imgMissing = imageError && isMissingBatchTableError(imageError);
  const pubMissing = publishError && isMissingBatchTableError(publishError);
  if (!imgMissing && !pubMissing) return null;
  const parts = [];
  if (imgMissing) parts.push("025（image_batches）");
  if (pubMissing) parts.push("027（publish_batches）");
  return `批次表尚未建立，請在 Supabase SQL Editor 執行 migration ${parts.join("、")}。額度無法估算。`;
}

function resolveMakeOpsLimit(envValue) {
  if (envValue == null || envValue === "") return DEFAULT_MAKE_OPS_LIMIT;
  const n = Number(envValue);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAKE_OPS_LIMIT;
  return Math.floor(n);
}

// ---------------------------------------------------------------------------
console.log("verify-e3-make-quota");

await check("files exist", () => {
  assert.ok(exists("src/lib/dashboard/makeQuotaStats.ts"));
  assert.ok(exists("src/components/dashboard/DashboardTodoPanel.tsx"));
  assert.ok(exists("scripts/verify-e3-make-quota.mjs"));
});

await check("source has honesty label and weights", () => {
  const lib = read("src/lib/dashboard/makeQuotaStats.ts");
  assert.ok(lib.includes("估算 · 非 Make 帳單"));
  assert.ok(lib.includes("DEFAULT_OPS_PER_IMAGE_ITEM = 8"));
  assert.ok(lib.includes("DEFAULT_OPS_PER_PUBLISH_ITEM = 3"));
  assert.ok(lib.includes("DEFAULT_MAKE_OPS_LIMIT = 1000"));
  assert.ok(lib.includes("MAKE_QUOTA_WARN_RATIO = 0.8"));
  assert.ok(lib.includes("Asia/Taipei"));
});

await check("Dashboard wires E3 below funnel, team-wide", () => {
  const ui = read("src/components/dashboard/DashboardTodoPanel.tsx");
  assert.ok(ui.includes("computeMakeQuotaView"));
  assert.ok(ui.includes("dash-quota-panel"));
  assert.ok(ui.includes("估算 · 非 Make 帳單"));
  assert.ok(ui.includes("image_batches"));
  assert.ok(ui.includes("publish_batches"));
  // team-wide: no created_by on batch queries (scope is only for drafts)
  assert.ok(ui.includes("E3 Q2-A: always team-wide"));
  assert.ok(ui.includes("E4–E6") || ui.includes("E4-E6") || ui.includes("E4"));
  // must not still claim E3 is later-only in footer
  assert.ok(!ui.includes("Make 額度／月預算成本／熱圖／AI 顧問 → 後續版本（E3–E6）"));
});

await check("CSS quota tokens only", () => {
  const css = read("src/app/globals.css");
  assert.ok(css.includes(".dash-quota-panel"));
  assert.ok(css.includes(".dash-quota-bar-fill--warn"));
  assert.ok(css.includes("var(--warn)"));
  assert.ok(css.includes("var(--accent)"));
});

await check("taiwan month range contains now", () => {
  const now = new Date("2026-07-14T12:00:00+08:00");
  const range = taiwanMonthRange(now);
  assert.equal(range.labelYm, "2026/07");
  assert.ok(range.rangeHint.includes("7/1"));
  const start = Date.parse(range.startIso);
  const end = Date.parse(range.endIso);
  assert.ok(start < end);
  assert.ok(now.getTime() >= start && now.getTime() < end);
  // Start should be Taipei July 1 00:00
  const startParts = taiwanYmdHmsParts(new Date(range.startIso));
  assert.equal(startParts.year, 2026);
  assert.equal(startParts.month, 7);
  assert.equal(startParts.day, 1);
  assert.equal(startParts.hour, 0);
});

await check("month boundary excludes previous month", () => {
  const now = new Date("2026-07-01T00:30:00+08:00");
  const range = taiwanMonthRange(now);
  // June 30 23:59 Taipei
  const june = "2026-06-30T15:59:59.000Z"; // still June in Taipei (UTC+8 → July 1 00:00 would be 2026-06-30T16:00:00Z)
  // 2026-06-30 23:59 Taipei = 2026-06-30T15:59:00Z
  assert.equal(isCreatedInTaiwanMonth("2026-06-30T15:59:00.000Z", range), false);
  // 2026-07-01 00:00 Taipei = 2026-06-30T16:00:00.000Z
  assert.equal(isCreatedInTaiwanMonth("2026-06-30T16:00:00.000Z", range), true);
});

await check("weighted estimate Q1-A: 8 + 3", () => {
  assert.equal(estimateMakeOps({ imageItemCount: 10, publishItemCount: 5 }), 10 * 8 + 5 * 3);
  assert.equal(estimateMakeOps({ imageItemCount: 0, publishItemCount: 0 }), 0);
  assert.equal(
    estimateMakeOps({
      imageItemCount: 2,
      publishItemCount: 1,
      weights: { perImageItem: 8, perPublishItem: 3 }
    }),
    19
  );
});

await check("quota view bar + 80% warn", () => {
  const now = new Date("2026-07-14T12:00:00+08:00");
  const inMonth = "2026-07-10T04:00:00.000Z";
  // 100 image items * 8 = 800 → 80% exactly → warn
  const view = computeMakeQuotaView({
    imageBatches: [{ total_count: 100, created_at: inMonth }],
    publishBatches: [],
    limit: 1000,
    now
  });
  assert.equal(view.used, 800);
  assert.equal(view.remaining, 200);
  assert.equal(view.barPct, 80);
  assert.equal(view.warn, true);
  assert.equal(view.honestyLabel, "估算 · 非 Make 帳單");

  const low = computeMakeQuotaView({
    imageBatches: [{ total_count: 1, created_at: inMonth }],
    publishBatches: [{ total_count: 1, created_at: inMonth }],
    limit: 1000,
    now
  });
  assert.equal(low.used, 8 + 3);
  assert.equal(low.warn, false);
  assert.equal(low.barPct, 1); // 11/1000 ≈ 1%

  const over = computeMakeQuotaView({
    imageBatches: [{ total_count: 200, created_at: inMonth }],
    publishBatches: [],
    limit: 1000,
    now
  });
  assert.equal(over.used, 1600);
  assert.equal(over.remaining, 0);
  assert.equal(over.barPct, 100);
  assert.equal(over.warn, true);
});

await check("out-of-month batches ignored", () => {
  const now = new Date("2026-07-14T12:00:00+08:00");
  const view = computeMakeQuotaView({
    imageBatches: [
      { total_count: 50, created_at: "2026-06-01T00:00:00.000Z" },
      { total_count: 2, created_at: "2026-07-05T00:00:00.000Z" }
    ],
    publishBatches: [{ total_count: 1, created_at: "2025-07-01T00:00:00.000Z" }],
    now
  });
  assert.equal(view.imageItemCount, 2);
  assert.equal(view.publishItemCount, 0);
  assert.equal(view.used, 16);
});

await check("missing table hint Q4-A", () => {
  const h1 = makeQuotaMigrationHint(
    'relation "public.image_batches" does not exist',
    null
  );
  assert.ok(h1 && h1.includes("025"));
  const h2 = makeQuotaMigrationHint(null, "Could not find the table 'publish_batches' in the schema cache");
  assert.ok(h2 && h2.includes("027"));
  const h3 = makeQuotaMigrationHint(
    "image_batches does not exist",
    "publish_batches does not exist"
  );
  assert.ok(h3 && h3.includes("025") && h3.includes("027"));
  assert.equal(makeQuotaMigrationHint("permission denied", null), null);
});

await check("resolveMakeOpsLimit", () => {
  assert.equal(resolveMakeOpsLimit(undefined), 1000);
  assert.equal(resolveMakeOpsLimit(""), 1000);
  assert.equal(resolveMakeOpsLimit("2000"), 2000);
  assert.equal(resolveMakeOpsLimit("-1"), 1000);
  assert.equal(resolveMakeOpsLimit("abc"), 1000);
});

await check("zero SQL / no new migration for E3", () => {
  const migrations = fs.readdirSync(path.join(root, "supabase/migrations"));
  // 028 is unrelated (publish_batches RLS recursion). E3 itself must not add migrations.
  assert.ok(!migrations.some((f) => /e3|make_quota/i.test(f)));
  assert.ok(!migrations.some((f) => /^029_.*make/i.test(f)));
});

if (failures.length) {
  console.error(`\nFAILED ${failures.length}`);
  process.exit(1);
}
console.log("\nALL passed");
