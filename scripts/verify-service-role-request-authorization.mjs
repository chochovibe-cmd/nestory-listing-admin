import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const principal = read("src/lib/api/requestPrincipal.ts");
for (const fragment of [
  "createServerSupabaseClient",
  "loadAuthorizedDraft",
  "loadAuthorizedDraftIds",
  "resolveAuthorizedDraftId",
  'from("product_drafts")',
  "rlsSupabase",
  "hasBearerAuthorization"
]) {
  assert.ok(principal.includes(fragment), `request principal boundary is missing: ${fragment}`);
}

const sessionRoutes = [
  "src/app/api/drafts/[id]/request-revision/route.ts",
  "src/app/api/drafts/[id]/return-stage/route.ts"
];
for (const route of sessionRoutes) {
  const source = read(route);
  assert.match(source, /resolveRequestPrincipal\(request\)/, `${route} must resolve the signed-in principal`);
  assert.match(source, /loadAuthorizedDraft\(/, `${route} must RLS-load the requested draft`);
  assert.match(source, /canonicalDraftId/, `${route} must use the RLS-approved draft ID`);
}

const batchRoutes = [
  "src/app/api/drafts/batch/advance-ready/route.ts",
  "src/app/api/drafts/batch/send-images/route.ts"
];
for (const route of batchRoutes) {
  const source = read(route);
  assert.match(source, /resolveRequestPrincipal\(request\)/, `${route} must resolve the signed-in principal`);
  assert.match(source, /loadAuthorizedDraftIds\(/, `${route} must RLS-filter requested draft IDs`);
  assert.match(source, /authorizedDraftIds/, `${route} must use only RLS-approved IDs`);
}

const workerOrSessionRoutes = [
  "src/app/api/images/ai-process/route.ts",
  "src/app/api/images/sharp-batch/route.ts",
  "src/app/api/images/finalize/route.ts",
  "src/app/api/images/compose-detail/route.ts"
];
for (const route of workerOrSessionRoutes) {
  const source = read(route);
  assert.match(
    source,
    /resolveRequestPrincipal\(request, \{ allowWorker: true \}\)/,
    `${route} must make the trusted-worker exception explicit`
  );
  assert.match(source, /resolveAuthorizedDraftId\(/, `${route} must RLS-load session draft IDs`);
  assert.match(source, /canonicalDraftId/, `${route} must use the authorised draft ID`);
}

const batchStatus = read("src/lib/images/runAiProcess.ts");
for (const fragment of [
  'from("image_batch_items")',
  '.eq("batch_id", batchId)',
  '.eq("draft_id", draftId)',
  "if (membershipError || !membership) return false"
]) {
  assert.ok(batchStatus.includes(fragment), `batch membership guard is missing: ${fragment}`);
}

console.log("Service-role request authorization checks passed");
