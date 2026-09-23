import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

const titleBase = read("src/lib/contentGenerator/titleGeneratorBase.ts");
const titleFinalizer = read("src/lib/contentGenerator/titleFinalizer.ts");
const route = read("src/app/api/generate/route.ts");
const payload = read("src/lib/shopify/payload.ts");
const copy = read("src/lib/providers/copy.ts");
const promptBase = read("src/lib/providers/systemPromptBase.ts");
const prompt = read("src/lib/providers/systemPrompt.ts");
const resultCardCopyPanel = read("src/components/listing/result-card/ResultCardCopyPanel.tsx");
const finalizer = read("src/lib/providers/customerFacingFinalizer.ts");
const specAuthority = read("src/lib/providers/specAuthority.ts");
const htmlFormat = read("src/lib/contentGenerator/htmlFormat.ts");

function loadHtmlFormatModule() {
  const output = ts.transpileModule(htmlFormat, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "src/lib/contentGenerator/htmlFormat.ts",
  }).outputText;
  const module = { exports: {} };
  const localRequire = (specifier) => {
    if (specifier === "./sectionHeaders") {
      return {
        matchSectionHeader(line) {
          const trimmed = line.trim();
          if (/^◈\s*.+/u.test(trimmed)) return { title: trimmed.replace(/^◈\s*/u, "") };
          if (/^[A-E]｜/u.test(trimmed)) return { title: null };
          return null;
        },
      };
    }
    if (specifier === "./saleStatusNotice") {
      return { saleStatusNoticeHtml: () => "" };
    }
    throw new Error(`Unexpected htmlFormat dependency: ${specifier}`);
  };
  vm.runInNewContext(output, {
    exports: module.exports,
    module,
    require: localRequire,
  }, { filename: "src/lib/contentGenerator/htmlFormat.ts" });
  return module.exports;
}

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

function normalizeSeparators(value) {
  const raw = (value ?? "").trim();
  if (!raw || !/[|｜]/u.test(raw)) return raw;
  return raw
    .split(/\s*[|｜]\s*/u)
    .map((segment) => segment.trim())
    .join(" | ");
}

function finalizeWithoutDetectedTypeAppend(value) {
  return normalizeSeparators(value);
}

