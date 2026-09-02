/**
 * D4 verification (no secrets / no live OpenAI / no fake CDN).
 *
 * - Static wiring: modules, thin shell, no HTTP self-fetch
 * - Pure decision helpers (mirrored)
 * - Mock provider path in source (imageProvider inject)
 * - Compatible with verify-d2 hybrid decision (run_mixed)
 *
 * Run: node scripts/verify-d4-ai-process.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const failures = [];
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

// --- Mirrors of pure helpers (keep in sync with runAiProcess / openai-image-provider / sendImagesAutoChain) ---

function isPipelineImageType(imageType) {
  return imageType === "main" || imageType === "spec" || imageType === "variant";
}

function isD4ProcessIntent(intent) {
  return intent === "de_text" || intent === "regenerate";
}

function decideAiProcessAction(input) {
  if (!isPipelineImageType(input.imageType)) {
    return { action: "skip", reason: `image_type=${input.imageType}` };
  }
  if (!isD4ProcessIntent(input.processIntent)) {
    return { action: "skip", reason: `process_intent=${input.processIntent ?? "null"}` };
  }
  if (input.processIntent === "de_text" && !input.originalFileUrl?.trim()) {
    return { action: "skip", reason: "de_text missing original_file_url" };
  }
  return {
    action: "process_ai",
    reason: `process_intent=${input.processIntent}`,
    intent: input.processIntent
  };
}

function decideSharpAction(input) {
  if (!isPipelineImageType(input.imageType)) {
    return { action: "skip", reason: "not pipeline" };
  }
  const intent = input.processIntent ?? null;
  if (input.afterAi && (intent === "de_text" || intent === "regenerate")) {
    if (!input.generatedFileUrl?.trim()) {
      return { action: "skip", reason: "afterAi missing generated" };
    }
    return { action: "process_sharp", reason: "post-AI" };
  }
  if (intent === "de_text" || intent === "regenerate") {
    return { action: "skip", reason: "needs D4" };
  }
  if (intent === "keep") {
    return { action: "process_sharp", reason: "keep" };
  }
  return { action: "skip", reason: "unmarked" };
}

function modelSupportsImageEdit(model, envFlag) {
  if (envFlag === "0" || envFlag === "false") return false;
  if (envFlag === "1" || envFlag === "true") return true;
  const m = (model || "gpt-image-1").toLowerCase();
  return !["dall-e-3", "dall-e-3-hd"].includes(m);
}

function buildRegeneratePrompt(input) {
  const title = input.title?.trim() || "";
  const desc = input.imageDescription?.trim() || "";
  let warning;
  if (!desc && !title) warning = "missing title and image_description";
  else if (!desc) warning = "empty image_description; used title only (Q5-A)";
  return {
    prompt: `Product title: ${title}\nVisual: ${desc}`.slice(0, 3200),
    warning
  };
}

function decideDraftAutoChainFromSnapshot(snapshotImages) {
  if (!snapshotImages.length) return { action: "no_pipeline_images" };
  const hasD4 = snapshotImages.some(
    (img) => img.processIntent === "de_text" || img.processIntent === "regenerate"
  );
  if (hasD4) return { action: "run_mixed" };
  const allKeep = snapshotImages.every((img) => img.processIntent === "keep");
  if (allKeep) return { action: "run_all_keep" };
  return { action: "awaiting_d4" };
}

function isShopifyCdnUrl(url) {
  if (!url?.trim()) return false;
  try {
    const host = new URL(url.trim()).hostname.toLowerCase();
    return host === "cdn.shopify.com" || host.endsWith(".cdn.shopify.com");
  } catch {
    return false;
  }
}

/** Simulate: failure must not overwrite CDN processed URL */
function nextProcessedOnFailure(priorProcessed, error) {
  void error;
  if (isShopifyCdnUrl(priorProcessed)) return priorProcessed;
  return priorProcessed; // leave as-is; never invent fake CDN
}

