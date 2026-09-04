import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const engine = read("src/lib/shopify/syncShopifyProduct.ts");
const route = read("src/app/api/drafts/[id]/shopify-sync/route.ts");
const lifecycle = read("src/app/api/drafts/[id]/shopify-lifecycle/route.ts");
const operations = read("src/lib/shopify/fullSyncGraphQL.ts");
const contract = read("scripts/graphql/shopify-full-sync-2026-04.graphql");
const migration = read("supabase/migrations/20260903100000_shopify_full_sync_state.sql");

for (const field of [
  "shopify_sync_status",
  "shopify_remote_updated_at",
  "shopify_sync_hash",
  "shopify_variant_id",
  "shopify_inventory_item_id",
  "shopify_media_id",
  "shopify_source_hash",
  "shopify_sync_jobs"
]) {
  assert.match(migration, new RegExp(field), `migration missing ${field}`);
}
assert.match(migration, /mark_linked_product_draft_dirty/, "draft payload dirty trigger missing");
assert.match(migration, /mark_linked_product_variant_dirty/, "variant dirty trigger missing");
assert.match(migration, /mark_linked_product_image_dirty/, "image dirty trigger missing");
assert.match(
  migration,
  /shopify_sync_status not in \('syncing', 'remote_deleted'\)/,
  "dirty triggers must preserve guarded sync states"
);

assert.match(route, /canPublish\(/, "sync route must require reviewer authorization");
assert.match(route, /forceRemoteOverwrite:\s*body\.forceRemoteOverwrite === true/);
assert.match(route, /confirmRemovals:\s*body\.confirmRemovals === true/);
assert.match(route, /confirmActiveUpdate:\s*body\.confirmActiveUpdate === true/);
assert.match(lifecycle, /confirmAction !== true/);
assert.match(lifecycle, /confirmPermanentDelete !== true/);
assert.match(lifecycle, /confirmTitle/);
assert.match(lifecycle, /Keep shopify_product_id\/admin URL as immutable audit evidence/);
assert.match(lifecycle, /lifecycle audit ledger is unavailable; no remote mutation was sent/);
assert.match(lifecycle, /manual_reconciliation_required/);

const readIndex = engine.indexOf("await loadSnapshot(productId, caller)");
const writeIndex = engine.indexOf("await caller(SYNC_PRODUCT_CORE_MUTATION");
assert.ok(readIndex >= 0 && writeIndex > readIndex, "sync must read remote state before writing");
assert.match(engine, /shopify_sync_status:\s*"conflict"/);
assert.match(engine, /sync_already_running/);
assert.match(engine, /partial \? "partial" : "error"/);
assert.match(engine, /active_update_confirmation_required/);
assert.match(engine, /sync audit ledger is unavailable; no remote mutation was sent/);
assert.match(engine, /removal_confirmation_required/);
assert.match(engine, /changeFromQuantity:\s*current/);
assert.match(engine, /adjustment:\s*desiredQuantity - current/);
assert.match(engine, /Shopify 回讀與工具不一致/);
assert.match(engine, /shopify_variant_id:/);
assert.match(engine, /shopify_media_id:/);

const addMediaIndex = engine.indexOf("ADD_PRODUCT_MEDIA_MUTATION");
const removeCommentIndex = engine.indexOf("Remove product references only after");
assert.ok(addMediaIndex >= 0 && removeCommentIndex > addMediaIndex, "media replacement must add before remove");

for (const operation of [
  "ProductSyncSnapshot",
  "SyncProductCore",
  "SyncProductVariants",
  "CreateProductVariants",
  "DeleteProductVariants",
  "AddProductMedia",
  "UpdateProductFiles"
]) {
  assert.match(operations, new RegExp(operation), `runtime operations missing ${operation}`);
  assert.match(contract, new RegExp(operation), `validated contract missing ${operation}`);
}
assert.doesNotMatch(contract, /productCreateMedia|productUpdateMedia|productDeleteMedia|productChangeStatus/);

console.log("Shopify full-sync source contract checks passed (runtime Shopify E2E still required)");
