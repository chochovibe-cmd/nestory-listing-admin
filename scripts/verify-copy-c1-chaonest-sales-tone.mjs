import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

const copy = read("src/lib/providers/copy.ts");
const prompt = read("src/lib/providers/systemPrompt.ts");
const route = read("src/app/api/generate/route.ts");
const workspace = read("src/components/listing/WorkspaceInputPanel.tsx");
const resultCard = read("src/components/listing/ResultCard.tsx");
const analyzeRoute = read("src/app/api/analyze-images/route.ts");
const visionProvider = read("src/lib/providers/visionProvider.ts");
const finalizer = read("src/lib/providers/customerFacingFinalizer.ts");
const specAuthority = read("src/lib/providers/specAuthority.ts");

// COPY C1 owner allowlist remains present.
assert.match(copy, /"潮巢導購版"/u, "seventh Chaochao tone disappeared");
assert.match(prompt, /潮巢導購版/u, "Chaochao tone prompt disappeared");
assert.match(prompt, /台灣繁中/u, "Taiwan Traditional customer-facing instruction disappeared");
assert.match(finalizer, /localizeToTaiwanTraditionalText/u, "Taiwan Traditional finalizer disappeared");
assert.match(finalizer, /stripCustomerSourceMarkers/u, "customer source-marker cleanup disappeared");
assert.doesNotMatch(finalizer, /factsByLabel|CUSTOMER_SPEC_LABELS|webEvidence|derivedUsageScenario/u,
  "customerFacingFinalizer regained spec/evidence authority");

// R0A removal: C1.4-only files must not exist.
assert.equal(exists("src/lib/providers/productEvidencePack.ts"), false, "C1.4 Evidence Pack file still exists");
assert.equal(exists("src/lib/images/fullGenerateVision.ts"), false, "C1.4 Full Generate Vision bridge file still exists");

// No C1.4 runtime wiring survives.
const runtimeSources = [copy, prompt, route, workspace, resultCard, analyzeRoute, visionProvider, finalizer, specAuthority];
for (const symbol of [
  "buildProductEvidencePack",
  "formatProductEvidencePack",
  "evidencePackText",
  "prepareVisionEvidenceForFullGenerate",
  "mergeCustomerSpecEvidence",
]) {
  assert.ok(runtimeSources.every((source) => !source.includes(symbol)), `removed runtime symbol still referenced: ${symbol}`);
}

// Vision is restored to the Production capability, without C1.4 cache/sampling redesign.
assert.match(analyzeRoute, /describeProductImages/u, "original analyze-images Vision capability missing");
assert.match(visionProvider, /function describeProductImages|export async function describeProductImages/u, "original Vision provider capability missing");
for (const c14VisionSymbol of [
  "VISION_SOURCE_FINGERPRINT_FLAG_KEY",
  "buildVisionSourceFingerprint",
  "selectRepresentativeVisionImages",
  "VisionImageCandidate",
]) {
  assert.ok(!analyzeRoute.includes(c14VisionSymbol), `C1.4 analyze-images behavior remains: ${c14VisionSymbol}`);
  assert.ok(!visionProvider.includes(c14VisionSymbol), `C1.4 Vision provider behavior remains: ${c14VisionSymbol}`);
}
assert.ok(!resultCard.includes("/api/analyze-images"), "ResultCard full regenerate must not force analyze-images");
assert.match(resultCard, /fetch\("\/api\/generate"/u, "ResultCard direct generate flow missing");
assert.match(workspace, /async function analyzeImages/u, "original Workspace image-analysis helper missing");
assert.match(workspace, /if \(hasImages\)[\s\S]*analyzeImages\(id\)/u, "Workspace Production analyze-only-when-images flow missing");

// Provider input is back to direct Production fields; Web Search is context only.
for (const field of ["rawTitle", "variantSummary", "imageDescription", "specText", "webSearchSummary", "ipKnowledgePromptBlock"]) {
  assert.ok(prompt.includes(field), `direct provider context field missing: ${field}`);
}
assert.match(route, /webSearchSummary,\s*\n\s*ipKnowledgePromptBlock/u, "Web Search summary no longer reaches AI provider context");
assert.ok(!route.includes("webEvidence"), "Web Search must not enter backend spec merge");
assert.ok(!specAuthority.includes("webEvidence"), "spec authority must not parse Web Search");
assert.ok(!specAuthority.includes("factsByLabel"), "canonical-key spec merge must be removed");
assert.ok(!specAuthority.includes("CUSTOMER_SPEC_LABELS"), "spec label selection must be removed");
assert.ok(!specAuthority.includes("derivedUsageScenario"), "derived usage-scenario spec merge must be removed");

// Production spec authority: existing non-empty spec wins verbatim; empty existing may adopt provider spec.
assert.match(specAuthority, /const existing = existingSpec \?\? "";[\s\S]*if \(existing\.trim\(\)\) return existing;/u,
  "existing non-empty spec is not authoritative");
assert.match(specAuthority, /localizeToTaiwanTraditionalText\(providerSpec \?\? ""\)[\s\S]*return provider;/u,
  "empty existing spec cannot adopt localized provider spec");
assert.match(route, /finalizeCustomerSpecText\(providerOutput\.spec, draft\.spec_text\)/u,
  "full generate is not using restored spec selector");

function productionSpec(existingSpec, providerSpec) {
  const existing = existingSpec ?? "";
  if (existing.trim()) return existing;
  const provider = (providerSpec ?? "").trim();
  if (!provider || provider === "（無）" || provider === "(無)") return null;
  return provider;
}

const cocoaCatRichSpec = [
  "品牌：可可貓",
  "型號：Cocoa Cat CC-2026",
  "填充物：聚酯纖維",
  "尺寸：約 20cm",
  "工藝：刺繡",
  "材質：短毛絨",
  "款式：坐姿款",
  "角色：可可貓",
  "商品類型：絨毛娃娃",
].join("\n");
assert.equal(
  productionSpec(cocoaCatRichSpec, "品牌：可可貓\n尺寸：約20cm\n材質：絨毛"),
  cocoaCatRichSpec,
  "可可貓 rich existing spec must survive a shorter provider spec",
);

const razerRichSpec = [
  "品牌：Razer",
  "型號：Orochi V2",
  "連線：2.4GHz",
  "無線技術：Razer HyperSpeed Wireless",
  "無線距離：約 10 公尺",
  "人體工學：右手／對稱握持",
  "充電：AA／AAA 電池供電",
  "使用情境：辦公、遊戲、行動使用",
].join("\n");
assert.equal(
  productionSpec(razerRichSpec, "品牌：Razer\n連線：2.4GHz\n用途：無線滑鼠"),
  razerRichSpec,
  "Razer rich existing spec must not collapse to 3–4 provider lines",
);

assert.equal(
  productionSpec("   ", "品牌：Razer\n連線：2.4GHz\n商品類型：無線滑鼠"),
  "品牌：Razer\n連線：2.4GHz\n商品類型：無線滑鼠",
  "empty existing spec must adopt a non-empty provider spec",
);

console.log("COPY C1.R0A shared data pipeline recovery verifier passed");
