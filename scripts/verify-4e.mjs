/**
 * 4e DETAIL-LISTING verifier (written by Claude before construction).
 * 詳情圖全部放進商品描述（一個開關，預設開）＋發布／同步時先上傳 Shopify Files，描述只放 Shopify CDN 網址。
 * No network, no database. Run from repo root with: npm run verify:4e
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
register(pathToFileURL(path.join(root, "scripts/publish-guard-loader.mjs")).href);
const src = (name) => pathToFileURL(path.join(root, name)).href;
const flags = await import(src("src/lib/images/detailCompose/flags.ts"));
const rowsMod = await import(src("src/lib/images/descriptionDetailRows.ts"));
const desc = await import(src("src/lib/contentGenerator/descriptionDetailImages.ts"));
const upload = await import(src("src/lib/images/uploadDescriptionImages.ts"));
const payload = await import(src("src/lib/shopify/payload.ts"));
const reconcile = await import(src("src/lib/shopify/reconcileFields.ts"));

let passed = 0;
const failed = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  ✓ " + name);
  } catch (err) {
    failed.push({ name, err });
    console.error("  ✗ " + name + ": " + (err.stack || err));
  }
}

const SUPA = "https://tbgtqwvuohmdxnxisrgr.supabase.co/storage/v1/object/public/product-images/o/d/detail/";
const CDN = "https://cdn.shopify.com/s/files/1/0787/8600/3129/files/";
const img = (id, image_type, sort_order, url, extra = {}) => ({
  id,
  image_type,
  sort_order,
  alt_text: null,
  processed_file_url: url,
  original_file_url: url,
  generated_file_url: null,
  ...extra
});
const imgSrcs = (html) => [...html.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1]);

console.log("\n[A] 開關：image_flags.description_detail_images（預設開）");

await...[truncated]