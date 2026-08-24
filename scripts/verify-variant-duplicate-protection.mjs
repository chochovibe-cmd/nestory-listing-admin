import assert from "node:assert/strict";
import fs from "node:fs";

const cross = fs.readFileSync("src/lib/variants/variantCrossExpand.ts", "utf8");
const pricing = fs.readFileSync("src/lib/variants/variantPricing.ts", "utf8");
const persist = fs.readFileSync("src/lib/variants/variantPersist.ts", "utf8");
const shopifyVariants = fs.readFileSync("src/lib/variants/shopifyVariants.ts", "utf8");
const publishDraftFacade = fs.readFileSync("src/lib/shopify/publishDraft.ts", "utf8");
const publishDraftSafe = fs.readFileSync("src/lib/shopify/publishDraftSafe.ts", "utf8");

// 1) Expand/merge must surface duplicate hand-filled losers instead of silently dropping them.
assert.match(cross, /export function findDuplicateVariantMergeKeyRows/);
assert.match(cross, /export function findDuplicateHandFilledVariantRows/);
assert.match(
  cross,
  /const wouldDiscardHandFilled:[\s\S]*findDuplicateHandFilledVariantRows\(existing\)/
);

// 2) Workspace validation runs before persistDraft and must reject duplicate option combinations.
assert.match(pricing, /findDuplicateVariantMergeKeyRows\(input\.variants\)/);
assert.match(pricing, /款式組合重複/);

// 3) Shared ResultCard persistence guard must fail before any DB query/insert.
const validateIndex = persist.indexOf("const duplicateRows = findDuplicateVariantInsertRows(rows)");
const dbReadIndex = persist.indexOf('.from("product_variants")');
assert.ok(validateIndex >= 0, "persist duplicate validation missing");
assert.ok(dbReadIndex > validateIndex, "duplicate validation must run before product_variants DB access");
assert.match(persist, /phase:\s*"validate"/);

// 4) Public publish path remains a facade; implementation checks belong to publishDraftSafe.
assert.match(
  publishDraftFacade,
  /export\s+\{\s*publishDraft\s*\}\s+from\s+["']@\/lib\/shopify\/publishDraftSafe["']/,
  "publishDraft facade must re-export publishDraftSafe"
);

// 5) Publish must reject legacy/manual duplicate DB rows before payload creation and CAS claim.
assert.match(shopifyVariants, /export function findDuplicateProductVariantRows/);
const publishFunctionIndex = publishDraftSafe.indexOf("export async function publishDraft(");
assert.ok(publishFunctionIndex >= 0, "publishDraft safe implementation missing");
const publishImplementation = publishDraftSafe.slice(publishFunctionIndex);
const publishGuardIndex = publishImplementation.indexOf(
  "findDuplicateProductVariantRows(typedVariantRows)"
);
const payloadIndex = publishImplementation.indexOf("buildShopifyProductPayload(");
const claimPublishingIndex = publishImplementation.indexOf("await claimPublishing(");
assert.ok(publishGuardIndex >= 0, "publish duplicate guard missing");
assert.ok(payloadIndex > publishGuardIndex, "publish duplicate guard must run before payload creation");
assert.ok(
  claimPublishingIndex > payloadIndex,
  "duplicate validation and payload creation must run before claimPublishing"
);
assert.match(publishImplementation, /status:\s*409/);
assert.match(publishImplementation, /款式組合重複/);

// Minimal duplicate-key behavior mirror: later same normalized tuple is a duplicate.
function duplicateIndexes(rows) {
  const seen = new Set();
  const out = [];
  rows.forEach((row, index) => {
    const key = row.map((v) => String(v ?? "").trim().toLowerCase()).join("\u0001");
    if (seen.has(key)) out.push(index);
    else seen.add(key);
  });
  return out;
}
assert.deepEqual(
  duplicateIndexes([
    ["粉色", "12cm", ""],
    ["藍色", "12cm", ""],
    ["粉色", "12cm", ""]
  ]),
  [2]
);

console.log("Variant duplicate-protection checks passed");
