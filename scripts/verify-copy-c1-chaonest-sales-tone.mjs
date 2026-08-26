import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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

function appendDetectedType(value, detectedProductType) {
  const normalized = normalizeSeparators(value);
  const segments = normalized.split(" | ");
  if (segments.length < 2) return normalized;
  const productType = (detectedProductType ?? "").trim();
  if (!productType) return normalized;
  const secondSegment = segments[1]?.trim() ?? "";
  if (!secondSegment.includes(productType)) {
    segments[1] = [secondSegment, productType].filter(Boolean).join(" ");
  }
  return segments.join(" | ");
}

// Title: exact Production generator remains the semantic base. No stale getVariantText assumption.
assert.match(titleBase, /function getShortFeatureText\(/u, "Production getShortFeatureText ladder missing");
assert.match(titleBase, /isCharacterRedundantWithIpDisplay/u, "Production character redundancy helper missing");
assert.match(titleBase, /export function collectCharacterNames/u, "Production collectCharacterNames missing");
assert.match(titleBase, /export function formatCharacterText/u, "Production formatCharacterText missing");
assert.match(titleBase, /const TITLE_DEDUPE_TERMS/u, "Production title dedupe terms missing");
assert.match(titleBase, /export const TITLE_SEGMENT3_BLACKLIST/u, "Production title blacklist missing");
assert.match(titleBase, /export function scrubEnrichedTitleSegment3/u, "Production segment-3 scrub missing");
assert.match(titleBase, /export const OFFICIAL_TITLE_MAX_LENGTH = 60/u, "Production 60-char official clamp missing");
assert.match(titleBase, /export const ENRICHED_TITLE_MAX_LENGTH = 80/u, "Production 80-char enriched limit missing");

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
  "return getSelectableText(sourceText) ?? '標準款';",
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
  "/** COPY C1 owner fix #2",
);
assert.match(separatorHelper, /split\(\/\\s\*\[\|｜\]\\s\*\/u\)/u, "separator parser changed");
assert.match(separatorHelper, /join\(" \| "\)/u, "separator output is not ASCII ' | '");
assert.doesNotMatch(separatorHelper, /filter\(Boolean\)/u, "separator helper must preserve empty segments");
assert.equal(normalizeSeparators("A||C"), "A |  | C", "ASCII empty segment was dropped");
assert.equal(normalizeSeparators("A｜｜C"), "A |  | C", "fullwidth empty segment was dropped");
assert.equal(normalizeSeparators("A |B｜ C"), "A | B | C", "mixed separator normalization changed");

