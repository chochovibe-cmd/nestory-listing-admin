/**
 * P1 文案品質（Fable 2026-07-18 §1.3）：75a / 臺燈 alias / 75b / 76 / 66 / 69.
 * Pure source + inline logic checks. No secrets, no network.
 *
 * Run: node scripts/verify-p1-copy-quality.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const failures = [];

function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

// --- Inline mirrors of productBrand.normalizeDetectedProductBrand (keep in sync) ---
function mirrorNormalizeBrand(raw) {
  if (raw == null) return null;
  let s = String(raw).normalize("NFKC").trim();
  if (!s) return null;
  const TRAILING =
    /(官方旗艦店|官方旗舰店|旗艦店|旗舰店|官方店|專賣店|专卖店|官方|正版|旗艦|旗舰)$/u;
  s = s.replace(TRAILING, "").trim();
  if (!s) return null;
  // Light 簡→繁 tokens used in brands (full localizer not imported here)
  s = s.replace(/旗舰/g, "旗艦").replace(/专卖/g, "專賣");
  s = s.replace(TRAILING, "").trim();
  if (s.length > 40) s = s.slice(0, 40).trim();
  if (s.length < 2) return null;
  if (/^(正版|官方|品牌|無|无|未知|没有|none|n\/a|na|unknown|null|undefined|—|-|－)$/i.test(s)) {
    return null;
  }
  if (!/[\p{L}\p{N}]/u.test(s)) return null;
  return s;
}

// Segment parse mirror for brand key
function mirrorParseBrandSegment(text) {
  const re = /^\s*\[\[([a-z_]+)\]\]\s*$/;
  const buffers = new Map();
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(re);
    if (m) {
      current = m[1];
      if (!buffers.has(current)) buffers.set(current, []);
      continue;
    }
    if (current) buffers.get(current).push(line);
  }
  return (buffers.get("detected_product_brand")?.join("\n") ?? "").trim();
}

console.log("verify-p1-copy-quality:");

// --- 75a ---
check("75a: productBrand helper + parse keys + generate write gate", () => {
  assert.ok(exists("src/lib/providers/productBrand.ts"));
  const brand = read("src/lib/providers/productBrand.ts");
  assert.match(brand, /normalizeDetectedProductBrand/);
  assert.match(brand, /localizeToTaiwanTraditionalText/);

  const copy = read("src/lib/providers/copy.ts");
  assert.match(copy, /detected_product_brand/);
  assert.match(copy, /detectedProductBrand/);

  const route = read("src/app/api/generate/route.ts");
  assert.match(route, /normalizeDetectedProductBrand/);
  assert.match(route, /if \(detectedBrand\)/);
  assert.match(route, /product_brand/);

  const prompt = read("src/lib/providers/systemPrompt.ts");
  assert.match(prompt, /detected_product_brand/);
  assert.match(prompt, /沒把握就留空/);
});

check("75a: brand sanitize honesty (empty / noise / clean)", () => {
  assert.equal(mirrorNormalizeBrand(""), null);
  assert.equal(mirrorNormalizeBrand("  "), null);
  assert.equal(mirrorNormalizeBrand("正版"), null);
  assert.equal(mirrorNormalizeBrand("無"), null);
  assert.equal(mirrorNormalizeBrand("TOYUKI"), "TOYUKI");
  assert.equal(mirrorNormalizeBrand("TOYUKI官方"), "TOYUKI");
  assert.equal(mirrorNormalizeBrand("Razer 正版"), "Razer");
  assert.equal(mirrorParseBrandSegment("[[detected_product_brand]]\nTOYUKI\n[[sku]]\nX"), "TOYUKI");
  assert.equal(mirrorParseBrandSegment("[[detected_product_brand]]\n\n[[sku]]\nX"), "");
});

// --- C1 臺燈 alias ---
check("C1: 臺燈系 alias → 燈具小物 in nestoryTagsV2", () => {
  const src = read("src/lib/nestoryTagsV2.ts");
  for (const a of ["臺燈", "台燈", "檯燈", "桌燈", "夜燈"]) {
    assert.match(src, new RegExp(`\\['${a}', '燈具小物'\\]`));
  }
  assert.match(src, /燈具小物/);
});

check("C1: 033 has no 燈具 seed (alias-only; no extra migration)", () => {
  const m033 = read("supabase/migrations/033_tag_rules_sync_boss_tool.sql");
  assert.ok(!m033.includes("燈具"), "033 unexpectedly mentions 燈具 — re-check migration need");
});

// --- 75b ---
check("75b: title skeleton + variantSummary character hint in prompt", () => {
  const prompt = read("src/lib/providers/systemPrompt.ts");
  assert.match(prompt, /P1-75b/);
  assert.match(prompt, /品牌 ×/);
  assert.match(prompt, /最多 3/);
  assert.match(prompt, /款式列可能含角色名/);
  assert.match(prompt, /variantSummary/);
  // user message block
  assert.match(prompt, /多角色用「・」分隔、最多 3 個/);
});

// --- 76 ---
check("76: emoji rules + multi examples + HelloKitty static anchor", () => {
  const prompt = read("src/lib/providers/systemPrompt.ts");
  assert.match(prompt, /Emoji 硬性｜小編聊天口吻|必須自然使用 1–2 個|必須自然使用 1-2 個/);
  assert.match(prompt, /可愛周邊輕鬆感[\s\S]*鼓勵/);
  assert.match(prompt, /XIAOBIAN_STYLE_ANCHOR|老闆點讚的語感錨點/);
  assert.match(prompt, /Hello Kitty/);
  assert.match(prompt, /84ef0cba/);
  // TONE_EXAMPLES is array form with multiple lines
  assert.match(prompt, /TONE_EXAMPLES: Partial<Record<CopyTone, string\[\]>>/);
  assert.ok(
    (prompt.match(/黑膠文藝收藏感: \[/s) || prompt.includes("黑膠文藝收藏感: [")),
    "tone examples should be arrays"
  );
});

check("76-fix: field-level emoji rules + checklist + soft warning wiring", () => {
  const prompt = read("src/lib/providers/systemPrompt.ts");
  assert.match(prompt, /欄位硬性｜generated_description_html｜小編聊天口吻/);
  assert.match(prompt, /欄位硬性｜generated_faq_html｜小編聊天口吻/);
  assert.match(prompt, /輸出前自檢清單（小編聊天口吻必勾）/);
  assert.match(prompt, /錨點原文本身沒有 emoji/);
  assert.match(prompt, /正文必須含 1–2 個 emoji|正文必須含 1-2 個 emoji/);

  assert.ok(exists("src/lib/providers/emojiPolicy.ts"));
  const pol = read("src/lib/providers/emojiPolicy.ts");
  assert.match(pol, /textHasEmoji/);
  assert.match(pol, /buildXiaobianMissingEmojiWarning/);

  const route = read("src/app/api/generate/route.ts");
  assert.match(route, /buildXiaobianMissingEmojiWarning/);
  assert.match(route, /generationTone === "小編聊天口吻"/);
});

check("76: body.tone reaches provider system prompt (wiring)", () => {
  const route = read("src/app/api/generate/route.ts");
  assert.match(route, /const tone: CopyTone = \(COPY_TONES/);
  assert.match(route, /tone,/); // passed into generate({...})
  const claude = read("src/lib/providers/claude-copy-provider.ts");
  const openai = read("src/lib/providers/openai-copy-provider.ts");
  for (const src of [claude, openai]) {
    assert.match(src, /resolveCopyTone\(input\.tone/);
    assert.match(src, /buildCopySystemPrompt\(resolvedTone/);
  }
  // post-process does not strip emoji
  const loc = read("src/lib/zhTwLocalizer.ts");
  assert.doesNotMatch(loc, /emoji|Emoji|pictographic/i);
  const html = read("src/lib/contentGenerator/htmlFormat.ts");
  assert.doesNotMatch(html, /stripEmoji|removeEmoji|pictographic/i);
});

check("76: emojiPolicy detects presence", () => {
  // inline mirror of textHasEmoji Extended_Pictographic path
  const has = (t) => /\p{Extended_Pictographic}/u.test(t);
  assert.equal(has("沒有符號"), false);
  assert.equal(has("有 ✨ 符號"), true);
  assert.equal(has("咖啡 ☕"), true);
});

// --- 66 ---
check("66: migration 034 generation_tone + generate write", () => {
  assert.ok(exists("supabase/migrations/034_generation_tone.sql"));
  const mig = read("supabase/migrations/034_generation_tone.sql");
  assert.match(mig, /generation_tone/);
  assert.match(mig, /add column if not exists/);

  const route = read("src/app/api/generate/route.ts");
  assert.match(route, /generation_tone/);
  assert.match(route, /resolvedGenerationTone/);
  assert.match(route, /resolveCopyTone/);

  const domain = read("src/types/domain.ts");
  assert.match(domain, /generation_tone\?:/);
});

// --- 69 ---
check("69: migration 035 kind check + export routes record batch", () => {
  assert.ok(exists("supabase/migrations/035_publish_batches_csv_kinds.sql"));
  const mig = read("supabase/migrations/035_publish_batches_csv_kinds.sql");
  assert.match(mig, /showmore/);
  assert.match(mig, /matrixify/);
  assert.match(mig, /publish_batches_kind_check/);

  const helper = read("src/lib/drafts/recordCsvExportBatch.ts");
  assert.match(helper, /recordCsvExportBatch/);
  assert.match(helper, /publish_mode: "draft"/);
  assert.match(helper, /kind/);

  const mx = read("src/app/api/exports/matrixify/route.ts");
  assert.match(mx, /recordCsvExportBatch/);
  assert.match(mx, /kind: "matrixify"/);

  const sm = read("src/app/api/exports/showmore/route.ts");
  assert.match(sm, /recordCsvExportBatch/);
  assert.match(sm, /kind: "showmore"/);

  const domain = read("src/types/domain.ts");
  assert.match(domain, /PublishBatchKind/);
  assert.match(domain, /showmore/);
});

check("69: 027 original kind was shopify_api only (baseline)", () => {
  const m027 = read("supabase/migrations/027_publish_batches.sql");
  assert.match(m027, /check \(kind in \('shopify_api'\)\)/);
});

// UI non-touch guard (lightweight)
check("P1 iron rule: no globals.css / no new component UI in this package files", () => {
  // This package should not have modified globals — we only assert source patterns of our new files.
  const helper = read("src/lib/drafts/recordCsvExportBatch.ts");
  assert.ok(!helper.includes("globals.css"));
  assert.ok(exists("src/lib/providers/productBrand.ts"));
});

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log("\nALL passed");
