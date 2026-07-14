/**
 * D8-open verification (no secrets / no live Showmore import).
 *
 * - Pure helpers: markup normalize, apply markup + beautify, compare-at > sell
 * - Inline HTML boundary (formatPlainTextAsHtml / isLikelyHtml)
 * - Static wiring: showmore.ts / matrixify.ts / export route / UI / settings copy
 * - Case B zip NOT implemented
 *
 * Run: node scripts/verify-d8-showmore.mjs
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

// ── Inline mirrors of nestoryPrice + showmorePricing (keep in sync) ──────

const LOW_TIER_PRICES = [99, 129, 149, 169, 199, 229, 249, 299];
const MID_TIER_PRICES = [329, 349, 399, 449, 499, 549, 599, 699, 799, 899];
const HIGH_TIER_PRICES = [
  980, 990, 999, 1080, 1099, 1180, 1199, 1280, 1299, 1580, 1680, 2280, 4480
];

function nearestAtOrAbove(tier, rawPrice, extensionStep) {
  const candidate = tier.find((price) => price >= rawPrice);
  if (candidate !== undefined) return candidate;
  let extended = tier[tier.length - 1];
  while (extended < rawPrice) extended += extensionStep;
  return extended;
}

function beautifyNestoryPrice(rawPrice) {
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) return 0;
  const basePrice = Math.ceil(rawPrice);
  if (basePrice < 300) return nearestAtOrAbove(LOW_TIER_PRICES, basePrice, 50);
  if (basePrice <= 900) return nearestAtOrAbove(MID_TIER_PRICES, basePrice, 100);
  return nearestAtOrAbove(HIGH_TIER_PRICES, basePrice, 1000);
}

function nextBeautifiedPriceAbove(price) {
  if (!Number.isFinite(price) || price < 0) return beautifyNestoryPrice(1);
  const candidate = beautifyNestoryPrice(Math.floor(price) + 1);
  if (candidate > price) return candidate;
  return beautifyNestoryPrice(candidate + 1);
}

const DEFAULT_SHOWMORE_MARKUP_PERCENT = 5;

function normalizeShowmoreMarkupPercent(value) {
  if (value == null || value === "") return DEFAULT_SHOWMORE_MARKUP_PERCENT;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SHOWMORE_MARKUP_PERCENT;
  return Math.min(100, Math.max(0, n));
}

function applyShowmoreMarkup(price, markupPercent) {
  if (price == null || !Number.isFinite(Number(price))) return "";
  const base = Number(price);
  if (base <= 0) return "";
  const pct = normalizeShowmoreMarkupPercent(markupPercent);
  return beautifyNestoryPrice(base * (1 + pct / 100));
}

function applyShowmoreCompareAt(compareAt, sellPriceShowmore, markupPercent) {
  if (compareAt == null || !Number.isFinite(Number(compareAt))) return "";
  const base = Number(compareAt);
  if (base <= 0) return "";
  let marked = applyShowmoreMarkup(base, markupPercent);
  if (marked === "") return "";
  if (typeof sellPriceShowmore === "number" && sellPriceShowmore > 0 && marked <= sellPriceShowmore) {
    marked = nextBeautifiedPriceAbove(sellPriceShowmore);
  }
  return marked;
}

function isLikelyHtml(text) {
  if (!text) return false;
  return /<\/?(?:p|div|br|ul|ol|li|h[1-6]|strong|em|span|a|table|tr|td|th|section|article|header|footer)\b/i.test(
    text
  );
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const BULLET_PREFIX = /^[・･•➼]\s*/;

function formatPlainTextAsHtml(text) {
  if (!text) return "";
  if (isLikelyHtml(text)) return text;
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  return blocks
    .map((block) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const bulletLines = lines.filter((line) => BULLET_PREFIX.test(line));
      const headingLines = lines.filter((line) => !BULLET_PREFIX.test(line));
      if (bulletLines.length > 0) {
        const heading =
          headingLines.length > 0 ? `<p>${headingLines.map(escapeHtml).join("<br>")}</p>` : "";
        const items = bulletLines
          .map((line) => `<li>${escapeHtml(line.replace(BULLET_PREFIX, ""))}</li>`)
          .join("");
        return `${heading}<ul>${items}</ul>`;
      }
      return `<p>${lines.map(escapeHtml).join("<br>")}</p>`;
    })
    .join("");
}

console.log("D8-open Showmore export checks\n");

// ── Pure pricing ─────────────────────────────────────────────────────────

await check("normalize: missing → 5", () => {
  assert.equal(normalizeShowmoreMarkupPercent(undefined), 5);
  assert.equal(normalizeShowmoreMarkupPercent(null), 5);
  assert.equal(normalizeShowmoreMarkupPercent("x"), 5);
});

await check("normalize: clamp 0–100", () => {
  assert.equal(normalizeShowmoreMarkupPercent(-3), 0);
  assert.equal(normalizeShowmoreMarkupPercent(12), 12);
  assert.equal(normalizeShowmoreMarkupPercent(150), 100);
});

