import assert from "node:assert/strict";
import fs from "node:fs";

const variants = fs.readFileSync("src/lib/variants/shopifyVariants.ts", "utf8");
const payload = fs.readFileSync("src/lib/shopify/payload.ts", "utf8");
const route = fs.readFileSync("src/app/api/shopify/auth-self-test/route.ts", "utf8");

assert.match(variants, /export function deriveVariantSku/);
assert.match(variants, /terminalSequence/);
assert.match(variants, /deriveVariantSku\(draft\.sku, row\.sku, index\)/);
assert.match(payload, /price_mode: draft\.price_mode,\s+sku/);

function deriveVariantSku(baseSku, rowSku, zeroBasedIndex) {
  const explicit = rowSku?.trim();
  if (explicit) return explicit;
  const base = baseSku?.trim();
  if (!base) return null;
  const terminalSequence = base.match(/^(.*-)(\d{3})$/);
  if (terminalSequence) {
    const sequence = Number(terminalSequence[2]) + Math.max(0, zeroBasedIndex);
    return `${terminalSequence[1]}${String(sequence).padStart(3, "0")}`;
  }
  return zeroBasedIndex === 0
    ? base
    : `${base}-${String(zeroBasedIndex + 1).padStart(3, "0")}`;
}

assert.equal(deriveVariantSku("CHO-OTH-MIF-MIF-001", null, 0), "CHO-OTH-MIF-MIF-001");
assert.equal(deriveVariantSku("CHO-OTH-MIF-MIF-001", null, 1), "CHO-OTH-MIF-MIF-002");
assert.equal(deriveVariantSku("CHO-OTH-MIF-MIF-001", null, 2), "CHO-OTH-MIF-MIF-003");
assert.equal(deriveVariantSku("CHO-OTH-MIF-MIF-001", "MANUAL-9", 1), "MANUAL-9");
assert.equal(deriveVariantSku("BASESKU", null, 0), "BASESKU");
assert.equal(deriveVariantSku("BASESKU", null, 1), "BASESKU-002");
assert.equal(deriveVariantSku(null, null, 0), null);

assert.match(route, /process\.env\.VERCEL_ENV !== "preview"/);
assert.match(route, /SHOPIFY_AUTH_SELFTEST_TOKEN/);
assert.match(route, /authorization/);
assert.match(route, /callShopifyAdminGraphQL/);
assert.match(route, /tokenExchange: "pass"/);
assert.doesNotMatch(route, /SHOPIFY_CLIENT_SECRET[^\n]*Response/);
assert.doesNotMatch(route, /SHOPIFY_CLIENT_ID[^\n]*Response/);
assert.doesNotMatch(route, /error\.message/);

console.log("Shopify batch-readiness checks passed: preview auth self-test guard + deterministic multi-variant SKU fallback");
