import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync("src/components/listing/VariantEditor.tsx", "utf8");
const render = fs.readFileSync("src/components/listing/VariantEditorRender.tsx", "utf8");
const d38Css = fs.readFileSync("src/app/d38-mobile-variant-horizontal.css", "utf8");
const css = fs.readFileSync("src/app/d39b-mobile-variant-table.css", "utf8");
const layout = fs.readFileSync("src/app/layout.tsx", "utf8");

assert.doesNotMatch(css, /!important/);
assert.match(css, /@media \(max-width:\s*959px\)/);
assert.doesNotMatch(css, /@media \(min-width:/);

// Final cascade: D3.9B is mobile-only and must load after frozen D3.9A.
const d38ImportPos = layout.indexOf('import "./d38-mobile-variant-horizontal.css";');
const d39aImportPos = layout.indexOf('import "./d39a-mobile-review-polish.css";');
const d39bImportPos = layout.indexOf('import "./d39b-mobile-variant-table.css";');
assert.ok(d38ImportPos >= 0 && d39aImportPos > d38ImportPos && d39bImportPos > d39aImportPos);

// A — mobile column header exists only inside the isNarrow render branch and uses dimHeaders.
const mobileBranchStart = render.indexOf(') : isNarrow ? (');
const mobileResultsStart = render.indexOf('className="v-mobile-results"', mobileBranchStart);
const desktopStart = render.indexOf('className="vgrid-hdr"', mobileResultsStart);
assert.ok(mobileBranchStart >= 0 && mobileResultsStart > mobileBranchStart && desktopStart > mobileResultsStart);
const mobileBranch = render.slice(mobileResultsStart, desktopStart);
assert.match(mobileBranch, /className="v-mobile-results-header-scroll"/);
assert.match(mobileBranch, /className="v-mobile-results-header"/);
assert.match(mobileBranch, /dimHeaders\.length > 0 \? dimHeaders : \[\{ name: "款式" \}\]/);
assert.doesNotMatch(render.slice(desktopStart), /v-mobile-results-header-scroll|v-mobile-results-header/);

const headerStart = mobileBranch.indexOf('className="v-mobile-results-header"');
const rowsStart = mobileBranch.indexOf('{rows.map(', headerStart);
assert.ok(headerStart >= 0 && rowsStart > headerStart);
const header = mobileBranch.slice(headerStart, rowsStart);
const headerTokens = [
  '>排序</span>',
  '>序列</span>',
  '>縮圖</span>',
  'v-mobile-header-cell--option',
  '>價格</span>',
  '>成本</span>',
  '>庫存</span>',
  '>複製</span>',
  '>刪除</span>'
];
let headerPrevious = -1;
for (const token of headerTokens) {
  const next = header.indexOf(token);
  assert.ok(next > headerPrevious, `mobile Variant header order mismatch at ${token}`);
  headerPrevious = next;
}

// Header scroll contract: independent horizontal guide, no JS synchronization.
assert.match(css, /\.v-mobile-results-header-scroll\s*\{[\s\S]*width:\s*100%;[\s\S]*max-width:\s*100%;[\s\S]*overflow-x:\s*auto;[\s\S]*overflow-y:\s*hidden;[\s\S]*scrollbar-width:\s*none;/);
assert.match(css, /\.v-mobile-results-header-scroll::\-webkit-scrollbar\s*\{[\s\S]*display:\s*none;/);
assert.match(css, /\.v-mobile-results-header\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-flow:\s*row nowrap;[\s\S]*width:\s*max-content;[\s\S]*min-width:\s*100%;[\s\S]*border-bottom:\s*1px solid var\(--border\);[\s\S]*font-size:\s*10px;[\s\S]*font-weight:\s*800;[\s\S]*white-space:\s*nowrap;/);
assert.doesNotMatch(mobileBranch, /onScroll=|scrollLeft|addEventListener\(["']scroll/);

// Shared geometry tokens and D3.8 row-local horizontal interaction remain intact.
for (const token of [
  '--vm-drag-w: 44px;', '--vm-seq-w: 28px;', '--vm-thumb-w: 52px;', '--vm-option-w: 136px;',
  '--vm-price-w: 154px;', '--vm-cost-w: 92px;', '--vm-inventory-w: 156px;', '--vm-action-w: 44px;'
]) assert.ok(css.includes(token));
assert.match(d38Css, /\.vgrid-block--mobile\s*\{[\s\S]*overflow-x:\s*auto;[\s\S]*overflow-y:\s*hidden;/);
assert.match(d38Css, /\.v-mobile-row-core\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-flow:\s*row nowrap;[\s\S]*width:\s*max-content;[\s\S]*min-width:\s*100%;/);
assert.match(css, /\.v-mobile-row-core\s*\{[\s\S]*gap:\s*0;/);

// C — leading cluster spacing is intentionally tighter than the old common 8px gap.
assert.match(css, /\.vdrag--touch\s*\{[\s\S]*margin-right:\s*var\(--sp-1\);/);
assert.match(css, /\.v-row-badge\s*\{[\s\S]*margin-right:\s*var\(--sp-1\);/);
assert.match(css, /\.vthumb-wrap\s*\{[\s\S]*margin-right:\s*var\(--sp-2\);/);

// B — readonly option/price and copy/trash controls are frameless in the final layer.
assert.match(css, /\.v-mobile-option\s*\{[\s\S]*min-width:\s*var\(--vm-option-w\);[\s\S]*border:\s*0;[\s\S]*border-radius:\s*0;[\s\S]*background:\s*transparent;[\s\S]*box-shadow:\s*none;/);
assert.match(css, /\.v-mobile-option-label\s*\{[\s\S]*display:\s*none;/);
assert.match(css, /\.v-mobile-price-result\s*\{[\s\S]*min-width:\s*var\(--vm-price-w\);[\s\S]*border:\s*0;[\s\S]*border-radius:\s*0;[\s\S]*background:\s*transparent;[\s\S]*box-shadow:\s*none;[\s\S]*white-space:\s*nowrap;/);
assert.match(css, /\.v-row-dup--icon\s*\{[\s\S]*block-size:\s*44px;[\s\S]*border:\s*0;[\s\S]*background:\s*transparent;[\s\S]*box-shadow:\s*none;/);
assert.match(css, /\.variant-del--trash\s*\{[\s\S]*block-size:\s*44px;[\s\S]*border:\s*0;[\s\S]*background:\s*transparent;[\s\S]*box-shadow:\s*none;[\s\S]*color:\s*var\(--danger\);/);

// Option value is one natural-width line: no clamp, wrapping, or ellipsis.
assert.match(css, /\.v-mobile-option-value\s*\{[\s\S]*width:\s*max-content;[\s\S]*overflow:\s*visible;[\s\S]*-webkit-line-clamp:\s*unset;[\s\S]*line-clamp:\s*unset;[\s\S]*white-space:\s*nowrap;[\s\S]*text-overflow:\s*clip;[\s\S]*overflow-wrap:\s*normal;/);
assert.doesNotMatch(css, /text-overflow:\s*ellipsis|-webkit-line-clamp:\s*2|white-space:\s*normal/);

// Price values prefer one horizontal row without changing business-facing wording.
assert.match(mobileBranch, /className="v-mobile-price-copy"[\s\S]*售價 NT\$\{row\.sellPrice \|\| "—"\}[\s\S]*定價 NT\$\{row\.compareAt \|\| "—"\}/);
assert.match(css, /\.v-mobile-price-copy\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*flex-flow:\s*row nowrap;[\s\S]*white-space:\s*nowrap;/);

// Exact mobile data order and business handlers stay unchanged.
const mobileRowStart = mobileBranch.indexOf('className="v-mobile-row-core"');
const mobileRow = mobileBranch.slice(mobileRowStart);
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
  assert.ok(next > previous, `mobile Variant row order mismatch at ${token}`);
  previous = next;
}
assert.match(mobileRow, /v-row-dup--icon[\s\S]*onClick=\{\(\) => duplicateRow\(index\)\}/);
assert.match(mobileRow, /variant-del variant-del--trash[\s\S]*onClick=\{\(\) => removeRow\(index\)\}/);

// Frozen interaction guards and desktop branch separation.
assert.match(main, /const ROW_LONG_PRESS_MS = 500;/);
assert.match(main, /const TOUCH_DRAG_PX = 8;/);
assert.match(render, /\) : isNarrow \? \([\s\S]*v-mobile-results[\s\S]*\) : \([\s\S]*vgrid-hdr/);
assert.match(render, /className="vdrag"[\s\S]*draggable/);
assert.match(render, /className="v-cell"[\s\S]*<input/);

console.log("D3.9B mobile Variant table presentation contract passed");
