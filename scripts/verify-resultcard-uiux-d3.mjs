import assert from "node:assert/strict";
import fs from "node:fs";

const panel = fs.readFileSync("src/components/listing/DraftResultsPanel.tsx", "utf8");
const card = fs.readFileSync("src/components/listing/ResultCard.tsx", "utf8");
const variants = fs.readFileSync("src/components/listing/VariantEditor.tsx", "utf8");
const layout = fs.readFileSync("src/app/layout.tsx", "utf8");
const shell = fs.readFileSync("src/components/AppShell.tsx", "utf8");
const css = fs.readFileSync("src/app/resultcard-mobile-release.css", "utf8");

assert.match(panel, /rc-header-select-all--desktop[\s\S]*StageFilterPills/);
assert.match(panel, /rc-selection-guide-row[\s\S]*rc-header-select-all--mobile[\s\S]*rc-gesture-hint/);
assert.match(panel, /rc-toggle-track/);
assert.match(card, /rc-sale-badge[\s\S]*rc-variant-count/);
assert.match(card, /!isImageStation && priceRangeLabel/);
assert.equal((card.match(/className="rc-swipe-remove"/g) ?? []).length, 3);
assert.equal((card.match(/archiveOne\(\)/g) ?? []).length >= 4, true);
assert.match(variants, /<details className="vh-builder"/);
assert.match(variants, /vh-add-dim-wrap[\s\S]*v-pop-dim vh-inline-pop/);
assert.doesNotMatch(variants, /moreOpen|vh-more-btn|更多規格操作|更多操作/);
assert.match(variants, /套用成本[\s\S]*依角色建立/);
assert.match(variants, /vdrag--mobile/);
assert.match(layout, /<AppShell>\{children\}<\/AppShell>/);
assert.match(shell, /pathname === "\/login"/);
assert.match(shell, /!isLogin \? <AppSidebar \/>/);
assert.match(shell, /!isLogin \? \([\s\S]*<MobileTabbar/);
assert.match(css, /results-sort-label:focus-within[\s\S]*box-shadow: none/);
assert.match(css, /rc-head-chips[\s\S]*flex-wrap: wrap/);

console.log("ResultCard UIUX D3 source checks passed");
