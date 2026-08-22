import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync("src/components/listing/VariantEditor.tsx", "utf8");
const render = fs.readFileSync("src/components/listing/VariantEditorRender.tsx", "utf8");
const css = fs.readFileSync("src/app/d39b-mobile-variant-table.css", "utf8");
const pricingCore = fs.readFileSync("src/lib/pricing.ts", "utf8");
const variantPricing = fs.readFileSync("src/lib/variants/variantPricing.ts", "utf8");
const workspace = fs.readFileSync("src/components/listing/WorkspaceInputPanel.tsx", "utf8");

function count(source, token) {
  return source.split(token).length - 1;
}

const mobileResultsStart = render.indexOf('className="v-mobile-results"');
const desktopStart = render.indexOf('className="vgrid-hdr"', mobileResultsStart);
assert.ok(mobileResultsStart >= 0 && desktopStart > mobileResultsStart);
const mobile = render.slice(mobileResultsStart, desktopStart);
const rowStart = mobile.indexOf('className="v-mobile-row-core"');
assert.ok(rowStart >= 0);
const mobileRow = mobile.slice(rowStart);

// A. One shared mobile price editor: sell is readonly-only; compare owns the sole trigger.
const sellCellStart = mobileRow.indexOf('className="v-mobile-price-cell v-mobile-price-cell--sell"');
const compareCellStart = mobileRow.indexOf('className="v-mobile-price-cell v-mobile-price-cell--compare"', sellCellStart);
const costCellStart = mobileRow.indexOf('className="v-mobile-cost"', compareCellStart);
const inventoryCellStart = mobileRow.indexOf('className="v-mobile-inventory"', costCellStart);
assert.ok(sellCellStart >= 0 && compareCellStart > sellCellStart && costCellStart > compareCellStart && inventoryCellStart > costCellStart);
const sellCell = mobileRow.slice(sellCellStart, compareCellStart);
const compareCell = mobileRow.slice(compareCellStart, costCellStart);
const costCell = mobileRow.slice(costCellStart, inventoryCellStart);

assert.doesNotMatch(sellCell, /kind: "edit-price"|aria-label="編輯售價"/);
assert.equal(count(compareCell, 'openEditorModal({ kind: "edit-price", rowIndex: index })'), 1);
assert.match(compareCell, /aria-label="編輯售價與定價"/);

const sharedModalStart = render.indexOf('editorModal.kind === "edit-price"');
const sharedModalEnd = render.indexOf('editorModal.kind === "batch-cost"', sharedModalStart);
assert.ok(sharedModalStart >= 0 && sharedModalEnd > sharedModalStart);
const sharedModal = render.slice(sharedModalStart, sharedModalEnd);
assert.match(sharedModal, /手動調整價格/);
assert.match(sharedModal, /售價 NT\$/);
assert.match(sharedModal, /定價 NT\$/);
assert.match(sharedModal, /onManualPrice\(editorModal\.rowIndex, modalValue, modalCompareAt\)/);

