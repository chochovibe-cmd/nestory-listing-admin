import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const brief = read("src/lib/providers/productBrief.ts");
const chaochao = read("src/lib/providers/chaochaoPrompt.ts");
const promptBase = read("src/lib/providers/systemPromptBase.ts");
const route = read("src/app/api/generate/route.ts");
const openai = read("src/lib/providers/openai-copy-provider.ts");
const fixtures = JSON.parse(read("scripts/fixtures/chaochao-product-brief-golden.json"));

assert.match(brief, /PRODUCT_BRIEF_VERSION = "pb1\.1-20261006"/u);
assert.match(brief, /gpt-4o-mini/u, "brief stage lost cheap-model default");
assert.match(brief, /rejectedEvidence/u, "brief no longer records rejected web evidence");
assert.match(brief, /當次直接證據優先：賣家標題／款式／操作備註／圖中文字 > 明確同款官方或零售資料 > 草稿既有分類與規格/u,
  "evidence authority order missing");
assert.match(brief, /只有同 IP、同類型但不是同款的結果放 rejectedEvidence/u,
  "generic same-IP search rejection rule missing");
assert.match(brief, /unknowns/u, "unknown-fact boundary missing");
assert.match(brief, /草稿既有 IP、角色、品項、品牌與規格可能是前一次 AI／舊網搜留下的資料/u,
  "legacy draft classification/spec trust boundary missing");
assert.match(brief, /草稿既有規格單獨出現不算直接證據/u,
  "legacy spec can still become a high-risk fact without corroboration");
assert.match(brief, /多角色／隨機盲盒不可只因草稿既有角色就縮成單一角色/u,
  "legacy character can still collapse a multi-character blind box");
assert.match(brief, /webSearchSummary, 3000/u, "raw web evidence cap changed; review token cost");

const writerStart = chaochao.indexOf("export function buildChaochaoBriefWriterSystemPrompt");
const writerEnd = chaochao.indexOf("const CHAOCHAO_REGEN_FIELD_RULES", writerStart);
assert.ok(writerStart >= 0 && writerEnd > writerStart, "focused Chaochao Writer block missing");
const writer = chaochao.slice(writerStart, writerEnd);
for (const forbidden of ["[[detected_ip_name]]", "[[detected_character_name]]", "[[detected_product_type]]", "[[detected_category]]", "[[sku]]", "[[spec]]"]) {
  assert.ok(!writer.includes(forbidden), `Writer regained upstream operation: ${forbidden}`);
}
for (const required of ["[[enriched_title]]", "[[generated_description_html]]", "[[generated_faq_html]]", "[[seo_title]]", "[[meta_description]]", "[[why_we_chose_it]]", "[[product_highlights]]"]) {
  assert.ok(writer.includes(required), `Writer output missing: ${required}`);
}
assert.match(writer, /不要用「品質有保證、絕佳收藏、經久耐用、不可錯過」/u,
  "generic-copy regression guard missing");
assert.match(writer, /Product Brief 沒有明確寫出的效果、耐用性、比較優勢或保證性結論/u,
  "focused Writer can still infer unsupported product effects");
assert.match(chaochao, /why_we_chose_it 只寫 1–2 句/u,
  "PB1.1 Why rule did not switch to value-first 1–2 sentence contract");
assert.match(chaochao, /不要把選品理由寫成角色頌歌、人生感悟或抽象療癒散文/u,
  "PB1.1 Why anti-poetic guard missing");
assert.match(chaochao, /只能問 Product Brief 有足夠資料回答的題目/u,
  "PB1.1 FAQ evidence-answerability guard missing");
assert.match(chaochao, /不能擴成「比一般吹風機更安靜」/u,
  "PB1.1 FAQ comparison certainty guard missing");
assert.match(writer, /\$\{buildChaochaoBriefFaqRules\(\)\}/u,
  "focused Writer stopped applying PB1.1 FAQ evidence rules");
assert.match(writer, /\$\{buildChaochaoBriefWhyRule\(\)\}/u,
  "focused Writer stopped applying PB1.1 Why rules");

assert.match(promptBase, /input\.productBrief\?\.trim\(\)/u, "Chaochao user message does not prefer Product Brief");
assert.match(promptBase, /不要重新分類、不要重新查證/u, "Writer boundary instruction missing");
assert.match(openai, /productBriefMode: Boolean\(input\.productBrief\?\.trim\(\)\)/u,
  "OpenAI provider is not switching to brief writer");
assert.match(route, /await buildProductBrief\(/u, "generate route does not build Product Brief");
assert.match(
  route,
  /productBrief: productBriefResult && !productBriefResult\.fallback \? productBriefResult\.writerText : undefined/u,
  "generate route does not pass only a successful brief to Writer",
);
assert.match(route, /applyProductBriefToCopyOutput\(writerOutput, productBriefResult\)/u,
  "upstream identity/spec/title are not merged back after Writer");
assert.match(route, /generation_rule_version: productBriefApplied \? `chaochao-\$\{PRODUCT_BRIEF_VERSION\}`/u,
  "Product Brief recipe version is not persisted only after a successful brief");

assert.equal(fixtures.length, 4, "golden set must keep four representative products");
for (const fixture of fixtures) {
  assert.ok(fixture.rawTitle && fixture.mustKeep?.length >= 4, `fixture incomplete: ${fixture.id}`);
  assert.ok(fixture.qualityRisk, `fixture risk missing: ${fixture.id}`);
}

console.log("COPY-PB1 Product Brief / focused Writer contract passed");
