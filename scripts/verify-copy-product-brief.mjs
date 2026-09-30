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

assert.match(brief, /PRODUCT_BRIEF_VERSION = "pb1-20260930"/u);
assert.match(brief, /gpt-4o-mini/u, "brief stage lost cheap-model default");
assert.match(brief, /rejectedEvidence/u, "brief no longer records rejected web evidence");
assert.match(brief, /賣家款式／標題／圖中文字／既有規格 > 明確同款官方或零售資料/u,
  "evidence authority order missing");
assert.match(brief, /只有同 IP、同類型但不是同款的結果放 rejectedEvidence/u,
  "generic same-IP search rejection rule missing");
assert.match(brief, /unknowns/u, "unknown-fact boundary missing");
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

assert.match(promptBase, /input\.productBrief\?\.trim\(\)/u, "Chaochao user message does not prefer Product Brief");
assert.match(promptBase, /不要重新分類、不要重新查證/u, "Writer boundary instruction missing");
assert.match(openai, /productBriefMode: Boolean\(input\.productBrief\?\.trim\(\)\)/u,
  "OpenAI provider is not switching to brief writer");
assert.match(route, /await buildProductBrief\(/u, "generate route does not build Product Brief");
assert.match(route, /productBrief: productBriefResult\?\.writerText/u, "generate route does not pass brief to Writer");
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
