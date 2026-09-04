import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const resultCard = read("src/components/listing/ResultCard.tsx");
const controls = read("src/components/listing/ShopifySyncControls.tsx");
const records = read("src/components/records/PublishLifecycleActionsBridge.tsx");

assert.match(resultCard, /ShopifySyncControls/);
assert.match(resultCard, /ShopifySyncStatusChip/);
assert.match(resultCard, /<ShopifySyncStatusChip[\s\S]*?\/>/);
assert.match(resultCard, /<ShopifySyncControls[\s\S]*?\/>/);

for (const endpoint of ["/api/drafts/${draftId}/shopify-sync", "/api/drafts/${draftId}/shopify-lifecycle"]) {
  assert.ok(controls.includes(endpoint), `sync UX missing endpoint ${endpoint}`);
}
for (const copy of [
  "只儲存工具",
  "儲存並同步 Shopify",
  "remote_conflict",
  "removal_confirmation_required",
  "active_update_confirmation_required",
  "confirmPermanentDelete",
  "confirmTitle",
  "modal-overlay",
  "開啟 Shopify 後台"
]) {
  assert.ok(controls.includes(copy), `sync UX missing ${copy}`);
}
assert.match(controls, /confirmTitle:\s*deleteTitle\.trim\(\)/);
assert.match(controls, /deleteTitle\.trim\(\)\s*!==\s*title\.trim\(\)/);

assert.match(records, /\/api\/drafts\/\$\{row\.id\}\/shopify-lifecycle/);
assert.doesNotMatch(records, /\/api\/drafts\/\$\{row\.id\}\/(?:publish|unpublish)/);
assert.doesNotMatch(records, /fetch\([^\n]*(?:\/publish|\/unpublish)/);

console.log("Shopify sync UX source contract checks passed");
