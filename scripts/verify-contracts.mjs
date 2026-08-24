import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function requireContains(file, labels) {
  const source = read(file);
  const missing = labels.filter((label) => !source.includes(label));
  return missing.map((label) => `${file} missing ${label}`);
}

const workerOutputKeys = [
  "title_zh",
  "description_html",
  "description_plain",
  "seo_title",
  "seo_description",
  "tags",
  "collection_suggestion",
  "spec_text",
  "warnings",
  "image_alt_texts"
];

const errors = [
  ...requireContains("src/lib/csv/matrixify.ts", [
    "Command",
    "Handle",
    "Title",
    "Body HTML",
    "Vendor",
    "Type",
    "Tags",
    "Published",
    "Status",
    "SEO Title",
    "SEO Description",
    "Option1 Name",
    "Option1 Value",
    "Variant SKU",
    "Variant Price",
    "Variant Cost",
    "Variant Inventory Tracker",
    "Variant Inventory Qty",
    "Variant Inventory Policy",
    "Variant Requires Shipping",
    "Variant Image",
    "Image Src",
    "Image Position",
    "Image Alt Text"
  ]),
  ...requireContains("src/lib/shopify/payload.ts", [
    "title",
    "descriptionHtml",
    "vendor",
    "productType",
    "tags",
    "shopify_tags",
    "shopify_collections",
    "shopify_handle",
    "metafields_json",
    "generated_payload_json",
    "generation_rule_version",
    "status",
    "seo",
    "media",
    "variantSeed"
  ]),
  ...requireContains("src/app/api/worker/complete/route.ts", [
    ...workerOutputKeys,
    'status: "ready_for_review"',
    'generation_status: "completed"',
    'mode: "codex_skill"'
  ]),
  ...requireContains("src/app/api/drafts/[id]/request-revision/route.ts", [
    "needs_revision"
  ]),
  ...requireContains("docs/RELEASE_READINESS.md", [
    "POST /api/worker/claim",
    "POST /api/worker/complete",
    "POST /api/worker/fail",
    "POST /api/drafts/{id}/request-revision",
    "POST /api/drafts/{id}/publish",
    "Matrixify CSV fallback",
    "SHOPIFY_PUBLISH_MOCK=true"
  ])
];

const workerComplete = readJson("fixtures/worker-complete-sample.json");
const workerOutput = workerComplete.output ?? {};
for (const key of workerOutputKeys) {
  if (!(key in workerOutput)) {
    errors.push(`fixtures/worker-complete-sample.json missing output.${key}`);
  }
}

const publishActive = readJson("fixtures/publish-active-sample.json");
if (publishActive.publishMode !== "active" || publishActive.confirmActive !== true) {
  errors.push("fixtures/publish-active-sample.json must confirm active publish");
}

const matrixifyExport = readJson("fixtures/matrixify-export-sample.json");
if (!Array.isArray(matrixifyExport.draftIds) || !matrixifyExport.draftIds.length) {
  errors.push("fixtures/matrixify-export-sample.json must include draftIds");
}

const uiStates = readJson("fixtures/ui-states.json");
const stateNames = new Set((uiStates.draftCardStates ?? []).map((state) => state.status));
for (const expectedState of ["pending_copy", "processing", "ready_for_review", "active_published", "csv_ready"]) {
  if (!stateNames.has(expectedState)) {
    errors.push(`fixtures/ui-states.json missing ${expectedState}`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Contract checks passed using current source, fixtures, and canonical release docs");
