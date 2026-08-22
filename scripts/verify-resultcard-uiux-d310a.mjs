import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync("src/components/listing/VariantEditor.tsx", "utf8");
const render = fs.readFileSync("src/components/listing/VariantEditorRender.tsx", "utf8");
const d38Css = fs.readFileSync("src/app/d38-mobile-variant-horizontal.css", "utf8");
const css = fs.readFileSync("src/app/d39b-mobile-variant-table.css", "utf8");
const types = fs.readFileSync("src/lib/variants/types.ts", "utf8");
const pricing = fs.readFileSync("src/lib/variants/variantPricing.ts", "utf8");
const mapping = fs.readFileSync("src/lib/variants/variantMapping.ts", "utf8");
const crossExpand = fs.readFileSync("src/lib/variants/variantCrossExpand.ts", "utf8");
const mapDraft = fs.readFileSync("src/lib/drafts/mapDraftToWorkspaceForm.ts", "utf8");
const autosave = fs.readFileSync("src/lib/drafts/workspaceAutosave.ts", "utf8");
const newPage = fs.readFileSync("src/app/drafts/new/page.tsx", "utf8");
const migration = fs.readFileSync("supabase/migrations/20260822223100_variant_split_override_semantics.sql", "utf8");

function count(source, token) {
  return source.split(token).length - 1;
}

