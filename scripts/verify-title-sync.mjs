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

// Mirror of formatCharacterText (titleGenerator.ts) — keep in sync
function mirrorFormatCharacterText(characters) {
  if (characters.length === 0) return "";
  if (characters.length === 1) return characters[0];
  if (characters.length === 2) return characters.join("・");
  return characters.slice(0, 3).join("・") + "等角色";
}

console.log("verify-title-sync:");

await check("titleGenerator: P2-83 60/80 dual cap, brand × IP, ladder, replacements", () => {
  const src = read("src/lib/contentGenerator/titleGenerator.ts");
  assert.match(src, /OFFICIAL_TITLE_MAX_LENGTH = 60/);
  assert.match(src, /ENRICHED_TITLE_MAX_LENGTH = 80/);
  assert.match(src, /clampOfficialTitle/);
  assert.match(src, /enforceSkeletonTitleLength/);
  assert.match(src, /TITLE_SEGMENT3_BLACKLIST/);
  assert.match(src, /' × '/);
  assert.match(src, /formatCharacterText/);
  assert.match(src, /collectCharacterNames/);
  assert.match(src, /等角色/);
  assert.match(src, /夏威夷衝浪造型/);
  assert.match(src, /款式可選/);
  assert.match(src, /台灯/);
  // Night-work unified 80 on official title must be gone
  assert.doesNotMatch(src, /const TITLE_MAX_LENGTH = 80/);
});

await check("mirror: character list formatting (1/2/3+)", () => {
  assert.equal(mirrorFormatCharacterText(["小八"]), "小八");
  assert.equal(mirrorFormatCharacterText(["小八", "烏薩奇"]), "小八・烏薩奇");
  assert.equal(
    mirrorFormatCharacterText(["小八", "烏薩奇", "吉伊", "小桃"]),
    "小八・烏薩奇・吉伊等角色"
  );
});

await check("seoGenerator: 80 caps, brand, multi-character ・", () => {
  const src = read("src/lib/contentGenerator/seoGenerator.ts");
  assert.match(src, /SEO_TITLE_MAX_LENGTH = 80/);
  assert.match(src, /META_DESCRIPTION_MAX_LENGTH = 80/);
  assert.match(src, /collectCharacterNames/);
  assert.match(src, /productBrand \? productBrand \+ ' × '/);
});

await check("systemPrompt: P2-83 unique length table, brand + ・ rule", () => {
  const src = read("src/lib/providers/systemPrompt.ts");
  assert.match(src, /標題長度唯一真相表/);
  assert.match(src, /enriched_title（你輸出）/);
  assert.match(src, /官網 title_zh（後端 clamp）/);
  assert.match(src, /seo_title（你輸出）/);
  assert.match(src, /70-80 字為佳/);
  assert.match(src, /多角色用「・」/);
  assert.match(src, /品牌 × IP/);
  assert.doesNotMatch(src, /70-110 字/);
  // Old conflicting numbers must be gone
  assert.doesNotMatch(src, /最長不超過 60 字（後端規則引擎另有 80/);
  assert.doesNotMatch(src, /最長 75 字/);
  assert.doesNotMatch(src, /建議 45 字、最長 60 字/);
  // Positive 送禮首選 example removed (blacklist context only)
  assert.doesNotMatch(src, /例如「包包吊飾」「桌面擺件」「送禮首選」/);
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

await check("migrations 031/032/033 exist (SQL 只產檔)", () => {
  assert.ok(exists("supabase/migrations/031_product_brand.sql"));
  assert.ok(exists("supabase/migrations/032_ip_catalog_v3_100_ips.sql"));
  assert.ok(exists("supabase/migrations/033_tag_rules_sync_boss_tool.sql"));
  assert.match(read("supabase/migrations/031_product_brand.sql"), /add column if not exists product_brand/);
  assert.match(read("supabase/migrations/033_tag_rules_sync_boss_tool.sql"), /不移植/);
});

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL passed");
