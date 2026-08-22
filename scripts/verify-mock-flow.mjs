import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const errors = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function json(relativePath) {
  try {
    return JSON.parse(read(relativePath));
  } catch (error) {
    errors.push(`${relativePath} is not valid JSON: ${error.message}`);
    return null;
  }
}

function expect(name, condition, detail = "") {
  if (!condition) errors.push(`${name}${detail ? `: ${detail}` : ""}`);
}

const draftId = "00000000-0000-4000-8000-000000000001";
const imageId = "00000000-0000-4000-8000-000000000101";
// Deterministic fixture version. This is test data, not the current production copy-rule version.
const ruleVersion = "chochonest-copywriter@2026-06-24-v1";

const claim = json("fixtures/worker-claim-sample.json");
const complete = json("fixtures/worker-complete-sample.json");
const publish = json("fixtures/publish-active-sample.json");
const matrixify = json("fixtures/matrixify-export-sample.json");
const uiStates = json("fixtures/ui-states.json");
const seed = read("supabase/seeds/001_mock_draft.sql");
const productForm = read("src/components/listing/WorkspaceInputPanel.tsx");
const publishRoute = read("src/app/api/drafts/[id]/publish/route.ts");
const publishDraftLib = read("src/lib/shopify/publishDraft.ts");
const matrixifySource = read("src/lib/csv/matrixify.ts");
const releaseReadiness = read("docs/RELEASE_READINESS.md");

expect("worker claim limit", claim?.limit === 1);
expect("worker claim rule version", claim?.ruleVersion === ruleVersion);

expect("worker complete draft id", complete?.draftId === draftId);
expect("worker complete rule version", complete?.ruleVersion === ruleVersion);
expect("worker complete model", complete?.model === "codex_skill");
expect("worker complete title", Boolean(complete?.output?.title_zh));
expect("worker complete description_html", /<h3>/.test(complete?.output?.description_html ?? ""));
expect("worker complete seo title", Boolean(complete?.output?.seo_title));
expect("worker complete seo description", Boolean(complete?.output?.seo_description));
expect("worker complete tags", Array.isArray(complete?.output?.tags) && complete.output.tags.length >= 3);
expect("worker complete warning", Array.isArray(complete?.output?.warnings) && complete.output.warnings.length >= 1);
expect("worker complete image alt id", complete?.output?.image_alt_texts?.[0]?.image_id === imageId);

expect("publish active mode", publish?.publishMode === "active");
expect("publish active confirmation", publish?.confirmActive === true);
expect("publish route requires active confirmation", /confirmActive !== true/.test(publishRoute));
expect("publish route mock safe", /SHOPIFY_PUBLISH_MOCK/.test(publishDraftLib));

expect("matrixify draft id", matrixify?.draftIds?.[0] === draftId);
expect("matrixify option title", /"Option1 Name": "Title"/.test(matrixifySource));
expect("matrixify supports active status", /Status: draft\.publish_mode === "active" \? "active" : "draft"/.test(matrixifySource));

expect("seed draft id", seed.includes(draftId));
expect("seed image id", seed.includes(imageId));
expect("seed pending copy", seed.includes("'pending_copy'"));
expect("seed codex skill", seed.includes("'codex_skill'"));
expect("seed publish active", seed.includes("'active'"));
expect("seed shopify api", seed.includes("'shopify_api'"));

for (const expected of [
  'status: "pending_copy"',
  // generation_mode moved from "codex_skill" to "api_llm" when copy
  // generation switched from worker claim/complete to synchronous /api/generate.
  'generation_mode: "api_llm"',
  'generation_provider: "codex"',
  'generation_status: "pending"',
  'publish_mode: "active"',
  'publish_method: "shopify_api"',
  'publish_status: "pending"'
]) {
  expect(`PWA default ${expected}`, productForm.includes(expected));
}

expect(
  "release readiness references worker complete fixture",
  releaseReadiness.includes("fixtures/worker-complete-sample.json")
);
expect(
  "release readiness documents active double confirmation",
  /ACTIVE publish.*explicit.*confirm/i.test(releaseReadiness)
);
expect("ui states fixture parses", Boolean(uiStates));

const scanFiles = [
  "src/lib/categories.ts",
  "src/lib/csv/matrixify.ts",
  "fixtures/worker-complete-sample.json",
  "supabase/seeds/001_mock_draft.sql",
  "docs/RELEASE_READINESS.md"
];
const mojibakePattern = /[-]|銝|撌|隢|敺|雿|瘚|繚|甈|皜|祈岫|||/;
for (const file of scanFiles) {
  expect(`No mojibake in ${file}`, !mojibakePattern.test(read(file)));
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Mock flow checks passed");
