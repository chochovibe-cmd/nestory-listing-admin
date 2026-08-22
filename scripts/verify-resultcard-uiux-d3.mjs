import assert from "node:assert/strict";
import fs from "node:fs";

const panel = fs.readFileSync("src/components/listing/DraftResultsPanel.tsx", "utf8");
const card = fs.readFileSync("src/components/listing/ResultCard.tsx", "utf8");
const variants = fs.readFileSync("src/components/listing/VariantEditor.tsx", "utf8") + "\n" + fs.readFileSync("src/components/listing/VariantEditorRender.tsx", "utf8");
const layout = fs.readFileSync("src/app/layout.tsx", "utf8");
const shell = fs.readFileSync("src/components/AppShell.tsx", "utf8");
const css = fs.readFileSync("src/app/resultcard-mobile-release.css", "utf8");
const finalCss = fs.readFileSync("src/app/d34b-iphone-corrective.css", "utf8");

assert.match(panel, /rc-header-select-all--desktop[\s\S]*StageFilterPills/);
assert.match(panel, /rc-selection-guide-row[\s\S]*rc-header-select-all--mobile[\s\S]*rc-gesture-hint/);
// D3.5 supersedes the historical switch presentation but keeps the native
// checkbox and indeterminate behavior.
assert.match(panel, /type="checkbox"/);
assert.match(panel, /el\.indeterminate\s*=\s*someSelected/);
assert.match(finalCss, /rc-header-select-all \.rc-toggle-track\s*\{[\s\S]*display:\s*none;/);
assert.match(card, /rc-sale-badge[\s\S]*rc-variant-count/);
assert.match(card, /!isImageStation && priceRangeLabel/);
// D3.7 supersedes D3's three duplicated per-station remove buttons with one
// shared left-swipe remove action. Preserve archive semantics, not DOM count.
assert.match(
  card,
  /const removeSwipeAction =[\s\S]*className="rc-swipe-remove"[\s\S]*archiveOne\(\)/
);
assert.equal((card.match(/archiveOne\(\)/g) ?? []).length >= 4, true);
assert.match(variants, /const \[builderOpen, setBuilderOpen\][\s\S]*<details[\s\S]*className="vh-builder"[\s\S]*open=\{builderOpen\}[\s\S]*onToggle=/);
// D3.4B supersedes D3's in-flow dimension popover with one shared modal.
assert.match(variants, /variant-editor-modal-backdrop[\s\S]*editorModal\.kind === "add-dimension"/);
assert.doesNotMatch(variants, /moreOpen|vh-more-btn|更多規格操作|更多操作/);
// Desktop still retains the legacy safe blank-cost action and role builder.
assert.match(variants, /依角色建立[\s\S]*套用成本/);
// D3.4B supersedes the mobile arrow fallback with a real Pointer Events handle.
assert.match(variants, /vdrag vdrag--touch/);
assert.match(layout, /<AppShell>\{children\}<\/AppShell>/);
assert.match(shell, /pathname === "\/login"/);
assert.match(shell, /!isLogin \? <AppSidebar \/>/);
assert.match(shell, /!isLogin \? \([\s\S]*<MobileTabbar/);
assert.match(css, /results-sort-label:focus-within[\s\S]*box-shadow: none/);
assert.match(css, /rc-head-chips[\s\S]*flex-wrap: wrap/);

console.log("ResultCard UIUX D3 source checks passed (D3.5 owner supersessions acknowledged)");
