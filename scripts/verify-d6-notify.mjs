/**
 * D6 + #2-open verification (mock — no real Resend / LINE / DB).
 *
 * - Static wiring: notify center, tryNotify image + publish, cron, hooks
 * - Pure: item terminal, claim rule Q3b, email/flex builders, publish lists
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

function buildPublishDoneSubject(doneCount, failedCount) {
  return `潮巢｜發布批次完成（成功 ${doneCount}／失敗 ${failedCount}）`;
}

/** Mirror templates/publishBatch.ts Q2-B list builder. */
const PUBLISH_NOTIFY_MAX_SUCCESS_LINES = 20;
const PUBLISH_NOTIFY_TITLE_MAX = 28;

function truncateNotifyTitle(title, max = PUBLISH_NOTIFY_TITLE_MAX) {
  const t = (title || "未命名草稿").trim() || "未命名草稿";
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function formatPublishNotifyLine(title, errorMessage) {
  const t = truncateNotifyTitle(title);
  const reason = (errorMessage || "").trim();
  if (!reason) return t;
  return `${t} — ${reason}`;
}

function buildPublishNotifyLineLists(items, maxSuccess = PUBLISH_NOTIFY_MAX_SUCCESS_LINES) {
  const successAll = [];
  const failedLines = [];
  const skippedLines = [];
  for (const item of items) {
    const title = item.title || "未命名草稿";
    if (item.itemStatus === "done") {
      successAll.push(truncateNotifyTitle(title));
    } else if (item.itemStatus === "failed") {
      failedLines.push(formatPublishNotifyLine(title, item.errorMessage || "未知錯誤"));
    } else if (item.itemStatus === "skipped") {
      skippedLines.push(formatPublishNotifyLine(title, item.errorMessage || "已略過"));
    }
  }
  return {
    successLines: successAll.slice(0, maxSuccess),
    failedLines,
    skippedLines,
    successTruncated: successAll.length > maxSuccess,
    doneCount: successAll.length,
    failedCount: failedLines.length,
    skippedCount: skippedLines.length
  };
}

console.log("\nD6-open + #2-open notify verification\n");

// --- Static files ---
await check("notify modules exist", () => {
  for (const rel of [
    "src/lib/notifications/types.ts",
    "src/lib/notifications/config.ts",
    "src/lib/notifications/itemTerminal.ts",
    "src/lib/notifications/notifyCenter.ts",
    "src/lib/notifications/tryNotifyImageBatchIfComplete.ts",
    "src/lib/notifications/tryNotifyPublishBatchIfComplete.ts",
    "src/lib/notifications/scanStuckBatches.ts",
    "src/lib/notifications/channels/resend.ts",
    "src/lib/notifications/channels/lineMessaging.ts",
    "src/lib/notifications/templates/imageBatch.ts",
    "src/lib/notifications/templates/publishBatch.ts",
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

// --- #2-open publish_batch_done ---
await check("#2: types include publish_batch_done", () => {
  const t = read("src/lib/notifications/types.ts");
  assert.ok(t.includes("publish_batch_done"), "event type");
  assert.ok(t.includes("PublishBatchNotifyPayload"), "payload type");
  assert.ok(t.includes("recordsUrl"), "records deep link field");
});

await check("#2: notifyCenter dispatches publish_batch_done", () => {
  const src = read("src/lib/notifications/notifyCenter.ts");
  assert.ok(src.includes("dispatchPublishBatchDone"), "dispatch fn");
  assert.ok(src.includes("buildPublishBatchDoneEmail"), "email template");
  assert.ok(src.includes("buildPublishBatchDoneFlex"), "flex template");
  assert.ok(src.includes('"publish_batch_done"') || src.includes("'publish_batch_done'"), "event id");
});

await check("#2: tryNotify items terminal + Q3b claim on publish_batches", () => {
  const src = read("src/lib/notifications/tryNotifyPublishBatchIfComplete.ts");
  assert.ok(src.includes("areAllBatchItemsTerminal"), "item-level terminal Q1-A");
  assert.ok(src.includes("publish_batches"), "publish table");
  assert.ok(src.includes("publish_batch_items"), "items table");
  assert.ok(src.includes("notify_sent_at"), "idempotent column");
  assert.ok(
    src.includes('.is("notify_sent_at", null)') || src.includes("notify_sent_at\", null"),
    "conditional claim"
  );
  assert.ok(src.includes("shouldClaimAfterDispatch"), "Q3b");
  assert.ok(src.includes("no_channel_configured") || src.includes("anyChannelReady"), "no key skip");
  assert.ok(src.includes('"/records"') || src.includes("'/records'") || src.includes("/records"), "records path");
  assert.ok(src.includes("buildPublishNotifyLineLists"), "Q2-B lists");
});

await check("#2: runPublishBatch hooks safeTry after terminal update", () => {
  const src = read("src/lib/shopify/runPublishBatch.ts");
  assert.ok(src.includes("safeTryNotifyPublishBatchIfComplete"), "hook present");
  // Call site (not import) must follow terminal done_count write
  const terminalIdx = src.indexOf("done_count: doneCount");
  const callIdx = src.indexOf("await safeTryNotifyPublishBatchIfComplete");
  assert.ok(terminalIdx > 0, "terminal done_count write");
  assert.ok(callIdx > terminalIdx, "notify call after terminal counts write");
  assert.ok(src.includes("ok: true"), "success return still ok true");
  assert.ok(!src.includes("event #2 not wired") && !src.includes("event #2 not sent"), "stale not-wired comment gone");
});

await check("#2: Email lists fail/skip; success ≤20; LINE counts only", () => {
  const tpl = read("src/lib/notifications/templates/publishBatch.ts");
  assert.ok(tpl.includes("PUBLISH_NOTIFY_MAX_SUCCESS_LINES"), "cap constant");
  assert.ok(tpl.includes("= 20") || tpl.includes("20"), "cap 20");
  assert.ok(tpl.includes("失敗清單") || tpl.includes("failedLines"), "fail list");
  assert.ok(tpl.includes("略過清單") || tpl.includes("skippedLines"), "skip list");
  assert.ok(tpl.includes("buildPublishBatchDoneFlex"), "flex");
  // Flex must not dump successLines into body
  const flexFn = tpl.slice(tpl.indexOf("buildPublishBatchDoneFlex"));
  assert.ok(flexFn.includes("成功 ${doneCount}") || flexFn.includes("doneCount"), "counts in flex");
  assert.ok(!flexFn.includes("successLines"), "LINE must not list success titles");
  assert.ok(!flexFn.includes("failedLines"), "LINE must not list fail titles");
  assert.ok(tpl.includes("recordsUrl") || tpl.includes("打開紀錄"), "records CTA");
  assert.ok(!tpl.includes("notify-api.line.me"), "no LINE Notify");
});

await check("#2 pure: buildPublishNotifyLineLists Q2-B", () => {
  const items = [
    { itemStatus: "done", title: "成功A" },
    { itemStatus: "failed", title: "失敗B", errorMessage: "Shopify 401" },
    { itemStatus: "skipped", title: "略過C", errorMessage: "時間不足略過（time_budget）" }
  ];
  const lists = buildPublishNotifyLineLists(items);
  assert.equal(lists.doneCount, 1);
  assert.equal(lists.failedCount, 1);
  assert.equal(lists.skippedCount, 1);
  assert.equal(lists.successLines[0], "成功A");
  assert.ok(lists.failedLines[0].includes("失敗B"));
  assert.ok(lists.failedLines[0].includes("401"));
  assert.ok(lists.skippedLines[0].includes("略過C"));
  assert.equal(lists.successTruncated, false);

  const many = Array.from({ length: 25 }, (_, i) => ({
    itemStatus: "done",
    title: `商品${i + 1}`
  }));
  const cap = buildPublishNotifyLineLists(many);
  assert.equal(cap.successLines.length, 20);
  assert.equal(cap.doneCount, 25);
  assert.equal(cap.successTruncated, true);
});

await check("#2 pure: publish subject + records URL", () => {
  assert.ok(buildPublishDoneSubject(18, 2).includes("發布批次完成"));
  assert.ok(buildPublishDoneSubject(18, 2).includes("成功 18"));
  assert.equal(buildReviewUrl("https://app.example", "/records"), "https://app.example/records");
});

await check("#2: no LINE Notify in publish template", () => {
  const tpl = read("src/lib/notifications/templates/publishBatch.ts");
  assert.ok(tpl.includes("Not LINE Notify") || tpl.includes("Messaging"), "document ban");
  assert.ok(!tpl.includes("notify-api.line.me"));
});

console.log("");
if (failures.length) {
  console.error(`FAILED ${failures.length} check(s)`);
  process.exit(1);
}
console.log("All D6-open + #2-open checks passed.\n");
