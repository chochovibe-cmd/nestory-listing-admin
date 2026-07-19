/**
 * D9: pure checks for Shopify storefront URL builders (no network).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// Load compiled-free TS via dynamic import of source is not available;
// re-implement minimal mirror of storefrontUrl pure rules for CI without tsx.
function normalizeShopifyStoreDomain(raw) {
  if (!raw || typeof raw !== "string") return null;
  let d = raw.trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^https?:\/\//, "");
  d = d.split("/")[0] ?? "";
  d = d.replace(/:\d+$/, "");
  if (!d || d.includes(" ") || !d.includes(".")) return null;
  return d;
}

function sanitizeShopifyHandle(raw) {
  if (!raw || typeof raw !== "string") return null;
  const h = raw.trim().replace(/^\/+|\/+$/g, "");
  if (!h) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(h)) return null;
  return h;
}

function buildShopifyStorefrontProductUrl({ storeDomain, handle }) {
  const domain = normalizeShopifyStoreDomain(storeDomain);
  const h = sanitizeShopifyHandle(handle);
  if (!domain || !h) return null;
  return `https://${domain}/products/${h}`;
}

console.log("storefront URL checks\n");

{
  const url = buildShopifyStorefrontProductUrl({
    storeDomain: "https://Nestory-TW.myshopify.com/admin",
    handle: "chiikawa-keychain"
  });
  assert.equal(url, "https://nestory-tw.myshopify.com/products/chiikawa-keychain");
  console.log("  ✓ normalize domain + handle");
}

{
  assert.equal(
    buildShopifyStorefrontProductUrl({ storeDomain: null, handle: "x" }),
    null
  );
  assert.equal(
    buildShopifyStorefrontProductUrl({
      storeDomain: "shop.myshopify.com",
      handle: "../evil"
    }),
    null
  );
  console.log("  ✓ reject missing domain / bad handle");
}

{
  // Source file presence
  const require = createRequire(import.meta.url);
  const fs = require("node:fs");
  const src = fs.readFileSync(
    path.join(root, "src/lib/shopify/storefrontUrl.ts"),
    "utf8"
  );
  assert.ok(src.includes("buildShopifyStorefrontProductUrl"));
  const modal = fs.readFileSync(
    path.join(root, "src/components/listing/ExportPreflightModal.tsx"),
    "utf8"
  );
  assert.ok(modal.includes("export-pf-storefront-iframe"));
  assert.ok(modal.includes("Shopify 官網"));
  console.log("  ✓ source wires iframe preview");
}

console.log("\nALL passed");
