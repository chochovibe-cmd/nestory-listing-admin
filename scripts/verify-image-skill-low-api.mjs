import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

const skills = read("src/lib/images/imageSkills.ts");
const square = read("src/lib/images/squarePad.ts");
const ad = read("src/lib/images/adCreative.ts");
const provider = read("src/lib/providers/openai-image-provider.ts");
const providerContract = read("src/lib/providers/image.ts");
const endpoint = read("src/app/api/images/skill-process/route.ts");
const studio = read("src/components/listing/ImageSkillStudio.tsx");
const station = read("src/components/listing/Station2ImagePanel.tsx");
const tabs = read("src/lib/images/station2ImageTabs.ts");
const sharpBatch = read("src/lib/images/runSharpBatch.ts");
const marks = read("src/lib/images/processMarks.ts");
const env = read(".env.example");
const shopifyPayload = read("src/lib/shopify/payload.ts");
const descriptionEmbed = read("src/lib/contentGenerator/descriptionEmbed.ts");

console.log("verify-image-skill-low-api:");

for (const task of ["square_pad", "square_ai", "hero_enhance", "creative_hero", "ad_creative"]) {
  assert.match(skills, new RegExp(`["']${task}["']`), `missing task ${task}`);
}
assert.match(skills, /quality === "standard"[\s\S]*"medium"[\s\S]*"low"/, "economy/standard quality routing missing");
assert.match(skills, /The real product in the reference image is the source of truth/, "product fidelity policy missing");
assert.match(skills, /image_skill_source:/, "zero-migration source marker missing");
console.log("  ✓ task policy + fidelity + zero-migration marker");

assert.match(square, /composite\(\[\{ input: resized, gravity: "centre" \}\]\)/, "square pad must composite, not crop");
assert.doesNotMatch(square, /fit:\s*"cover"/, "square pad must not cover-crop product");
console.log("  ✓ square_pad is deterministic no-crop Sharp path");

assert.match(ad, /renderAdCreativeCard/, "ad renderer missing");
assert.match(ad, /CHOCHO NESTORY|eyebrow/, "ad typography layer missing");
assert.match(ad, /\.composite\(/, "ad typography should be deterministic overlay");
console.log("  ✓ ad creative uses deterministic typography overlay");

assert.match(providerContract, /"square_ai"/, "provider contract missing square_ai");
assert.match(providerContract, /"hero_enhance"/, "provider contract missing hero_enhance");
assert.match(providerContract, /"creative_hero"/, "provider contract missing creative_hero");
assert.match(providerContract, /"ad_creative"/, "provider contract missing ad_creative");
assert.match(provider, /DEFAULT_SKILL_MODEL = "gpt-image-2"/, "advanced skill model must default to gpt-image-2");
assert.match(provider, /OPENAI_IMAGE_SKILL_MODEL/, "skill model env isolation missing");
assert.match(provider, /task === "de_text" \|\| task === "to_trad" \|\| isAdvancedSkill/, "reference edits must use skill model");
assert.match(provider, /deriveGptImage2EditSize/, "aspect-safe edit sizing missing");
assert.match(provider, /task === "de_text" \? "low" : task === "to_trad" \? "medium"/, "cost-aware de_text/to_trad quality routing missing");
assert.match(provider, /"image\[\]"/, "multiple reference image[] edit upload missing");
assert.match(provider, /task === "square_ai"/, "advanced tasks not routed through edits");
console.log("  ✓ GPT Image 2 reference edits are cost-aware and aspect-safe");

assert.match(endpoint, /task === "square_pad"/, "zero API task endpoint missing");
assert.match(endpoint, /padImageToSquare/, "square_pad must use Sharp helper");
assert.match(endpoint, /createOpenAiImageProvider/, "AI skill provider call missing");
assert.match(endpoint, /product_highlights/, "ad copy fallback context missing");
assert.match(endpoint, /renderAdCreativeCard/, "ad visual must pass through typography renderer");
assert.match(endpoint, /markImageSkillSource/, "selected skill output marker missing");
assert.match(endpoint, /appendGenerationCostUsd/, "AI cost logging missing");
console.log("  ✓ endpoint separates free vs one-edit AI execution and logs cost");

assert.match(sharpBatch, /hasImageSkillSource/, "send pipeline does not preserve skill output");
assert.match(sharpBatch, /skillSource[\s\S]*generated_file_url/, "skill output must feed downstream Sharp");
console.log("  ✓ send-images Sharp preserves selected skill result");

assert.match(studio, /省錢版 · low（預設）/, "economy mode is not visible/default");
assert.match(studio, /只會生成 <strong>1 張<\/strong>/, "single-output cost guard missing");
assert.match(studio, /參考圖越多，圖片 input token 成本越高/, "reference input cost warning missing");
assert.match(station, /圖片 AI 工具/, "Station2 studio launcher missing");
assert.match(tabs, /"generated", label: "AI 產出"/, "AI output tab missing");
console.log("  ✓ Station2 exposes cost-aware studio + AI output tab");

const visibleIntentBlock = marks.match(/export const PROCESS_INTENT_OPTIONS[\s\S]*?\];/)?.[0] ?? "";
assert.doesNotMatch(visibleIntentBlock, /"regenerate"/, "unsafe text-only regenerate still exposed in new picks");
assert.match(marks, /regenerate: "重生"/, "historical regenerate compatibility label should remain");
console.log("  ✓ unsafe legacy regenerate hidden from new picks but backward compatibility remains");

assert.match(env, /OPENAI_IMAGE_SKILL_MODEL=gpt-image-2/, "skill model env example missing");

assert.match(
  shopifyPayload,
  /image\.image_type !== "detail"/,
  "raw detail reference images must not leak into Shopify media"
);
const generatedIndex = descriptionEmbed.indexOf('const scene = byType("generated_detail")');
const detailIndex = descriptionEmbed.indexOf('const detail = byType("detail")');
assert.ok(generatedIndex >= 0 && detailIndex > generatedIndex, "generated creative must beat raw detail in description embed");
console.log("  ✓ Shopify uses generated creatives, not raw detail references");

console.log("ALL image skill low-API checks passed");
