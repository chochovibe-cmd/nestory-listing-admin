import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const guard = fs.readFileSync("src/lib/shopify/liveTestGuard.ts", "utf8");
const single = fs.readFileSync("src/app/api/drafts/[id]/publish/route.ts", "utf8");
const batch = fs.readFileSync("src/app/api/drafts/batch/publish/route.ts", "utf8");
const safe = fs.readFileSync("src/lib/shopify/publishDraftSafe.ts", "utf8");
const runner = fs.readFileSync("src/lib/shopify/runPublishBatch.ts", "utf8");
assert.match(guard, /SHOPIFY_PUBLISH_MOCK/);
assert.match(guard, /SHOPIFY_LIVE_TEST_DRAFT_ID/);
assert.match(guard, /SHOPIFY_ACTIVE_PUBLISH_ENABLED/);
assert.match(guard, /Live Shopify publishing is DRAFT-only/);
assert.match(guard, /publishMode !== "draft"/);
assert.match(guard, /draftIds\.length !== 1/);
assert.match(single, /checkLiveTestGuard/);
assert.match(batch, /checkLiveTestGuard/);
assert.match(safe, /checkLiveTestGuard/);
assert.match(runner, /checkLiveTestGuard/);

const originalMock = process.env.SHOPIFY_PUBLISH_MOCK;
const originalAllowlist = process.env.SHOPIFY_LIVE_TEST_DRAFT_ID;
const originalActiveEnabled = process.env.SHOPIFY_ACTIVE_PUBLISH_ENABLED;
const moduleUrl = pathToFileURL("src/lib/shopify/liveTestGuard.ts").href;
const { checkLiveTestGuard } = await import(moduleUrl);

try {
  // Mock mode never reaches real Shopify and stays unrestricted.
  process.env.SHOPIFY_PUBLISH_MOCK = "true";
  process.env.SHOPIFY_LIVE_TEST_DRAFT_ID = "x";
  process.env.SHOPIFY_ACTIVE_PUBLISH_ENABLED = "false";
  assert.equal(checkLiveTestGuard({ draftIds: ["other", "z"], publishMode: "active" }), null);

  // Normal live daily mode: any draft can publish as DRAFT, ACTIVE is blocked.
  process.env.SHOPIFY_PUBLISH_MOCK = "false";
  delete process.env.SHOPIFY_LIVE_TEST_DRAFT_ID;
  delete process.env.SHOPIFY_ACTIVE_PUBLISH_ENABLED;
  assert.equal(checkLiveTestGuard({ draftIds: ["x"], publishMode: "draft" }), null);
  assert.equal(checkLiveTestGuard({ draftIds: ["x", "y"], publishMode: "draft" }), null);
  assert.match(checkLiveTestGuard({ draftIds: ["x"], publishMode: "active" }), /DRAFT-only/);
  assert.match(checkLiveTestGuard({ draftIds: ["x"] }), /DRAFT-only/);

  // ACTIVE requires a separate explicit go-live flag.
  process.env.SHOPIFY_ACTIVE_PUBLISH_ENABLED = "true";
  assert.equal(checkLiveTestGuard({ draftIds: ["x"], publishMode: "active" }), null);

  // A configured single-draft allowlist remains stricter, even if ACTIVE is enabled.
  process.env.SHOPIFY_LIVE_TEST_DRAFT_ID = "x";
  assert.equal(checkLiveTestGuard({ draftIds: ["x"], publishMode: "draft" }), null);
  assert.match(checkLiveTestGuard({ draftIds: ["other"], publishMode: "draft" }), /allowlist/);
  assert.match(checkLiveTestGuard({ draftIds: ["x"], publishMode: "active" }), /DRAFT/);
  assert.match(checkLiveTestGuard({ draftIds: ["x", "y"], publishMode: "draft" }), /single/);
  assert.equal(checkLiveTestGuard({ draftIds: ["x"], operation: "sync" }), null);
  assert.match(checkLiveTestGuard({ draftIds: ["other"], operation: "archive" }), /allowlist/);

  // Without the single-draft test allowlist, non-publish lifecycle writes keep
  // their existing authorization/contract and are not accidentally blocked here.
  delete process.env.SHOPIFY_LIVE_TEST_DRAFT_ID;
  process.env.SHOPIFY_ACTIVE_PUBLISH_ENABLED = "false";
  assert.equal(checkLiveTestGuard({ draftIds: ["x"], operation: "sync" }), null);
  assert.equal(checkLiveTestGuard({ draftIds: ["x"], operation: "archive" }), null);
} finally {
  if (originalMock === undefined) delete process.env.SHOPIFY_PUBLISH_MOCK;
  else process.env.SHOPIFY_PUBLISH_MOCK = originalMock;
  if (originalAllowlist === undefined) delete process.env.SHOPIFY_LIVE_TEST_DRAFT_ID;
  else process.env.SHOPIFY_LIVE_TEST_DRAFT_ID = originalAllowlist;
  if (originalActiveEnabled === undefined) delete process.env.SHOPIFY_ACTIVE_PUBLISH_ENABLED;
  else process.env.SHOPIFY_ACTIVE_PUBLISH_ENABLED = originalActiveEnabled;
}

console.log(
  "Shopify live-write guard checks passed: mock, daily DRAFT, ACTIVE block/explicit enable, single-draft allowlist"
);