await check("markup + beautify: 299 +5%", () => {
  // 299 * 1.05 = 313.95 → ceil 314 → mid tier nearest ≥314 = 329
  const sell = applyShowmoreMarkup(299, 5);
  assert.equal(sell, beautifyNestoryPrice(299 * 1.05));
  assert.equal(sell, 329);
});

await check("cost never uses markup helper (empty / zero stay empty)", () => {
  assert.equal(applyShowmoreMarkup(0, 5), "");
  assert.equal(applyShowmoreMarkup(null, 5), "");
  // Cost column must pass raw twd_cost in showmore.ts — verified in static section
});

await check("compare-at must stay > sell after markup", () => {
  const sell = applyShowmoreMarkup(500, 5);
  // same base → without bump would equal sell; helper must lift
  const sameBase = applyShowmoreCompareAt(500, sell, 5);
  assert.ok(typeof sameBase === "number");
  assert.ok(sameBase > sell, `compare ${sameBase} should be > sell ${sell}`);

  const higher = applyShowmoreCompareAt(800, sell, 5);
  assert.ok(typeof higher === "number");
  assert.ok(higher > sell);
});

await check("0% markup still beautifies", () => {
  const sell = applyShowmoreMarkup(301, 0);
  assert.equal(sell, beautifyNestoryPrice(301));
});

// ── HTML boundary ────────────────────────────────────────────────────────

await check("plain text → HTML paragraphs", () => {
  const html = formatPlainTextAsHtml("第一段\n\n第二段");
  assert.match(html, /<p>/);
  assert.ok(!html.includes("第一段\n\n"));
});

await check("isLikelyHtml prevents double-wrap", () => {
  const already = "<p>已是 HTML</p>";
  assert.equal(formatPlainTextAsHtml(already), already);
});

await check("bullets become ul/li", () => {
  const html = formatPlainTextAsHtml("標題\n・A\n・B");
  assert.match(html, /<ul>/);
  assert.match(html, /<li>A<\/li>/);
});

// ── Static wiring ────────────────────────────────────────────────────────

await check("showmorePricing.ts exists", () => {
  assert.ok(exists("src/lib/csv/showmorePricing.ts"));
});

await check("showmore.ts: markup + HTML + exclude spec + empty 簡述", () => {
  const src = read("src/lib/csv/showmore.ts");
  assert.match(src, /formatPlainTextAsHtml/);
  assert.match(src, /applyShowmoreMarkup/);
  assert.match(src, /applyShowmoreCompareAt/);
  assert.match(src, /image_type !== "spec"/);
  assert.match(src, /processed_file_url/);
  assert.match(src, /original_file_url/);
  assert.match(src, /"商品簡述":\s*""/);
  assert.match(src, /單一款式/);
  assert.ok(!/JSZip|zip/.test(src), "case B zip must not be in showmore.ts");
  // cost not marked up
  assert.match(src, /twd_cost/);
  assert.ok(
    /"成本":\s*draft\.twd_cost/.test(src),
    "cost column should use raw twd_cost"
  );
});

await check("matrixify.ts: Body HTML uses formatPlainTextAsHtml", () => {
  const src = read("src/lib/csv/matrixify.ts");
  assert.match(src, /formatPlainTextAsHtml/);
  assert.match(src, /"Body HTML":\s*formatPlainTextAsHtml/);
});

await check("export route: body markup + csv_ready", () => {
  const src = read("src/app/api/exports/showmore/route.ts");
  assert.match(src, /showmoreMarkupPercent/);
  assert.match(src, /normalizeShowmoreMarkupPercent/);
  assert.match(src, /status:\s*"csv_ready"/);
  assert.match(src, /export:\s*"showmore"/);
  assert.match(src, /buildShowmoreCsv/);
});

await check("UI passes showmoreMarkupPercent from pricing store", () => {
  for (const rel of [
    "src/components/listing/DraftResultsPanel.tsx",
    "src/components/drafts/DraftQueueList.tsx"
  ]) {
    const src = read(rel);
    assert.match(src, /getStoredPricingSettings/);
    assert.match(src, /showmoreMarkupPercent/);
    assert.match(src, /匯出時已套用|已套 Showmore/, `toast/copy in ${rel}`);
  }
});

await check("settings copy: 匯出時已套用 (not 接通後生效)", () => {
  const settings = read("src/components/settings/SettingsPanel.tsx");
  const workspace = read("src/components/listing/WorkspaceInputPanel.tsx");
  assert.match(settings, /匯出時已套用/);
  assert.ok(!settings.includes("D8 接通後生效"));
  assert.match(workspace, /匯出時已套用/);
  assert.ok(!workspace.includes("D8 匯出管線接通後生效"));
});

await check("records: honest note that CSV export is not publish batch log", () => {
  const src = read("src/components/records/PublishRecordsPanel.tsx");
  assert.match(src, /不進本頁批次帳/);
  assert.ok(!src.includes("Showmore／Matrixify（尚未）"));
});

await check("no case B zip packaging in export paths", () => {
  const showmoreRoute = read("src/app/api/exports/showmore/route.ts");
  assert.ok(!/JSZip|application\/zip/.test(showmoreRoute));
});

console.log("");
if (failures.length) {
  console.error(`FAILED ${failures.length} check(s)`);
  process.exit(1);
}
console.log("ALL passed");
