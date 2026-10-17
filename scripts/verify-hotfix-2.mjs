import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "src/lib/supabase/fetchAllRows.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports });
const { fetchAllRows } = module.exports;
assert.equal(typeof fetchAllRows, "function", "load the real TypeScript helper");

const approveSource = fs.readFileSync(path.join(root, "src/lib/drafts/approveCopy.ts"), "utf8");
const approveCompiled = ts.transpileModule(approveSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const approveModule = { exports: {} };
vm.runInNewContext(approveCompiled, {
  module: approveModule,
  exports: approveModule.exports,
  require: (id) => {
    if (id === "@/lib/images/processMarks") {
      return { unmarkedPipelineImageIds: (rows) => rows.map((row) => row.id) };
    }
    if (id === "@/lib/supabase/fetchAllRows") return { fetchAllRows };
    throw new Error(`Unexpected approveCopy dependency: ${id}`);
  }
});
let approvePageErrorCalls = 0;
let approvalMutationCalls = 0;
const approvalQuery = () => ({
  select() { return this; },
  in() { return this; },
  order() { return this; },
  range(from) {
    approvePageErrorCalls += 1;
    if (from > 0) return Promise.resolve({ data: null, error: { message: "second image page failed" } });
    return Promise.resolve({
      data: Array.from({ length: 1000 }, (_, id) => ({ id: String(id), image_type: "main", process_intent: null })),
      error: null
    });
  },
  update() { approvalMutationCalls += 1; return this; }
});
const approvalResult = await approveModule.exports.applyDefaultKeepMarks(
  { from: () => approvalQuery() },
  ["draft-1"]
);
assert.equal(approvePageErrorCalls, 2);
assert.equal(approvalResult.updatedCount, 0);
assert.match(approvalResult.error, /second image page failed/);
assert.equal(approvalMutationCalls, 0, "approval must not mutate from incomplete image rows");

const countRows = async (count) => {
  const calls = [];
  const result = await fetchAllRows(async (from, to) => {
    calls.push([from, to]);
    return { data: Array.from({ length: Math.max(0, Math.min(1000, count - from)) }, (_, i) => from + i), error: null };
  });
  assert.equal(result.error, null);
  assert.equal(result.data.length, count);
  return calls;
};

assert.deepEqual(await countRows(0), [[0, 999]]);
assert.deepEqual(await countRows(999), [[0, 999]]);
assert.deepEqual(await countRows(1000), [[0, 999], [1000, 1999]]);
assert.deepEqual(await countRows(1001), [[0, 999], [1000, 1999]]);
assert.deepEqual(await countRows(2001), [[0, 999], [1000, 1999], [2000, 2999]]);

const exactBoundaryCalls = [];
const exactBoundary = await fetchAllRows(async (from, to) => {
  exactBoundaryCalls.push({ from, to, freshQuery: {} });
  return { data: from === 0 ? Array.from({ length: 1000 }, (_, i) => i) : [], error: null };
});
assert.equal(exactBoundary.data.length, 1000);
assert.deepEqual(exactBoundaryCalls.map(({ from, to }) => [from, to]), [[0, 999], [1000, 1999]]);
assert.notEqual(exactBoundaryCalls[0].freshQuery, exactBoundaryCalls[1].freshQuery);

const pageError = { message: "page two failed", code: "P2" };
let errorCalls = 0;
const failed = await fetchAllRows(async (from) => {
  errorCalls += 1;
  return from === 0
    ? { data: Array.from({ length: 1000 }, (_, i) => i), error: null }
    : { data: null, error: pageError };
});
assert.equal(errorCalls, 2);
assert.equal(failed.data, null, "a later page error must not return partial rows");
assert.equal(failed.error, pageError, "preserve the original error object");

const sortedRows = [
  { sort_order: 2, id: "a" },
  { sort_order: 2, id: "b" },
  { sort_order: 3, id: "c" }
];
const ordered = await fetchAllRows(async () => ({ data: sortedRows, error: null }));
assert.deepEqual(Array.from(ordered.data, ({ sort_order, id }) => `${sort_order}:${id}`), ["2:a", "2:b", "3:c"]);

const paginatedFiles = [
  "src/app/drafts/new/page.tsx",
  "src/app/api/exports/matrixify/route.ts",
  "src/app/api/exports/showmore/route.ts",
  "src/app/api/exports/preflight/route.ts",
  "src/app/api/price-resync/candidates/route.ts",
  "src/components/library/ProductLibraryModal.tsx",
  "src/components/review/ImageReviewPanel.tsx",
  "src/lib/drafts/approveCopy.ts",
  "src/lib/images/deleteProductImages.ts",
  "src/lib/shopify/runPublishBatch.ts",
  "src/app/api/drafts/batch/send-images/route.ts"
];
const assertErrorGuardBeforeUse = (relative, fetchMarker, guard, useMarker) => {
  const text = fs.readFileSync(path.join(root, relative), "utf8");
  const fetchAt = text.indexOf(fetchMarker);
  const guardAt = text.indexOf(guard, fetchAt + fetchMarker.length);
  const useAt = text.indexOf(useMarker, fetchAt + fetchMarker.length);
  assert.ok(fetchAt >= 0, `${relative}: paginated query marker missing`);
  assert.ok(guardAt > fetchAt, `${relative}: error guard must follow the paginated query`);
  assert.ok(useAt > guardAt, `${relative}: error guard must run before consuming data or mutating`);
};
const responseErrorGuard = "if (variantError) return Response.json({ error: variantError.message }, { status: 500 });";
assertErrorGuardBeforeUse(
  "src/app/api/exports/matrixify/route.ts",
  "const { data: variantRows, error: variantError } = await fetchAllRows",
  responseErrorGuard,
  "variantsByDraft = new Map()"
);
assertErrorGuardBeforeUse(
  "src/app/api/exports/showmore/route.ts",
  "const { data: variantRows, error: variantError } = await fetchAllRows",
  responseErrorGuard,
  "variantsByDraft = new Map()"
);
assertErrorGuardBeforeUse(
  "src/app/api/exports/preflight/route.ts",
  "const { data: variantRows, error: variantError } = await fetchAllRows",
  responseErrorGuard,
  "const variantsByDraft = new Map"
);
assertErrorGuardBeforeUse(
  "src/lib/shopify/runPublishBatch.ts",
  "const { data: imageRows, error: imageError } = await fetchAllRows",
  "if (imageError) {\n    return { ok: false, error: imageError.message, status: 500 };\n  }",
  "const imagesByDraft = new Map"
);
assert.ok(source.includes("const result = await queryPage(from, to)"));
assert.ok(source.includes("if (result.error) return { data: null, error: result.error }"));
assert.ok(source.includes("if (page.length < pageSize) return { data: rows, error: null }"));

let queryCount = 0;
for (const relative of paginatedFiles) {
  const text = fs.readFileSync(path.join(root, relative), "utf8");
  const file = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true);
  const delegatedToHelper = relative === "src/lib/images/deleteProductImages.ts";
  if (delegatedToHelper) {
    const wrapper = file.statements.find((statement) =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === "selectImageRows"
    );
    assert.ok(wrapper && text.slice(wrapper.pos, wrapper.end).includes("fetchAllRows"), `${relative}: selectImageRows must use fetchAllRows`);
  }

  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "in") {
      const [column] = node.arguments;
      const isDraftBatch = column && ts.isStringLiteral(column) && column.text === "draft_id";
      const isImageBindingBatch = relative === "src/lib/images/deleteProductImages.ts" &&
        column && ts.isStringLiteral(column) && column.text === "image_id";
      if (isDraftBatch || isImageBindingBatch) {
        queryCount += 1;
        let callback = null;
        let current = node.parent;
        while (current) {
          if (ts.isArrowFunction(current) && ts.isCallExpression(current.parent) && ts.isIdentifier(current.parent.expression)) {
            const callee = current.parent.expression.text;
            if (callee === "fetchAllRows" || (delegatedToHelper && callee === "selectImageRows")) {
              callback = current;
              break;
            }
          }
          current = current.parent;
        }
        assert.ok(callback, `${relative}: .in("draft_id") must be inside the pagination callback`);
        const callbackText = text.slice(callback.body.pos, callback.body.end);
        assert.match(callbackText, /\.range\(from,\s*to\)/, `${relative}: paginated query needs the current range`);
        assert.match(callbackText, /\.order\("id"\)/, `${relative}: paginated query needs a unique id tie-breaker`);
        if (/\.order\("sort_order"/.test(callbackText)) {
          assert.ok(callbackText.indexOf('.order("sort_order"') < callbackText.indexOf('.order("id")'), `${relative}: preserve sort_order before id`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}
assert.ok(queryCount >= 14, `expected all approved batch draft_id/image_id selects, found ${queryCount}`);

console.log(`HOTFIX-2 pagination verification passed (${queryCount} protected batch image/variant selects).`);
