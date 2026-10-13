/**
 * REVIEW-FLOW verify (no network, no .env, no Supabase).
 *
 * Imports the REAL TypeScript modules through scripts/publish-guard-loader.mjs and drives
 * them directly; route / component wiring is checked with static source assertions.
 *
 *   B1  transition guard matrix (reviewTransitions) + route wiring
 *   B2  batch return route + shared write helper (applyReturnStage) + strip buttons
 *   B3  station② 規格 tab renders the same ResultCardSpecsPanel
 *   B4  pendingLeave filter (hidden while unchanged, shown after change, dropped after 20s)
 *   B5  approve failure triage (classify / re-read / wording)
 *   B6  batch ⛔ partition (approveGate) + server decision
 *   B7  sequential review outcome reducer + overlay wiring
 *
 * Run: node scripts/verify-review-flow.mjs  |  npm run verify:review-flow
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
process.chdir(root);
register(pathToFileURL(path.join(root, "scripts", "publish-guard-loader.mjs")).href);

const src = (rel) => pathToFileURL(path.join(root, rel)).href;
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const transitions = await import(src("src/lib/drafts/reviewTransitions.ts"));
const gate = await import(src("src/lib/drafts/approveGate.ts"));
const warningTiers = await import(src("src/lib/drafts/warningTiers.ts"));
const leave = await import(src("src/lib/drafts/pendingLeave.ts"));
const triage = await import(src("src/lib/drafts/approveTriage.ts"));
const seq = await import(src("src/lib/drafts/sequentialReview.ts"));
const returnWrite = await import(src("src/lib/drafts/returnStageWrite.ts"));

const { checkReviewTransition, effectiveStage, describeReviewLocation, stageMismatchBody } =
  transitions;

// --- harness ---------------------------------------------------------------

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

// =============================================================================
// B1 — transition matrix
// =============================================================================
console.log("\nB1 transition guard");

const GID = "gid://shopify/Product/1";
// [label, draft, expected per action]  "ok" | "noop" | "block"
const MATRIX = [
  ["input / pending_input", { pipeline_stage: "input", status: "pending_input" }, ["block", "block", "block"]],
  ["input / processing", { pipeline_stage: "input", status: "processing" }, ["block", "block", "block"]],
  ["input / pending_copy", { pipeline_stage: "input", status: "pending_copy" }, ["block", "block", "block"]],
  ["copy_review / ready_for_review", { pipeline_stage: "copy_review", status: "ready_for_review" }, ["ok", "ok", "ok"]],
  ["copy_review / needs_revision", { pipeline_stage: "copy_review", status: "needs_revision" }, ["ok", "noop", "ok"]],
  ["copy_review / failed", { pipeline_stage: "copy_review", status: "failed" }, ["ok", "ok", "ok"]],
  ["image_review / approved", { pipeline_stage: "image_review", status: "approved" }, ["noop", "ok", "noop"]],
  ["ready / approved", { pipeline_stage: "ready", status: "approved" }, ["block", "ok", "ok"]],
  ["ready / publishing", { pipeline_stage: "ready", status: "publishing" }, ["block", "block", "block"]],
  ["published / csv_ready", { pipeline_stage: "published", status: "csv_ready" }, ["block", "block", "block"]],
  ["published / draft_created", { pipeline_stage: "published", status: "draft_created" }, ["block", "block", "block"]],
  ["published / active_published", { pipeline_stage: "published", status: "active_published" }, ["block", "block", "block"]],
  ["published / api_failed", { pipeline_stage: "published", status: "api_failed" }, ["block", "block", "block"]],
  ["archived / archived", { pipeline_stage: "archived", status: "archived" }, ["block", "block", "block"]],
  // legacy rows without pipeline_stage fall back to status
  ["legacy ready_for_review", { pipeline_stage: null, status: "ready_for_review" }, ["ok", "ok", "ok"]],
  ["legacy approved (no GID)", { pipeline_stage: null, status: "approved" }, ["noop", "ok", "noop"]],
  ["legacy approved + GID → published", { pipeline_stage: null, status: "approved", shopify_product_id: GID }, ["block", "block", "block"]],
  ["legacy publishing", { pipeline_stage: undefined, status: "publishing" }, ["block", "block", "block"]]
];
const ACTIONS = ["approve", "return_copy", "return_image"];

function classify(result) {
  if (!result.ok) return "block";
  return result.noop ? "noop" : "ok";
}

for (const [label, draft, expected] of MATRIX) {
  await check(`matrix: ${label}`, () => {
    ACTIONS.forEach((action, i) => {
      assert.equal(
        classify(checkReviewTransition(draft, action)),
        expected[i],
        `${label} / ${action}`
      );
    });
  });
}

await check("stale card cannot pull a 站③ item back to 站② via approve", () => {
  const result = checkReviewTransition({ pipeline_stage: "ready", status: "approved" }, "approve");
  assert.equal(result.ok, false);
  assert.equal(result.code, "STAGE_MISMATCH");
});

await check("published / archived / publishing are blocked for every action", () => {
  for (const draft of [
    { pipeline_stage: "published", status: "active_published" },
    { pipeline_stage: "archived", status: "archived" },
    { pipeline_stage: "ready", status: "publishing" },
    { pipeline_stage: "copy_review", status: "processing" }
  ]) {
    for (const action of ACTIONS) {
      assert.equal(checkReviewTransition(draft, action).ok, false, `${draft.status}/${action}`);
    }
  }
});

await check("quickUndo paths stay allowed (undo approve / undo 標圖分流)", () => {
  // undoApproveDrafts → return-stage copy_review, from 站② (just approved) or 站③ (moved on)
  assert.equal(checkReviewTransition({ pipeline_stage: "image_review", status: "approved" }, "return_copy").ok, true);
  assert.equal(checkReviewTransition({ pipeline_stage: "ready", status: "approved" }, "return_copy").ok, true);
  // undoStation2Drafts → return-stage image_review, from 站③ (all-keep) or 站② (送工廠: noop success)
  assert.equal(checkReviewTransition({ pipeline_stage: "ready", status: "approved" }, "return_image").ok, true);
  const factory = checkReviewTransition({ pipeline_stage: "image_review", status: "approved" }, "return_image");
  assert.deepEqual(factory, { ok: true, noop: true });
  // undo of a return lands on copy_review → return_image must still pass
  assert.equal(checkReviewTransition({ pipeline_stage: "copy_review", status: "needs_revision" }, "return_image").ok, true);
});

await check("mismatch message names the real station and the action", () => {
  const result = checkReviewTransition({ pipeline_stage: "ready", status: "approved" }, "approve");
  assert.equal(
    result.message,
    "這筆目前在「完成待發布」，不能核准文案（畫面可能過時，請重新整理）"
  );
  const pub = checkReviewTransition({ pipeline_stage: "published", status: "csv_ready" }, "return_image");
  assert.match(pub.message, /已發布.*不能退回改圖/);
  const busy = checkReviewTransition({ pipeline_stage: "ready", status: "publishing" }, "return_copy");
  assert.match(busy.message, /發布中.*不能退回文案/);
  assert.equal(describeReviewLocation({ pipeline_stage: "image_review", status: "approved" }), "圖片待標示");
});

await check("stageMismatchBody + effectiveStage agree with the UI station resolver", () => {
  const body = stageMismatchBody({ pipeline_stage: "ready", status: "approved" }, "msg");
  assert.deepEqual(body, { error: "msg", code: "STAGE_MISMATCH", status: "approved", pipeline_stage: "ready" });
  assert.equal(effectiveStage({ pipeline_stage: "bogus", status: "needs_revision" }), "copy_review");
});

await check("the 4 routes + batch routes call checkReviewTransition and answer 409 STAGE_MISMATCH", () => {
  for (const rel of [
    "src/app/api/drafts/[id]/approve/route.ts",
    "src/app/api/drafts/batch/approve/route.ts",
    "src/app/api/drafts/[id]/request-revision/route.ts",
    "src/app/api/drafts/[id]/return-stage/route.ts",
    "src/app/api/drafts/batch/return-stage/route.ts"
  ]) {
    assert.match(read(rel), /checkReviewTransition\(/, `${rel} must call checkReviewTransition`);
  }
  for (const rel of [
    "src/app/api/drafts/[id]/approve/route.ts",
    "src/app/api/drafts/[id]/request-revision/route.ts",
    "src/app/api/drafts/[id]/return-stage/route.ts"
  ]) {
    const source = read(rel);
    assert.match(source, /stageMismatchBody\(/, `${rel} must build the STAGE_MISMATCH body`);
    assert.match(source, /status:\s*409/, `${rel} must answer 409`);
  }
});

await check("single approve reads first, checks before keep marks, update is conditional + selected", () => {
  const source = read("src/app/api/drafts/[id]/approve/route.ts");
  const readAt = source.indexOf(".maybeSingle()");
  const checkAt = source.indexOf("checkReviewTransition(");
  const keepAt = source.indexOf("applyDefaultKeepMarks(serviceSupabase");
  const updateAt = source.indexOf(".update(");
  assert.ok(readAt > 0 && checkAt > readAt, "row must be read before the check");
  assert.ok(keepAt > checkAt, "applyDefaultKeepMarks must come after the transition check");
  assert.ok(updateAt > keepAt);
  assert.match(source, /\.eq\("pipeline_stage",\s*"copy_review"\)/);
  assert.match(source, /\.select\("id"\)/);
  assert.match(source, /alreadyApproved:\s*true/);
});

await check("batch approve keeps its old fields and adds approved[] / skipped[]", () => {
  const source = read("src/app/api/drafts/batch/approve/route.ts");
  for (const field of ["approvedCount", "approvedIds", "defaultKeepCount", "keepError", "approved:", "skipped"]) {
    assert.ok(source.includes(field), `batch approve response must include ${field}`);
  }
});

await check("route modules export only HTTP methods (+ runtime config)", () => {
  for (const rel of [
    "src/app/api/drafts/[id]/approve/route.ts",
    "src/app/api/drafts/batch/approve/route.ts",
    "src/app/api/drafts/[id]/request-revision/route.ts",
    "src/app/api/drafts/[id]/return-stage/route.ts",
    "src/app/api/drafts/batch/return-stage/route.ts"
  ]) {
    const exports = [...read(rel).matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm)].map((m) => m[1]);
    for (const name of exports) {
      assert.ok(
        ["GET", "POST", "PUT", "PATCH", "DELETE", "runtime"].includes(name),
        `${rel} exports non-HTTP symbol ${name}`
      );
    }
    assert.ok(exports.includes("POST"), `${rel} must export POST`);
  }
});

// =============================================================================
// B2 — batch return
// =============================================================================
console.log("\nB2 batch return");

/** Minimal chain fake: records every update/insert; `.select()` resolves with `updateRows`. */
function fakeService(opts = {}) {
  const calls = [];
  const state = { updateRows: opts.updateRows ?? [{ id: "d1" }], updateError: opts.updateError ?? null };
  return {
    calls,
    state,
    from(table) {
      const st = { table, filters: [] };
      const api = {
        update(patch) {
          st.op = "update";
          st.patch = patch;
          return api;
        },
        insert(row) {
          st.op = "insert";
          st.row = row;
          calls.push(st);
          return Promise.resolve({ data: null, error: null });
        },
        eq(col, val) {
          st.filters.push([col, val]);
          return api;
        },
        select() {
          calls.push(st);
          return Promise.resolve({ data: state.updateRows, error: state.updateError });
        }
      };
      return api;
    }
  };
}

