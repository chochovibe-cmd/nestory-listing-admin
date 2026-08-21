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
const dropAxis = functionBody(editor, "dropAxisValue", "renameAxisValue");
const confirmExpand = functionBody(editor, "confirmPendingAxisChange", "duplicateRow");

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
assert.match(confirmExpand, /confirmArm\.nextDimensions \?\? dimensions/);
assert.match(confirmExpand, /targetDimensions/);
assert.match(confirmExpand, /onDimensionsChange\(targetDimensions\)/);
// D3.4B removes the ordinary manual expand control. The only visible expand
// action is the pre-existing destructive-change confirmation.
assert.match(editor, /const expandArmed = confirmArm\?\.kind === "expand"/);
assert.match(editor, /expandArmed \? \([\s\S]*確認更新款式/);
assert.doesNotMatch(editor, />重新展開</);

console.log("Variant axis atomic-confirm checks passed (D3.4B auto-expand UI acknowledged)");
