/**
 * D8b-open: Showmore copy rewrite (rules template v2) at export boundary.
 * Static wiring + pure logic mirrors. No network / DB / LLM keys.
 *
 * Run: node scripts/verify-d8b-showmore-rewrite.mjs
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

// ── Inline mirrors (keep in sync with showmoreCopyRewrite.ts) ────────────

const TITLE_TAIL = "收藏送禮推薦";

const DEFAULT_SHOWMORE_FOOTER = [
  "【交貨方式說明】",
  "下單後依商品銷售狀態出貨：台灣現貨約 1–3 個工作天處理；預購／代購依到貨時程，頁面或聊聊會再說明。",
  "",
  "【運送方式說明】",
  "支援台灣本島常溫配送；離島與特殊商品以結帳可選物流為準。請確認收件資料正確，以免延誤。"
].join("\n");

const SOURCE_PLATFORM_RE =
  /淘寶|天貓|閑魚|閒魚|1688|拼多多|抖音|小紅書|代購來源|貨源/gi;

const PRICE_IN_COPY_RE =
  /(?:NT\$|NT\s*|\$|¥|￥|元|圓)\s*\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:元|圓|塊錢)|售價\s*[:：]?\s*\d|定價\s*[:：]?\s*\d|成本\s*[:：]?\s*\d/gi;

function sanitizeShowmoreCopyText(text) {
  if (!text) return "";
  return text
    .replace(SOURCE_PLATFORM_RE, "")
    .replace(PRICE_IN_COPY_RE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function nf(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

/** Minimal title builder mirror for formula skeleton checks. */
function buildShowmoreTitleMirror(draft) {
  const ip = nf(draft.ip_name);
  const character = nf(draft.character_name);
  const productType = nf(draft.product_type);
  const feature = nf((draft.product_highlights && draft.product_highlights[0]) || "").slice(0, 12);
  let core = "";
  if (character && productType) core = `${character}${productType}`;
  else core = character || productType || nf(draft.title_zh);
  let middle = core;
  if (middle && feature && !middle.includes(feature)) middle = `${middle}-${feature}`;
  const headParts = [];
  if (ip) headParts.push(`【${ip}】`);
  if (middle) headParts.push(middle);
  const head = headParts.join("");
  const category = productType || "";
  const segments = [head, category, TITLE_TAIL].filter(Boolean);
  return sanitizeShowmoreCopyText(segments.join("｜"));
}

console.log("D8b-open Showmore copy rewrite checks\n");

// ── Pure sanitize / iron rules ───────────────────────────────────────────

await check("sanitize strips 淘寶/閑魚 source platforms", () => {
  const out = sanitizeShowmoreCopyText("這款來自淘寶與閑魚的吊飾很好摸");
  assert.ok(!out.includes("淘寶"));
  assert.ok(!out.includes("閑魚"));
  assert.match(out, /吊飾/);
});

await check("sanitize strips prices from body text", () => {
  const out = sanitizeShowmoreCopyText("可愛吊飾 售價：299 元 也很適合送禮");
  assert.ok(!/\d{2,}/.test(out) || !out.includes("299"));
  assert.ok(!out.includes("售價"));
  assert.match(out, /可愛吊飾|送禮/);
});

await check("footer constants include both public blocks", () => {
  assert.match(DEFAULT_SHOWMORE_FOOTER, /【交貨方式說明】/);
  assert.match(DEFAULT_SHOWMORE_FOOTER, /【運送方式說明】/);
});

await check("title formula: IP bracket + tail 收藏送禮推薦", () => {
  const title = buildShowmoreTitleMirror({
    ip_name: "吉伊卡哇",
    character_name: "小八",
    product_type: "吊飾掛件",
    product_highlights: ["療癒絨毛"],
    title_zh: "吉伊卡哇 小八 吊飾"
  });
  assert.match(title, /【吉伊卡哇】/);
  assert.match(title, /小八/);
  assert.match(title, /收藏送禮推薦/);
  assert.ok(title.includes("｜"), "should use ｜ separators in tail");
  // Different from raw shopify-style title
  assert.notEqual(title, "吉伊卡哇 小八 吊飾");
});

await check("title omits empty parts (no IP still has tail)", () => {
  const title = buildShowmoreTitleMirror({
    ip_name: "",
    character_name: "",
    product_type: "絨毛娃娃",
    title_zh: "可愛娃娃"
  });
  assert.match(title, /收藏送禮推薦/);
  assert.ok(!title.includes("【】"));
});

// ── Source module static checks ──────────────────────────────────────────