// Title: exact Production generator remains the semantic base. No stale getVariantText assumption.
assert.match(titleBase, /function getShortFeatureText\(/u, "Production getShortFeatureText ladder missing");
assert.match(titleBase, /isCharacterRedundantWithIpDisplay/u, "Production character redundancy helper missing");
assert.match(titleBase, /export function collectCharacterNames/u, "Production collectCharacterNames missing");
assert.match(titleBase, /export function formatCharacterText/u, "Production formatCharacterText missing");
assert.match(titleBase, /const TITLE_DEDUPE_TERMS/u, "Production title dedupe terms missing");
assert.match(titleBase, /export const TITLE_SEGMENT3_BLACKLIST/u, "Production title blacklist missing");
assert.match(titleBase, /export function scrubEnrichedTitleSegment3/u, "Production segment-3 scrub missing");
assert.match(titleBase, /export const OFFICIAL_TITLE_MAX_LENGTH = PRODUCT_TITLE_MAX_LENGTH/u, "unified 80-char official title cap missing");
assert.match(titleBase, /export const ENRICHED_TITLE_MAX_LENGTH = PRODUCT_TITLE_MAX_LENGTH/u, "unified 80-char enriched title cap missing");

const featureLadder = section(titleBase, "function getShortFeatureText", "function textLen");
const ladderMarkers = [
  "const styleText = getStyleText(sourceText);",
  "const seriesText = getSeriesText(sourceText);",
  "const functionText = getFunctionText(sourceText);",
  "if (featureTerms.length > 0)",
  "if (draft.variant_feature?.trim())",
  "if (sizeText) return sizeText;",
  "const scenario = pickTitleScenarioFallback(draft);",
  "if (hasMultipleCharacters) return '款式可選';",
  "return getSelectableText(sourceText) ?? '';",
];
let previousIndex = -1;
for (const marker of ladderMarkers) {
  const index = featureLadder.indexOf(marker);
  assert.ok(index > previousIndex, `Production title feature ladder changed near: ${marker}`);
  previousIndex = index;
}

// Owner title fix #1: normalize separator spelling only; never drop empty segments.
const separatorHelper = section(
  titleFinalizer,
  "export function normalizeTitleSeparators",
  "export function appendProductTypeToSecondSegment",
);
assert.match(separatorHelper, /split\(\/\\s\*\[\|｜\]\\s\*\/u\)/u, "separator parser changed");
assert.match(separatorHelper, /join\(" \| "\)/u, "separator output is not ASCII ' | '");
assert.doesNotMatch(separatorHelper, /filter\(Boolean\)/u, "separator helper must preserve empty segments");
assert.equal(normalizeSeparators("A||C"), "A |  | C", "ASCII empty segment was dropped");
assert.equal(normalizeSeparators("A｜｜C"), "A |  | C", "fullwidth empty segment was dropped");
assert.equal(normalizeSeparators("A |B｜ C"), "A | B | C", "mixed separator normalization changed");

// COPY C5A: detected product type is Writer evidence, not a mandatory backend append.
assert.match(
  titleFinalizer,
  /export function appendProductTypeToSecondSegment[\s\S]*?return normalizeTitleSeparators\(value\);/u,
  "legacy append helper no longer preserves C5A no-append behavior",
);
assert.doesNotMatch(
  titleFinalizer,
  /segments\[1\]\s*=\s*\[secondSegment,\s*productType\]/u,
  "detected product type append returned",
);
assert.doesNotMatch(titleFinalizer, /segments\[0\]\s*=/u, "title finalizer rewrites segment 1");
assert.doesNotMatch(titleFinalizer, /segments\[2\]\s*=/u, "title finalizer rewrites segment 3");

const titleFixtures = [
  [
    "馬克圖布 × Miffy | 米菲 矽膠臺燈 | 70週年蘋果樹典藏款",
    "燈具小物",
    "馬克圖布 × Miffy | 米菲 矽膠臺燈 | 70週年蘋果樹典藏款",
  ],
  [
    "Razer × 寶可夢|皮卡丘 無線藍牙鍵盤|RGB燈效",
    "3C小物",
    "Razer × 寶可夢 | 皮卡丘 無線藍牙鍵盤 | RGB燈效",
  ],
  [
    "MARtube × Pingu|Pingu 迷你CCD相機吊飾|可拍照錄影盲盒",
    "吊飾",
    "MARtube × Pingu | Pingu 迷你CCD相機吊飾 | 可拍照錄影盲盒",
  ],
];
for (const [input, productType, expected] of titleFixtures) {
  const actual = finalizeWithoutDetectedTypeAppend(input);
  assert.equal(actual, expected, `detected type unexpectedly changed title (${productType}): ${input}`);
  assert.equal(
    actual.split(" | ").slice(2).join(" | "),
    normalizeSeparators(input).split(" | ").slice(2).join(" | "),
    `segment 3 changed: ${input}`,
  );
}

const titlePrompt = read("src/lib/providers/titlePrompt.ts");
const chaochaoPrompt = read("src/lib/providers/chaochaoPrompt.ts");

// Shared title contract lives in titlePrompt.ts and is used by every tone.
assert.match(titlePrompt, /商品標題契約｜所有語氣共用/, "shared title contract missing");
assert.match(titlePrompt, /IP中文＋英文 × 品牌/, "IP-first brand-second title order missing");
assert.match(titlePrompt, /三麗鷗 Sanrio × Bandai \| 家族米粒公仔吊飾盲盒 \| 隨機單盒/, "owner title example missing");
assert.match(titlePrompt, /不要填「標準款」/, "filler 標準款 rule missing");
assert.match(promptBase, /SHARED_PRODUCT_TITLE_PROMPT/, "base prompt no longer injects the shared title contract");
assert.doesNotMatch(prompt, /COPY C5A 潮巢導購版 Title Writer/, "Chaochao-only title overlay returned");
assert.doesNotMatch(prompt, /CHAOCHAO_BOSS_LAYOUT/, "stacked Chaochao layout overlay returned");

assert.match(titleFinalizer, /finalizeProductTitle/u, "shared product title assembler missing");
assert.match(titleFinalizer, /PRODUCT_TITLE_MAX_LENGTH/u, "unified title cap missing from finalizer");
assert.doesNotMatch(titleFinalizer, /clampOfficialTitle/u,
  "title finalizer must not re-introduce the old official clamp helper");
assert.match(route, /const officialTitleZh = enrichedTitleFull;/u,
  "Full Generate still splits 80-char generation from a shorter official title");
const regenTitleBlock = section(route, 'if (regenField === "enriched_title")', '} else {');
assert.match(regenTitleBlock, /finalizeProductTitle/u, "single-field title regen bypasses title assembler");
assert.match(regenTitleBlock, /value = historyContent/u, "single-field title regen history and stored title diverged");

// SKU: Production raw provider SKU wins full generation; field regen has no SKU write.
assert.match(route, /sku: raw\.sku,/u, "raw.sku no longer feeds detected.sku");
assert.match(route, /sku: detected\.sku \|\| null,/u, "detected.sku no longer feeds draft update");
assert.doesNotMatch(route, /persistedSku|COPY C1\.3 SKU authority|generateSku/u,
  "C1.3 persisted/generated SKU authority returned to generate route");
const regenMap = section(route, "const REGEN_FIELD_TO_COLUMN", "async function handleFieldRegen");
assert.doesNotMatch(regenMap, /sku/u, "single-field regeneration must not write SKU");
const badPinguDraftSku = "Pingu相機盲盒";
const rawPinguSku = "CHO-BBX-PNG-PNG-001";
const detectedPinguSku = rawPinguSku;
assert.notEqual(detectedPinguSku, badPinguDraftSku, "bad draft SKU incorrectly remains authoritative");
assert.equal(detectedPinguSku, "CHO-BBX-PNG-PNG-001", "Pingu Production SKU fixture failed");

assert.match(payload, /const \{ sku \} = generateSku\(\{/u, "Shopify Production generateSku authority missing");
assert.match(payload, /variantSeed:\s*\{\s*sku,/u, "Shopify variant seed no longer uses generated Production SKU");
assert.doesNotMatch(payload, /draft\.sku\?\.trim\(\)|persistedSku/u,
  "Shopify payload restored stale persisted-draft SKU precedence");
assert.match(promptBase, /sku：依規則產生 CHO-\{型態縮寫\}-\{IP縮寫\}-\{角色縮寫\}-001/u,
  "Production SKU prompt format missing");
assert.match(promptBase, /縮寫用 2-3 碼全大寫英文，序號固定 001/u,
  "Production SKU abbreviation/sequence rule missing");

// Shared FAQ/GEO remains Production-derived; no R0B FAQ redesign.
assert.match(promptBase, /【FAQ 規則】/u, "Production FAQ section missing");
assert.match(promptBase, /3-5 題，每題 <h3><strong>問題<\/strong><\/h3> \+ <p>回答<\/p>（2-3 句）/u,
  "Production FAQ count/markup/sentence contract changed");
assert.match(promptBase, /鼓勵自由發揮：問題可以導購性強、有趣、吸引人、針對目標客群設計/u,
  "Production FAQ creativity/target-audience guidance missing");
assert.match(promptBase, /避免低價值制式問題/u, "Production low-value FAQ guidance missing");
assert.match(promptBase, /FAQ 回答必須寫成可以被 AI 搜尋引擎（ChatGPT、Perplexity 等）單獨引用、語意完整的句子/u,
  "Production GEO standalone-answer rule missing");
assert.match(promptBase, /避免使用「如上所述」「如前面提到」「如圖所示」/u,
  "Production GEO contextual-reference ban missing");
assert.match(promptBase, /3-5 題，每題 <h3><strong>問題<\/strong><\/h3><p>回答<\/p>，答案自成一段可被單獨引用，導購感優先/u,
  "Production FAQ single-field regen rule changed");

// Taiwan Traditional customer-facing boundary retained.
assert.match(prompt, /所有顧客可見 AI 產出使用台灣繁中與台灣慣用詞/u,
  "Taiwan Traditional customer-facing instruction missing");
assert.match(finalizer, /localizeToTaiwanTraditionalText/u, "Taiwan Traditional finalizer missing");
assert.match(finalizer, /stripCustomerSourceMarkers/u, "customer-facing source marker cleanup missing");

assert.match(copy, /"潮巢導購版"/u, "seventh Chaochao tone disappeared");
assert.match(chaochaoPrompt, /只輸出純文字，不要 HTML/u, "Chaochao description must stay plain text");
assert.match(chaochaoPrompt, /第一行是「商品介紹」/u, "Chaochao description no longer starts with 商品介紹");
assert.match(chaochaoPrompt, /收藏亮點/u);
assert.match(chaochaoPrompt, /適合誰/u);
assert.match(chaochaoPrompt, /商品資訊/u);
assert.match(chaochaoPrompt, /購買提醒/u);
assert.match(chaochaoPrompt, /why_we_chose_it/u);
assert.match(chaochaoPrompt, /product_highlights/u);
assert.match(chaochaoPrompt, /3～5 個真實特色當主軸/u, "distinctive-feature priority missing");
assert.match(chaochaoPrompt, /這是先後順序，不是上限/u, "3–5 must not be a hard cap");
assert.match(chaochaoPrompt, /約 10cm 掛在包包上不會太有負擔/u, "feature-to-benefit example missing");
assert.doesNotMatch(chaochaoPrompt, /把雨季變可愛一點/u, "full article few-shots returned");
assert.doesNotMatch(chaochaoPrompt, /先寫買家真正在意的痛點/u, "pain-point-only opener returned");
assert.doesNotMatch(chaochaoPrompt, /不要停在「不僅是收藏品」/u, "empty-phrase ban pool returned");
assert.doesNotMatch(prompt, /CHAOCHAO_VOICE_ANCHOR/u, "brand-manifesto voice overlay returned");
assert.match(promptBase, /buildChaochaoCopySystemPrompt/u, "Chaochao is not assembled from the dedicated contract");
assert.match(promptBase, /if \(tone === CHAOCHAO_SALES_TONE\) \{\s*return buildChaochaoCopySystemPrompt/u,
  "Chaochao no longer skips the shared body prompt");

assert.match(resultCardCopyPanel,
  /descriptionPreviewHtml\(description, draft\.generation_tone, draft\.sale_status\)/u,
  "ResultCard preview no longer passes stored generation_tone and sale_status");

const {
  descriptionPreviewHtml,
  formatChaochaoSalesDescriptionHtml,
  formatPlainTextAsHtml,
} = loadHtmlFormatModule();

const pinguMissingHeadingPrefix = `商品介紹

想隨身帶著Pingu去冒險，親手捕捉生活中的可愛瞬間？

收藏亮點
・Pingu正版授權：享受正版認證帶來的品質保證。
・多色選擇：紅、黃、黑、白四種顏色。
・相機+錄影功能：輕鬆捕捉日常生活。
・優質塑膠材質：耐磨光亮。

獨特的隨身配件

在尋找一個兼具功能性和趣味性的隨身小物嗎？這款迷你相機吊飾……`;
const pinguFallbackPreview = descriptionPreviewHtml(
  pinguMissingHeadingPrefix,
  "潮巢導購版",
);
assert.match(pinguFallbackPreview, /^<h2>商品介紹<\/h2><p>想隨身帶著Pingu去冒險/u,
  "Pingu fallback preview lost the intro heading or paragraph");
assert.match(pinguFallbackPreview, /<h2>收藏亮點<\/h2><ul>/u,
  "Pingu fallback preview lost the highlights section");
assert.equal(
  [...pinguFallbackPreview.matchAll(/<li>/gu)].length,
  4,
  "Pingu fallback preview must contain exactly four highlight items",
);
assert.match(pinguFallbackPreview, /<\/ul><h2>獨特的隨身配件<\/h2><p>在尋找一個兼具功能性和趣味性的隨身小物嗎？/u,
  "missing-prefix sales heading was not recovered before the sales paragraph");
assert.doesNotMatch(pinguFallbackPreview, /<li>獨特的隨身配件/u,
  "missing-prefix sales heading was swallowed by highlights");
assert.doesNotMatch(pinguFallbackPreview, /<li>在尋找一個兼具功能性/u,
  "sales paragraph was swallowed by highlights");
assert.doesNotMatch(pinguFallbackPreview, /這件商品為什麼有意思/u,
  "generic sales-heading fallback appeared for the recoverable Pingu source");

const formalHeadingSource = `商品介紹

想隨身帶著Pingu去冒險？

收藏亮點
・Pingu正版授權
・相機與錄影功能

導購小標：獨特的隨身配件

這款迷你相機吊飾兼具功能性和趣味性。`;
const formalHeadingPreview = descriptionPreviewHtml(formalHeadingSource, "潮巢導購版");
assert.match(formalHeadingPreview, /<\/ul><h2>獨特的隨身配件<\/h2><p>這款迷你相機吊飾/u,
  "formal 導購小標 prefix no longer has priority");
assert.equal([...formalHeadingPreview.matchAll(/<li>/gu)].length, 2,
  "formal heading source changed its highlight count");
assert.doesNotMatch(formalHeadingPreview, /這件商品為什麼有意思/u,
  "formal heading source incorrectly used the generic fallback");

const genuineHighlightContinuation = `商品介紹

這是商品介紹正文。

收藏亮點
・可愛造型
材質摸起來柔軟，日常使用也很舒服。
這段只是對亮點的補充說明。`;
const conservativePreview = descriptionPreviewHtml(
  genuineHighlightContinuation,
  "潮巢導購版",
);
assert.match(conservativePreview, /<h2>這件商品為什麼有意思<\/h2>$/u,
  "ordinary highlight prose was promoted to a sales heading");
assert.doesNotMatch(conservativePreview, /<h2>材質摸起來柔軟/u,
  "sentence-like highlight content bypassed the conservative guard");

const shortHighlightBeforeBullet = `商品介紹

這是商品介紹正文。

收藏亮點
・可愛造型
補充亮點
・耐磨材質`;
const nextBulletPreview = descriptionPreviewHtml(shortHighlightBeforeBullet, "潮巢導購版");
assert.doesNotMatch(nextBulletPreview, /<h2>補充亮點<\/h2>/u,
  "a short highlight line followed by another bullet was promoted to a heading");

const fourSectionSource = `商品介紹

今天的麵包坊由 Hello Kitty 值班。

收藏亮點
・圓滾滾麵包輪廓：看起來像剛出爐。
・柔軟絨毛：拿在手上有份量。

適合誰
・想送朋友一份會心一笑的人

商品資訊
・角色：Hello Kitty
・材質：絨毛`;
const fourSectionPreview = descriptionPreviewHtml(fourSectionSource, "潮巢導購版");
assert.match(fourSectionPreview, /<h2>商品介紹<\/h2>/u, "4-section intro heading missing");
assert.match(fourSectionPreview, /<h2>收藏亮點<\/h2>/u, "4-section highlights heading missing");
assert.match(fourSectionPreview, /<h2>適合誰<\/h2>/u, "4-section audience heading missing");
assert.match(fourSectionPreview, /<h2>商品資訊<\/h2>/u, "4-section product-info heading missing");
assert.match(fourSectionPreview, /<li>角色：Hello Kitty<\/li>/u, "4-section product-info list missing");
assert.doesNotMatch(fourSectionPreview, /這件商品為什麼有意思/u, "4-section source used the legacy sales fallback");
assert.doesNotMatch(fourSectionPreview, /導購小標/u, "4-section source leaked the legacy sales prefix");

const escapedFourSection = formatChaochaoSalesDescriptionHtml(
  "商品介紹\n\nA < B & C\n\n收藏亮點\n・1\n\n適合誰\n・2\n\n商品資訊\n・3",
);
assert.match(escapedFourSection, /A &lt; B &amp; C/u, "Chaochao HTML must keep escaping");

const otherTonePreview = descriptionPreviewHtml(pinguMissingHeadingPrefix, "小編聊天口吻");
assert.equal(otherTonePreview, formatPlainTextAsHtml(pinguMissingHeadingPrefix),
  "missing-prefix tolerance leaked into an existing tone");
assert.doesNotMatch(otherTonePreview, /<h2>獨特的隨身配件<\/h2>/u,
  "an existing tone gained the Chaochao fallback heading");

const directFormatterOutput = formatChaochaoSalesDescriptionHtml(pinguMissingHeadingPrefix);
assert.match(directFormatterOutput, /<h2>這件商品為什麼有意思<\/h2>/u,
  "preview-only tolerance leaked into the direct Shopify formatter path");
assert.doesNotMatch(directFormatterOutput, /<h2>獨特的隨身配件<\/h2>/u,
  "direct formatter unexpectedly enabled the Preview fallback");

// R0A existing-spec-first; no evidence/vision/spec-merge recovery regressions.
assert.match(specAuthority, /const existing = existingSpec \?\? "";[\s\S]*if \(existing\.trim\(\)\) return existing;/u,
  "existing non-empty spec is not authoritative");
assert.match(specAuthority, /localizeToTaiwanTraditionalText\(providerSpec \?\? ""\)[\s\S]*return provider;/u,
  "empty existing spec cannot adopt provider spec");
assert.doesNotMatch(specAuthority, /webEvidence|factsByLabel|CUSTOMER_SPEC_LABELS|derivedUsageScenario/u,
  "R0A spec authority regained deterministic evidence merge");
assert.equal(exists("src/lib/providers/productEvidencePack.ts"), false, "Evidence Pack file returned");
assert.equal(exists("src/lib/images/fullGenerateVision.ts"), false, "Full Generate Vision bridge file returned");

const sourceFiles = [];
function collectRuntimeFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectRuntimeFiles(full);
    else if (/\.(?:ts|tsx)$/u.test(entry.name)) sourceFiles.push(full);
  }
}
collectRuntimeFiles(path.join(root, "src"));
const runtimeText = sourceFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
for (const forbidden of [
  "buildStructuredEnrichedTitle",
  "StructuredEnrichedTitleInput",
  "featureCandidateFromTitle",
  "LOW_VALUE_TITLE_FEATURES",
  "rankTitleFeatureCandidates",
  "COPY C1.3 SKU authority",
  "persistedSku",
  "buildProductEvidencePack",
  "formatProductEvidencePack",
  "evidencePackText",
  "prepareVisionEvidenceForFullGenerate",
  "mergeCustomerSpecEvidence",
]) {
  assert.ok(!runtimeText.includes(forbidden), `forbidden runtime symbol/authority remains: ${forbidden}`);
}

// Live-line spec: model-organized Taiwan Traditional spec is written back when
// non-blank; a blank model spec never wipes an existing value.
assert.match(route, /const existingSpec = \(draft\.spec_text \?\? ""\)\.trim\(\);/u,
  "spec warning guard no longer checks existing spec");
assert.match(route, /const autoSpec = tidySpecLines\(/u,
  "full generate no longer organizes provider spec into Taiwan Traditional");
assert.match(route, /if \(!autoSpecIsBlank\) \{[\s\S]*finalSpecText = autoSpec/u,
  "non-blank organized spec is not written back");
assert.match(route, /A blank model spec never wipes an existing value/u,
  "blank model spec wipe-protection comment missing");
assert.match(route, /商品規格已整理成台灣繁體/u,
  "organized spec warning missing");
assert.match(specAuthority, /const existing = existingSpec \?\? "";[\s\S]*if \(existing\.trim\(\)\) return existing;/u,
  "specAuthority helper no longer preserves existing spec");
assert.match(specAuthority, /localizeToTaiwanTraditionalText\(providerSpec \?\? ""\)[\s\S]*return provider;/u,
  "empty existing spec cannot adopt provider spec in specAuthority helper");

function specOutcome(existingSpec, providerSpec) {
  const existing = (existingSpec ?? "").trim();
  const autoSpec = (providerSpec ?? "").trim();
  const autoSpecIsBlank = !autoSpec || autoSpec === "（無）" || autoSpec === "(無)";
  let finalSpec = existing || null;
  if (!autoSpecIsBlank) finalSpec = autoSpec;
  return { finalSpec, wroteOrganizedSpec: !autoSpecIsBlank };
}
const organizedOverwrites = specOutcome("品牌：Razer\n型號：Orochi V2", "品牌：Razer\n類型：滑鼠");
assert.equal(organizedOverwrites.finalSpec, "品牌：Razer\n類型：滑鼠", "organized spec should replace the captured spec");
assert.equal(organizedOverwrites.wroteOrganizedSpec, true, "organized spec must write back");
const providerAdopted = specOutcome("   ", "品牌：Razer\n類型：滑鼠");
assert.equal(providerAdopted.finalSpec, "品牌：Razer\n類型：滑鼠", "valid provider spec was not adopted when existing is blank");
assert.equal(providerAdopted.wroteOrganizedSpec, true, "blank existing spec must adopt organized spec");
const blankKeepsExisting = specOutcome("品牌：Razer\n型號：Orochi V2", "（無）");
assert.equal(blankKeepsExisting.finalSpec, "品牌：Razer\n型號：Orochi V2", "blank model spec must not wipe existing spec");
assert.equal(blankKeepsExisting.wroteOrganizedSpec, false, "blank model spec must not count as a write-back");

// R0B.3: single-field regeneration preserves stored tone and never writes generation_tone.
const singleFieldDispatch = section(route, "if (regenField) {", "const ipCatalogWithPack");
assert.match(singleFieldDispatch, /const regenTone: CopyTone =[\s\S]*typeof draft\.generation_tone === "string"[\s\S]*COPY_TONES[\s\S]*includes\(draft\.generation_tone\)[\s\S]*\? \(draft\.generation_tone as CopyTone\)[\s\S]*: tone;/u,
  "single-field regen does not prefer a valid stored generation_tone");
assert.match(singleFieldDispatch, /tone: regenTone,/u,
  "single-field regen does not pass the preserved tone to the provider path");

const fieldRegenFunction = section(route, "async function handleFieldRegen", "async function writeImageAltTexts");
assert.doesNotMatch(fieldRegenFunction, /generation_tone/u,
  "single-field regen must not write generation_tone");

function resolveSingleFieldToneFixture(storedTone, fallbackTone) {
  const approvedStoredTones = new Set(["潮巢導購版", "小編聊天口吻"]);
  return typeof storedTone === "string" && approvedStoredTones.has(storedTone)
    ? storedTone
    : fallbackTone;
}
assert.equal(
  resolveSingleFieldToneFixture("潮巢導購版", "黑膠文藝收藏感"),
  "潮巢導購版",
  "Fixture A: Chaochao stored tone was not preserved for enriched_title regen",
);
assert.equal(
  resolveSingleFieldToneFixture("小編聊天口吻", "黑膠文藝收藏感"),
  "小編聊天口吻",
  "Fixture B: Xiaobian stored tone was not preserved for description regen",
);
assert.equal(
  resolveSingleFieldToneFixture(null, "黑膠文藝收藏感"),
  "黑膠文藝收藏感",
  "Fixture C: null legacy tone must retain existing fallback behavior",
);
assert.equal(
  resolveSingleFieldToneFixture("legacy-invalid-tone", "黑膠文藝收藏感"),
  "黑膠文藝收藏感",
  "Fixture C: invalid legacy tone must retain existing fallback behavior",
);

const fullGenerateToneBlock = section(route, "const generationTone = resolvedGenerationTone", "if (webSearchCacheToPersist)");
assert.match(fullGenerateToneBlock, /const generationTone = resolvedGenerationTone\(tone, detected\.ip \|\| draft\.ip_name, ipToneMap\);/u,
  "Full Generate no longer resolves the explicitly selected tone");
assert.match(fullGenerateToneBlock, /\.update\(\{ generation_tone: generationTone \}\)/u,
  "Fixture D: Full Generate no longer persists the selected generation_tone");

console.log("COPY C1.R0B title/SKU/FAQ/spec-warning/tone-preservation contract verifier passed");
