import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const variantSku = read("src/lib/shopify/variantSku.ts");
const payload = read("src/lib/shopify/payload.ts");
const publish = read("src/lib/shopify/publishDraftSafe.ts");
const sync = read("src/lib/shopify/syncShopifyProduct.ts");
const preflight = read("src/app/api/shopify/runtime-preflight/route.ts");
const token = read("src/lib/shopify/adminToken.ts");

function check(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (error) {
    console.error("FAIL", name);
    throw error;
  }
}

check("SKU authority stays on existing generateSku", () => {
  assert.match(variantSku, /resolveShopifySkuBase/);
  assert.match(variantSku, /generateSku\(\{/);
  assert.match(payload, /resolveShopifySkuBase\(draft\)/);
  assert.doesNotMatch(payload, /draft\.sku\s*\?\?/);
});

check("blank multi-variant SKU fallback is deterministic and preserves explicit SKU", () => {
  assert.match(variantSku, /if \(row\.sku\?\.trim\(\)\) continue/);
  assert.match(variantSku, /row\.sort_order \+ 1/);
  assert.match(variantSku, /padStart\(3, "0"\)/);
  assert.match(variantSku, /used\.has\(candidate\.toUpperCase\(\)\)/);
  assert.match(variantSku, /previousSku/);
});

check("real publish persists row SKU before Shopify productCreate", () => {
  const prepare = publish.indexOf("ensurePersistedVariantSkus(serviceSupabase, id");
  const create = publish.indexOf("mutation ProductCreate");
  assert.ok(prepare >= 0);
  assert.ok(create > prepare);
  assert.match(publish, /!mockMode && !deps\.callGraphQL/);
  assert.match(publish, /fillMissingVariantSkus\(typedVariantRows, skuBase\)/);
});

check("real sync persists row SKU while injected/mock paths stay non-persistent", () => {
  assert.match(
    sync,
    /process\.env\.SHOPIFY_PUBLISH_MOCK === "false" && !deps\.callGraphQL/
  );
  assert.match(sync, /ensurePersistedVariantSkus\(serviceSupabase, draftId, variantRows, skuBase\)/);
  assert.match(sync, /fillMissingVariantSkus\(variantRows, skuBase\)/);
  assert.match(sync, /product_variants: syncVariantRows/);
  assert.match(sync, /localVariantRows\(syncVariantRows\)/);
});

check("SKU DB write is guarded and stops before remote write on race", () => {
  assert.match(variantSku, /\.eq\("draft_id", draftId\)/);
  assert.match(variantSku, /query\.is\("sku", null\)/);
  assert.match(variantSku, /query\.eq\("sku", assignment\.previousSku\)/);
  assert.match(variantSku, /Shopify 尚未變更/);
  assert.match(variantSku, /已停止 Shopify 寫入/);
});

check("runtime preflight is Preview-only + one-time-token gated", () => {
  assert.match(preflight, /process\.env\.VERCEL_ENV !== "preview"/);
  assert.match(preflight, /SHOPIFY_RUNTIME_PREFLIGHT_TOKEN/);
  assert.match(preflight, /timingSafeEqual/);
  assert.match(preflight, /Cache-Control/);
  assert.match(preflight, /no-store/);
});

check("runtime preflight is read-only and never returns credentials", () => {
  assert.match(preflight, /query NestoryShopifyRuntimePreflight/);
  assert.match(preflight, /shop \{/);
  assert.doesNotMatch(preflight, /\bmutation\b/);
  assert.doesNotMatch(preflight, /productCreate|productUpdate|productVariantsBulk|metafieldsSet/);
  assert.doesNotMatch(preflight, /accessToken\s*:/);
  assert.doesNotMatch(preflight, /SHOPIFY_CLIENT_SECRET.*Response|SHOPIFY_CLIENT_ID.*Response/);
});

check("preflight exercises the same client-credentials Admin GraphQL path", () => {
  assert.match(preflight, /callShopifyAdminGraphQL/);
  assert.match(preflight, /hasShopifyAdminCredentials/);
  assert.match(preflight, /credentialMode: "client_credentials"/);
  assert.match(token, /grant_type: "client_credentials"/);
  assert.match(token, /SHOPIFY_CLIENT_ID/);
  assert.match(token, /SHOPIFY_CLIENT_SECRET/);
});

console.log("Shopify batch-readiness source gate passed");
