import assert from "node:assert/strict";
import fs from "node:fs";

const editor = fs.readFileSync("src/components/listing/VariantEditor.tsx", "utf8");
const planner = fs.readFileSync("src/lib/variants/variantAxisChange.ts", "utf8");

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : source.length;
  assert.notEqual(end, -1, `missing next function ${nextName}`);
  return source.slice(start, end);
}

const autoExpand = functionBody(editor, "tryAutoExpandFromDimensions", "addAxisValue");
const addAxis = functionBody(editor, "addAxisValue", "dropAxisValue");
const dropAxis = functionBody(editor, "dropAxisValue", "expandFromAxisValues");
const confirmExpand = functionBody(editor, "expandFromAxisValues", "duplicateRow");

assert.match(planner, /wouldDiscardHandFilled\.length\s*>\s*0/);
assert.match(planner, /kind:\s*"confirm"/);
assert.match(planner, /kind:\s*"apply"/);

assert.match(autoExpand, /planVariantAxisChange\(nextDims, currentRows\)/);
assert.match(autoExpand, /nextDimensions:\s*plan\.dimensions/);
assert.match(autoExpand, /onDimensionsChange\(plan\.dimensions\)/);
assert.match(autoExpand, /setRowsSafe\(withInheritedProductCost\(plan\.rows\)\)/);

assert.doesNotMatch(addAxis, /onDimensionsChange\(nextDims\)/);
assert.match(addAxis, /tryAutoExpandFromDimensions\(nextDims, rows\)/);
assert.doesNotMatch(dropAxis, /onDimensionsChange\(nextDims\)/);
assert.match(dropAxis, /tryAutoExpandFromDimensions\(nextDims, rows\)/);

assert.match(editor, /nextDimensions\?:\s*VariantDimension\[\]/);
assert.match(confirmExpand, /pendingDimensions/);
assert.match(confirmExpand, /targetDimensions/);
assert.match(confirmExpand, /onDimensionsChange\(targetDimensions\)/);
assert.match(editor, /const canExpand = expandArmed \|\| canExpandFromDimensions\(dimensions\)/);

console.log("Variant axis atomic-confirm checks passed");
