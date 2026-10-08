import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const queueApi = read("src/app/api/generation-queue/route.ts");
const runner = read("src/components/listing/GenerationQueueRunner.tsx");
const layout = read("src/app/layout.tsx");
const workspace = read("src/components/listing/WorkspaceInputPanel.tsx");
const resultCard = read("src/components/listing/ResultCard.tsx");
const generate = read("src/app/api/generate/route.ts");

console.log("V1.1 generation queue runner");

assert.match(queueApi, /const QUEUE_VERSION = "v1\.1"/, "queue version marker missing");
assert.match(queueApi, /const MAX_CONCURRENCY = 2/, "server queue concurrency must stay capped at 2");
assert.match(queueApi, /from\("generation_runs"\)/, "queue must persist jobs in generation_runs");
assert.match(queueApi, /action === "enqueue"/, "enqueue action missing");
assert.match(queueApi, /action === "claim"/, "claim action missing");
assert.match(queueApi, /action === "fail"/, "network-failure action missing");
assert.match(queueApi, /action === "retry"/, "single retry action missing");
assert.match(queueApi, /worker_lock_expires_at/, "draft lock expiry missing");
assert.match(queueApi, /生成工作逾時中斷/, "stale queue recovery missing");
assert.match(queueApi, /\.eq\("status", "pending_copy"\)/, "claim must conditionally lock only queued drafts");
assert.match(queueApi, /\.is\("worker_id", null\)/, "claim must reject already-owned drafts");

assert.match(runner, /const MAX_LOCAL_CONCURRENCY = 2/, "client runner concurrency must stay capped at 2");
assert.match(runner, /POLL_MS = 4_000/, "queue resume polling missing");
assert.match(runner, /action: "claim"/, "runner must claim persisted DB jobs");
assert.match(runner, /queueRunId: job\.runId/, "runner must bind generate to generation_runs job id");
assert.match(runner, /\/api\/analyze-images/, "runner must own queued image analysis");
assert.match(runner, /reportNetworkFailure/, "runner network failures must persist");
assert.match(runner, /payload\.draftState === "blocked"/, "blocked output must remain a failed review state");
assert.match(layout, /<GenerationQueueRunner \/>/, "queue runner must mount globally for refresh resume");

assert.match(workspace, /action: "enqueue"/, "input submit must enqueue");
assert.match(workspace, /resetForNextItem\(\);[\s\S]*GENERATION_QUEUE_KICK_EVENT/, "input must reset before kicking runner");
assert.doesNotMatch(
  workspace,
  /fetch\("\/api\/generate"/,
  "new-item form must not synchronously block on /api/generate",
);
assert.match(workspace, /已排入生成佇列，表單已清空/, "operator enqueue feedback missing");

assert.match(resultCard, /action: "retry", draftId: draft\.id/, "failed queue card must support single retry");
assert.match(resultCard, /GENERATION_QUEUE_KICK_EVENT/, "retry must wake the queue runner");

assert.match(generate, /const queueRunId =/, "generate route queue job identity missing");
assert.match(generate, /Generation queue job is not claim-valid/, "generate route must validate claimed queue job");
assert.match(generate, /updateQueueRun\("failed"/, "generate failures must close queue job");
assert.match(generate, /successStatus\.generation_status === "failed" \? "failed" : "completed"/, "queue outcome must match draft outcome");
assert.match(generate, /worker_id: null/, "generate completion/failure must release worker lock");

console.log("V1.1 generation queue runner checks passed");