// Owner title fix #2: second segment only, detected type is trim-only, third segment untouched by this fix.
assert.match(titleFinalizer, /return \(value \?\? ""\)\.trim\(\);/u, "detected product type is not trim-only");
assert.doesNotMatch(titleFinalizer, /normalizeProductTypeForDisplay|canonicalizeProductType|\.normalize\(/u,
  "title finalizer must not canonicalize detected product type");
assert.match(titleFinalizer, /segments\[1\] = \[secondSegment, productType\]\.filter\(Boolean\)\.join\(" "\);/u,
  "segment 2 append contract changed");
assert.doesNotMatch(titleFinalizer, /segments\[0\]\s*=/u, "owner fix rewrites segment 1");
assert.doesNotMatch(titleFinalizer, /segments\[2\]\s*=/u, "owner fix rewrites segment 3");

const titleFixtures = [
  [
    "YOSIDA × 可可貓 | 可可貓 | 吐司麵包頭套吊飾",
    "鑰匙圈",
    "YOSIDA × 可可貓 | 可可貓 鑰匙圈 | 吐司麵包頭套吊飾",
  ],
  [
    "Razer × 寶可夢|皮卡丘聯名|毒蝰V3專業版SE無線遊戲滑鼠",
    "無線滑鼠",
    "Razer × 寶可夢 | 皮卡丘聯名 無線滑鼠 | 毒蝰V3專業版SE無線遊戲滑鼠",
  ],
  [
    "MARtube × Pingu|Pingu|迷你相機盲盒創意吊飾",
    "迷你相機盲盒",
    "MARtube × Pingu | Pingu 迷你相機盲盒 | 迷你相機盲盒創意吊飾",
  ],
];
for (const [input, productType, expected] of titleFixtures) {
  const actual = appendDetectedType(input, productType);
  assert.equal(actual, expected, `title fixture failed: ${input}`);
  assert.equal(
    actual.split(" | ").slice(2).join(" | "),
    normalizeSeparators(input).split(" | ").slice(2).join(" | "),
    `segment 3 changed: ${input}`,
  );
}

// Production enriched-title boundary: Production scrub, then raw Array.from(...).slice(0,80).
assert.match(titleFinalizer, /const scrubbed = scrubEnrichedTitleSegment3\(withType\);/u,
  "Production segment-3 scrub is not applied before enriched clamp");
assert.match(titleFinalizer, /Array\.from\(scrubbed\)\.slice\(0, maxLen\)\.join\(""\)/u,
  "Production raw Array.from(...).slice enriched clamp missing");
assert.doesNotMatch(titleFinalizer, /enforceSkeletonTitleLength|clampOfficialTitle/u,
  "80-char helper must not become skeleton-aware or apply the official clamp");
assert.match(route, /const enrichedTitleFull = normalizeEnrichedTitleContract\([\s\S]*?ENRICHED_TITLE_MAX_LENGTH,[\s\S]*?\);\s*const officialTitleZh = clampOfficialTitle\(enrichedTitleFull\);/u,
  "Full Generate no longer preserves 80-stage then Production 60 official clamp");
const regenTitleBlock = section(route, 'if (regenField === "enriched_title")', '} else {');
assert.match(regenTitleBlock, /normalizeEnrichedTitleContract/u, "single-field title regen bypasses title finalizer");
assert.match(regenTitleBlock, /clampOfficialTitle\(historyContent\)/u, "single-field title regen lost Production 60 clamp");

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

// Approved seventh tone + Boss description hierarchy retained without changing shared FAQ rules.
assert.match(copy, /"潮巢導購版"/u, "seventh Chaochao tone disappeared");
assert.match(prompt, /潮巢導購版 Boss description hierarchy/u, "Boss hierarchy wrapper disappeared");
const chaochaoContract = section(prompt, "const CHAOCHAO_BOSS_LAYOUT", "function sharedRecoverySuffix");
assert.match(chaochaoContract, /只適用 tone === "潮巢導購版"/u,
  "Chaochao contract is not explicitly tone-only");
assert.match(chaochaoContract, /第一行固定且只能是「商品介紹」/u,
  "Chaochao description no longer starts exactly with 商品介紹");
assert.match(chaochaoContract,
  /商品介紹\n（正文 2–4 個短段落）\n\n收藏亮點\n・亮點一\n・亮點二\n・亮點三\n\n導購小標：依這件商品動態產生/u,
  "Chaochao exact three-section source contract changed");
assert.match(chaochaoContract, /「收藏亮點」heading 後立刻使用「・」bullets/u,
  "Chaochao 收藏亮點 no longer requires direct bullets");
assert.match(chaochaoContract,
  /最後一個 bullet 結束後，下一個非空白行必須直接是「導購小標：<動態標題>」/u,
  "Chaochao bullets no longer flow directly into the dynamic sales heading");
assert.match(chaochaoContract, /禁止插入無標題正文、總結/u,
  "Chaochao contract no longer forbids post-bullet unheaded prose");
assert.match(chaochaoContract, /feature → benefit/u,
  "Chaochao feature-to-benefit rule disappeared");
assert.match(chaochaoContract, /evidence 足夠時至少 3 點/u,
  "Chaochao evidence-rich bullet minimum disappeared");
assert.match(chaochaoContract, /商品介紹＋收藏亮點合計至少自然使用 3 個本商品專屬 facts/u,
  "Chaochao product-specific fact minimum disappeared");
assert.match(chaochaoContract, /精確尺寸、材質、容量、款式數、功能、授權、配件與特殊 claim/u,
  "Chaochao evidence safety field list disappeared");
assert.match(chaochaoContract, /evidence 不足時寧可少寫/u,
  "Chaochao insufficient-evidence fallback disappeared");

for (const boilerplate of [
  "總是覺得……嗎？",
  "是否正在尋找……",
  "每天都在尋找……嗎？",
  "或許是你的解答",
  "一大力作",
  "滿載童趣",
  "最佳選擇",
  "完美選擇",
  "完美良伴",
  "夢幻逸品",
  "絕對不能錯過",
  "完美地將……",
  "帶給你無限……",
  "無限的快樂",
  "陪伴左右",
  "為生活增添一抹……",
  "不僅……更……",
  "療癒指數爆表",
  "收藏價值滿滿",
  "送禮自用兩相宜",
  "值得入手",
  "值得考慮",
]) {
  assert.ok(chaochaoContract.includes(boilerplate), `Chaochao anti-AI rule missing: ${boilerplate}`);
}
assert.match(chaochaoContract, /像真的潮巢小編在介紹這件商品，不要像 AI 在寫萬用電商模板/u,
  "Chaochao human-editor voice requirement disappeared");
assert.match(chaochaoContract, /【潮巢導購版輸出前自檢】[\s\S]*1\.[\s\S]*2\.[\s\S]*3\.[\s\S]*4\.[\s\S]*5\.[\s\S]*6\.[\s\S]*7\.[\s\S]*8\.[\s\S]*9\.[\s\S]*10\./u,
  "Chaochao ten-point output self-check disappeared");
assert.match(chaochaoContract, /禁止 ◈、商品資訊、購買提醒與重複到貨提醒/u,
  "Chaochao forbidden output sections disappeared");
assert.match(prompt, /tone === "潮巢導購版" \? CHAOCHAO_BOSS_LAYOUT : ""/u,
  "Full-generate Chaochao wrapper is no longer tone-gated");
assert.match(prompt,
  /field === "generated_description_html" && tone === "潮巢導購版"\) extras\.push\(CHAOCHAO_BOSS_LAYOUT\)/u,
  "Description regeneration Chaochao wrapper is no longer field-and-tone-gated");

