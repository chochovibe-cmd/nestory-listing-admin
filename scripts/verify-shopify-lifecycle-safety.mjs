import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const safe = read("src/lib/shopify/publishDraftSafe.ts");
const payload = read("src/lib/shopify/payload.ts");
const prep = read("src/lib/images/prepareImagesForPublish.ts");
const lifecycle = read("src/lib/shopify/productLifecycle.ts");
const unpublish = read("src/app/api/drafts/[id]/unpublish/route.ts");
const recordsPage = read("src/app/records/page.tsx");
const actions = read("src/components/records/PublishLifecycleActionsBridge.tsx");

assert.match(unpublish, /confirmUnpublish\s*!==\s*true/, "unpublish must require explicit confirmation");
assert.match(unpublish, /canPublish\(/, "unpublish must use publish authorization");
assert.match(unpublish, /setShopifyProductStatus\(productId,\s*"DRAFT"\)/, "unpublish must use DRAFT status mutation");
assert.match(unpublish, /published_at intentionally preserved/, "published_at must be preserved");
assert.match(unpublish, /shopify_product_id \/ shopify_admin_url intentionally preserved/, "same Shopify linkage must be preserved");
assert.match(lifecycle, /mutation ProductUpdateStatus/, "central non-deprecated productUpdate status helper missing");
assert.match(lifecycle, /product\.id !== productId/, "status helper must validate returned product id");
assert.match(lifecycle, /product\.status !== status/, "status helper must validate returned status");
assert.match(lifecycle, /productId !== "mock-product-id"/, "mock-product-id must be excluded from live lifecycle mutations");
assert.match(lifecycle, /handle === "online_store"/, "Online Store discovery must use Shopify channel handle, not a store-specific publication ID");
assert.match(lifecycle, /mutation PublishProductToOnlineStore/, "Online Store publishablePublish helper missing");
assert.match(lifecycle, /publishablePublish\(id: \$id, input: \$input\)/, "publishablePublish mutation missing");
assert.match(lifecycle, /publishedOnPublication\(publicationId: \$publicationId\)/, "Online Store publication readback missing");
assert.match(safe, /publishShopifyProductToOnlineStore\(productId, caller\)/, "ACTIVE flow must publish to Online Store before local success");

assert.match(safe, /product:\s*\{ \.\.\.payload\.product, status: "DRAFT" \}/, "productCreate must force DRAFT");
assert.doesNotMatch(safe, /publishableStatuses\s*=\s*\[[^\]]*"publishing"/, "publishing must not be publishable");
assert.match(safe, /Draft is already publishing; duplicate publish request blocked/, "double-publish 409 guard missing");
assert.match(safe, /draft\.status === "api_failed" && isRealShopifyProductId/, "api_failed existing-ID recovery missing");
assert.match(safe, /remote\?\.status === "ACTIVE"/, "unsafe ACTIVE partial must be blocked");
assert.match(safe, /resumeExistingDraftId/, "api_failed DRAFT must resume existing Shopify product");
assert.doesNotMatch(safe, /await deleteShopifyProduct\(existingProductId, caller\)/, "recoverable DRAFT must not be deleted");
assert.match(safe, /clearLocalShopifyLink/, "stale remote linkage must still clear locally before replacement create");
assert.match(safe, /persistCreatedProductLink/, "created product ID must be persisted before follow-up");
assert.match(safe, /local linkage persistence failed; manual reconciliation required/, "fatal orphan reconciliation message missing");
assert.match(safe, /draft\.status === "draft_created" && isRealShopifyProductId/, "same-ID republish branch missing");
assert.match(safe, /setShopifyProductStatus\(productId, "ACTIVE", caller\)/, "final ACTIVE promotion missing");

const createIndex = safe.indexOf('product: { ...payload.product, status: "DRAFT" }');
const persistIndex = safe.indexOf("persistCreatedProductLink(serviceSupabase, id, productId)");
const variantIndex = safe.indexOf("mutation ProductVariantsBulkUpdate", persistIndex);
const mediaIndex = safe.indexOf("mutation ProductAttachMedia", variantIndex);
const activeIndex = safe.lastIndexOf('setShopifyProductStatus(productId, "ACTIVE", caller)');
const publicationIndex = safe.lastIndexOf("publishShopifyProductToOnlineStore(productId, caller)");
const finalLocalIndex = safe.lastIndexOf("finishLocalSuccess(");
assert(createIndex >= 0 && persistIndex > createIndex, "productId persistence must follow create");
assert(variantIndex > persistIndex, "variant sync must happen after productId persistence");
assert(mediaIndex > variantIndex, "media sync must happen after variant sync");
assert(activeIndex > mediaIndex, "ACTIVE promotion must happen after media sync");
assert(publicationIndex > activeIndex, "Online Store publication must happen after ACTIVE status promotion");
assert(finalLocalIndex > publicationIndex, "local active_published success must happen after publication readback");
assert.doesNotMatch(safe, /productCreate\(product: \$product, media: \$media\)/, "productCreate must not wait on media");
assert.match(safe, /media sync is pending/, "pre-media recovery checkpoint missing");
assert.match(payload, /const publishSku = draft\.sku\?\.trim\(\) \|\| generatedSeedSku;/, "reviewed draft SKU must be authoritative when present");
assert.match(payload, /\.\.\.generatedVariantSeed,[\s\S]*sku: publishSku/, "generated variant seed must not override reviewed draft SKU");
assert.match(payload, /image\.image_type === "main" \|\| image\.image_type === "variant"/, "Shopify product media must only include main and variant images");
assert.match(prep, /processing_status === "done"/, "publish image prep must reuse completed processed images");
assert.match(prep, /isShopifyCdnUrl\(img\.processed_file_url\)/, "publish image prep must recognize existing Shopify CDN URLs");
assert.match(prep, /shouldRunSharp/, "publish image prep sharp fast-path missing");
assert.match(prep, /shouldRunFinalize/, "publish image prep finalize fast-path missing");
assert.match(prep, /needsFinalizeNow = !preflightKnown \|\| shouldRunSharp \|\| shouldRunFinalize/, "publish image prep fallback must preserve full path when needed");

assert.match(recordsPage, /PublishLifecycleActionsBridge/, "records page must wire lifecycle actions");
assert.match(actions, />\s*Shopify 封存\s*</, "active product archive action missing");
assert.match(actions, />\s*恢復 Shopify\s*</, "archived product restore action missing");
assert.match(actions, /確認封存 Shopify 商品/, "archive confirmation copy missing");
assert.match(actions, /商品會從顧客端移除，但仍保留在 Shopify 後台/, "archive consequence copy missing");
assert.match(actions, />\s*取消\s*</, "confirmation cancel button missing");
assert.match(actions, /confirm\.action === "archive" \? "確認封存" : "確認恢復"/, "confirmation action labels missing");
assert.match(actions, /shopify-lifecycle/, "records lifecycle UI must call the guarded lifecycle endpoint");
assert.match(actions, /confirmAction: true/, "records lifecycle UI must send explicit confirmation");
assert.doesNotMatch(actions, /\/api\/drafts\/\$\{row\.id\}\/unpublish/, "records UI must not bypass the lifecycle ledger");
assert.doesNotMatch(actions, /publishMode: "active"/, "restore must return to DRAFT rather than publish ACTIVE");

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
  publicationFails = false,
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
      calls.push("publishablePublish:online_store");
      if (publicationFails) {
        calls.push("productChangeStatus:DRAFT");
        remote = "DRAFT";
        status = "api_failed";
        return { http: 502, calls, status, productId, remote };
      }
      calls.push("verifyPublication:online_store");
      status = "active_published";
    }
    return { http: 200, calls, status, productId, remote };
  }

  let resumed = false;
  if (status === "api_failed" && productId) {
    calls.push("queryExisting");
    if (remote === "ACTIVE") return { http: 409, calls, status, productId, remote };
    if (remote === "DRAFT") {
      calls.push("resumeExisting:DRAFT");
      resumed = true;
    } else {
      calls.push("clearLocalId");
      productId = null;
    }
  }

  if (!resumed) {
    calls.push("productCreate:DRAFT");
    productId = "gid://shopify/Product/101";
    remote = "DRAFT";
    calls.push("persistProductId");
  }
  if (linkFails) {
    calls.push("productDelete");
    return { http: 502, calls, status: "api_failed", productId, remote: null };
  }
  calls.push("variantSync");
  if (variantFails) return { http: 502, calls, status: "api_failed", productId, remote };
  if (requested === "active") {
    calls.push("productChangeStatus:ACTIVE");
    remote = "ACTIVE";
    calls.push("publishablePublish:online_store");
    if (publicationFails) {
      calls.push("productChangeStatus:DRAFT");
      remote = "DRAFT";
      status = "api_failed";
      return { http: 502, calls, status, productId, remote };
    }
    calls.push("verifyPublication:online_store");
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
    "publishablePublish:online_store",
    "verifyPublication:online_store",
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

// TEST 3 — api_failed retry DRAFT resumes same ID
{
  const id = "gid://shopify/Product/9";
  const r = runLifecycleModel({ localStatus: "api_failed", existingId: id, remoteStatus: "DRAFT" });
  assert.deepEqual(r.calls.slice(0, 3), ["queryExisting", "resumeExisting:DRAFT", "variantSync"]);
  assert.equal(r.calls.filter((c) => c === "productCreate:DRAFT").length, 0);
  assert.equal(r.productId, id);
  console.log("PASS TEST 3 — api_failed DRAFT recovery reuses same product");
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
  assert.deepEqual(r.calls, [
    "productChangeStatus:ACTIVE",
    "publishablePublish:online_store",
    "verifyPublication:online_store"
  ]);
  assert.equal(r.calls.filter((c) => c.startsWith("productCreate")).length, 0);
  assert.equal(r.status, "active_published");
  assert.equal(r.productId, id);
  console.log("PASS TEST 7 — re-publish reuses same product ID");
}

// TEST 8 — Online Store publication failure must never become local active_published
{
  const r = runLifecycleModel({ requested: "active", publicationFails: true });
  assert.equal(r.http, 502);
  assert.equal(r.status, "api_failed");
  assert.equal(r.remote, "DRAFT");
  assert.ok(r.calls.includes("publishablePublish:online_store"));
  assert.ok(r.calls.includes("productChangeStatus:DRAFT"));
  assert.equal(r.calls.filter((c) => c === "local:active_published").length, 0);
  console.log("PASS TEST 8 — publication failure rolls back DRAFT and blocks local ACTIVE success");
}

console.log("Shopify lifecycle safety verifier passed (mock/injected model only; network disabled)");