await check("applyReturnStage copy_review writes the exact single-route fields + review_logs row", async () => {
  const db = fakeService();
  const result = await returnWrite.applyReturnStage(db, {
    draftId: "d1",
    target: "copy_review",
    userId: "u1",
    comment: null,
    defaultComment: "批次退回文案",
    expectedStage: "ready"
  });
  assert.deepEqual(result, { ok: true, status: "needs_revision", pipeline_stage: "copy_review" });
  const update = db.calls.find((c) => c.op === "update");
  assert.deepEqual(update.patch, {
    status: "needs_revision",
    pipeline_stage: "copy_review",
    reviewed_by: "u1",
    error_message: null
  });
  assert.ok(update.filters.some(([c, v]) => c === "pipeline_stage" && v === "ready"), "race guard on read stage");
  const log = db.calls.find((c) => c.op === "insert");
  assert.equal(log.table, "review_logs");
  assert.deepEqual(log.row, { draft_id: "d1", action: "needs_revision", reviewer: "u1", comment: "批次退回文案" });
});

await check("applyReturnStage image_review keeps approved + logs return_image_review", async () => {
  const db = fakeService();
  const result = await returnWrite.applyReturnStage(db, {
    draftId: "d1",
    target: "image_review",
    userId: "u1",
    comment: "請重標",
    defaultComment: returnWrite.BATCH_RETURN_DEFAULT_COMMENT.image_review,
    expectedStage: "ready"
  });
  assert.equal(result.ok, true);
  const update = db.calls.find((c) => c.op === "update");
  assert.equal(update.patch.pipeline_stage, "image_review");
  assert.equal(update.patch.status, "approved");
  assert.ok(typeof update.patch.updated_at === "string");
  const log = db.calls.find((c) => c.op === "insert");
  assert.equal(log.row.action, "return_image_review");
  assert.equal(log.row.comment, "請重標");
  assert.equal(returnWrite.BATCH_RETURN_DEFAULT_COMMENT.copy_review, "批次退回文案");
  assert.equal(returnWrite.BATCH_RETURN_DEFAULT_COMMENT.image_review, "批次退回改圖");
});

