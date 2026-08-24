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

const d38ImportPos = layout.indexOf('import "./d38-mobile-variant-horizontal.css";');
const d39aImportPos = layout.indexOf('import "./d39a-mobile-review-polish.css";');
const d39bImportPos = layout.indexOf('import "./d39b-mobile-variant-table.css";');
assert.ok(d38ImportPos >= 0 && d39aImportPos > d38ImportPos && d39bImportPos > d39aImportPos);

const mobileBranchStart = render.indexOf(') : isNarrow ? (');
const mobileResultsStart = render.indexOf('className="v-mobile-results"', mobileBranchStart);
const desktopStart = render.indexOf('className="vgrid-hdr"', mobileResultsStart);
assert.ok(mobileBranchStart >= 0 && mobileResultsStart > mobileBranchStart && desktopStart > mobileResultsStart);
const mobileBranch = render.slice(mobileResultsStart, desktopStart);

// D3.10A supersedes D3.9B's independent header/row scrolling with one shared track.
assert.match(mobileBranch, /className="v-mobile-table-scroll"/);
assert.match(mobileBranch, /className="v-mobile-results-header"/);
assert.match(mobileBranch, /className="v-mobile-results-body"/);
assert.doesNotMatch(mobileBranch, /v-mobile-results-header-scroll/);
assert.match(css, /\.v-mobile-table-scroll\s*\{[\s\S]*overflow-x:\s*auto;[\s\S]*overflow-y:\s*hidden;/);
assert.doesNotMatch(d38Css, /\.vgrid-block--mobile\s*\{[^}]*overflow-x:\s*auto;/);

// D3.10B supersedes the mobile cost/inventory presentation widths while the shared-table contract remains.
for (const token of [
  '--vm-drag-w: 44px;',
  '--vm-seq-w: 28px;',
  '--vm-thumb-w: 52px;',
  '--vm-option-w: 168px;',
  '--vm-cost-w: 116px;',
  '--vm-inventory-w: 160px;',
  '--vm-action-w: 44px;'
]) assert.ok(css.includes(token), `missing shared token ${token}`);
for (const token of ['--vm-sell-w:', '--vm-compare-w:']) {
  assert.ok(css.includes(token), `missing shared price token ${token}`);
}

// D3.9B presentation freeze remains: readonly options/prices and copy/trash are frameless.
assert.match(css, /\.v-mobile-option\s*\{[\s\S]*border:\s*0;[\s\S]*background:\s*transparent;[\s\S]*box-shadow:\s*none;/);
assert.match(css, /\.v-mobile-option-label\s*\{[\s\S]*display:\s*none;/);
assert.match(css, /\.v-mobile-price-cell\s*\{[\s\S]*border:\s*0;[\s\S]*background:\s*transparent;/);
assert.match(css, /\.v-row-dup--icon\s*\{[\s\S]*block-size:\s*44px;[\s\S]*border:\s*0;[\s\S]*background:\s*transparent;[\s\S]*box-shadow:\s*none;/);
assert.match(css, /\.variant-del--trash\s*\{[\s\S]*block-size:\s*44px;[\s\S]*border:\s*0;[\s\S]*background:\s*transparent;[\s\S]*color:\s*var\(--danger\);/);

// Complete mobile header splits sell/compare and uses the live cost currency label.
assert.match(render, /const mobileHeaders = dimHeaders\.length > 0 \? dimHeaders : \[\{ name: "款式" \}\];/);
assert.match(mobileBranch, />售價<\/span>/);
assert.match(mobileBranch, /priceMode === "sale" \? <span className="v-mobile-header-cell v-mobile-header-cell--compare">定價<\/span> : null/);
assert.match(mobileBranch, /v-mobile-header-cell--cost">\{costLabel\}<\/span>/);
assert.match(mobileBranch, />庫存<\/span>/);
assert.doesNotMatch(render, /款式1/);

const mobileRowStart = mobileBranch.indexOf('className="v-mobile-row-core"');
const mobileRow = mobileBranch.slice(mobileRowStart);
const orderedTokens = [
  'className="vdrag vdrag--touch"',
  'className="v-row-badge"',
  'renderImagePicker(ctx, row, index)',
  'className="v-mobile-options"',
  'v-mobile-price-cell--sell',
  'v-mobile-price-cell--compare',
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

assert.match(main, /const ROW_LONG_PRESS_MS = 500;/);
assert.match(main, /const TOUCH_DRAG_PX = 8;/);
assert.match(render, /className="vdrag"[\s\S]*draggable/);
assert.match(render, /className="v-cell"[\s\S]*<input/);

console.log("D3.9B presentation contract passed with D3.10A shared-table and D3.10B pricing-row supersession");
