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
assert.doesNotMatch(d39bCss, /@media \(min-width:/);

// D3.8 remains the accepted interaction baseline; D3.9B supersedes presentation only.
const d35ImportPos = layout.indexOf('import "./d34b-iphone-corrective.css";');
const d36ImportPos = layout.indexOf('import "./d36-owner-ui-consistency.css";');
const d38ImportPos = layout.indexOf('import "./d38-mobile-variant-horizontal.css";');
const d39aImportPos = layout.indexOf('import "./d39a-mobile-review-polish.css";');
const d39bImportPos = layout.indexOf('import "./d39b-mobile-variant-table.css";');
assert.ok(
  d35ImportPos >= 0 && d36ImportPos > d35ImportPos && d38ImportPos > d36ImportPos &&
  d39aImportPos > d38ImportPos && d39bImportPos > d39aImportPos
);

// Each mobile row still owns horizontal scrolling; page-level overflow is not introduced.
assert.match(d38Css, /\.variant-box \.vgrid-block--mobile\s*\{[\s\S]*width:\s*100%;[\s\S]*max-width:\s*100%;[\s\S]*min-width:\s*0;[\s\S]*overflow-x:\s*auto;[\s\S]*overflow-y:\s*hidden;[\s\S]*overscroll-behavior-inline:\s*contain;[\s\S]*-webkit-overflow-scrolling:\s*touch;[\s\S]*scrollbar-width:\s*none;/);
assert.match(d38Css, /\.vgrid-block--mobile::\-webkit-scrollbar\s*\{[\s\S]*display:\s*none;/);
assert.match(d38Css, /\.vgrid-block--mobile:has\(\.v-pop-pick\.open\)\s*\{[\s\S]*overflow-x:\s*clip;[\s\S]*overflow-y:\s*visible;/);

// Row remains one non-wrapping max-content flex line. D3.9B only tightens its spacing.
assert.match(d38Css, /\.v-mobile-row-core\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-flow:\s*row nowrap;[\s\S]*align-items:\s*center;[\s\S]*width:\s*max-content;[\s\S]*min-width:\s*100%;/);
assert.match(d39bCss, /\.v-mobile-row-core\s*\{[\s\S]*gap:\s*0;/);

// D3.9B owner decision supersedes D3.8's framed readonly presentation.
assert.match(d39bCss, /\.v-mobile-option\s*\{[\s\S]*min-width:\s*var\(--vm-option-w\);[\s\S]*border:\s*0;[\s\S]*background:\s*transparent;[\s\S]*box-shadow:\s*none;/);
assert.match(d39bCss, /\.v-mobile-option-label\s*\{[\s\S]*display:\s*none;/);
assert.match(d39bCss, /\.v-mobile-option-value\s*\{[\s\S]*white-space:\s*nowrap;[\s\S]*text-overflow:\s*clip;[\s\S]*overflow-wrap:\s*normal;/);
assert.match(d39bCss, /\.v-mobile-price-result\s*\{[\s\S]*min-width:\s*var\(--vm-price-w\);[\s\S]*border:\s*0;[\s\S]*background:\s*transparent;[\s\S]*box-shadow:\s*none;/);
assert.match(d39bCss, /\.v-row-dup--icon\s*\{[\s\S]*border:\s*0;[\s\S]*background:\s*transparent;/);
assert.match(d39bCss, /\.variant-del--trash\s*\{[\s\S]*border:\s*0;[\s\S]*background:\s*transparent;/);
assert.doesNotMatch(d39bCss, /text-overflow:\s*ellipsis|-webkit-line-clamp:\s*2/);

// D3.8 geometry/semantics still underpin the final presentation.
assert.match(d38Css, /\.v-row-badge\s*\{[\s\S]*inline-size:\s*28px;[\s\S]*block-size:\s*28px;/);
assert.match(d38Css, /\.vthumb\s*\{[\s\S]*inline-size:\s*52px;[\s\S]*block-size:\s*52px;/);
assert.match(d38Css, /\.v-mobile-cost\s*\{[\s\S]*flex:\s*0 0 92px;[\s\S]*width:\s*92px;/);
assert.match(d38Css, /\.v-mobile-inventory\s*\{[\s\S]*flex:\s*0 0 156px;[\s\S]*width:\s*156px;/);

const mobileRowStart = render.indexOf('className="v-mobile-row-core"');
const desktopStart = render.indexOf('className="vgrid-hdr"', mobileRowStart);
assert.ok(mobileRowStart >= 0 && desktopStart > mobileRowStart);
const mobileRow = render.slice(mobileRowStart, desktopStart);
const orderedTokens = [
  'className="vdrag vdrag--touch"',
  'className="v-row-badge"',
  'renderImagePicker(ctx, row, index)',
  'className="v-mobile-options"',
  'className="v-mobile-price-result"',
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

console.log("D3.8 mobile Variant horizontal interaction contract passed with D3.9B presentation supersession");