// A.2. Override ownership stays split, with one stronger theme-token warning pill.
assert.match(sellCell, /row\.sellPriceLocked[\s\S]*v-manual-override-tag[\s\S]*已手動覆蓋/);
assert.doesNotMatch(sellCell, /row\.compareAtLocked|costOverridden/);
assert.match(compareCell, /row\.compareAtLocked[\s\S]*v-manual-override-tag[\s\S]*已手動覆蓋/);
assert.doesNotMatch(compareCell, /row\.sellPriceLocked|costOverridden/);
assert.match(costCell, /costOverridden[\s\S]*v-manual-override-tag[\s\S]*已手動覆蓋/);
assert.doesNotMatch(costCell, /row\.sellPriceLocked|row\.compareAtLocked/);
assert.match(css, /\.v-manual-override-tag\s*\{[\s\S]*border:\s*1px solid color-mix\(in srgb, var\(--danger\)[\s\S]*background:\s*color-mix\(in srgb, var\(--danger\)[\s\S]*color:\s*color-mix\(in srgb, var\(--danger\)[\s\S]*font-weight:\s*800;/);

// B. Variant cost header and recalculation use the same product cost currency source.
assert.match(main, /const costLabel = currency === "CNY" \? "成本 ¥" : "成本 NT\$";/);
assert.match(mobile, /className="v-mobile-header-cell v-mobile-header-cell--cost">\{costLabel\}<\/span>/);
assert.match(workspace, /const \[costCurrency, setCostCurrency\] = useState<CostCurrency>\("CNY"\);/);
assert.match(workspace, /<VariantEditor[\s\S]*currency=\{costCurrency\}[\s\S]*productCost=\{parsedPrice > 0 \? parsedPrice : null\}/);
assert.match(workspace, /repriceVariants\(current, \{[\s\S]*currency: costCurrency,[\s\S]*productCost: parsedPrice > 0 \? parsedPrice : null/);
assert.match(variantPricing, /calculatePrice\(costNum, \{[\s\S]*currency: options\.currency,[\s\S]*priceMode: options\.priceMode/);
// TWD uses the raw TWD cost as base; only CNY multiplies by the FX rate.
assert.match(pricingCore, /const base = currency === "TWD" \? costInput : costInput \* settings\.rate;/);

// C. Shared geometry fixes the loose price pair and aligns cost/inventory controls.
for (const token of [
  '--vm-sell-w: 116px;',
  '--vm-compare-w: 140px;',
  '--vm-cost-w: 112px;',
  '--vm-inventory-w: 152px;',
  '--vm-cell-h: 52px;',
  '--vm-control-h: 44px;',
  '--vm-cell-pad: var(--sp-1);',
  '--vm-cell-gap: var(--sp-1);'
]) assert.ok(css.includes(token), `missing D3.10B geometry token ${token}`);

assert.match(css, /\.v-mobile-price-cell\s*\{[\s\S]*min-height:\s*var\(--vm-cell-h\);[\s\S]*justify-items:\s*center;[\s\S]*row-gap:\s*var\(--vm-cell-gap\);[\s\S]*padding-inline:\s*var\(--vm-cell-pad\);[\s\S]*text-align:\s*center;/);
assert.match(css, /\.v-mobile-price-cell--compare\s*\{[\s\S]*grid-template-columns:\s*32px minmax\(0, 1fr\) 32px;/);
assert.match(css, /\.v-mobile-price-cell--sell \.v-mobile-price-value\s*\{[\s\S]*grid-column:\s*1;/);
assert.match(css, /\.v-mobile-price-cell--compare \.v-mobile-price-value\s*\{[\s\S]*grid-column:\s*2;/);
assert.match(css, /\.v-mobile-price-cell \.v-mobile-edit-icon\s*\{[\s\S]*grid-column:\s*3;[\s\S]*block-size:\s*var\(--vm-control-h\);/);
assert.match(css, /\.v-mobile-cost\s*\{[\s\S]*min-height:\s*var\(--vm-cell-h\);[\s\S]*row-gap:\s*var\(--vm-cell-gap\);[\s\S]*padding-inline:\s*var\(--vm-cell-pad\);/);
assert.match(css, /\.v-mobile-inventory\s*\{[\s\S]*min-height:\s*var\(--vm-cell-h\);[\s\S]*gap:\s*var\(--vm-cell-gap\);[\s\S]*padding-inline:\s*var\(--vm-cell-pad\);/);
assert.match(css, /\.v-number-stepper\s*\{[\s\S]*height:\s*var\(--vm-control-h\);/);
assert.match(css, /\.v-inventory-toggle\s*\{[\s\S]*min-height:\s*var\(--vm-control-h\);/);

// Shared horizontal owner and desktop branch remain frozen.
assert.equal(count(mobile, 'className="v-mobile-table-scroll"'), 1);
assert.doesNotMatch(mobile, /v-mobile-results-header-scroll/);
assert.match(css, /@media \(max-width:\s*959px\)/);
assert.doesNotMatch(css, /@media \(min-width:/);
assert.doesNotMatch(css, /!important/);
const desktop = render.slice(desktopStart);
assert.match(desktop, /className="v-inline-edit"[\s\S]*kind: "edit-price"/);

console.log("D3.10B mobile Variant price/cost row polish contract passed");
