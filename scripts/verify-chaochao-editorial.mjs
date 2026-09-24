import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "src/lib/providers/chaochaoPrompt.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
const require = createRequire(import.meta.url);
const loadTypeScriptModule = (filePath) => {
  const js = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", js)(require, module, module.exports);
  return module.exports;
};
new Function("require", "module", "exports", compiled)(
  (specifier) => {
    if (specifier === "./titlePrompt") return loadTypeScriptModule(path.join(root, "src/lib/providers/titlePrompt.ts"));
    throw new Error(`Unexpected runtime dependency: ${specifier}`);
  },
  loaded,
  loaded.exports,
);
const prompt = loaded.exports;

const lengths = ["精簡", "標準", "詳細"];
const full = Object.fromEntries(lengths.map((length) => [
  length,
  prompt.buildChaochaoCopySystemPrompt(length),
]));
assert.equal(new Set(Object.values(full)).size, 3, "full prompts must respond to all three lengths");
assert.ok(full["精簡"].length < full["標準"].length);
assert.ok(full["標準"].length < full["詳細"].length);
assert.ok(full["標準"].length <= 4353, `standard prompt is ${full["標準"].length} chars`);

const faqPrompts = lengths.map((length) => prompt.buildChaochaoFieldRegenSystemPrompt("generated_faq_html", length));
assert.equal(new Set(faqPrompts).size, 3, "FAQ regen prompts must respond to all three lengths");
assert.match(faqPrompts[0], /2 題/);
assert.match(faqPrompts[2], /4 題/);

const fieldCases = [
  ["generated_description_html", /純文字五段/, /選品觀察/],
  ["generated_faq_html", /選款、使用、送禮或照顧/, /product_highlights/],
  ["seo_title", /款式差異/, /generated_faq_html/],
  ["meta_description", /適用情境/, /product_highlights/],
  ["why_we_chose_it", /選品觀察/, /generated_faq_html/],
  ["product_highlights", /3–5 條短句/, /seo_title/],
];
for (const [field, includes, excludes] of fieldCases) {
  const regen = prompt.buildChaochaoFieldRegenSystemPrompt(field, "標準");
  assert.match(regen, includes, `${field} should contain its own writing task`);
  assert.doesNotMatch(regen, excludes, `${field} should not carry unrelated field guidance`);
  assert.ok(regen.length < full["標準"].length, `${field} regen should be smaller than full generation`);
  assert.match(regen, new RegExp(`\\[\\[${field}\\]\\]`));
}

const descriptionRegen = prompt.buildChaochaoFieldRegenSystemPrompt("generated_description_html", "標準");
assert.match(descriptionRegen, /雨衣吊飾/);
assert.match(descriptionRegen, /衝浪吊飾/);
assert.match(descriptionRegen, /滑雪布丁狗/);
assert.doesNotMatch(prompt.buildChaochaoFieldRegenSystemPrompt("seo_title", "標準"), /雨衣吊飾/);

const outputStart = full["標準"].indexOf("【輸出格式】");
const output = full["標準"].slice(outputStart).match(/\[\[(?:detected_ip_name|detected_character_name|detected_product_type|detected_product_brand|detected_category|sku|enriched_title|title_ip|title_brand|title_item|title_diff|generated_description_html|generated_faq_html|seo_title|meta_description|why_we_chose_it|product_highlights|spec)\]\]/g) ?? [];
assert.equal(output.length, 18, "renderer contract must keep 18 markers");
assert.match(full["標準"], /最多 80 字/);
assert.match(full["標準"], /採用本次輸入或已確認資料中的事實/);
assert.match(full["標準"], /供擷取商品資訊/);

console.log(`verify-chaochao-editorial: all checks passed`);
console.log(`full prompt chars: ${lengths.map((length) => `${length}=${full[length].length}`).join(", ")}`);
console.log(`regen chars: ${fieldCases.map(([field]) => `${field}=${prompt.buildChaochaoFieldRegenSystemPrompt(field, "標準").length}`).join(", ")}`);
