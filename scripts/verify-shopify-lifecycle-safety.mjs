import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const safe = read("src/lib/shopify/publishDraftSafe.ts");
const lifecycle = read("src/lib/shopify/productLifecycle.ts");
const unpublish = read("src/app/api/drafts/[id]/unpublish/route.ts");
const recordsPage = read("src/app/records/page.tsx");
const actions = read("src/components/records/PublishLifecycleActionsBridge.tsx");

assert.match(unpublish, /confirmUnpublish\s*!==\s*true/, "unpublish must require explicit confirmation");
assert.match(unpublish, /canPublish\(/, "unpublish must use publish authorization");
assert.match(unpublish, /setShopifyProductStatus\(productId,\s*"DRAFT"\)/, "unpublish must use DRAFT status mutation");
assert.match(unpublish, /published_at intentionally preserved/, "published_at must be preserved");
assert.match(unpublish, /shopify_product_id \/ shopify_admin_url intentionally preserved/, "same Shopify linkage must be preserved");
assert.match(lifecycle, /mutation ProductChangeStatus/, "central productChangeStatus helper missing");
assert.match(lifecycle, /product\.id !== productId/, "status helper must validate returned product id");
assert.match(lifecycle, /product\.status !== status/, "status helper must validate returned status");
assert.match(lifecycle, /mutation ProductDelete/, "partial-DRAFT cleanup helper missing");
assert.match(lifecycle, /productId !== "mock-product-id"/, "mock-product-id must be excluded from live lifecycle mutations");

assert.match(safe, /product:\s*\{ \.\.\.payload\.product, status: "DRAFT" \}/, "productCreate must force DRAFT");
assert.doesNotMatch(safe, /publishableStatuses\s*=\s*\[[^\]]*"publishing"/, "publishing must not be publishable");
assert.match(safe, /Draft is already publishing; duplicate publish request blocked/, "double-publish 409 guard missing");
assert.match(safe, /draft\.status === "api_failed" && isRealShopifyProductId/, "api_failed existing-ID recovery missing");
assert.match(safe, /remote\?\.status === "ACTIVE"/, "unsafe ACTIVE partial must be blocked");
assert.match(safe, /await deleteShopifyProduct\(existingProductId, caller\)/, "DRAFT retry cleanup delete missing");
assert.match(safe, /clearLocalShopifyLink/, "stale/deleted linkage must clear locally before create");
assert.match(safe, /persistCreatedProductLink/, "created product ID must be persisted before follow-up");
assert.match(safe, /compensation productDelete succeeded/, "link-persistence compensation result missing");
assert.match(safe, /Shopify product created but local linkage failed; manual reconciliation required/, "fatal orphan reconciliation message missing");
assert.match(safe, /draft\.status === "draft_created" && isRealShopifyProductId/, "same-ID republish branch missing");
assert.match(safe, /setShopifyProductStatus\(productId, "ACTIVE", caller\)/, "final ACTIVE promotion missing");

const createIndex = safe.indexOf('product: { ...payload.product, status: "DRAFT" }');
const persistIndex = safe.indexOf("persistCreatedProductLink(serviceSupabase, id, productId)");
const variantIndex = safe.indexOf("mutation ProductVariantsBulkUpdate", persistIndex);
const activeIndex = safe.lastIndexOf('setShopifyProductStatus(productId, "ACTIVE", caller)');
assert(createIndex >= 0 && persistIndex > createIndex, "productId persistence must follow create");
assert(variantIndex > persistIndex, "variant sync must happen after productId persistence");
assert(activeIndex > variantIndex, "ACTIVE promotion must happen after variant sync");

assert.match(recordsPage, /PublishLifecycleActionsBridge/, "records page must wire lifecycle actions");
assert.match(actions, />\s*下架\s*</, "active product unpublish action missing");
assert.match(actions, />\s*重新上架\s*</, "draft product republish action missing");
assert.match(actions, /確認將此商品下架？/, "unpublish confirmation copy missing");
assert.match(actions, /Shopify 商品會保留，但顧客端將不可購買。/, "unpublish consequence copy missing");
assert.match(actions, />\s*取消\s*</, "confirmation cancel button missing");
assert.match(actions, />\s*確認下架\s*</, "confirmation action button missing");
assert.match(actions, /publishMode: "active", confirmActive: true/, "republish UI must call active publish contract");
assert.match(actions, /confirmUnpublish: true/, "unpublish UI must send explicit confirmation");

// No verifier test is allowed to touch network. Fail loudly if future edits try.
globalThis.fetch = async () => {
  throw new Error("NETWORK_FORBIDDEN_IN_SHOPIFY_LIFECYCLE_VERIFIER");
};

function runLifecycleModel({
  requested = "active",
  localStatus = "approved",
  existingId = null,
  remoteStatus = null,
  variantFails = false,
  linkFails = false,
  deleteFails = false,
  unpublish = false
} = {}) {
  const calls = [];
  let status = localStatus;
  let productId = existingId;
  let remote = remoteStatus;

  if (status === "publishing") return { http: 409, calls, status, productId, remote };

  if (unpublish) {
    if (status === "draft_created") return { http: 200, calls, status, productId, remote };
    assert.equal(status, "active_published");
    calls.push("productChangeStatus:DRAFT");
    remote = "DRAFT";
    status = "draft_created";
    return { http: 200, calls, status, productId, remote };
  }

  if (status === "draft_created" && productId) {
    if (requested === "active") {
      calls.push("productChangeStatus:ACTIVE");
      remote = "ACTIVE";
      status = "active_published";
    }
    return { http: 200, calls, status, productId, remote };
  }

  if (status === "api_failed" && productId) {
    calls.push("queryExisting");
    if (remote === "ACTIVE") return { http: 409, calls, status, productId, remote };
    if (remote === "DRAFT") {
      calls.push("productDelete");
      if (deleteFails) return { http: 409, calls, status, productId, remote };
    }
    calls.push("clearLocalId");
    productId = null;
  }

  calls.push("productCreate:DRAFT");
  productId = "gid://shopify/Product/101";
  remote = "DRAFT";
  calls.push("persistProductId");
  if (linkFails) {
    calls.push("productDelete");
    return { http: 502, calls, status: "api_failed", productId, remote: null };
  }
  calls.push("variantSync");
  if (variantFails) return { http: 502, calls, status: "api_failed", productId, remote };
  if (requested === "active") {
    calls.push("productChangeStatus:ACTIVE");
    remote = "ACTIVE";
    status = "active_published";
  } else {
    status = "draft_created";
  }
  calls.push(`local:${status}`);
  return { http: 200, calls, status, productId, remote };
}

// TEST 1 — active safe staging
{
  const r = runLifecycleModel({ requested: "active" });
  assert.deepEqual(r.calls, [
    "productCreate:DRAFT",
    "persistProductId",
    "variantSync",
    "productChangeStatus:ACTIVE",
    "local:active_published"
  ]);
  assert.equal(r.remote, "ACTIVE");
  console.log("PASS TEST 1 — active safe staging");
}

// TEST 2 — post-create failure
{
  const r = runLifecycleModel({ requested: "active", variantFails: true });
  assert.equal(r.status, "api_failed");
  assert.equal(r.remote, "DRAFT");
  assert.ok(r.productId);
  assert.equal(r.calls.filter((c) => c === "productChangeStatus:ACTIVE").length, 0);
  console.log("PASS TEST 2 — post-create failure remains DRAFT");
}

// TEST 3 — api_failed retry DRAFT
{
  const r = runLifecycleModel({ localStatus: "api_failed", existingId: "gid://shopify/Product/9", remoteStatus: "DRAFT" });
  assert.deepEqual(r.calls.slice(0, 4), ["queryExisting", "productDelete", "clearLocalId", "productCreate:DRAFT"]);
  assert.equal(r.calls.filter((c) => c === "productCreate:DRAFT").length, 1);
  console.log("PASS TEST 3 — api_failed DRAFT recovery creates once");
}

// TEST 4 — unsafe ACTIVE partial
{
  const r = runLifecycleModel({ localStatus: "api_failed", existingId: "gid://shopify/Product/9", remoteStatus: "ACTIVE" });
  assert.equal(r.http, 409);
  assert.equal(r.calls.filter((c) => c === "productDelete").length, 0);
  assert.equal(r.calls.filter((c) => c === "productCreate:DRAFT").length, 0);
  console.log("PASS TEST 4 — unsafe ACTIVE partial blocked");
}

// TEST 5 — double publish
{
  const r = runLifecycleModel({ localStatus: "publishing" });
  assert.equal(r.http, 409);
  assert.equal(r.calls.length, 0);
  console.log("PASS TEST 5 — publishing duplicate blocked");
}

// TEST 6 — unpublish
{
  const id = "gid://shopify/Product/77";
  const r = runLifecycleModel({ localStatus: "active_published", existingId: id, remoteStatus: "ACTIVE", unpublish: true });
  assert.deepEqual(r.calls, ["productChangeStatus:DRAFT"]);
  assert.equal(r.status, "draft_created");
  assert.equal(r.productId, id);
  assert.equal(r.remote, "DRAFT");
  console.log("PASS TEST 6 — unpublish preserves same product ID");
}

// TEST 7 — republish
{
  const id = "gid://shopify/Product/77";
  const r = runLifecycleModel({ localStatus: "draft_created", existingId: id, remoteStatus: "DRAFT", requested: "active" });
  assert.deepEqual(r.calls, ["productChangeStatus:ACTIVE"]);
  assert.equal(r.calls.filter((c) => c.startsWith("productCreate")).length, 0);
  assert.equal(r.status, "active_published");
  assert.equal(r.productId, id);
  console.log("PASS TEST 7 — re-publish reuses same product ID");
}

console.log("Shopify lifecycle safety verifier passed (mock/injected model only; network disabled)");
