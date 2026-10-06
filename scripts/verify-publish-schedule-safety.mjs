import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("src/app/api/publish-schedules/route.ts", "utf8");
const dryRun = fs.readFileSync("src/app/api/publish-schedules/dry-run/route.ts", "utf8");
const runner = fs.readFileSync("src/lib/shopify/runDuePublishSchedules.ts", "utf8");
const core = fs.readFileSync("src/lib/drafts/publishScheduleCore.ts", "utf8");
const modal = fs.readFileSync("src/components/listing/Station3PublishModal.tsx", "utf8");
const center = fs.readFileSync("src/components/records/ScheduleCenterPreview.tsx", "utf8");

assert.match(route, /requirePublisher/);
assert.match(route, /canPublish/);
assert.match(route, /pipeline_stage !== "ready"/);
assert.match(route, /scheduleStagingEnabled\(\)/);
assert.match(route, /publish_schedule_groups/);
assert.match(route, /publish_schedule_items/);

assert.match(core, /PUBLISH_SCHEDULE_STAGING_ENABLED/);
assert.match(core, /PUBLISH_SCHEDULE_EXECUTION_ENABLED/);
assert.match(core, /=== "true"/);

assert.match(dryRun, /if \(scheduleExecutionEnabled\(\)\)/);
assert.match(dryRun, /runDuePublishSchedules/);

assert.match(runner, /if \(!scheduleExecutionEnabled\(\)\)/);
assert.match(runner, /no items were claimed and no Shopify write was sent/);
assert.match(runner, /queue_position/);
for (const status of ["dirty","syncing","conflict","error","partial","remote_deleted"]) {
  assert.ok(runner.includes('"' + status + '"'), "missing blocking Shopify sync status: " + status);
}
assert.match(runner, /status: "blocked"/);
assert.match(runner, /publishMode: "active"/);

assert.match(modal, /\/api\/publish-schedules/);
assert.match(modal, /schedulePreviewOpen/);
assert.match(center, /\/api\/publish-schedules\/dry-run/);
for (const action of ["retry_blocked","cancel","pause","resume"]) {
  assert.ok(center.includes(action), "missing schedule center action: " + action);
}

console.log("PASS: schedule API/UI safety contracts are intact.");