await check("showmoreCopyRewrite.ts exists with exports", () => {
  assert.ok(exists("src/lib/csv/showmoreCopyRewrite.ts"));
  const src = read("src/lib/csv/showmoreCopyRewrite.ts");
  assert.match(src, /export function assembleShowmoreCopy/);
  assert.match(src, /export function buildShowmoreTitle/);
  assert.match(src, /export function buildShowmoreBrief/);
  assert.match(src, /export function buildShowmoreDescriptionPlain/);
  assert.match(src, /export function sanitizeShowmoreCopyText/);
  assert.match(src, /DEFAULT_SHOWMORE_FOOTER/);
  assert.match(src, /DEFAULT_SHOWMORE_FAQ_PAIRS/);
  assert.match(src, /rewriteMode:\s*"rules"/);
  // Q5-A: no live LLM provider call
  assert.ok(!/createCopyProvider|anthropic|openai\.chat|generateText/i.test(src));
  // Q4-B: footer is code default only — no runtime team_settings fetch
  assert.ok(!/\.from\(\s*["']team_settings["']\s*\)/.test(src));
  assert.ok(!/await.*team_settings/.test(src));
  // Iron rules present
  assert.match(src, /SOURCE_PLATFORM_RE|淘寶/);
  assert.match(src, /PRICE_IN_COPY_RE|售價/);
  assert.match(src, /商品介紹/);
  assert.match(src, /商品特色/);
  assert.match(src, /商品資訊/);
  assert.match(src, /常見問題 FAQ/);
  assert.match(src, /✔ /);
  assert.match(src, /➼ /);
});

await check("showmore.ts wires assembleShowmoreCopy (not raw title/description only)", () => {
  const src = read("src/lib/csv/showmore.ts");
  assert.match(src, /assembleShowmoreCopy/);
  assert.match(src, /from "\.\/showmoreCopyRewrite"/);
  assert.match(src, /copy\.title/);
  assert.match(src, /copy\.brief/);
  assert.match(src, /copy\.descriptionPlain/);
  assert.match(src, /formatPlainTextAsHtml\(copy\.descriptionPlain\)/);
  // Still HTML boundary + video + embed chain
  assert.match(src, /appendVideoLinksHtml/);
  assert.match(src, /appendShowmoreDescriptionEmbedIfEnabled/);
  // Must NOT write DB showmore columns in export path
  assert.ok(!/showmore_title|showmore_description|showmore_faq/.test(src));
});

await check("Q1-A: no showmore_* columns in types/domain or migrations 028+", () => {
  const domain = read("src/types/domain.ts");
  assert.ok(!/showmore_title|showmore_description|showmore_faq/.test(domain));
  // Q4-B zero migration: no 028 showmore footer file
  assert.ok(
    !exists("supabase/migrations/028_showmore_footer_team_settings.sql"),
    "Q4-B forbids footer migration this pack"
  );
  assert.ok(!exists("supabase/migrations/028_showmore_copy_columns.sql"));
});

await check("export route still uses buildShowmoreCsv (boundary rewrite inside)", () => {
  const src = read("src/app/api/exports/showmore/route.ts");
  assert.match(src, /buildShowmoreCsv/);
  // Route must not call LLM
  assert.ok(!/assembleShowmoreCopy|openai|anthropic|rewriteMode/i.test(src));
});

await check("Matrixify does not use Showmore rewrite (Shopify title path intact)", () => {
  const src = read("src/lib/csv/matrixify.ts");
  assert.ok(!/assembleShowmoreCopy|showmoreCopyRewrite/.test(src));
  assert.match(src, /title_zh/);
});

await check("no case B zip / no BX-P globals mass edit", () => {
  const rewrite = read("src/lib/csv/showmoreCopyRewrite.ts");
  const showmore = read("src/lib/csv/showmore.ts");
  assert.ok(!/JSZip|application\/zip/.test(rewrite + showmore));
});

await check("D8 pricing helpers still imported in showmore.ts", () => {
  const src = read("src/lib/csv/showmore.ts");
  assert.match(src, /applyShowmoreMarkup/);
  assert.match(src, /applyShowmoreCompareAt/);
});

// ── Sample body structure (string contract from source constants) ────────

await check("source builds FAQ defaults + footer markers", () => {
  const src = read("src/lib/csv/showmoreCopyRewrite.ts");
  assert.match(src, /現在有現貨嗎/);
  assert.match(src, /實品顏色會跟照片一樣嗎/);
  assert.match(src, /【交貨方式說明】/);
  assert.match(src, /【運送方式說明】/);
  assert.match(src, /Q5-A|llm_optional/);
});

console.log("");
if (failures.length) {
  console.error(`FAILED ${failures.length} check(s)`);
  process.exit(1);
}
console.log("ALL passed");
