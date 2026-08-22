import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync("src/components/listing/VariantEditor.tsx", "utf8");
const render = fs.readFileSync("src/components/listing/VariantEditorRender.tsx", "utf8");
const d38Css = fs.readFileSync("src/app/d38-mobile-variant-horizontal.css", "utf8");
const d39bCss = fs.readFileSync("src/app/d39b-mobile-variant-table.css", "utf8");
const layout = fs.readFileSync("src/app/layout.tsx", "utf8");

assert.doesNotMatch(d38Css, /!important/);
assert.doesNotMatch(d39bCss, /!important/);
assert.match(d38Css, /@media \(max-width:\s*959px\)/);
assert.match(d39bCss, /@media \(max-width:\s*959px\)/);

const d35ImportPos = layout.indexOf('import "./d34b-iphone-corrective.css";');
const d36ImportPos = layout.indexOf('import "./d36-owner-ui-consistency.css";');
const d38ImportPos = layout.indexOf('import "./d38-mobile-variant-horizontal.css";');
const d39aImportPos = layout.indexOf('import "./d39a-mobile-review-polish.css";');
const d39bImportPos = layout.indexOf('import "./d39b-mobile-variant-table.css";');
assert.ok(
  d35ImportPos >= 0 && d36ImportPos > d35ImportPos && d38ImportPos > d36ImportPos &&
  d39aImportPos > d38ImportPos && d39bImportPos > d39aImportPos
);

// D3.10A supersedes D3.8 row-local scrolling: the row remains max-content/nowrap,
// but only the shared parent owns horizontal overflow.
assert.match(d38Css, /\.vgrid-block--mobile\s*\{[\s\S]*width:\s*max-content;[\s\S]*min-width:\s*100%;[\s\S]*overflow:\s*visible;/);
assert.doesNotMatch(d38Css, /\.vgrid-block--mobile\s*\{[^}]*overflow-x:\s*auto;/);
assert.match(d38Css, /\.v-mobile-row-core\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-flow:\s*row nowrap;[\s\S]*width:\s*max-content;[\s\S]*min-width:\s*100%;/);
assert.match(d39bCss, /\.v-mobile-table-scroll\s*\{[\s\S]*width:\s*100%;[\s\S]*max-width:\s*100%;[\s\S]*overflow-x:\s*auto;[\s\S]*overflow-y:\s*hidden;[\s\S]*overscroll-behavior-inline:\s*contain;[\s\S]*-webkit-overflow-scrolling:\s*touch;[\s\S]*scrollbar-width:\s*none;/);
assert.match(d39bCss, /\.v-mobile-table-scroll::\-webkit-scrollbar\s*\{[\s\S]*display:\s*none;/);

const mobileBranchStart = render.indexOf(') : isNarrow ? (');
const mobileResultsStart = render.indexOf('className="v-mobile-results"', mobileBranchStart);
const desktopStart = render.indexOf('className="vgrid-hdr"', mobileResultsStart);
assert.ok(mobileBranchStart >= 0 && mobileResultsStart > mobileBranchStart && desktopStart > mobileResultsStart);
const mobileBranch = render.slice(mobileResultsStart, desktopStart);
assert.match(mobileBranch, /className="v-mobile-table-scroll"/);
assert.match(mobileBranch, /className="v-mobile-results-header"/);
assert.match(mobileBranch, /className="v-mobile-results-body"/);
assert.doesNotMatch(mobileBranch, /v-mobile-results-header-scroll/);

const mobileRowStart = mobileBranch.indexOf('className="v-mobile-row-core"');
const mobileRow = mobileBranch.slice(mobileRowStart);
const orderedTokens = [
  'className="vdrag vdrag--touch"',
  'className="v-row-badge"',
  'renderImagePicker(ctx, row, index)',
  'className="v-mobile-options"',
  'v-mobile-price-cell--sell',
  'className="v-mobile-cost"',
  'className="v-mobile-inventory"',
  'className="v-row-dup--icon"',
  'className="variant-del variant-del--trash"'
];
let previous = -1;
for (const token of orderedTokens) {
  const next = mobileRow.indexOf(token);
  assert.ok(next > previous, `mobile Variant order mismatch at ${token}`);
  previous = next;
}

assert.match(mobileRow, /v-row-dup--icon[\s\S]*onClick=\{\(\) => duplicateRow\(index\)\}/);
assert.match(mobileRow, /variant-del variant-del--trash[\s\S]*onClick=\{\(\) => removeRow\(index\)\}/);
assert.match(main, /function duplicateRow\(index: number\)[\s\S]*\.\.\.rows\.slice\(0, index \+ 1\),[\s\S]*copy,[\s\S]*\.\.\.rows\.slice\(index \+ 1\)/);
assert.match(main, /const ROW_LONG_PRESS_MS = 500;/);
assert.match(main, /const TOUCH_DRAG_PX = 8;/);
assert.match(render, /\) : isNarrow \? \([\s\S]*v-mobile-results[\s\S]*\) : \([\s\S]*vgrid-hdr/);
assert.match(render, /className="vdrag"[\s\S]*draggable/);
assert.match(render, /className="v-cell"[\s\S]*<input/);

console.log("D3.8 mobile Variant interaction contract passed with D3.10A shared-scroll supersession");