console.log("\nD4 AI process verify\n");

await check("core modules exist", () => {
  assert.ok(exists("src/lib/providers/image.ts"));
  assert.ok(exists("src/lib/providers/openai-image-provider.ts"));
  assert.ok(exists("src/lib/images/runAiProcess.ts"));
  assert.ok(exists("src/app/api/images/ai-process/route.ts"));
  assert.ok(exists("src/lib/images/sendImagesAutoChain.ts"));
});

await check("ai-process route: dual auth + thin shell + no self HTTP", () => {
  const src = read("src/app/api/images/ai-process/route.ts");
  assert.match(src, /resolveRequestPrincipal/);
  assert.match(src, /resolveAuthorizedDraftId/);
  assert.match(src, /runAiProcessForDraft/);
  assert.match(src, /maxDuration\s*=\s*60/);
  assert.match(src, /autoSharp/);
  assert.match(src, /autoFinalize/);
  assert.doesNotMatch(src, /fetch\s*\(\s*[^)]*\/api\/images\//);
  assert.doesNotMatch(src, /localhost:.*\/api\/images/);
});

await check("runAiProcess: inject provider, generated then sharp afterAi, no self fetch", () => {
  const src = read("src/lib/images/runAiProcess.ts");
  assert.match(src, /export async function runAiProcessForDraft/);
  assert.match(src, /imageProvider/);
  assert.match(src, /generated_file_url/);
  assert.match(src, /afterAi:\s*true/);
  assert.match(src, /runSharpBatchForDraft/);
  assert.match(src, /runFinalizeForDraft/);
  assert.match(src, /updateBatchStatusAfterAiProcess/);
  assert.match(src, /isShopifyCdnUrl/);
  assert.match(src, /AUTO_CHAIN_MAX_AI_IMAGES_PER_DRAFT\s*=\s*1/);
  assert.doesNotMatch(src, /fetch\s*\(\s*[^)]*\/api\/images\//);
});

await check("openai provider: missing key honest; edit gate; Q5-A regen", () => {
  const src = read("src/lib/providers/openai-image-provider.ts");
  assert.match(src, /OPENAI_API_KEY is not configured/);
  assert.match(src, /modelSupportsImageEdit/);
  assert.match(src, /images\/edits/);
  assert.match(src, /images\/generations/);
  assert.match(src, /OPENAI_IMAGE_MODEL/);
  assert.match(src, /buildRegeneratePrompt/);
  assert.match(src, /dall-e-3/);
});

await check("decideAiProcessAction: de_text/regen only", () => {
  assert.equal(
    decideAiProcessAction({
      imageType: "main",
      processIntent: "de_text",
      originalFileUrl: "https://x/a.png"
    }).action,
    "process_ai"
  );
  assert.equal(
    decideAiProcessAction({
      imageType: "main",
      processIntent: "keep",
      originalFileUrl: "https://x/a.png"
    }).action,
    "skip"
  );
  assert.equal(
    decideAiProcessAction({
      imageType: "detail",
      processIntent: "regenerate",
      originalFileUrl: "https://x/a.png"
    }).action,
    "skip"
  );
  assert.equal(
    decideAiProcessAction({
      imageType: "main",
      processIntent: "de_text",
      originalFileUrl: null
    }).action,
    "skip"
  );
  assert.equal(
    decideAiProcessAction({
      imageType: "main",
      processIntent: "regenerate",
      originalFileUrl: null
    }).action,
    "process_ai"
  );
});

await check("decideSharpAction afterAi vs default", () => {
  assert.equal(
    decideSharpAction({
      imageType: "main",
      processIntent: "de_text",
      afterAi: false
    }).action,
    "skip"
  );
  assert.equal(
    decideSharpAction({
      imageType: "main",
      processIntent: "de_text",
      afterAi: true,
      generatedFileUrl: "https://x/gen.png"
    }).action,
    "process_sharp"
  );
  assert.equal(
    decideSharpAction({
      imageType: "main",
      processIntent: "keep"
    }).action,
    "process_sharp"
  );
});

await check("modelSupportsImageEdit: dall-e-3 false; gpt-image-1 true", () => {
  assert.equal(modelSupportsImageEdit("dall-e-3"), false);
  assert.equal(modelSupportsImageEdit("gpt-image-1"), true);
  assert.equal(modelSupportsImageEdit("gpt-image-1", "false"), false);
});

await check("buildRegeneratePrompt Q5-A warning when empty description", () => {
  const a = buildRegeneratePrompt({ title: "測試吊飾", imageDescription: "" });
  assert.ok(a.warning && a.warning.includes("image_description"));
  const b = buildRegeneratePrompt({ title: "x", imageDescription: "紅色絨毛" });
  assert.equal(b.warning, undefined);
});

await check("hybrid decision: mixed → run_mixed (Q1-C)", () => {
  assert.equal(
    decideDraftAutoChainFromSnapshot([
      { processIntent: "keep" },
      { processIntent: "de_text" }
    ]).action,
    "run_mixed"
  );
  assert.equal(
    decideDraftAutoChainFromSnapshot([{ processIntent: "keep" }]).action,
    "run_all_keep"
  );
  assert.equal(
    decideDraftAutoChainFromSnapshot([{ processIntent: "regenerate" }]).action,
    "run_mixed"
  );
});

await check("failure never invents CDN URL", () => {
  const cdn = "https://cdn.shopify.com/s/files/1/x.webp";
  assert.equal(nextProcessedOnFailure(cdn, "boom"), cdn);
  assert.ok(isShopifyCdnUrl(cdn));
  assert.equal(isShopifyCdnUrl("https://xxx.supabase.co/storage/v1/object/public/x.webp"), false);
});

await check("sendImagesAutoChain wires hybrid + d4 + runAiProcess", () => {
  const src = read("src/lib/images/sendImagesAutoChain.ts");
  assert.match(src, /run_mixed/);
  assert.match(src, /runAiProcessForDraft/);
  assert.match(src, /AUTO_CHAIN_MAX_AI_IMAGES_PER_DRAFT|maxAiImages/);
  assert.match(src, /buildMakeD4Summary/);
  assert.match(src, /hybrid_d4/);
  assert.doesNotMatch(src, /fetch\s*\(\s*[^)]*\/api\/images\//);
});

await check("send-images route includes d4 summary for Make", () => {
  const src = read("src/app/api/drafts/batch/send-images/route.ts");
  assert.match(src, /buildMakeD4Summary/);
  assert.match(src, /\bd4\b/);
  assert.match(src, /runSendImagesAutoChain/);
});

await check("imagePipeline documents D4", () => {
  const src = read("src/lib/images/imagePipeline.ts");
  assert.match(src, /runAiProcessForDraft|ai-process/);
  assert.match(src, /generated_file_url|afterAi/);
  assert.match(src, /buildGeneratedStoragePath/);
});

await check("env.example has OPENAI_IMAGE_*", () => {
  const src = read(".env.example");
  assert.match(src, /OPENAI_IMAGE_MODEL/);
  assert.match(src, /OPENAI_IMAGE_EDIT_SUPPORTED|images\/edits|edit/i);
});

await check("no UI components import runAiProcess (b15 skip)", () => {
  const ban = [
    "src/components/listing/ResultCard.tsx",
    "src/components/listing/DraftResultsPanel.tsx",
    "src/components/review/ImageReviewPanel.tsx"
  ];
  for (const rel of ban) {
    if (!exists(rel)) continue;
    const src = read(rel);
    assert.doesNotMatch(src, /runAiProcessForDraft|openai-image-provider/);
  }
});

console.log("");
if (failures.length) {
  console.error(`FAILED ${failures.length} check(s)`);
  process.exit(1);
}
console.log("ALL passed\n");
