/**
 * D8a-open: description embed images (Shopify / Matrixify boundary).
 * Pure + static wiring — no real Shopify / DB.
 *
 * Run: node scripts/verify-d8a-description-embed.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const failures = [];
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

// --- Pure mirrors (keep in sync with descriptionEmbed.ts) ---

const DESCRIPTION_EMBED_MAX = 2;

function normalizeEnvFlag(raw) {
  if (raw == null) return null;
  const v = String(raw).trim().toLowerCase();
  if (!v) return null;
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  return null;
}

function isDescriptionEmbedEnabled(env) {
  const parsed = normalizeEnvFlag(
    env.DESCRIPTION_EMBED_IMAGES ?? env.NESTORY_DESCRIPTION_EMBED_IMAGES
  );
  return parsed !== false;
}

function isShowmoreDescriptionEmbedEnabled(env) {
  const parsed = normalizeEnvFlag(env.SHOWMORE_DESCRIPTION_EMBED_IMAGES);
  return parsed === true;
}

function resolveImageSourceUrl(image) {
  const url =
    (image.processed_file_url || "").trim() ||
    (image.original_file_url || "").trim() ||
    (image.generated_file_url || "").trim() ||
    "";
  return url || null;
}

function isShopifyCdnUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.includes("cdn.shopify.com") || host.includes("shopifycdn.com");
  } catch {
    return /cdn\.shopify\.com|shopifycdn\.com/...[truncated]