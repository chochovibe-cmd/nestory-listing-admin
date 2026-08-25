import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function gitBlobSha(file) {
  const body = fs.readFileSync(path.join(ROOT, file));
  const header = Buffer.from(`blob ${body.length}\0`, "utf8");
  return crypto.createHash("sha1").update(header).update(body).digest("hex");
}

function sliceSourceBlock(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label} source start missing`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `${label} source end missing`);
  return source.slice(start, end);
}

const copy = read("src/lib/providers/copy.ts");
const prompt = read("src/lib/providers/systemPrompt.ts");
const workspace = read("src/components/listing/WorkspaceInputPanel.tsx");
const titleGenerator = read("src/lib/contentGenerator/titleGenerator.ts");
const htmlFormat = read("src/lib/contentGenerator/htmlFormat.ts");
const notice = read("src/lib/contentGenerator/saleStatusNotice.ts");
const payload = read("src/lib/shopify/payload.ts");
const route = read("src/app/api/generate/route.ts");
const finalizer = read("src/lib/providers/customerFacingFinalizer.ts");
const ipToneMap = read("src/lib/providers/ipToneMap.ts");
const resultCard = read("src/components/listing/ResultCard.tsx");
const analyzeRoute = read("src/app/api/analyze-images/route.ts");
const visionProvider = read("src/lib/providers/visionProvider.ts");
const visionBridge = read("src/lib/images/fullGenerateVision.ts");
const evidencePack = read("src/lib/providers/productEvidencePack.ts");

// COPY C1 base contract still exists.
assert.match(copy, /"潮巢導購版"/u);
assert.match(workspace, /value:\s*"潮巢導購版"[\s\S]{0,180}emoji:\s*"🛍️"[\s\S]{0,180}desc:\s*"痛點導購・資訊完整"[\s\S]{0,120}usesEmoji:\s*true/u);
assert.match(workspace, /const DEFAULT_TONE = TONE_OPTIONS\[0\]\.value;/u);
const defaultMapSource = sliceSourceBlock(
  ipToneMap,
  "export const DEFAULT_IP_TONE_MAP",
  "\n/** Concrete tones only",
  "DEFAULT_IP_TONE_MAP",
);
assert.ok(!defaultMapSource.includes("潮巢導購版"), "manual C1 tone must not become an auto-map target");

// ---------------------------------------------------------------------------
// Fixture 1 — title contract bug: normalize all pipes + force product type into segment 2.
// ---------------------------------------------------------------------------
function normalizePipes(value) {
  return value.normalize("NFKC").split(/\s*[|｜]\s*/u).map((part) => part.trim()).filter(Boolean).join(" | ");
}
function titleFixtureNormalize(value, productType, max = 80) {
  const parts = normalizePipes(value).split(" | ");
  const seg1 = parts[0] ?? "";
  let seg2 = parts[1] ?? "";
  let seg3 = parts.slice(2).join(" | ");
  if (productType && !seg2.includes(productType)) seg2 = `${seg2} ${productType}`.trim();
  if (productType) seg3 = seg3.split(productType).join(" ").replace(/\s{2,}/g, " ").trim();
  for (const banned of ["生日禮物", "送禮首選", "最佳選擇", "送禮推薦", "熱賣", "爆款", "必買", "超值", "限時"]) {
    seg3 = seg3.split(banned).join("");
  }
  let out = [seg1, seg2, seg3 || "標準款"].filter(Boolean).join(" | ");
  if (Array.from(out).length > max) out = Array.from(out).slice(0, max).join("");
  return out;
}

const llmTitle = "MARtube × Pingu|Pingu|迷你相機盲盒創意吊飾";
const normalizedTitle = titleFixtureNormalize(llmTitle, "盲盒", 80);
assert.ok(normalizedTitle.startsWith("MARtube × Pingu | "), "segment 1 must remain brand × IP");
assert.equal(normalizedTitle.split(" | ")[1], "Pingu 盲盒", "segment 2 must be character + product type");
assert.ok(!normalizedTitle.includes("Pingu|Pingu"), "bare pipe duplicate must be gone");
assert.ok(!normalizedTitle.includes("｜"), "fullwidth pipe must be gone");
assert.ok(Array.from(normalizedTitle).length <= 80);
for (const raw of ["A｜B｜C", "A | B | C", "A|B|C"]) {
  assert.equal(normalizePipes(raw), "A | B | C", `separator normalization failed: ${raw}`);
}

assert.match(titleGenerator, /function splitTitlePipeSegments/u, "shared pipe parser missing");
assert.match(titleGenerator, /split\(\/\\s\*\[\|｜\]\\s\*\/u\)/u, "bare/fullwidth pipe parser missing");
assert.match(titleGenerator, /export function normalizeEnrichedTitleContract/u, "deterministic title finalizer missing");
assert.match(titleGenerator, /productBrand \? productBrand \+ ' × ' \+ ipDisplayName : ipDisplayName/u, "first segment brand × IP contract changed");
assert.match(route, /buildStructuredEnrichedTitle\([\s\S]*structuredBaseTitle:\s*ruleOutput\.display_title[\s\S]*featureText:/u, "full generate must assemble title from structured base and feature-only AI text");
assert.match(route, /buildStructuredEnrichedTitle\([\s\S]*structuredBaseTitle:\s*currentValues\.enrichedTitle\s*\|\|\s*draft\.title_zh[\s\S]*productType:/u, "title regen must preserve cached structured segments");
assert.match(titleGenerator, /TITLE_SEGMENT3_BLACKLIST/u, "third-segment blacklist disappeared");

// ---------------------------------------------------------------------------
// Fixture 2 — Boss Shopify semantic hierarchy for 潮巢導購版 only.
// ---------------------------------------------------------------------------
const c1Plain = [
  "商品介紹",
  "包包今天是不是安靜得有點過分？那就派 Pingu 出門值班。",
  "MARtube 的 Pingu 迷你相機盲盒做成吊飾造型，讓角色自然跟著包包出門。",
  "",
  "收藏亮點",
  "・Pingu 角色造型：包包多一個一眼認得的角色焦點",
  "・迷你相機主題：造型有梗，但不假裝真的能拍照",
  "・盲盒玩法：拆盒前保留一點未知感",
  "",
  "導購小標：今天換 Pingu 掌鏡",
  "想讓每天背的包有點新戲份，這顆剛好負責把 Pingu 帶出門。",
].join("\n");

function bossHtmlFixture(text, noticeText) {
  const lines = text.split(/\r?\n/);
  const intro = [];
  const bullets = [];
  const sales = [];
  let heading = "";
  let mode = "intro";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line === "商品介紹") continue;
    if (line === "收藏亮點") { mode = "bullets"; continue; }
    const m = line.match(/^(?:導購小標|導購標題)\s*[：:]\s*(.+)$/u);
    if (m) { heading = m[1]; mode = "sales"; continue; }
    if (mode === "bullets") bullets.push(line.replace(/^[・･•]\s*/u, ""));
    else if (mode === "sales") sales.push(line);
    else intro.push(line);
  }
  return `<h2>商品介紹</h2><p>${noticeText}</p>` +
    intro.map((p) => `<p>${p}</p>`).join("") +
    `<h2>收藏亮點</h2><ul>${bullets.map((b) => `<li>${b}</li>`).join("")}</ul>` +
    `<h2>${heading}</h2>` + sales.map((p) => `<p>${p}</p>`).join("");
}

const bossHtml = bossHtmlFixture(c1Plain, "此為海外代購商品，預估約 14 天。");
assert.equal((bossHtml.match(/<h2>/g) ?? []).length, 3, "C1 main description must have exactly 3 H2s");
assert.ok(bossHtml.indexOf("<h2>商品介紹</h2>") < bossHtml.indexOf("此為海外代購商品"));
assert.ok(bossHtml.indexOf("此為海外代購商品") < bossHtml.indexOf("<h2>收藏亮點</h2>"));
assert.ok(bossHtml.includes("<h2>今天換 Pingu 掌鏡</h2>"), "third H2 must be dynamic");
assert.ok(!bossHtml.includes("◈"));
assert.ok(!bossHtml.includes("<h3"));
assert.ok(!bossHtml.includes("<h2>商品資訊</h2>"));
assert.ok(!bossHtml.includes("<h2>購買提醒</h2>"));

assert.match(htmlFormat, /export function formatChaochaoSalesDescriptionHtml/u);
assert.match(htmlFormat, /`<h2>商品介紹<\/h2>`[\s\S]*saleStatusNoticeHtml[\s\S]*`<h2>收藏亮點<\/h2>`[\s\S]*`<h2>\$\{escapeHtml\(dynamicHeading\)\}<\/h2>`/u);
assert.match(htmlFormat, /formatPlainTextAsHtml[\s\S]*<h3><strong>◈/u, "original six-tone formatter must remain h3-based");
assert.match(htmlFormat, /looksLikeChaochaoSalesSource/u, "Nestory preview must recognize C1 source hierarchy");
const chaochaoFormatterSource = sliceSourceBlock(
  htmlFormat,
  "export function formatChaochaoSalesDescriptionHtml",
  "\nexport function descriptionPreviewHtml",
  "C1 formatter",
);
assert.doesNotMatch(chaochaoFormatterSource, /font-size|style=/u, "C1 main formatter must not hard-code typography");
assert.match(payload, /generation_tone === CHAOCHAO_SALES_TONE[\s\S]*formatChaochaoSalesDescriptionHtml/u, "Shopify payload must use C1 boundary formatter");
assert.match(payload, /:\s*saleStatusNoticeHtml\([\s\S]*\+ formatPlainTextAsHtml/u, "original six tones must keep legacy payload formatter");

for (const expected of [
  "此為海外代購商品，預估約 14 天。",
  "此為預購商品，到貨時程以頁面說明為準。",
  "此為台灣現貨商品，約 1–3 個工作天出貨。",
  "此為二手現貨商品，品況請見商品資訊，約 1–3 個工作天出貨。",
]) assert.ok(notice.includes(expected), `missing C1 notice: ${expected}`);

// Human voice / no competitor few-shot / no obsolete C1 sections.
for (const phrase of [
  "總是覺得……嗎？", "是否正在尋找……", "一大力作", "滿載童趣",
  "絕對不能錯過", "完美地將", "陪伴左右", "為生活增添一抹",
  "療癒指數爆表", "收藏價值滿滿", "送禮自用兩相宜", "值得入手", "值得考慮",
  "裝備／覺醒／戰力／召喚", "Pingu 出門值班",
]) assert.ok(prompt.includes(phrase), `anti-AI/human voice contract missing: ${phrase}`);
assert.match(prompt, /不保存、不模仿、不照抄/u);
assert.match(prompt, /禁止出現 ◈/u);
assert.match(prompt, /不要輸出「商品資訊」section/u);
assert.match(prompt, /不要輸出「購買提醒」section/u);

// ---------------------------------------------------------------------------
// Fixture 3 — Taiwan Traditional + customer spec cleanup.
// ---------------------------------------------------------------------------
function traditionalFixture(value) {
  return value
    .replaceAll("马克图布", "馬克圖布")
    .replaceAll("随机", "隨機")
    .replaceAll("分类", "分類")
    .replaceAll("货品", "貨品")
    .replaceAll("颜色", "顏色")
    .replaceAll("适用", "適用")
    .replaceAll("人群", "人群")
    .replaceAll("是否为", "是否為")
    .replaceAll("特殊用途化妆品", "特殊用途化妝品")
    .replaceAll("流行趋势词", "流行趨勢詞")
    .replaceAll("可爱", "可愛");
}
function specFixture(raw) {
  const text = traditionalFixture(raw);
  const useful = [];
  let random = false;
  let noChoice = false;
  for (const line of text.split("\n")) {
    const [label, ...rest] = line.split(/[:：]/u);
    const value = rest.join("：").replace(/[【】]/g, "").trim();
    if (label === "品牌") useful.push(`品牌：${value}`);
    if (["分類", "貨品分類", "顏色分類", "適用人群", "是否為特殊用途化妝品", "流行趨勢詞"].includes(label)) {
      if (/隨機/u.test(value)) random = true;
      if (/盲盒/u.test(value) && /不可指定/u.test(value)) noChoice = true;
    }
  }
  if (random || noChoice) useful.push(`盲盒方式：${random && noChoice ? "隨機出貨，不可指定款式" : random ? "隨機出貨" : "不可指定款式"}`);
  return useful.join("\n");
}

const rawSpec = [
  "分类：【盲盒不可指定】",
  "品牌：MARtube/马克图布",
  "颜色分类：【随机1个】",
  "适用人群：女生",
  "是否为特殊用途化妆品：否",
  "流行趋势词：可爱",
].join("\n");
const cleanSpec = specFixture(rawSpec);
assert.ok(cleanSpec.includes("品牌：MARtube/馬克圖布"));
assert.ok(cleanSpec.includes("盲盒方式：隨機出貨，不可指定款式"));
for (const junk of ["分類：", "貨品分類", "顏色分類", "適用人群", "特殊用途化妝品", "流行趨勢詞"]) {
  assert.ok(!cleanSpec.includes(junk), `backend junk leaked: ${junk}`);
}
assert.ok(!/\d/.test(cleanSpec), "cleanup must not fabricate numeric spec");

assert.match(finalizer, /export function mergeCustomerSpecEvidence/u, "C1.4 evidence merge missing");
assert.match(finalizer, /localizeToTaiwanTraditionalText/u);
assert.match(finalizer, /BACKEND_ONLY_SPEC_LABELS/u);
assert.match(finalizer, /factsByLabel\.set\("盲盒方式", \{ label: "盲盒方式", value: rule/u);
assert.match(route, /mergeCustomerSpecEvidence\(\{[\s\S]*existingSpec:\s*draft\.spec_text[\s\S]*providerSpec:\s*providerOutput\.spec/u);
assert.match(route, /cleanedWhyWeChoseIt = finalizeCustomerText\(providerOutput\.whyWeChoseIt\)/u);
assert.match(route, /cleanedProductHighlights = finalizeCustomerTextList\(providerOutput\.productHighlights\)/u);
assert.match(route, /localizedOutput\.generated_faq_html = finalizeCustomerText/u);
assert.match(route, /localizedOutput\.seo_title = finalizeCustomerText/u);
assert.match(route, /localizedOutput\.meta_description = finalizeCustomerText/u);

// Raw evidence columns are read-only in this generate update; they may remain Simplified.
const draftUpdateBlock = sliceSourceBlock(
  route,
  "const draftUpdate: Record<string, unknown> = {",
  "\n\n  if (detectedBrand)",
  "draftUpdate",
);
assert.doesNotMatch(draftUpdateBlock, /taobao_title\s*:|original_title\s*:/u, "raw source fields must not be overwritten");

// Single-field regen must not mutate spec_text.
const regenMapBlock = sliceSourceBlock(
  route,
  "const REGEN_FIELD_TO_COLUMN",
  "\n\nasync function handleFieldRegen",
  "REGEN_FIELD_TO_COLUMN",
);
assert.ok(!regenMapBlock.includes("spec_text"), "single-field map must not contain spec_text");
const regenBodyBlock = sliceSourceBlock(
  route,
  "async function handleFieldRegen",
  "\n\nasync function writeImageAltTexts",
  "handleFieldRegen",
);
assert.doesNotMatch(regenBodyBlock, /update\.spec_text|spec_text\s*:/u, "single-field regen must not write spec_text");

// P4 safety remains live after prompt rewrite.
for (const phrase of ["P4 出處標記禁令", "網路搜尋補充資訊（B19", "不確定就不寫", "P4 賣家服務類排除", "物理事實"]) {
  assert.ok(prompt.includes(phrase), `P4 prompt contract missing: ${phrase}`);
}

// ---------------------------------------------------------------------------
// COPY C1.2 — structured title, classification, prewrite, evidence, anti-AI.
// ---------------------------------------------------------------------------
function structuredTitleFixture({ brand, ip, characters, productType, featureText }) {
  const seg1 = brand && ip ? `${brand} × ${ip}` : (ip || brand || "");
  const chars = characters.length >= 3
    ? characters.slice(0, 3).join("・") + (characters.length > 3 ? "等角色" : "")
    : characters.join("・");
  const seg2 = [chars, productType].filter(Boolean).join(" ");
  const seg3 = featureText || "標準款";
  return [seg1, seg2, seg3].filter(Boolean).join(" | ");
}
const pinguC12 = structuredTitleFixture({
  brand: "MARtube", ip: "Pingu", characters: ["Pingu"],
  productType: "迷你相機盲盒", featureText: "創意吊飾",
});
assert.equal(pinguC12.split(" | ")[0], "MARtube × Pingu");
assert.equal(pinguC12.split(" | ")[1], "Pingu 迷你相機盲盒");

const kirarunC12 = structuredTitleFixture({
  brand: "KIRARUN", ip: "吉伊卡哇", characters: ["烏薩奇", "小八", "吉伊"],
  productType: "絨毛公仔吊飾", featureText: "車伕造型",
});
assert.equal(kirarunC12.split(" | ")[0], "KIRARUN × 吉伊卡哇");
assert.equal(kirarunC12.split(" | ")[1], "烏薩奇・小八・吉伊 絨毛公仔吊飾");
assert.ok(!kirarunC12.startsWith("KIRARUN |"), "brand must not impersonate IP");

assert.match(titleGenerator, /export function buildStructuredEnrichedTitle/u);
const structuredTitleBlock = sliceSourceBlock(
  titleGenerator,
  "export function buildStructuredEnrichedTitle",
  "\n\n/**\n * COPY C1.1 deterministic",
  "structured title helper",
);
assert.match(structuredTitleBlock, /brand && ip \? .* × .* : \(ip \|\| brand\)/u);
assert.match(structuredTitleBlock, /formatCharacterText/u);
assert.match(structuredTitleBlock, /featureCandidateFromTitle/u);
assert.match(structuredTitleBlock, /ENRICHED_TITLE_MAX_LENGTH/u);
assert.match(prompt, /品牌有值而 IP 未確認時，IP 必須保持空白/u);
assert.match(prompt, /禁止把品牌複製成 IP/u);

for (const field of [
  "product_facts", "usage_scenarios", "consumer_desires", "consumer_pain_points",
  "ip_character_hooks", "purchase_reasons", "humor_angles",
]) assert.ok(prompt.includes(field), `prewrite field missing: ${field}`);
for (const evidence of ["原始標題", "Variant／款式", "規格與 OCR", "圖片描述", "網路搜尋摘要", "IP knowledge"]) {
  assert.ok(prompt.includes(evidence), `evidence pool source missing: ${evidence}`);
}
assert.match(prompt, /const coverage = copyLength === "詳細" \? "4–6" : "至少 3"/u);
assert.match(prompt, /商品介紹＋收藏亮點必須實際使用\$\{coverage\} 個商品獨有 facts/u);
assert.match(titleGenerator, /characters\.length <= 3.*join\('・'\)/u);
assert.match(prompt, /具體 usage scenario＋對應 consumer desire 或 consumer pain point＋商品具體 facts/u);
assert.match(prompt, /IP\/character\/humor hook/u);
assert.match(prompt, /可信同款具體資訊優先納入 product_facts/u);
assert.match(prompt, /cached 網路搜尋 evidence/u);
assert.match(prompt, /只重生第三段 feature candidate/u);
assert.match(prompt, /既有 structured brand／IP／characters／productType.*不可重猜/u);

// Three quality families must be structurally different, not character-name swaps.
const qualityFixtures = [
  { kind: "Pingu 相機吊飾", scenario: "掛在每天出門的包包", pain: "包包太安靜", hook: "Pingu 出門值班", facts: ["Pingu", "迷你相機造型", "盲盒"] },
  { kind: "吉伊卡哇絨毛吊飾", scenario: "角色群一起掛上包包", pain: "想把小劇場帶出門", hook: "三位角色同框", facts: ["烏薩奇", "小八", "吉伊"] },
  { kind: "電子桌面商品", scenario: "工作桌需要功能也需要氣氛", pain: "桌面功能齊了但少一點存在感", hook: "功能優先，不硬套角色台詞", facts: ["電源", "連線", "燈效"] },
];
assert.equal(new Set(qualityFixtures.map((item) => item.scenario)).size, 3);
assert.equal(new Set(qualityFixtures.map((item) => item.pain)).size, 3);
for (const fixture of qualityFixtures) {
  assert.ok(fixture.scenario && fixture.pain && fixture.facts.length >= 3, `quality fixture incomplete: ${fixture.kind}`);
}

// ---------------------------------------------------------------------------
// COPY C1.3 — regression recovery: SKU authority, title recovery, base safety.
// ---------------------------------------------------------------------------
function skuAuthorityFixture(draftSku, rawSku, generatedSku) {
  void rawSku;
  return draftSku?.trim() || generatedSku;
}
assert.equal(
  skuAuthorityFixture("CHO-BBX-PNG-PNG-001", "Pingu相機盲盒", "CHO-OTH-ABC-DEF-001"),
  "CHO-BBX-PNG-PNG-001",
  "existing Nestory SKU must survive full generation",
);
assert.equal(
  skuAuthorityFixture(null, "Pingu相機盲盒", "CHO-BLD-PNG-PNG-001"),
  "CHO-BLD-PNG-PNG-001",
  "empty draft SKU must use generateSku result",
);
assert.match(route, /import \{ generateSku \} from "@\/lib\/contentGenerator\/sku"/u);
assert.match(route, /const persistedSku = draft\.sku\?\.trim\(\) \|\| generateSku\(/u);
assert.match(route, /sku:\s*persistedSku/u);
assert.doesNotMatch(route, /sku:\s*raw\.sku/u, "provider/raw SKU must not become authority");
assert.doesNotMatch(regenMapBlock, /sku/u, "single-field regen map must not touch SKU");
assert.doesNotMatch(regenBodyBlock, /update\.sku|sku\s*:/u, "single-field regen must not write SKU");
assert.match(payload, /const sku = draft\.sku\?\.trim\(\) \|\| generatedSku/u, "Shopify must share persisted/generateSku authority");
assert.match(payload, /variantSeed:\s*\{[\s\S]*\.\.\.generatedVariantSeed,\s*sku\s*\}/u, "generated payload must not override authoritative SKU");

assert.doesNotMatch(titleGenerator, /isCharacterRedundantWithIpDisplay/u, "canonical character must survive even when IP display contains it");
assert.match(titleGenerator, /'吊飾'.*'盲盒'.*'娃娃'.*'公仔'/u, "global title dedupe tokens missing");
const lengthFinalizerBlock = sliceSourceBlock(
  titleGenerator,
  "export function enforceSkeletonTitleLength",
  "\n\nfunction enforceTitleLength",
  "title length finalizer",
);
assert.match(lengthFinalizerBlock, /dedupeRepeatedTitleTerms\(seg1\)/u);
assert.match(lengthFinalizerBlock, /dedupeRepeatedTitleTerms\(seg2\)/u);
assert.match(lengthFinalizerBlock, /dedupeRepeatedTitleTerms\(seg3\)/u);
assert.match(titleGenerator, /LOW_VALUE_TITLE_FEATURES/u);
for (const low of ["隨機款", "標準款", "款式可選", "多款可選", "一般款"]) {
  assert.ok(titleGenerator.includes(`'${low}'`), `low-value title fallback missing: ${low}`);
}
assert.match(titleGenerator, /rankTitleFeatureCandidates\(\[/u);
function rankFeatureFixture(candidates) {
  const low = new Set(["隨機款", "標準款", "款式可選", "多款可選", "一般款"]);
  return candidates.find((value) => value && !low.has(value)) ?? candidates.find(Boolean) ?? "";
}
assert.equal(rankFeatureFixture(["隨機款", "迷你相機造型"]), "迷你相機造型");
for (const duplicated of ["吊飾吊飾", "盲盒盲盒", "公仔公仔", "娃娃娃娃"]) {
  const token = duplicated.slice(0, duplicated.length / 2);
  assert.equal(duplicated.split(token + token).join(token), token);
}
assert.equal(pinguC12.split(" | ")[1], "Pingu 迷你相機盲盒");
assert.match(titleGenerator, /productBrand \? productBrand \+ ' × ' \+ ipDisplayName : ipDisplayName/u);

assert.match(prompt, /FAQ GEO standalone-answer contract/u);
for (const phrase of ["如上所述", "如前面提到", "如圖所示"]) {
  assert.ok(prompt.includes(phrase), `FAQ standalone prohibition missing: ${phrase}`);
}
assert.match(prompt, /Tags \/ Collections authority boundary/u);
assert.match(prompt, /AI 只負責 classification 與 copy/u);
assert.match(prompt, /正式 Tags／Collections 一律由 backend rules/u);
assert.match(prompt, /AI 不擁有 SKU authority/u);
assert.match(prompt, /全域安全禁詞/u);

// ---------------------------------------------------------------------------
// COPY C1.4 — Vision bridge, ONE Evidence Pack, and evidence-preserving specs.
// ---------------------------------------------------------------------------
const workspaceFullGenerate = sliceSourceBlock(
  workspace,
  "async function submit(event",
  "\n  return (",
  "Workspace full generate",
);
assert.ok(
  workspaceFullGenerate.indexOf("prepareVisionEvidenceForFullGenerate(id)") <
    workspaceFullGenerate.indexOf('fetch("/api/generate"'),
  "new-product full generate must run analyze bridge before copy",
);
const resultFullRegenerate = sliceSourceBlock(
  resultCard,
  "async function regenerate()",
  "\n\n  /** R2/R3",
  "ResultCard full regenerate",
);
assert.ok(
  resultFullRegenerate.indexOf("prepareVisionEvidenceForFullGenerate(draft.id)") <
    resultFullRegenerate.indexOf('fetch("/api/generate"'),
  "ResultCard full regenerate must run analyze bridge before copy",
);
assert.match(resultFullRegenerate, /imageWarnings/u, "Vision warnings must reach generate");
assert.ok(
  !regenBodyBlock.includes("prepareVisionEvidenceForFullGenerate"),
  "single-field regen must never trigger Vision",
);
assert.ok(
  visionBridge.includes("圖片辨識未成功，本次文案未使用詳情圖資訊"),
  "Vision failure warning must be honest",
);
assert.match(visionBridge, /if \(!response\.ok\) return \[failureWarning\(payload\)\]/u);
assert.match(visionBridge, /catch \{[\s\S]*return \[VISION_EVIDENCE_MISSING_WARNING\]/u);

const cacheGuard = sliceSourceBlock(
  analyzeRoute,
  "const cacheIsCurrent =",
  "\n\n  const describeUrls",
  "Vision cache guard",
);
assert.match(cacheGuard, /VISION_STATUS_FLAG_KEY.*=== "done"/u);
assert.match(cacheGuard, /VISION_SOURCE_FINGERPRINT_FLAG_KEY.*=== sourceFingerprint/u);
assert.match(cacheGuard, /cached: true/u);
assert.match(analyzeRoute, /selectRepresentativeVisionImages\(candidates\)/u);
assert.match(analyzeRoute, /image_description: null/u, "removing all images must clear stale aggregate evidence");
assert.doesNotMatch(analyzeRoute, /spec_text\s*:/u, "Vision route must never write manual spec_text");
assert.doesNotMatch(analyzeRoute, /image_status\s*:/u, "Vision route must not enter image pipeline");

function evenlySpacedFixture(items, count) {
  if (items.length <= count) return [...items];
  if (count === 1) return [items[0]];
  return Array.from({ length: count }, (_, index) =>
    items[Math.round((index * (items.length - 1)) / (count - 1))]);
}
const sampledDetails = evenlySpacedFixture(
  Array.from({ length: 12 }, (_, index) => `detail-${index + 1}`),
  5,
);
assert.equal(sampledDetails.length, 5);
assert.equal(sampledDetails[0], "detail-1");
assert.equal(sampledDetails.at(-1), "detail-12");
assert.ok(sampledDetails.some((value) => ["detail-6", "detail-7"].includes(value)));
assert.match(visionProvider, /export const MAX_DESCRIBE_IMAGES = 6/u);
assert.match(visionProvider, /export function selectRepresentativeVisionImages/u);
assert.match(visionProvider, /evenlySpaced\(details/u);
assert.match(visionProvider, /return selected\.slice\(0, safeCap\)/u);

function chooseImageTextFixture(row) {
  return row.translated_text?.trim() || row.ocr_text?.trim() || null;
}
assert.equal(chooseImageTextFixture({ translated_text: "繁中尺寸：10cm", ocr_text: "简中尺寸：10cm" }), "繁中尺寸：10cm");
assert.equal(chooseImageTextFixture({ translated_text: "", ocr_text: "材質：塑膠" }), "材質：塑膠");
assert.equal(chooseImageTextFixture({ translated_text: null, ocr_text: null }), null);
for (const section of [
  "classification", "raw_product_text", "variant_facts", "image_facts",
  "image_visible_text", "existing_specs", "web_product_facts", "ip_context",
]) assert.ok(evidencePack.includes(section), `Evidence Pack section missing: ${section}`);
assert.match(evidencePack, /translated_text\?\.trim\(\)[\s\S]*ocr_text\?\.trim\(\)/u);
assert.match(evidencePack, /IP／角色語境（不可作商品數字來源）/u);
assert.match(route, /const evidencePack = buildProductEvidencePack\(/u);
assert.match(route, /evidencePackText,/u, "CopyProvider must receive the built pack");
assert.match(prompt, /ONE PRODUCT EVIDENCE PACK/u);
assert.match(prompt, /來源同 key 衝突時不要自行挑值/u);

function mergeSpecFixture(existing, provider) {
  const aliases = new Map([["商品材質", "材質"], ["主要材質", "材質"]]);
  const junk = new Set(["適用人群", "特殊用途化妝品", "流行趨勢詞", "店鋪服務", "銷量", "優惠券", "包郵"]);
  const facts = new Map();
  for (const [source, text] of [["existing", existing], ["provider", provider]]) {
    for (const line of text.split("\n")) {
      const [rawLabel, ...rest] = line.split(/[:：]/u);
      const label = aliases.get(rawLabel) ?? rawLabel;
      const value = rest.join("：").trim();
      if (!label || !value || junk.has(label)) continue;
      if (source === "existing" || !facts.has(label)) facts.set(label, value);
    }
  }
  return [...facts].map(([label, value]) => `${label}：${value}`).join("\n");
}
const mergedSpec = mergeSpecFixture(
  "尺寸：10cm\n商品材質：塑膠",
  "品牌：MARtube\n尺寸：約10cm\n內容物：掛鏈",
);
for (const line of ["尺寸：10cm", "材質：塑膠", "品牌：MARtube", "內容物：掛鏈"]) {
  assert.ok(mergedSpec.includes(line), `spec merge lost: ${line}`);
}
assert.ok(!mergedSpec.includes("尺寸：約10cm"), "provider must not overwrite clean manual size");
const junkSpec = mergeSpecFixture(
  "適用人群：女生\n特殊用途化妝品：否\n流行趨勢詞：可愛\n品牌：MARtube",
  "",
);
assert.equal(junkSpec, "品牌：MARtube");
const richSpec = mergeSpecFixture(
  "品牌：MARtube\nIP：Pingu\n系列：生活小劇場\n角色：Pingu\n材質：塑膠\n尺寸：10cm",
  "內容物：迷你相機吊飾＋掛鏈\n盲盒方式：隨機出貨／不可指定",
);
assert.ok(richSpec.split("\n").length >= 8, "rich evidence must not collapse to 3–4 lines");
assert.match(finalizer, /protectedSources = new Set<SpecSource>\(\["existing", "classification", "variant"\]\)/u);
assert.match(finalizer, /規格「\$\{fact\.label\}」來源衝突，已略過待人工確認/u);
assert.match(finalizer, /derivedUsageScenario/u);
assert.match(finalizer, /商品材質.*材質/u);
assert.match(finalizer, /主要材質.*材質/u);
assert.match(finalizer, /使用方式.*使用情境/u);
assert.match(finalizer, /factsByLabel/u, "spec merge must retain multiple evidence keys");

// Lifecycle/safety files remain byte-identical to the pre-C1.1 authority.
const FROZEN_BLOBS = {
  "src/lib/shopify/productLifecycle.ts": "a7e6b2bbe851aeae12c797be583f0cd64fd1789c",
  "src/lib/shopify/publishDraftSafe.ts": "0d9a992802ca1c165587a785daff9c544d6c8821",
  "src/lib/shopify/runPublishBatch.ts": "a89cb43df865c1f1cf7661c9575988ef37900445",
  "scripts/verify-shopify-lifecycle-safety.mjs": "20025dccc07d3c1aa6494b3dfed8a52c68185640",
};
for (const [file, expected] of Object.entries(FROZEN_BLOBS)) {
  assert.equal(gitBlobSha(file), expected, `Shopify lifecycle scope freeze violated: ${file}`);
}

console.log("COPY C1.4 evidence + spec foundation verifier passed");
