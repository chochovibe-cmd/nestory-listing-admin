import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const queue = read("src/app/api/generation-queue/route.ts");
const runner = read("src/components/listing/GenerationQueueRunner.tsx");
const resultCard = read("src/components/listing/ResultCard.tsx");
const generate = read("src/app/api/generate/route.ts");

console.log("V1.1 nonblocking regeneration");

assert.match(queue, /jobKind\?: QueueJobKind/);
assert.match(queue, /"regen_full" \| "regen_field"/);
assert.match(queue, /action === "enqueue_regen"/);
assert.match(queue, /action === "regen_status"/);
assert.match(queue, /rule_version: "nestory-v1\.1-regen"/);
assert.match(queue, /This draft already has a generation job in progress/);
assert.match(queue, /pwa-regen:/);
assert.match(queue, /重生工作逾時中斷/);
assert.match(queue, /isRegenJob\(input\)/);

assert.match(runner, /REGEN_QUEUE_STATUS_EVENT/);
assert.match(runner, /jobKind !== "full"/);
assert.match(runner, /queueRunId: job\.runId/);
assert.match(runner, /regenNotes: job\.input\.regenNotes/);
assert.match(runner, /field: job\.input\.regenField/);
assert.match(runner, /currentValues: job\.input\.currentValues/);
assert.match(runner, /重新生成完成/);

assert.match(resultCard, /action: "enqueue_regen"/);
assert.match(resultCard, /jobKind: "regen_full"/);
assert.match(resultCard, /jobKind: "regen_field"/);
assert.match(resultCard, /setRegenOpen\(false\)/);
assert.match(resultCard, /↻ 重生中…/);
assert.match(resultCard, /⚠ 重生失敗/);
assert.match(resultCard, /action: "regen_status"/);
assert.doesNotMatch(
  resultCard,
  /async function regenerateField[\s\S]*?fetch\("\/api\/generate"/,
  "single-field regeneration must not block ResultCard on /api/generate",
);
assert.doesNotMatch(
  resultCard,
  /async function regenerate\(\)[\s\S]*?fetch\("\/api\/generate"/,
  "full regeneration must not block ResultCard on /api/generate",
);

assert.match(generate, /queueJobKind: "full" \| "regen_full" \| "regen_field"/);
assert.match(generate, /queueJobKind === "regen_full"/);
assert.match(generate, /draftUpdate\.status = draft\.status/);
assert.match(generate, /draftUpdate\.pipeline_stage = draft\.pipeline_stage/);
assert.match(generate, /shopify_sync_status = "dirty"/);
assert.match(generate, /queueJobKind === "regen_field"/);
assert.match(generate, /updateQueueRun\("completed"/);

console.log("V1.1 nonblocking regeneration checks passed");
