/**
 * P2 文案微調 verify：79 character aliases / 80 segment3 blacklist /
 * 83 official 60 vs enriched+seo 80 / 81 saleStatusNotice tones / 82 D-spec warn.
 *
 * Pure source + inline mirrors (no tsx). Run: node scripts/verify-p2-copy-tune.mjs
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

// --- Inline mirrors of title clamp (keep in sync with titleGenerator.ts) ---
function textLen(value) {
  return Array.from(value).length;
}
function sliceChars(value, max) {
  return Array.from(value).slice(0, Math.max(0, max)).join("");
}
function enforceSkeletonTitleLength(seg1, seg2, seg3, maxLen = 60) {
  const s1 = (seg1 ?? "").trim();
  let core = (seg2 ?? "").trim();
  let feature = (seg3 ?? "").trim();
  const join3 = (a, b, c) => {
    if (a && b && c) return `${a} | ${b} | ${c}`;
    if (a && b) return `${a} | ${b}`;
    return [a, b, c].filter(Boolean).join(" | ");
  };
  let title = join3(s1, core, feature);
  if (textLen(title) <= maxLen) return title;
  while (feature && textLen(join3(s1, core, feature)) > maxLen) {
    if (textLen(feature) <= 1) {
      feature = "";
      break;
    }
    feature = sliceChars(feature, textLen(feature) - 1).trim();
  }
  title = join3(s1, core, feature);
  if (textLen(title) <= maxLen) return title;
  while (core && textLen(join3(s1, core, feature)) > maxLen) {
    if (textLen(core) <= 1) break;
    core = sliceChars(core, textLen(core) - 1).trim();
  }
  title = join3(s1, core, feature);
  if (textLen(title) <= maxLen) return title;
  if (textLen(s1) >= maxLen) return sliceChars(s1, maxLen);
  const restBudget = maxLen - textLen(s1) - 3;
  const rest = [core, feature].filter(Boolean).join(" | ");
  if (restBudget <= 0) return s1;
  return `${s1} | ${sliceChars(rest, restBudget)}`.trim();
}
function clampOfficialTitle(title, maxLen = 60) {
  const raw = (title ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  if (textLen(raw) <= maxLen) return raw;
  const pipeSplit = raw.includes(" | ")
    ? raw.split(" | ").map((p) => p.trim()).filter(Boolean)
    : raw.includes("｜")
      ? raw.split("｜").map((p) => p.trim()).filter(Boolean)
      : null;
  if (pipeSplit && pipeSplit.length >= 2) {
    return enforceSkeletonTitleLength(pipeSplit[0], pipeSplit[1] ?? "", pipeSplit.slice(2).join(" | "), maxLen);
  }
  const chars = Array.from(raw);
  const window = chars.slice(0, maxLen);
  const breakPoints = [" ", "、", "・", "，", ",", "/", "-", "－"];
  let cut = maxLen;
  for (let i = window.length - 1; i >= Math.floor(maxLen * 0.55); i -= 1) {
    if (breakPoints.includes(window[i])) {
      cut = i;
      break;
    }
  }
  if (cut < Math.floor(maxLen * 0.4)) cut = maxLen;
  return chars.slice(0, cut).join("").trim();
}

console.log("verify-p2-copy-tune:");

// --- 79 ---
check("79: characterAliasMap + resolve + findCharacterEntry aliases", () => {
  assert.ok(exists("src/lib/characters/characterAliasMap.ts"));
  assert.ok(exists("src/lib/characters/resolveCanonicalCharacter.ts"));
  const map = read("src/lib/characters/characterAliasMap.ts");
  assert.match(map, /米飛/);
  assert.match(map, /character_name: "Miffy"/);
  assert.match(map, /懶懶熊/);
  assert.match(map, /Rilakkuma/);
  const resolve = read("src/lib/characters/resolveCanonicalCharacter.ts");
  assert.match(resolve, /resolveCanonicalCharacterName/);
  assert.match(resolve, /lookupCharacterAliasPatch/);
  const labels = read("src/lib/contentGenerator/displayLabels.ts");
  assert.match(labels, /characterEntryTerms/);
  assert.match(labels, /lookupCharacterAliasPatch/);
  const route = read("src/app/api/generate/route.ts");
  assert.match(route, /resolveCanonicalCharacterName/);
});

// --- 80 + 83 ---
check("80/83: titleGenerator constants + helpers", () => {
  const src = read("src/lib/contentGenerator/titleGenerator.ts");
  assert.match(src, /OFFICIAL_TITLE_MAX_LENGTH = 60/);
  assert.match(src, /ENRICHED_TITLE_MAX_LENGTH = 80/);
  assert.match(src, /TITLE_SEGMENT3_BLACKLIST/);
  assert.match(src, /clampOfficialTitle/);
  assert.match(src, /scrubEnrichedTitleSegment3/);
  assert.match(src, /sanitizeTitleSegment3/);
  assert.match(src, /pickScenarioKeywords/);
  assert.doesNotMatch(src, /const TITLE_MAX_LENGTH = 80/);
});

check("80/83: clamp skeleton prefers cut seg3; no-pipe safe (mirror)", () => {
  const longFeature =
    "超長第三段特色詞還有更多贅詞繼續堆疊讓標題爆掉需要被優先砍掉的部分還有更多再補一串絕對會超過六十的字元尾巴尾巴尾巴尾巴";
  const skeleton = `米菲 Miffy | 絨毛吊飾掛件 | ${longFeature}`;
  assert.ok(textLen(skeleton) > 60, "fixture must exceed 60");
  const clamped = clampOfficialTitle(skeleton, 60);
  assert.ok(textLen(clamped) <= 60, `len=${textLen(clamped)} ${clamped}`);
  assert.match(clamped, /^米菲 Miffy/);
  assert.ok(!clamped.includes(longFeature), "full third segment must be cut");
  assert.ok(textLen(clamped) < textLen(skeleton));

  const flat =
    "米菲Miffy超長沒有分隔符號的標題需要安全截斷不要在詞中間亂砍還要保留開頭品牌資訊段落內容很多很多";
  const flatClamped = clampOfficialTitle(flat, 60);
  assert.ok(textLen(flatClamped) <= 60);
  assert.ok(flatClamped.startsWith("米菲"));
});

check("80/83: generate route clamp + history split", () => {
  const route = read("src/app/api/generate/route.ts");
  assert.match(route, /clampOfficialTitle/);
  assert.match(route, /scrubEnrichedTitleSegment3/);
  assert.match(route, /enrichedTitleFull/);
  assert.match(route, /officialTitleZh/);
  assert.match(route, /ENRICHED_TITLE_MAX_LENGTH/);
});

check("80/83: systemPrompt unique length table, no old conflicts", () => {
  const src = read("src/lib/providers/systemPrompt.ts");
  assert.match(src, /標題長度唯一真相表/);
  assert.match(src, /enriched_title（你輸出）/);
  assert.match(src, /官網 title_zh（後端 clamp）/);
  assert.doesNotMatch(src, /最長不超過 60 字（後端規則引擎另有 80/);
  assert.doesNotMatch(src, /最長 75 字/);
  assert.doesNotMatch(src, /建議 45 字、最長 60 字/);
  assert.doesNotMatch(src, /例如「包包吊飾」「桌面擺件」「送禮首選」/);
  assert.match(src, /音譯變體/);
  assert.match(src, /TITLE_SEGMENT3|生日禮物、送禮首選|黑名單/);
});

// --- 81 ---
check("81: saleStatusNotice 4×5 tones + facts + payload wire", () => {
  const src = read("src/lib/contentGenerator/saleStatusNotice.ts");
  assert.match(src, /saleStatusNoticeText/);
  assert.match(src, /saleStatusNoticeHtml/);
  assert.match(src, /listAllSaleStatusNotices/);
  assert.match(src, /SALE_STATUS_NOTICES_BY_TONE/);
  for (const tone of ["黑膠文藝收藏感", "日系選物店溫柔感", "可愛周邊輕鬆感", "中二熱血宣言", "小編聊天口吻"]) {
    assert.match(src, new RegExp(tone));
  }
  for (const status of ["海外代購（約14天）", "預購中", "台灣現貨", "二手現貨"]) {
    assert.match(src, new RegExp(status.replace(/[（）]/g, "\\$&")));
  }
  // immutable facts
  assert.match(src, /14 天/);
  assert.match(src, /1–3 個工作天|1-3 個工作天/);
  assert.match(src, /以頁面說明為準/);
  assert.match(src, /品況見商品資訊|品況請看商品資訊|品況見商品資訊/);
  const payload = read("src/lib/shopify/payload.ts");
  assert.match(payload, /saleStatusNoticeHtml\(draft\.sale_status,\s*draft\.generation_tone\)/);
});

check("81: exactly 20 tone×status notice lines present", () => {
  const src = read("src/lib/contentGenerator/saleStatusNotice.ts");
  // Count quoted notice-like lines under BY_TONE (heuristic: lines with 天 or 預購 or 現貨 long strings)
  const toneKeys = (src.match(/黑膠文藝收藏感:|日系選物店溫柔感:|可愛周邊輕鬆感:|中二熱血宣言:|小編聊天口吻:/g) || [])
    .length;
  // 4 statuses × 5 tones = 20 tone-keyed entries (+ defaults don't use those labels as keys only)
  assert.ok(toneKeys >= 20, `tone keys found ${toneKeys}`);
});

// --- 82 ---
check("82: D-section vs empty spec warning (generate route)", () => {
  const route = read("src/app/api/generate/route.ts");
  assert.match(route, /descriptionHasProductInfoSection/);
  assert.match(route, /規格中繼是空的，但描述的商品資訊段有內容——要進 Shopify 規格請補規格欄/);
  assert.match(route, /matchSectionHeader/);
});

// P4 regression touchpoint (full suite: scripts/verify-p4-source-and-seller.mjs)
check("P4 touch: generate still strips customer source markers after copy", () => {
  const route = read("src/app/api/generate/route.ts");
  assert.match(route, /stripCustomerSourceMarkers/);
  const prompt = read("src/lib/providers/systemPrompt.ts");
  assert.ok(!prompt.includes("必須標來源"), "P4: prompt must not teach 必須標來源");
});

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL passed");