await check("applyReturnStage reports a race (no row updated) and writes no log", async () => {
  const db = fakeService({ updateRows: [] });
  const result = await returnWrite.applyReturnStage(db, {
    draftId: "d1",
    target: "copy_review",
    userId: "u1",
    comment: null,
    defaultComment: "x",
    expectedStage: "ready"
  });
  assert.deepEqual(result, { ok: false, reason: "race" });
  assert.equal(db.calls.filter((c) => c.op === "insert").length, 0);
  const dbErr = fakeService({ updateError: { message: "boom" } });
  const errResult = await returnWrite.applyReturnStage(dbErr, {
    draftId: "d1", target: "image_review", userId: "u1", comment: null, defaultComment: "x", expectedStage: null
  });
  assert.deepEqual(errResult, { ok: false, reason: "db", error: "boom" });
});

await check("single return-stage, request-revision and batch route all use applyReturnStage", () => {
  for (const rel of [
    "src/app/api/drafts/[id]/return-stage/route.ts",
    "src/app/api/drafts/[id]/request-revision/route.ts",
    "src/app/api/drafts/batch/return-stage/route.ts"
  ]) {
    assert.match(read(rel), /applyReturnStage\(/, `${rel} must share the write helper`);
  }
});

await check("batch return route: ids 1..200, target, RLS-scoped auth, skipped/updated response", () => {
  const source = read("src/app/api/drafts/batch/return-stage/route.ts");
  assert.match(source, /MAX_BATCH_IDS\s*=\s*200/);
  assert.match(source, /body\.ids/);
  assert.match(source, /resolveRequestPrincipal\(request\)/);
  assert.match(source, /loadAuthorizedDraftIds\(/);
  assert.match(source, /authorizedDraftIds/);
  assert.match(source, /updated/);
  assert.match(source, /skipped/);
  assert.match(source, /BATCH_RETURN_DEFAULT_COMMENT/);
});

await check("batch strip: ② has 批次退回文案; ③ has 批次退回文案 + 批次退回改圖 (confirm dialog, count toast)", () => {
  const panel = read("src/components/listing/DraftResultsPanel.tsx");
  assert.equal(panel.split("批次退回文案\n").length - 1, 2, "批次退回文案 button on ② and ③");
  assert.equal(panel.split("批次退回改圖\n").length - 1, 1, "批次退回改圖 button on ③");
  assert.match(panel, /\/api\/drafts\/batch\/return-stage/);
  assert.match(panel, /ReviewConfirmModal/);
  assert.match(panel, /已退回 \$\{updated\.length\} 件/);
  assert.match(panel, /formatSkippedSummary\(skipped\)/);
  // buttons disabled when nothing selected / busy
  const returnBtns = panel.match(/className="batch-return-action"[\s\S]*?type="button"/g) ?? [];
  assert.equal(returnBtns.length, 3);
  for (const btn of returnBtns) assert.match(btn, /disabled=\{busy \|\| (station3Busy \|\| )?!selectedArray\.length\}/);
});

// =============================================================================
// B3 — ② 規格 tab
// =============================================================================
console.log("\nB3 station② 規格 tab");

await check("② tab bar has a trailing 規格 tab; subtabs + their handlers are unchanged", () => {
  const card = read("src/components/listing/ResultCard.tsx");
  const start = card.indexOf('aria-label="圖片類型"');
  const end = card.indexOf('aria-label="卡片分頁"');
  assert.ok(start > 0 && end > start);
  const bar = card.slice(start, end);
  assert.match(bar, /STATION2_IMAGE_SUBTABS\.map/);
  assert.match(bar, /setS2ImageSubtab\(tab\.id\)/);
  assert.match(bar, /tabLabelWithWarn\("specs", 0\)/);
  assert.ok(
    bar.indexOf("tabLabelWithWarn") > bar.indexOf("STATION2_IMAGE_SUBTABS.map"),
    "規格 must come after the image subtabs (last)"
  );
});

await check("規格 body is the one shared ResultCardSpecsPanel (no duplicate implementation)", () => {
  const card = read("src/components/listing/ResultCard.tsx");
  assert.equal(card.split("<ResultCardSpecsPanel").length - 1, 1, "exactly one ResultCardSpecsPanel render");
  assert.match(card, /\{activeTab === "specs" \? \(\s*<ResultCardSpecsPanel/);
  assert.doesNotMatch(card, /!isImageStation && activeTab === "specs"/);
  // image panel is hidden while 規格 is open
  assert.match(card, /s2SpecsOpen \? null :/);
});

await check("② 標圖通過 refuses to run over unsaved 款式 edits (no silent loss)", () => {
  const card = read("src/components/listing/ResultCard.tsx");
  const start = card.indexOf("async function stationReview()");
  const end = card.indexOf("async function returnFromReady");
  const body = card.slice(start, end);
  assert.ok(start > 0 && end > start);
  const guardAt = body.indexOf("if (variantsDirty)");
  assert.ok(guardAt > 0, "stationReview must guard on variantsDirty");
  assert.ok(guardAt < body.indexOf("decideStation2Review("), "guard runs before the route decision");
  assert.match(body, /請先按「儲存修改」/);
});

await check("saving variants from ② uses the same save() and never touches stage / status", () => {
  const card = read("src/components/listing/ResultCard.tsx");
  const saveStart = card.indexOf("async function save(): Promise<boolean>");
  const saveEnd = card.indexOf("async function regenerateField");
  const saveBody = card.slice(saveStart, saveEnd);
  assert.ok(saveBody.length > 500);
  assert.doesNotMatch(saveBody, /pipeline_stage|status:\s/, "save() must not write stage/status");
  assert.match(saveBody, /persistVariantsSafe\(/);
  // station② footer exposes the same 儲存修改 entry as 站③
  const footerStart = card.indexOf("{isImageStation ? (\n              <span className=\"rc-actions-group rc-actions-group-review\">");
  assert.ok(footerStart > 0);
  assert.match(card.slice(footerStart, footerStart + 700), /void save\(\)/);
});

// =============================================================================
// B4 — pendingLeave
// =============================================================================
console.log("\nB4 pending leave (no blink)");

const T0 = 1_000_000;
const D = (over = {}) => ({ id: "a", pipeline_stage: "copy_review", status: "ready_for_review", ...over });

await check("hidden while the prop still has the pre-action stage + status", () => {
  const pending = leave.recordPendingLeave(new Map(), leave.snapshotForPendingLeave(["a"], [D()]), T0);
  const out = leave.filterPendingLeave([D(), D({ id: "b" })], pending, T0 + 1_000);
  assert.deepEqual(out.map((d) => d.id), ["b"]);
});

await check("shown again once stage OR status changed (refresh landed)", () => {
  const pending = leave.recordPendingLeave(new Map(), leave.snapshotForPendingLeave(["a"], [D()]), T0);
  assert.equal(leave.filterPendingLeave([D({ pipeline_stage: "image_review" })], pending, T0 + 500).length, 1);
  assert.equal(leave.filterPendingLeave([D({ status: "approved" })], pending, T0 + 500).length, 1);
});

await check("reconcile drops changed / vanished entries and keeps unchanged ones (same Map when no change)", () => {
  const pending = leave.recordPendingLeave(
    new Map(),
    leave.snapshotForPendingLeave(["a", "b", "c"], [D(), D({ id: "b" }), D({ id: "c" })]),
    T0
  );
  const unchanged = leave.reconcilePendingLeave(pending, [D(), D({ id: "b" }), D({ id: "c" })], T0 + 100);
  assert.equal(unchanged, pending, "no change → same instance (no re-render)");
  const next = leave.reconcilePendingLeave(
    pending,
    [D({ status: "approved", pipeline_stage: "image_review" }), D({ id: "c" })], // a changed, b gone
    T0 + 100
  );
  assert.deepEqual([...next.keys()], ["c"]);
});

await check("dropped after 20s regardless — a failed refresh never hides a card forever", () => {
  assert.equal(leave.PENDING_LEAVE_TTL_MS, 20_000);
  const pending = leave.recordPendingLeave(new Map(), leave.snapshotForPendingLeave(["a"], [D()]), T0);
  assert.equal(leave.filterPendingLeave([D()], pending, T0 + 19_999).length, 0, "still hidden at 19.999s");
  assert.equal(leave.filterPendingLeave([D()], pending, T0 + 20_000).length, 1, "shown at 20s");
  const reconciled = leave.reconcilePendingLeave(pending, [D()], T0 + 20_000);
  assert.equal(reconciled.size, 0);
});

await check("pre-action values are what is recorded; missing ids are ignored; expiry timer math", () => {
  const snap = leave.snapshotForPendingLeave(["a", "ghost"], [D()]);
  assert.deepEqual(snap, [{ id: "a", pipeline_stage: "copy_review", status: "ready_for_review" }]);
  const pending = leave.recordPendingLeave(new Map(), snap, T0);
  assert.equal(leave.nextPendingLeaveExpiryMs(new Map(), T0), null);
  assert.equal(leave.nextPendingLeaveExpiryMs(pending, T0 + 5_000), 15_000);
  assert.equal(leave.nextPendingLeaveExpiryMs(pending, T0 + 50_000), 0);
  assert.equal(leave.recordPendingLeave(pending, [], T0), pending);
});

await check("panel wiring: success paths record pending-leave; archive's optimisticHide + undo untouched", () => {
  const panel = read("src/components/listing/DraftResultsPanel.tsx");
  assert.match(panel, /filterPendingLeave\(sortedDrafts, pendingLeave, Date\.now\(\)\)/);
  assert.match(panel, /recordPendingLeave\(prev, hideSnapshot, Date\.now\(\)\)/);
  assert.match(panel, /reconcilePendingLeave\(prev, drafts, Date\.now\(\)\)/);
  assert.match(panel, /scheduleLeaveThenRefresh\(approvedIds\)/);
  assert.match(panel, /scheduleLeaveThenRefresh\(updated\)/);
  assert.match(panel, /scheduleLeaveThenRefresh\(undoIds, \{ hideIds: advanceIds \}\)/, "送工廠 ids stay at ②, not pinned hidden");
  assert.match(panel, /onLeaveSuccess=\{\(info\) =>/);
  assert.match(panel, /onItemDone=/);
  // archive flow still uses optimisticHide + undo
  assert.match(panel, /applyOptimisticHide\(prev, ids, "archived"\)/);
  assert.match(panel, /undoArchiveDrafts\(archivedIds\)/);
  const card = read("src/components/listing/ResultCard.tsx");
  assert.match(card, /returned\) finishSuccessfulTransition\(\)/);
});

// =============================================================================
// B5 — approve failure triage
// =============================================================================
console.log("\nB5 approve failure triage");

await check("classifyApproveResponse: success / noop / mismatch / rejected / uncertain", () => {
  const c = triage.classifyApproveResponse;
  assert.deepEqual(c({ status: 200, payload: { ok: true } }), { kind: "success", alreadyApproved: false });
  assert.deepEqual(c({ status: 200, payload: { ok: true, alreadyApproved: true } }), { kind: "success", alreadyApproved: true });
  assert.deepEqual(
    c({ status: 409, payload: { error: "這筆目前在「完成待發布」…", code: "STAGE_MISMATCH" } }),
    { kind: "mismatch", message: "這筆目前在「完成待發布」…" }
  );
  assert.deepEqual(
    c({ status: 422, payload: { error: "⛔ 必修：缺少 IP（必填）", code: "BLOCKING_WARNINGS" } }),
    { kind: "rejected", message: "⛔ 必修：缺少 IP（必填）", code: "BLOCKING_WARNINGS" }
  );
  assert.equal(c({ status: 403, payload: { error: "Reviewer role is required" } }).kind, "rejected");
  // 409 without the STAGE_MISMATCH code is just a rejection
  assert.equal(c({ status: 409, payload: { error: "x" } }).kind, "rejected");
});

await check("network error / 5xx / unparseable body are 'uncertain' (never a failure toast on their own)", () => {
  const c = triage.classifyApproveResponse;
  assert.equal(c({ networkError: true }).kind, "uncertain");
  assert.equal(c({ status: 500, payload: { error: "db" } }).kind, "uncertain");
  assert.equal(c({ status: 502, payload: null }).kind, "uncertain");
  assert.equal(c({ status: 200, payload: null }).kind, "uncertain");
  assert.equal(c({ status: 404, payload: null }).kind, "uncertain");
});

await check("re-read verdicts: approved / not approved / unknown", () => {
  const v = triage.verdictFromRecheck;
  assert.equal(v({ status: "approved", pipeline_stage: "image_review" }), "approved");
  assert.equal(v({ status: "approved", pipeline_stage: "ready" }), "approved");
  assert.equal(v({ status: "csv_ready", pipeline_stage: "published" }), "approved");
  assert.equal(v({ status: "ready_for_review", pipeline_stage: "copy_review" }), "not_approved");
  assert.equal(v({ status: "needs_revision", pipeline_stage: "copy_review" }), "not_approved");
  assert.equal(v(null), "unknown");
  assert.equal(v(undefined), "unknown");
});

await check("recheckDraftStages: reads status + stage; null on any error; empty ids short-circuit", async () => {
  const okClient = {
    from() {
      return {
        select() {
          return {
            in(_col, ids) {
              return Promise.resolve({
                data: ids.map((id) => ({ id, status: "approved", pipeline_stage: "image_review", shopify_product_id: null })),
                error: null
              });
            }
          };
        }
      };
    }
  };
  const rows = await triage.recheckDraftStages(okClient, ["a", "b"]);
  assert.equal(rows.get("a").status, "approved");
  const errClient = { from: () => ({ select: () => ({ in: () => Promise.resolve({ data: null, error: { message: "x" } }) }) }) };
  assert.equal(await triage.recheckDraftStages(errClient, ["a"]), null);
  const throwClient = { from() { throw new Error("offline"); } };
  assert.equal(await triage.recheckDraftStages(throwClient, ["a"]), null);
  assert.equal((await triage.recheckDraftStages(okClient, [])).size, 0);
});

await check("batch triage wording: N 件已核准、M 件未核准; unknown message when the re-check also fails", () => {
  const rows = new Map([
    ["a", { id: "a", status: "approved", pipeline_stage: "image_review" }],
    ["b", { id: "b", status: "ready_for_review", pipeline_stage: "copy_review" }],
    ["c", { id: "c", status: "approved", pipeline_stage: "image_review" }]
  ]);
  const t = triage.triageRecheck(["a", "b", "c"], rows);
  assert.deepEqual(t.approvedIds, ["a", "c"]);
  assert.deepEqual(t.notApprovedIds, ["b"]);
  assert.equal(triage.formatBatchRecheckMessage(t), "2 件已核准、1 件未核准");
  const failed = triage.triageRecheck(["a", "b"], null);
  assert.equal(failed.unknownIds.length, 2);
  assert.equal(triage.formatBatchRecheckMessage(failed), "連線不穩，無法確認是否已核准，請重新整理頁面確認");
});

await check("single-card wording is exactly the specified toasts", () => {
  assert.equal(triage.APPROVE_RECHECK_MESSAGE.approved, "已核准（剛剛連線不穩，已重新確認）");
  assert.equal(triage.APPROVE_RECHECK_MESSAGE.notApproved, "核准沒有成功（連線失敗），請再按一次");
  assert.equal(triage.APPROVE_RECHECK_MESSAGE.unknown, "連線不穩，無法確認是否已核准，請重新整理頁面確認");
});

await check("skipped wording: 略過 M 件（原因）, reasons de-duplicated and shortened", () => {
  const skipped = [
    { id: "1", reason: "這筆目前在「完成待發布」，不能核准文案（畫面可能過時，請重新整理）" },
    { id: "2", reason: "這筆目前在「完成待發布」，不能核准文案（畫面可能過時，請重新整理）" },
    { id: "3", reason: "⛔ 必修：缺少 IP（必填）" }
  ];
  assert.equal(triage.formatSkippedSummary(skipped), "略過 3 件（已在「完成待發布」、有 ⛔ 必修項目）");
  assert.equal(triage.formatSkippedSummary([]), "");
  const many = ["a", "b", "c"].map((r, i) => ({ id: String(i), reason: r }));
  assert.match(triage.formatSkippedSummary(many), /等）$/);
});

await check("approveOnly: only fetch+parse can report failure; success UI + callbacks run outside; no 核准連線失敗", () => {
  const card = read("src/components/listing/ResultCard.tsx");
  const start = card.indexOf("async function approveOnly()");
  const end = card.indexOf("// B4: one-click write ip_characters");
  assert.ok(start > 0 && end > start);
  const body = card.slice(start, end);
  const code = body.replace(/\/\/.*$/gm, ""); // comments may mention the old toast text
  assert.match(body, /classifyApproveResponse\(/);
  assert.match(body, /recheckDraftStages\(/);
  assert.match(body, /APPROVE_RECHECK_MESSAGE/);
  assert.doesNotMatch(code, /核准連線失敗/);
  // the callbacks come after the try/finally that owns the fetch
  const finallyAt = body.indexOf("setQuickBusy(false)");
  assert.ok(body.indexOf("onApproveSuccess?.(") > finallyAt, "onApproveSuccess runs after the fetch try/finally");
  assert.ok(body.indexOf("finishSuccessfulTransition()") > finallyAt);
  assert.match(body, /console\.error\("approveOnly: post-success UI update failed"/);
  assert.match(body, /router\.refresh\(\)/, "409 STAGE_MISMATCH refreshes");
});

await check("batchApproveOnly: triage + hide approved + `N 件已核准、M 件未核准`", () => {
  const panel = read("src/components/listing/DraftResultsPanel.tsx");
  assert.match(panel, /classifyApproveResponse\(/);
  assert.match(panel, /recheckDraftStages\(createClient\(\), ids\)/);
  assert.match(panel, /formatBatchRecheckMessage\(triage\)/);
  assert.match(panel, /scheduleLeaveThenRefresh\(triage\.approvedIds\)/);
  assert.match(panel, /console\.error\("batch approve: post-success UI update failed"/);
  assert.doesNotMatch(panel, /批次核准連線失敗/);
});

// =============================================================================
// B6 — batch ⛔
// =============================================================================
console.log("\nB6 batch ⛔ 必修");

const OK_DRAFT = (over = {}) => ({
  id: "ok",
  warnings: [],
  ip_name: "三麗鷗",
  character_name: "Kitty",
  title_zh: "Kitty 玩偶",
  twd_price: 599,
  twd_cost: 300,
  ...over
});

await check("partition: no IP / missing character / empty title are blocked; suggest-only warnings pass", () => {
  const drafts = [
    OK_DRAFT({ id: "fine" }),
    OK_DRAFT({ id: "noip", ip_name: "" }),
    OK_DRAFT({ id: "nochar", warnings: ["角色「Kitty」尚未建立 V2 字典"] }),
    OK_DRAFT({ id: "notitle", title_zh: "  " }),
    OK_DRAFT({ id: "suggest", warnings: ["使用情境詞可補強", "請核實尺寸"] }),
    OK_DRAFT({ id: "noprice", twd_price: null }) // 售價未算 is ⚠ confirm, never ⛔
  ];
  const { eligible, blocked } = gate.partitionApproveBlockers(drafts);
  assert.deepEqual(eligible.map((d) => d.id), ["fine", "suggest", "noprice"]);
  assert.deepEqual(blocked.map((b) => b.draft.id), ["noip", "nochar", "notitle"]);
  assert.ok(blocked[0].texts.some((t) => t.includes("缺少 IP")));
  assert.ok(blocked[1].texts.some((t) => t.includes("資料庫缺角色")));
  assert.ok(blocked[2].texts.some((t) => t.includes("標題空白")));
});

await check("gradeDraftForApprove === the grading the card always used (same inputs, same result)", () => {
  const inputs = [
    OK_DRAFT(),
    OK_DRAFT({ ip_name: null }),
    OK_DRAFT({ warnings: ["角色「小熊」尚未建立 V2 字典", "成本不齊"] }),
    OK_DRAFT({ warnings: ["使用情境", "⚠ 其他提醒"], twd_price: null })
  ];
  for (const d of inputs) {
    const viaGate = gate.gradeDraftForApprove(d);
    // exactly what ResultCard.warningSummary used to compute inline
    const missing = [...(d.warnings ?? []).join("\n").matchAll(/角色「([^」]+)」尚未建立/g)];
    const direct = warningTiers.gradeDraftWarnings(d.warnings, {
      ip_name: d.ip_name,
      character_name: d.character_name,
      title_zh: d.title_zh,
      twd_price: d.twd_price,
      twd_cost: d.twd_cost,
      missingCharacterInDict: missing.length > 0,
      missingIp: !d.ip_name?.trim()
    });
    assert.deepEqual(viaGate.block.map((w) => w.text), direct.block.map((w) => w.text));
    assert.equal(warningTiers.hasBlockingWarnings(viaGate), warningTiers.hasBlockingWarnings(direct));
  }
});

await check("confirm + toast wording", () => {
  assert.equal(
    gate.formatBatchApproveBlockedConfirm(2, 5),
    "有 2 件有 ⛔ 必修項目會被略過，要核准其餘 5 件嗎？"
  );
  assert.equal(gate.formatApproveBlockMessage(["a", "b"]), "⛔ 必修：a；b");
});

await check("panel: all blocked → toast only; some blocked → dialog; only eligible ids are sent", () => {
  const panel = read("src/components/listing/DraftResultsPanel.tsx");
  assert.match(panel, /partitionApproveBlockers\(selectedDrafts\)/);
  assert.match(panel, /都有 ⛔ 必修項目，無法核准/);
  assert.match(panel, /kind: "approve_blocked"/);
  assert.match(panel, /formatBatchApproveBlockedConfirm\(/);
  assert.match(panel, /runBatchApprove\(eligible\.map\(\(d\) => d\.id\)\)/);
  assert.match(panel, /runBatchApprove\(dialog\.eligibleIds\)/);
  assert.match(panel, /body: JSON\.stringify\(\{ draftIds: ids \}\)/);
});

await check("server-side ⛔: hasBlockingWarnings is a pure function of saved columns → both approve routes enforce it", () => {
  const gateSrc = read("src/lib/drafts/approveGate.ts");
  // every input is a product_drafts column, none is card state
  for (const column of ["warnings", "ip_name", "character_name", "title_zh", "twd_price", "twd_cost"]) {
    assert.ok(gateSrc.includes(column), `gate reads saved column ${column}`);
  }
  assert.match(gateSrc, /APPROVE_GATE_COLUMNS/);
  for (const rel of ["src/app/api/drafts/[id]/approve/route.ts", "src/app/api/drafts/batch/approve/route.ts"]) {
    const source = read(rel);
    assert.match(source, /approveBlockerTexts\(/, `${rel} must enforce ⛔`);
    assert.match(source, /APPROVE_GATE_COLUMNS/, `${rel} must read the gate columns`);
  }
  assert.match(read("src/app/api/drafts/[id]/approve/route.ts"), /BLOCKING_WARNINGS/);
  assert.match(read("src/components/listing/ResultCard.tsx"), /gradeDraftForApprove\(/);
});

// =============================================================================
// B7 — sequential review outcomes
// =============================================================================
console.log("\nB7 sequential review outcomes");

const ids = (n) => Array.from({ length: n }, (_, i) => `d${i + 1}`);
const run = (state, ...actions) => actions.reduce((s, a) => seq.reduceSequentialReview(s, a), state);
const newRound = (n) => seq.createSequentialReviewState(ids(n));

await check("done advances and counts; walking past the last item with nothing skipped closes ('finished')", () => {
  let s = run(newRound(2), { type: "done", id: "d1" });
  assert.equal(s.index, 1);
  assert.equal(seq.sequentialCounts(s).done, 1);
  s = run(s, { type: "done", id: "d2" });
  assert.equal(s.phase, "closed");
  assert.equal(s.closedBy, "finished");
});

await check("skip marks skipped and moves on; skipping the last item shows the summary", () => {
  let s = run(newRound(3), { type: "skip" });
  assert.equal(s.index, 1);
  assert.equal(s.outcomes.d1, "skipped");
  s = run(s, { type: "done", id: "d2" }, { type: "skip" });
  assert.equal(s.phase, "summary");
  const counts = seq.sequentialCounts(s);
  assert.deepEqual([counts.done, counts.skipped], [1, 2]);
  assert.deepEqual(seq.sequentialSkippedIds(s), ["d1", "d3"]);
});

await check("back never changes outcomes; skipping a done item keeps it done", () => {
  let s = run(newRound(3), { type: "done", id: "d1" }, { type: "skip" });
  const before = { ...s.outcomes };
  s = run(s, { type: "back" });
  assert.equal(s.index, 1);
  assert.deepEqual(s.outcomes, before);
  s = run(s, { type: "back" });
  assert.equal(s.index, 0);
  assert.deepEqual(s.outcomes, before);
  s = run(s, { type: "back" }); // already at first
  assert.equal(s.index, 0);
  s = run(s, { type: "skip" }); // d1 is done → stays done
  assert.equal(s.outcomes.d1, "done");
});

await check("acting on a previously skipped item makes it done (skipped count drops)", () => {
  let s = run(newRound(3), { type: "skip" }, { type: "skip" });
  assert.equal(seq.sequentialCounts(s).skipped, 2);
  s = run(s, { type: "back" }); // on d2
  s = run(s, { type: "done", id: "d2" });
  assert.equal(s.outcomes.d2, "done");
  assert.equal(seq.sequentialCounts(s).skipped, 1);
});

await check("結束逐件 / Esc: nothing skipped → close; skipped → summary; unvisited items are not 'skipped'", () => {
  assert.equal(run(newRound(3), { type: "end" }).phase, "closed");
  assert.equal(run(newRound(3), { type: "end" }).closedBy, "ended");
  const s = run(newRound(5), { type: "skip" }, { type: "end" });
  assert.equal(s.phase, "summary");
  assert.deepEqual(seq.sequentialSkippedIds(s), ["d1"]);
  assert.equal(seq.sequentialCounts(s).pending, 4);
  // 結束 inside the summary closes
  assert.equal(run(s, { type: "end" }).phase, "closed");
});

await check("summary: jump opens that item; acting returns to the summary; last skipped done → close", () => {
  let s = run(newRound(3), { type: "skip" }, { type: "done", id: "d2" }, { type: "skip" });
  assert.equal(s.phase, "summary");
  s = run(s, { type: "jump", index: 0 });
  assert.equal(s.phase, "reviewing");
  assert.equal(s.index, 0);
  assert.equal(s.fromSummary, true);
  s = run(s, { type: "done", id: "d1" });
  assert.equal(s.phase, "summary", "one skipped (d3) left → summary again");
  assert.deepEqual(seq.sequentialSkippedIds(s), ["d3"]);
  s = run(s, { type: "jump", index: 2 }, { type: "back" });
  assert.equal(s.phase, "summary", "back from a summary visit returns to the summary");
  s = run(s, { type: "jump", index: 2 }, { type: "done", id: "d3" });
  assert.equal(s.phase, "closed");
  assert.equal(s.closedBy, "finished");
  // out-of-range jump is ignored
  const sum = run(newRound(2), { type: "skip" }, { type: "skip" });
  assert.equal(run(sum, { type: "jump", index: 9 }).phase, "summary");
});

await check("restart with only the skipped items: new round, fresh outcomes", () => {
  let s = run(newRound(4), { type: "skip" }, { type: "done", id: "d2" }, { type: "skip" }, { type: "done", id: "d4" });
  assert.equal(s.phase, "summary");
  s = run(s, { type: "restart_skipped" });
  assert.deepEqual(s.ids, ["d1", "d3"]);
  assert.equal(s.phase, "reviewing");
  assert.equal(s.index, 0);
  assert.deepEqual(seq.sequentialCounts(s), { total: 2, position: 1, done: 0, skipped: 0, pending: 2 });
  s = run(s, { type: "done", id: "d1" }, { type: "done", id: "d3" });
  assert.equal(s.phase, "closed");
});

await check("a slow request that resolves after navigating still marks the right item without moving", () => {
  let s = run(newRound(3), { type: "skip" }); // now on d2; d1 was being approved in the background
  s = run(s, { type: "done", id: "d1" });
  assert.equal(s.outcomes.d1, "done");
  assert.equal(s.index, 1, "did not advance past d2");
  // resolves while the summary is up: recorded, and closes when nothing is left skipped
  let t = run(newRound(2), { type: "skip" }, { type: "skip" });
  assert.equal(t.phase, "summary");
  t = run(t, { type: "done", id: "d1" });
  assert.equal(t.phase, "summary");
  t = run(t, { type: "done", id: "d2" });
  assert.equal(t.phase, "closed");
  assert.deepEqual(run(newRound(2), { type: "done", id: "ghost" }), newRound(2), "unknown id ignored");
});

await check("progress counters: 第 i／N 件 and 已處理 x・跳過 y", () => {
  const s = run(newRound(5), { type: "done", id: "d1" }, { type: "skip" }, { type: "skip" });
  const c = seq.sequentialCounts(s);
  assert.deepEqual([c.position, c.total, c.done, c.skipped], [4, 5, 1, 2]);
  assert.equal(seq.sequentialCurrentId(s), "d4");
  assert.equal(seq.createSequentialReviewState([]).phase, "closed");
});

await check("overlay UI: 上一筆 / 跳過 / 結束逐件, progress + tally, summary with jump list and restart", () => {
  const overlay = read("src/components/listing/SequentialReviewOverlay.tsx");
  for (const text of ["‹ 上一筆", "跳過 ›", "結束逐件", "這輪跳過", "只看跳過的", "已處理 ${counts.done}・跳過 ${counts.skipped}", "第 ${counts.position}／${total} 件"]) {
    assert.ok(overlay.includes(text), `overlay must contain ${text}`);
  }
  assert.match(overlay, /dispatch\(\{ type: "jump", index: item\.index \}\)/);
  assert.match(overlay, /dispatch\(\{ type: "restart_skipped" \}\)/);
  assert.match(overlay, /reduceSequentialReview/);
  // ArrowRight/j = skip, ArrowLeft/k = back, Esc = end (→ summary when skipped)
  assert.match(overlay, /key === "ArrowRight" \|\| key === "j"[\s\S]{0,80}goSkip\(\)/);
  assert.match(overlay, /key === "ArrowLeft" \|\| key === "k"[\s\S]{0,80}goPrev\(\)/);
  assert.match(overlay, /key === "Escape"[\s\S]{0,60}endReview\(\)/);
  assert.match(overlay, /dispatch\(\{ type: "done", id: currentId \}\)/);
});

await check("ResultCard reports return success to the overlay (counts as done) and 送工廠 as not-left", () => {
  const card = read("src/components/listing/ResultCard.tsx");
  assert.match(card, /onApproveSuccess\?\.\(\{ leftStation: false \}\)/);
  assert.match(card, /onApproveSuccess\?\.\(\{ leftStation: true \}\)/);
  const rev = card.slice(card.indexOf("async function requestRevision()"), card.indexOf("/** B11: on-screen dirty"));
  assert.match(rev, /onApproveSuccess\?\.\(\{ leftStation: true \}\)/);
});

// =============================================================================
// wiring
// =============================================================================
console.log("\nwiring");

await check("existing auth static check covers the new batch route; no new !important in this package's files", () => {
  assert.match(
    read("scripts/verify-service-role-request-authorization.mjs"),
    /src\/app\/api\/drafts\/batch\/return-stage\/route\.ts/
  );
  for (const rel of [
    "src/lib/drafts/reviewTransitions.ts",
    "src/lib/drafts/pendingLeave.ts",
    "src/lib/drafts/sequentialReview.ts",
    "src/components/listing/ReviewConfirmModal.tsx",
    "src/components/listing/SequentialReviewOverlay.tsx"
  ]) {
    assert.doesNotMatch(read(rel), /!important/);
  }
});

await check("verify wiring: package.json script + verify-all entry", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["verify:review-flow"], "node scripts/verify-review-flow.mjs");
  assert.match(read("scripts/verify-all.mjs"), /scripts\/verify-review-flow\.mjs/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const { name, err } of failures) console.error(`\nFAIL: ${name}\n${err.stack}`);
  process.exit(1);
}
console.log("REVIEW-FLOW checks passed");