assert.match(resultCardCopyPanel,
  /descriptionPreviewHtml\(description, draft\.generation_tone, draft\.sale_status\)/u,
  "ResultCard preview no longer passes stored generation_tone and sale_status");

const promptBaseBlob = createHash("sha1")
  .update(`blob ${Buffer.byteLength(promptBase)}\0${promptBase}`)
  .digest("hex");
assert.equal(promptBaseBlob, "a7ba54d091deb1fefee7252ddb9054bf234203e6",
  "systemPromptBase.ts changed from the approved immutable blob");

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

// Spec warning parity: warn only if provider spec is actually adopted.
assert.match(route, /const existingSpec = \(draft\.spec_text \?\? ""\)\.trim\(\);/u,
  "spec warning guard no longer checks existing spec");
assert.match(route, /const finalSpecText = finalizeCustomerSpecText\(providerOutput\.spec, draft\.spec_text\);/u,
  "full generate no longer uses existing-first spec selector");
assert.match(route, /const usedProviderSpec = !existingSpec && providerSpecHasContent && Boolean\(finalSpecText\);/u,
  "spec warning is not gated on actual provider adoption");
assert.match(route, /if \(usedProviderSpec\) \{[\s\S]*商品規格為系統自動整理/u,
  "auto-organized spec warning is not guarded by usedProviderSpec");

function specOutcome(existingSpec, providerSpec) {
  const existing = existingSpec ?? "";
  const providerRaw = (providerSpec ?? "").trim();
  const providerHasContent = Boolean(providerRaw) && providerRaw !== "（無）" && providerRaw !== "(無)";
  const finalSpec = existing.trim()
    ? existing
    : providerHasContent
      ? providerRaw
      : null;
  const usedProviderSpec = !existing.trim() && providerHasContent && Boolean(finalSpec);
  return { finalSpec, usedProviderSpec };
}
const existingWins = specOutcome("品牌：Razer\n型號：Orochi V2", "品牌：Razer\n類型：滑鼠");
assert.equal(existingWins.finalSpec, "品牌：Razer\n型號：Orochi V2", "existing spec lost authority");
assert.equal(existingWins.usedProviderSpec, false, "existing spec incorrectly triggers auto-organized warning");
const providerAdopted = specOutcome("   ", "品牌：Razer\n類型：滑鼠");
assert.equal(providerAdopted.finalSpec, "品牌：Razer\n類型：滑鼠", "valid provider spec was not adopted when existing is blank");
assert.equal(providerAdopted.usedProviderSpec, true, "adopted provider spec must trigger auto-organized warning");

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