// A. Shared table: exactly one horizontal owner contains header + body + every row.
const mobileResultsStart = render.indexOf('className="v-mobile-results"');
const desktopStart = render.indexOf('className="vgrid-hdr"', mobileResultsStart);
assert.ok(mobileResultsStart >= 0 && desktopStart > mobileResultsStart);
const mobile = render.slice(mobileResultsStart, desktopStart);
assert.equal(count(mobile, 'className="v-mobile-table-scroll"'), 1);
const sharedScrollPos = mobile.indexOf('className="v-mobile-table-scroll"');
const headerPos = mobile.indexOf('className="v-mobile-results-header"', sharedScrollPos);
const bodyPos = mobile.indexOf('className="v-mobile-results-body"', headerPos);
const rowPos = mobile.indexOf('className="v-mobile-row-core"', bodyPos);
assert.ok(sharedScrollPos >= 0 && headerPos > sharedScrollPos && bodyPos > headerPos && rowPos > bodyPos);
assert.doesNotMatch(mobile, /v-mobile-results-header-scroll/);
assert.match(css, /\.v-mobile-table-scroll\s*\{[\s\S]*overflow-x:\s*auto;[\s\S]*overflow-y:\s*hidden;[\s\S]*overscroll-behavior-inline:\s*contain;[\s\S]*-webkit-overflow-scrolling:\s*touch;[\s\S]*scrollbar-width:\s*none;/);
assert.doesNotMatch(d38Css, /\.vgrid-block--mobile\s*\{[^}]*overflow-x:\s*auto;/);
assert.match(d38Css, /\.v-mobile-row-core\s*\{[\s\S]*flex-flow:\s*row nowrap;[\s\S]*width:\s*max-content;[\s\S]*min-width:\s*100%;/);

// D3.10B supersedes only the sell/compare presentation widths; the shared column contract remains.
for (const token of [
  '--vm-drag-w: 44px;',
  '--vm-seq-w: 28px;',
  '--vm-thumb-w: 52px;',
  '--vm-option-w: 168px;',
  '--vm-cost-w: 112px;',
  '--vm-inventory-w: 152px;',
  '--vm-action-w: 44px;'
]) assert.ok(css.includes(token), `missing D3.10A column token ${token}`);
for (const token of ['--vm-sell-w:', '--vm-compare-w:']) {
  assert.ok(css.includes(token), `missing shared price column token ${token}`);
}

// Complete header: dynamic dimensions; compare column is sale-only. D3.10B renders costLabel with currency.
assert.match(render, /const mobileHeaders = dimHeaders\.length > 0 \? dimHeaders : \[\{ name: "款式" \}\];/);
const header = mobile.slice(headerPos, bodyPos);
for (const label of ["排序", "序列", "縮圖", "售價", "庫存", "複製", "刪除"]) {
  assert.ok(header.includes(`>${label}</span>`), `missing mobile header ${label}`);
}
assert.match(header, /priceMode === "sale" \? <span className="v-mobile-header-cell v-mobile-header-cell--compare">定價<\/span> : null/);
assert.match(header, /className="v-mobile-header-cell v-mobile-header-cell--cost">\{costLabel\}<\/span>/);
assert.doesNotMatch(render, /款式1/);

// Data rows contain values only; mobile option/cost labels are not repeated.
const mobileRow = mobile.slice(rowPos);
assert.doesNotMatch(mobileRow, /v-mobile-option-label/);
assert.doesNotMatch(mobileRow, />\{costLabel\}<\/span>/);
assert.doesNotMatch(mobileRow, />售價<\/span>|>定價<\/span>/);

// B. Persistent split model + legacy compatibility.
for (const token of [
  "costIsInherited: boolean;",
  "sellPriceLocked: boolean;",
  "compareAtLocked: boolean;",
  "priceLocked: boolean;"
]) assert.ok(types.includes(token), `VariantFormRow missing ${token}`);
for (const token of [
  "cost_is_inherited: boolean;",
  "sell_price_locked: boolean;",
  "compare_at_locked: boolean;"
]) assert.ok(types.includes(token), `VariantDbInsert missing ${token}`);

assert.doesNotMatch(pricing, /if \(row\.priceLocked\) return row/);
assert.match(pricing, /const keepSell = sellLocked\(row\);/);
assert.match(pricing, /const keepCompare = compareLocked\(row\);/);
assert.match(pricing, /sellPrice:\s*keepSell \? row\.sellPrice : nextSell/);
assert.match(pricing, /compareAt:[\s\S]*keepCompare \? row\.compareAt : nextCompare/);
assert.match(pricing, /typeof row\.sellPriceLocked === "boolean" \? row\.sellPriceLocked : Boolean\(row\.priceLocked\)/);
assert.match(pricing, /typeof row\.compareAtLocked === "boolean" \? row\.compareAtLocked : Boolean\(row\.priceLocked\)/);

for (const token of [
  "cost_is_inherited: Boolean(row.costIsInherited)",
  "sell_price_locked: sellPriceLocked",
  "compare_at_locked: compareAtLocked",
  "price_locked: sellPriceLocked || compareAtLocked"
]) assert.ok(mapping.includes(token), `DB write mapping missing ${token}`);
assert.match(mapping, /typeof r\.sell_price_locked === "boolean" \? r\.sell_price_locked : legacyLocked/);
assert.match(mapping, /typeof r\.compare_at_locked === "boolean" \? r\.compare_at_locked : legacyLocked/);
assert.match(mapping, /typeof r\.cost_is_inherited === "boolean" \? r\.cost_is_inherited : inferredInherited/);
assert.match(mapping, /options\?: \{ productCost\?: number \| null \}/);

for (const token of ["cost_is_inherited?: boolean | null;", "sell_price_locked?: boolean | null;", "compare_at_locked?: boolean | null;"]) {
  assert.ok(mapDraft.includes(token), `draft reload type missing ${token}`);
}
assert.match(mapDraft, /dbRowsToForm\(dimsRaw, variants, \{[\s\S]*productCost: draft\.cny_price \?\? null/);
for (const token of ["cost_is_inherited", "sell_price_locked", "compare_at_locked", "price_locked"]) {
  assert.ok(newPage.includes(token), `draft reload SELECT missing ${token}`);
}
for (const token of ["costIsInherited?: boolean;", "sellPriceLocked?: boolean;", "compareAtLocked?: boolean;"]) {
  assert.ok(autosave.includes(token), `autosave snapshot missing ${token}`);
}
assert.match(autosave, /const sellPriceLocked =[\s\S]*legacyLocked/);
assert.match(autosave, /const compareAtLocked =[\s\S]*legacyLocked/);
assert.match(autosave, /const costIsInherited =[\s\S]*inferredInherited/);
for (const token of ["sellPriceLocked", "compareAtLocked", "costIsInherited"]) {
  assert.ok(crossExpand.includes(token), `cross-expand preservation missing ${token}`);
}

// Additive migration, NULL-preserving legacy fallback, no destructive backfill.
for (const token of [
  "add column if not exists cost_is_inherited boolean",
  "add column if not exists sell_price_locked boolean",
  "add column if not exists compare_at_locked boolean",
  "NULL means the row predates D3.10A"
]) assert.ok(migration.includes(token), `migration missing ${token}`);
assert.doesNotMatch(migration, /drop\s+column|alter\s+column[^;]+set\s+not\s+null|update\s+public\.product_variants/i);

// Override badges are scoped to the field that owns the override.
const sellCellStart = mobileRow.indexOf('className="v-mobile-price-cell v-mobile-price-cell--sell"');
const compareCellStart = mobileRow.indexOf('className="v-mobile-price-cell v-mobile-price-cell--compare"', sellCellStart);
const costCellStart = mobileRow.indexOf('className="v-mobile-cost"', compareCellStart);
const inventoryCellStart = mobileRow.indexOf('className="v-mobile-inventory"', costCellStart);
assert.ok(sellCellStart >= 0 && compareCellStart > sellCellStart && costCellStart > compareCellStart && inventoryCellStart > costCellStart);
const sellCell = mobileRow.slice(sellCellStart, compareCellStart);
const compareCell = mobileRow.slice(compareCellStart, costCellStart);
const costCell = mobileRow.slice(costCellStart, inventoryCellStart);
assert.match(sellCell, /row\.sellPriceLocked[\s\S]*已手動覆蓋/);
assert.doesNotMatch(sellCell, /row\.compareAtLocked|costOverridden/);
assert.match(compareCell, /row\.compareAtLocked[\s\S]*已手動覆蓋/);
assert.doesNotMatch(compareCell, /row\.sellPriceLocked|costOverridden/);
assert.match(costCell, /costOverridden[\s\S]*已手動覆蓋/);
assert.doesNotMatch(costCell, /row\.sellPriceLocked|row\.compareAtLocked/);

// C. Custom non-negative steppers and inventory inline swap.
assert.match(render, /function NumericStepper\(/);
assert.match(render, /type="number"[\s\S]*min="0"[\s\S]*step="1"/);
assert.match(render, /Math\.max\(0, base \+ delta\)/);
assert.match(costCell, /<NumericStepper value=\{row\.cost\}[\s\S]*onChange=\{\(value\) => onCostChange\(index, value\)\}/);
const inventoryCell = mobileRow.slice(inventoryCellStart, mobileRow.indexOf('className="v-row-dup--icon"', inventoryCellStart));
assert.match(inventoryCell, /checked=\{!row\.qty\.trim\(\)\}/);
assert.match(inventoryCell, /row\.qty\.trim\(\) \? \([\s\S]*<NumericStepper[\s\S]*value=\{row\.qty\}[\s\S]*integer[\s\S]*\) : \([\s\S]*v-inventory-inline-label[\s\S]*庫存視為無限/);
assert.doesNotMatch(inventoryCell, /className="v-qty"|<input[^>]*aria-label="庫存數量"/);

// Frozen interaction guards.
assert.match(main, /const ROW_LONG_PRESS_MS = 500;/);
assert.match(main, /const TOUCH_DRAG_PX = 8;/);
assert.match(main, /function duplicateRow\(index: number\)/);
assert.match(render, /onClick=\{\(\) => duplicateRow\(index\)\}/);
assert.match(render, /onClick=\{\(\) => removeRow\(index\)\}/);

console.log("D3.10A shared mobile table + persistent split overrides + stepper contract passed with D3.10B presentation supersession");
