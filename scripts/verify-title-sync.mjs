/**
 * 夜工包（回饋 27/29/33/11/22）verification — title/SEO engine sync with boss tool,
 * localizer terms, vision prompt hardening, migrations 031-033.
 *
 * Run: node scripts/verify-title-sync.mjs
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
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

// Mirror of formatCharacterText (titleGeneratorBase.ts) — keep in sync
function mirrorFormatCharacterText(characters) {
  if (characters.length === 0) return "";
  if (characters.length === 1) return characters[0];
  return characters.slice(0, 3).join("・");
}

console.log("verify-title-sync:");

await check("titleGeneratorBase: unified 80-char product title, IP × brand, ladder", () => {
  const src = read("src/lib/contentGenerator/titleGeneratorBase.ts");
  assert.match(src, /OFFICIAL_TITLE_MAX_LENGTH = PRODUCT_TITLE_MAX_LENGTH/);
  assert.match(src, /ENRICHED_TITLE_MAX_LENGTH = PRODUCT_TITLE_MAX_LENGTH/);
  assert.match(src, /clampOfficialTitle/);
  assert.match(src, /enforceSkeletonTitleLength/);
  assert.match(src, /TITLE_SEGMENT3_BLACKLIST/);
  assert.match(src, /' × '/);
  assert.match(src, /formatCharacterText/);
  assert.match(src, /collectCharacterNames/);
  assert.match(src, /夏威夷衝浪造型/);
  assert.match(src, /款式可選/);
  assert.match(src, /台灯/);
  assert.doesNotMatch(src, /const TITLE_MAX_LENGTH = 80/);
  assert.match(src, /ipDisplayName \+ ' × ' \+ productBrand/);
});

await check("titleGenerator wrapper + C5A titleFinalizer composition", () => {
  const wrapper = read("src/lib/contentGenerator/titleGenerator.ts");
  const finalizer = read("src/lib/contentGenerator/titleFinalizer.ts");

  assert.ok(
    wrapper.includes('export * from "./titleGeneratorBase";'),
    "titleGenerator.ts no longer re-exports Production base behavior"
  );
  for (const helper of [
    "appendProductTypeToSecondSegment",
    "normalizeEnrichedTitleContract",
    "normalizeTitleSeparators",
  ]) {
    assert.ok(wrapper.includes(helper), `titleGenerator.ts lost public finalizer helper: ${helper}`);
  }
  assert.doesNotMatch(
    wrapper,
    /OFFICIAL_TITLE_MAX_LENGTH\s*=|ENRICHED_TITLE_MAX_LENGTH\s*=|function getShortFeatureText|const TITLE_SEGMENT3_BLACKLIST/,
    "shared title implementation was duplicated back into titleGenerator.ts"
  );

  assert.match(finalizer, /split\(\/\\s\*\[\|｜\]\\s\*\/u\)/, "titleFinalizer separator parser changed");
  assert.match(finalizer, /join\(" \| "\)/, "titleFinalizer separator output is not ASCII ' | '");
  assert.doesNotMatch(
    finalizer,
    /segments\[1\]\s*=\s*\[secondSegment,\s*productType\]/,
    "titleFinalizer still appends detected type to segment 2"
  );
  assert.match(
    finalizer,
    /return normalizeTitleSeparators\(value\);/,
    "legacy append helper no longer preserves the C5A no-append behavior"
  );
  assert.doesNotMatch(finalizer, /segments\[0\]\s*=/, "titleFinalizer rewrites segment 1");
  assert.doesNotMatch(finalizer, /segments\[2\]\s*=/, "titleFinalizer rewrites segment 3");
  assert.match(finalizer, /finalizeProductTitle/, "shared product-title assembler missing");
  assert.match(finalizer, /scrubEnrichedTitleSegment3/, "Production segment-3 scrub delegation missing");

  const route = read("src/app/api/generate/route.ts");
  const finalizationCalls = route.match(/finalizeProductTitle\(/g) ?? [];
  assert.ok(
    finalizationCalls.length >= 2,
    "Full Generate + single-field title regen no longer share finalizeProductTitle"
  );
  assert.match(
    route,
    /value = historyContent/,
    "single-field title regen history and stored title diverged"
  );
  assert.match(
    route,
    /const officialTitleZh = enrichedTitleFull;/,
    "Full Generate still clamps a second shorter official title"
  );
});

await check("mirror: character list formatting (1/2/3+)", () => {
  assert.equal(mirrorFormatCharacterText(["小八"]), "小八");
  assert.equal(mirrorFormatCharacterText(["小八", "烏薩奇"]), "小八・烏薩奇");
  assert.equal(mirrorFormatCharacterText(["小八", "烏薩奇", "吉伊"]), "小八・烏薩奇・吉伊");
  assert.equal(mirrorFormatCharacterText(["小八", "烏薩奇", "吉伊", "小桃"]), "小八・烏薩奇・吉伊");
});

await check("seoGenerator: 80 caps, brand, multi-character ・", () => {
  const src = read("src/lib/contentGenerator/seoGenerator.ts");
  assert.match(src, /SEO_TITLE_MAX_LENGTH = 80/);
  assert.match(src, /META_DESCRIPTION_MAX_LENGTH = 80/);
  assert.match(src, /collectCharacterNames/);
  assert.match(src, /productBrand \? productBrand \+ ' × '/);
});

await check("systemPromptBase: shared title contract, Chaochao skips conflicting body", () => {
  const src = read("src/lib/providers/systemPromptBase.ts");
  const titlePrompt = read("src/lib/providers/titlePrompt.ts");
  assert.match(titlePrompt, /商品標題契約｜所有語氣共用/);
  assert.match(src, /SHARED_PRODUCT_TITLE_PROMPT/);
  assert.match(src, /多角色用「・」/);
  assert.match(titlePrompt, /不要寫：生日禮物/);
  assert.doesNotMatch(src, /官網會再收成 60/);
  assert.doesNotMatch(src, /最長不超過 60 字（後端規則引擎另有 80/);
  assert.doesNotMatch(src, /最長 75 字/);
  assert.doesNotMatch(src, /建議 45 字、最長 60 字/);
  assert.doesNotMatch(src, /例如「包包吊飾」「桌面擺件」「送禮首選」/);
  assert.match(src, /buildChaochaoCopySystemPrompt/);
  assert.match(src, /buildChaochaoDescriptionFormat/);
});

await check("systemPrompt wrapper: thin Taiwan-traditional suffix only", () => {
  const wrapper = read("src/lib/providers/systemPrompt.ts");

  assert.ok(
    wrapper.includes("buildCopySystemPrompt as buildProductionCopySystemPrompt"),
    "Full Generate no longer imports Production base prompt under recovery alias"
  );
  assert.ok(
    wrapper.includes("buildFieldRegenSystemPrompt as buildProductionFieldRegenSystemPrompt"),
    "field regen no longer imports Production base prompt under recovery alias"
  );
  assert.ok(
    wrapper.includes("buildProductionCopySystemPrompt(tone, copyLength, secondhandInfo)"),
    "Full Generate no longer delegates to Production base prompt"
  );
  assert.match(wrapper, /所有顧客可見 AI 產出使用台灣繁中與台灣慣用詞/, "Taiwan Traditional suffix missing");
  assert.doesNotMatch(wrapper, /CHAOCHAO_BOSS_LAYOUT|CHAOCHAO_TITLE_QUALITY|OWNER_TITLE_MINIMAL_FIX/,
    "stacked Chaochao overlay returned to the wrapper");
  assert.doesNotMatch(
    wrapper,
    /骨架規則（P1-75b＋P2-80/,
    "shared Production title prompt was duplicated back into systemPrompt.ts"
  );
});

await check("payload types + generate route carry product_brand / variant_text", () => {
  assert.match(read("src/lib/contentGenerator/sourceTypes.ts"), /product_brand\?/);
  assert.match(read("src/lib/contentGenerator/sourceTypes.ts"), /variant_text\?/);
  const route = read("src/app/api/generate/route.ts");
  // P1-75a: prefer detected brand for this pass, fall back to draft.product_brand
  assert.match(
    route,
    /product_brand:\s*productBrand \?\? draft\.product_brand \?\? null|product_brand: draft\.product_brand \?\? null/
  );
  assert.match(
    route,
    /toListingDraftInput\(draft, detected, variantSummary(?:, effectiveProductBrand)?\)/
  );
});

await check("zhTwLocalizer: new Taiwan terms (釐米→公分 etc.)", () => {
  const src = read("src/lib/zhTwLocalizer.ts");
  for (const [from, to] of [["釐米", "公分"], ["厘米", "公分"], ["屏幕", "螢幕"], ["性價比", "CP值"]]) {
    assert.match(src, new RegExp(`\\['${from}', '${to}'\\]`));
  }
});

await check("visionProvider: promo exclusion + full spec table + 逐字角色名", () => {
  const src = read("src/lib/providers/visionProvider.ts");
  assert.match(src, /促銷排除/);
  assert.match(src, /優惠券/);
  assert.match(src, /參數表要抄全/);
  assert.match(src, /逐字抄寫/);
});

await check("historical migrations 031/032/033 remain archived (SQL 只產檔)", () => {
  assert.ok(exists("supabase/history/pre_tracking_migrations/031_product_brand.sql"));
  assert.ok(exists("supabase/history/pre_tracking_migrations/032_ip_catalog_v3_100_ips.sql"));
  assert.ok(exists("supabase/history/pre_tracking_migrations/033_tag_rules_sync_boss_tool.sql"));
  assert.match(read("supabase/history/pre_tracking_migrations/031_product_brand.sql"), /add column if not exists product_brand/);
  assert.match(read("supabase/history/pre_tracking_migrations/033_tag_rules_sync_boss_tool.sql"), /不移植/);
});

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL passed");
