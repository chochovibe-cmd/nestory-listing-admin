import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync("src/components/listing/VariantEditor.tsx", "utf8");
const render = fs.readFileSync("src/components/listing/VariantEditorRender.tsx", "utf8");
const css = fs.readFileSync("src/app/d38-mobile-variant-horizontal.css", "utf8");
const layout = fs.readFileSync("src/app/layout.tsx", "utf8");

assert.doesNotMatch(css, /!important/);
assert.match(css, /@media \(max-width:\s*959px\)/);
assert.doesNotMatch(css, /@media \(min-width:\s*960px\)/);

// Final cascade: D3.8 must load after D3.5 and the D3.6 owner layer.
const d35ImportPos = layout.indexOf('import "./d34b-iphone-corrective.css";');
const d36ImportPos = layout.indexOf('import "./d36-owner-ui-consistency.css";');
const d38ImportPos = layout.indexOf('import "./d38-mobile-variant-horizontal.css";');
assert.ok(d35ImportPos >= 0 && d36ImportPos > d35ImportPos && d38ImportPos > d36ImportPos);

// Mobile container — each row owns horizontal scrolling; no page-level scroll contract.
assert.match(css, /\.variant-box \.vgrid-block--mobile\s*\{[\s\S]*width:\s*100%;[\s\S]*max-width:\s*100%;[\s\S]*min-width:\s*0;[\s\S]*overflow-x:\s*auto;[\s\S]*overflow-y:\s*hidden;[\s\S]*overscroll-behavior-inline:\s*contain;[\s\S]*-webkit-overflow-scrolling:\s*touch;[\s\S]*scrollbar-width:\s*none;/);
assert.match(css, /\.vgrid-block--mobile::\-webkit-scrollbar\s*\{[\s\S]*display:\s*none;/);
assert.doesNotMatch(css, /(?:html|body)[^{]*\{[^}]*overflow-x:\s*(?:auto|scroll)/);

// Image picker escape hatch remains operable outside the row scroll clip.
assert.match(css, /\.vgrid-block--mobile:has\(\.v-pop-pick\.open\)\s*\{[\s\S]*overflow-x:\s*clip;[\s\S]*overflow-y:\s*visible;/);

// Row is one non-wrapping horizontal data line.
assert.match(css, /\.v-mobile-row-core\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-flow:\s*row nowrap;[\s\S]*align-items:\s*center;[\s\S]*gap:\s*var\(--sp-2\);[\s\S]*width:\s*max-content;[\s\S]*min-width:\s*100%;/);

// Readonly option cards are visible, untruncated fields.
assert.match(css, /\.v-mobile-option\s*\{[\s\S]*flex:\s*0 0 136px;[\s\S]*min-width:\s*136px;[\s\S]*max-width:\s*168px;[\s\S]*min-height:\s*52px;[\s\S]*border:\s*1px solid var\(--border\);[\s\S]*border-radius:\s*var\(--radius-s\);[\s\S]*background:\s*var\(--surface\);/);
assert.match(css, /\.v-mobile-option-value\s*\{[\s\S]*overflow:\s*visible;[\s\S]*-webkit-line-clamp:\s*unset;[\s\S]*line-clamp:\s*unset;[\s\S]*text-overflow:\s*clip;/);
assert.doesNotMatch(css, /-webkit-line-clamp:\s*2/);
assert.doesNotMatch(css, /text-overflow:\s*ellipsis/);

// Geometry: actions 44, sequence compact, thumbnail/readonly/price 52 baseline,
// editable cost 92/88, inventory 156.
assert.match(css, /\.vdrag--touch,[\s\S]*\.v-mobile-edit-icon\s*\{[\s\S]*inline-size:\s*44px;[\s\S]*block-size:\s*44px;[\s\S]*min-width:\s*44px;[\s\S]*min-height:\s*44px;[\s\S]*border-radius:\s*var\(--radius-s\);/);
assert.match(css, /\.v-row-badge\s*\{[\s\S]*inline-size:\s*28px;[\s\S]*block-size:\s*28px;[\s\S]*background:\s*var\(--surface2\);[\s\S]*font-size:\s*10px;/);
assert.match(css, /\.vthumb\s*\{[\s\S]*inline-size:\s*52px;[\s\S]*block-size:\s*52px;/);
assert.match(css, /\.v-mobile-price-result\s*\{[\s\S]*flex:\s*0 0 154px;[\s\S]*width:\s*154px;[\s\S]*min-height:\s*52px;[\s\S]*border:\s*1px solid color-mix/);
assert.match(css, /\.v-mobile-cost\s*\{[\s\S]*flex:\s*0 0 92px;[\s\S]*width:\s*92px;[\s\S]*grid-template-columns:\s*1fr;/);
assert.match(css, /\.v-mobile-cost input\s*\{[\s\S]*inline-size:\s*88px;[\s\S]*min-height:\s*44px;/);
assert.match(css, /\.v-mobile-inventory\s*\{[\s\S]*flex:\s*0 0 156px;[\s\S]*width:\s*156px;[\s\S]*min-width:\s*156px;/);

// Exact mobile visual/source order: drag → sequence → thumbnail → options →
// price → cost → inventory → copy → trash.
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

// Existing duplicate/delete handlers and duplicate-next semantics remain unchanged.
assert.match(mobileRow, /v-row-dup--icon[\s\S]*onClick=\{\(\) => duplicateRow\(index\)\}/);
assert.match(mobileRow, /variant-del variant-del--trash[\s\S]*onClick=\{\(\) => removeRow\(index\)\}/);
assert.match(main, /function duplicateRow\(index: number\)[\s\S]*\.\.\.rows\.slice\(0, index \+ 1\),[\s\S]*copy,[\s\S]*\.\.\.rows\.slice\(index \+ 1\)/);

// Interaction guards are frozen.
assert.match(main, /const ROW_LONG_PRESS_MS = 500;/);
assert.match(main, /const TOUCH_DRAG_PX = 8;/);
assert.match(main, /onTouchDragPointerDown/);
assert.match(render, /onPointerDown=\{\(event\) => onTouchDragPointerDown\(index, event\)\}/);

// Inventory remains the existing semantic toggle/input path.
assert.match(mobileRow, /checked=\{!row\.qty\.trim\(\)\}/);
assert.match(mobileRow, /aria-label="庫存視為無限"/);
assert.match(mobileRow, /updateRow\(index, \{ qty:/);

// Desktop remains a separate native draggable/input branch.
assert.match(render, /\) : isNarrow \? \([\s\S]*v-mobile-results[\s\S]*\) : \([\s\S]*vgrid-hdr/);
assert.match(render, /className="vdrag"[\s\S]*draggable/);
assert.match(render, /className="v-cell"[\s\S]*<input/);

console.log("D3.8 mobile Variant horizontal row restore source contract passed");
