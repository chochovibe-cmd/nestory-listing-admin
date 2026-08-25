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

// COPY C1 base contract still exists.
assert.match(copy, /"潮巢導購版"/u);
assert.match(workspace, /value:\s*"潮巢導購版"[\s\S]{0,180}emoji:\s*"🛍️"[\s\S]{0,180}desc:\s*"痛點導購・資訊完整"[\s\S]{0,120}usesEmoji:\s*true/u);
assert.match(workspace, /const DEFAULT_TONE = TONE_OPTIONS\[0\]\.value;/u);
const defaultMapMatch = ipToneMap.match(/DEFAULT_IP_TONE_MAP[\s\S]*?=\s*\{([\s\S]*?)\n\};/u);
assert.ok(defaultMapMatch && !defaultMapMatch[1].includes("潮巢導購版"), "manual C1 tone must not become an auto-map target");

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
assert.match(route, /normalizeEnrichedTitleContract\([\s\S]*detected\.productType/u, "full generate must normalize LLM title with detected product type");
assert.match(route, /normalizeEnrichedTitleContract\([\s\S]*draft\.product_type/u, "single-field title regen must use existing product type");
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
assert.doesNotMatch(htmlFormat.match(/export function formatChaochaoSalesDescriptionHtml[\s\S]*?\n}\n\n\/\*\*/u)?.[0] ?? "", /font-size|style=/u, "C1 main formatter must not hard-code typography");
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

assert.match(finalizer, /providerBlank \? \(existingSpec \?\? ""\) : provider/u, "provider spec must win full-generation spec selection");
assert.match(finalizer, /localizeToTaiwanTraditionalText/u);
assert.match(finalizer, /BACKEND_ONLY_SPEC_LABELS/u);
assert.match(finalizer, /盲盒方式：\$\{rule\}/u);
assert.match(route, /finalizeCustomerSpecText\(providerOutput\.spec, draft\.spec_text\)/u);
assert.match(route, /cleanedWhyWeChoseIt = finalizeCustomerText\(providerOutput\.whyWeChoseIt\)/u);
assert.match(route, /cleanedProductHighlights = finalizeCustomerTextList\(providerOutput\.productHighlights\)/u);
assert.match(route, /localizedOutput\.generated_faq_html = finalizeCustomerText/u);
assert.match(route, /localizedOutput\.seo_title = finalizeCustomerText/u);
assert.match(route, /localizedOutput\.meta_description = finalizeCustomerText/u);

// Raw evidence columns are read-only in this generate update; they may remain Simplified.
const draftUpdateMatch = route.match(/const draftUpdate:[\s\S]*?\n  };/u);
assert.ok(draftUpdateMatch, "draftUpdate block missing");
assert.ok(!/taobao_title\s*:|original_title\s*:/u.test(draftUpdateMatch[0]), "raw source fields must not be overwritten");

// Single-field regen must not mutate spec_text.
const regenMapMatch = route.match(/const REGEN_FIELD_TO_COLUMN[\s\S]*?\n};/u);
assert.ok(regenMapMatch && !regenMapMatch[0].includes("spec_text"), "single-field map must not contain spec_text");
const regenBodyMatch = route.match(/async function handleFieldRegen[\s\S]*?\n}\n\nasync function writeImageAltTexts/u);
assert.ok(regenBodyMatch && !/update\.spec_text|spec_text\s*:/u.test(regenBodyMatch[0]), "single-field regen must not write spec_text");

// P4 safety remains live after prompt rewrite.
for (const phrase of ["P4 出處標記禁令", "網路搜尋補充資訊（B19", "不確定就不寫", "P4 賣家服務類排除", "物理事實"]) {
  assert.ok(prompt.includes(phrase), `P4 prompt contract missing: ${phrase}`);
}

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

console.log("COPY C1.1 owner corrective verifier passed");
