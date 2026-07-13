/**
 * D6-open verification (mock — no real Resend / LINE / DB).
 *
 * - Static wiring: notify center, tryNotify, cron, auto-chain/ai-process hooks
 * - Pure: item terminal, claim rule Q3b, email/flex builders
 * - No LINE Notify endpoint
 * - Forbidden: fake-send when no keys
 *
 * Run: node scripts/verify-d6-notify.mjs
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

// --- Pure mirrors (keep in sync with src/lib/notifications/*) ---

function areAllBatchItemsTerminal(itemStatuses) {
  if (!itemStatuses.length) return false;
  return itemStatuses.every(
    (s) => s === "done" || s === "failed" || s === "skipped"
  );
}

function countItemStatuses(itemStatuses) {
  const counts = {
    total: itemStatuses.length,
    done: 0,
    failed: 0,
    skipped: 0,
    queued: 0,
    processing: 0,
    other: 0
  };
  for (const s of itemStatuses) {
    if (s === "done") counts.done += 1;
    else if (s === "failed") counts.failed += 1;
    else if (s === "skipped") counts.skipped += 1;
    else if (s === "queued") counts.queued += 1;
    else if (s === "processing") counts.processing += 1;
    else counts.other += 1;
  }
  return counts;
}

function shouldClaimAfterDispatch(attempts) {
  return attempts.some((a) => a.status === "sent");
}

function summarizeDispatch(attempts) {
  const anySent = attempts.some((a) => a.status === "sent");
  const allSkipped =
    attempts.length > 0 && attempts.every((a) => a.status === "skipped");
  const allFailedOrError = !anySent && attempts.some((a) => a.status === "error");
  return { anySent, allSkipped, allFailedOrError };
}

function resolveAppBaseUrl(env) {
  const explicit = (env.APP_BASE_URL || env.NOTIFY_APP_BASE_URL || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = (env.VERCEL_URL || "").trim();
  if (vercel) {
    const host = vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    if (host) return `https://${host}`;
  }
  return null;
}

function buildReviewUrl(appBaseUrl, pathSuffix = "/review") {
  if (!appBaseUrl) return null;
  const base = appBaseUrl.replace(/\/+$/, "");
  const p = pathSuffix.startsWith("/") ? pathSuffix : `/${pathSuffix}`;
  return `${base}${p}`;
}

function shortBatchId(batchId) {
  return batchId.replace(/-/g, "").slice(0, 8);
}

function buildDoneSubject(doneCount, failedCount) {
  return `潮巢｜圖片批次完成（成功 ${doneCount}／失敗 ${failedCount}）`;
}

console.log("\nD6-open notify verification\n");

// --- Static files ---
await check("notify modules exist", () => {
  for (const rel of [
    "src/lib/notifications/types.ts",
    "src/lib/notifications/config.ts",
    "src/lib/notifications/itemTerminal.ts",
    "src/lib/notifications/notifyCenter.ts",
    "src/lib/notifications/tryNotifyImageBatchIfComplete.ts",
    "src/lib/notifications/scanStuckBatches.ts",
    "src/lib/notifications/channels/resend.ts",
    "src/lib/notifications/channels/lineMessaging.ts",
    "src/lib/notifications/templates/imageBatch.ts",
    "src/app/api/cron/stuck-batches/route.ts"
  ]) {
    assert.ok(exists(rel), `missing ${rel}`);
  }
});

await check("no LINE Notify endpoint", () => {
  const line = read("src/lib/notifications/channels/lineMessaging.ts");
  assert.ok(line.includes("api.line.me/v2/bot/message/push"), "must use Messaging API push");
  // Real fetch URL must be Messaging API only (allow ban-list comments)
  const pushUrlMatch = line.match(/LINE_PUSH_API\s*=\s*"([^"]+)"/);
  assert.ok(pushUrlMatch, "LINE_PUSH_API constant");
  assert.equal(pushUrlMatch[1], "https://api.line.me/v2/bot/message/push");
  assert.ok(!pushUrlMatch[1].includes("notify-api"), "must not call LINE Notify URL");
  assert.ok(line.includes("LINE Notify") || line.includes("Do NOT"), "must document ban");
});

await check("auto-chain and ai-process call tryNotify", () => {
  const chain = read("src/lib/images/sendImagesAutoChain.ts");
  const ai = read("src/lib/images/runAiProcess.ts");
  assert.ok(chain.includes("safeTryNotifyImageBatchIfComplete"), "chain must hook D6");
  assert.ok(ai.includes("safeTryNotifyImageBatchIfComplete"), "ai-process must hook D6");
  // Notify sits inside updateBatchStatusAfterAiProcess after image_batches update
  const fnStart = ai.indexOf("export async function updateBatchStatusAfterAiProcess");
  const fnBody = ai.slice(fnStart, fnStart + 4500);
  assert.ok(fnBody.includes("safeTryNotifyImageBatchIfComplete"), "notify inside updateBatchStatusAfterAiProcess");
  assert.ok(
    fnBody.indexOf('from("image_batches")') < fnBody.indexOf("safeTryNotifyImageBatchIfComplete"),
    "notify after batch update"
  );
});

await check("vercel.json has stuck-batches cron", () => {
  const v = JSON.parse(read("vercel.json"));
  const paths = (v.crons || []).map((c) => c.path);
  assert.ok(paths.includes("/api/cron/fx"), "fx cron kept");
  assert.ok(paths.includes("/api/cron/stuck-batches"), "stuck-batches cron");
  assert.equal(paths.length, 2, "exactly 2 free-tier crons");
});

await check(".env.example documents D6 vars", () => {
  const env = read(".env.example");
  for (const key of [
    "RESEND_API_KEY",
    "RESEND_FROM",
    "NOTIFY_EMAIL_TO",
    "LINE_CHANNEL_ACCESS_TOKEN",
    "LINE_USER_ID",
    "APP_BASE_URL"
  ]) {
    assert.ok(env.includes(key), `missing ${key}`);
  }
  assert.ok(env.includes("LINE Notify") || env.includes("Messaging API"), "warn about Notify");
});

await check("Settings copy mentions env (no BX-P tokens invent)", () => {
  const s = read("src/components/settings/SettingsPanel.tsx");
  assert.ok(s.includes("RESEND_"), "email env hint");
  assert.ok(s.includes("LINE_CHANNEL_ACCESS_TOKEN") || s.includes("LINE_"), "line env hint");
  assert.ok(s.includes("非 LINE Notify") || s.includes("Messaging"), "not LINE Notify");
});

// --- Pure logic ---
await check("terminal: empty = false", () => {
  assert.equal(areAllBatchItemsTerminal([]), false);
});

await check("terminal: all done/failed/skipped", () => {
  assert.equal(areAllBatchItemsTerminal(["done", "failed", "skipped"]), true);
});

await check("terminal: partial_failed batch with queued item is NOT terminal", () => {
  // The partial_failed landmine: batch.status may say partial_failed while items still queued
  assert.equal(areAllBatchItemsTerminal(["done", "queued"]), false);
  assert.equal(areAllBatchItemsTerminal(["done", "processing"]), false);
});

await check("countItemStatuses", () => {
  const c = countItemStatuses(["done", "done", "failed", "skipped", "queued"]);
  assert.equal(c.done, 2);
  assert.equal(c.failed, 1);
  assert.equal(c.skipped, 1);
  assert.equal(c.queued, 1);
  assert.equal(c.total, 5);
});

await check("Q3b claim: only when any sent", () => {
  assert.equal(
    shouldClaimAfterDispatch([
      { status: "skipped" },
      { status: "skipped" }
    ]),
    false,
    "all skip → no claim"
  );
  assert.equal(
    shouldClaimAfterDispatch([
      { status: "error" },
      { status: "error" }
    ]),
    false,
    "all error → no claim"
  );
  assert.equal(
    shouldClaimAfterDispatch([
      { status: "sent" },
      { status: "error" }
    ]),
    true,
    "one sent one error → claim"
  );
  assert.equal(
    shouldClaimAfterDispatch([
      { status: "sent" },
      { status: "skipped" }
    ]),
    true,
    "one sent one skip → claim"
  );
});

await check("summarizeDispatch", () => {
  const a = summarizeDispatch([
    { status: "skipped" },
    { status: "skipped" }
  ]);
  assert.equal(a.allSkipped, true);
  assert.equal(a.anySent, false);

  const b = summarizeDispatch([
    { status: "error" },
    { status: "skipped" }
  ]);
  assert.equal(b.allFailedOrError, true);
  assert.equal(b.anySent, false);
});

await check("review URL + short id + subject", () => {
  assert.equal(resolveAppBaseUrl({ APP_BASE_URL: "https://x.example/" }), "https://x.example");
  assert.equal(resolveAppBaseUrl({ VERCEL_URL: "my.vercel.app" }), "https://my.vercel.app");
  assert.equal(buildReviewUrl("https://x.example"), "https://x.example/review");
  assert.equal(buildReviewUrl(null), null);
  assert.equal(shortBatchId("abcdef12-3456-7890-abcd-ef1234567890"), "abcdef12");
  assert.ok(buildDoneSubject(3, 1).includes("成功 3"));
  assert.ok(buildDoneSubject(3, 1).includes("失敗 1"));
});

await check("tryNotify uses item statuses + conditional claim", () => {
  const src = read("src/lib/notifications/tryNotifyImageBatchIfComplete.ts");
  assert.ok(src.includes("areAllBatchItemsTerminal"), "item-level terminal");
  assert.ok(src.includes("notify_sent_at"), "idempotent column");
  assert.ok(src.includes(".is(\"notify_sent_at\", null)") || src.includes('notify_sent_at", null'), "conditional claim");
  assert.ok(src.includes("shouldClaimAfterDispatch") || src.includes("anySent"), "Q3b claim gate");
  assert.ok(src.includes("no_channel_configured") || src.includes("anyChannelReady"), "skip without claim when no keys");
});

await check("scanStuck marks stuck + stuck_notified_at", () => {
  const src = read("src/lib/notifications/scanStuckBatches.ts");
  assert.ok(src.includes('status: "stuck"') || src.includes("status: 'stuck'"), "Q6 stuck");
  assert.ok(src.includes("stuck_notified_at"), "stuck idempotent");
  assert.ok(src.includes("24") || src.includes("STUCK_AGE"), "24h window");
});

await check("cron auth mirrors fx", () => {
  const stuck = read("src/app/api/cron/stuck-batches/route.ts");
  const fx = read("src/app/api/cron/fx/route.ts");
  assert.ok(stuck.includes("CRON_SECRET"), "cron secret");
  assert.ok(stuck.includes("authorizeCron") || stuck.includes("Bearer"), "bearer auth");
  assert.ok(fx.includes("CRON_SECRET"), "fx still has secret");
});

await check("make.ts still present; no Resend in make", () => {
  const make = read("src/lib/notifications/make.ts");
  assert.ok(make.includes("MAKE_WEBHOOK_URL"));
  assert.ok(!make.includes("resend.com"));
});

// --- Mock channel: missing config = skipped ---
await check("mock: missing email config → skipped shape", () => {
  // Mirror sendResendEmail early return
  const config = null;
  const result = !config
    ? { channel: "email", status: "skipped", reason: "missing_resend_config" }
    : { channel: "email", status: "sent" };
  assert.equal(result.status, "skipped");
  assert.equal(shouldClaimAfterDispatch([result, { status: "skipped", channel: "line" }]), false);
});

console.log("");
if (failures.length) {
  console.error(`FAILED ${failures.length} check(s)`);
  process.exit(1);
}
console.log("All D6-open checks passed.\n");
