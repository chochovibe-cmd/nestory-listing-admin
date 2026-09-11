import assert from "node:assert/strict";
import fs from "node:fs";

const panel = fs.readFileSync("src/components/listing/DraftResultsPanel.tsx", "utf8");
const css = fs.readFileSync("src/app/d311-desktop-results-toolbar.css", "utf8");
const layout = fs.readFileSync("src/app/layout.tsx", "utf8");
const globals = fs.readFileSync("src/app/globals.css", "utf8");
const d33 = fs.readFileSync("src/app/d33-mobile-uiux.css", "utf8");

assert.doesNotMatch(css, /!important/);
assert.match(css, /@media \(min-width:\s*960px\)/);
assert.doesNotMatch(css, /@media \(max-width:/);

const d310ImportPos = layout.indexOf('import "./d310d1-mobile-character-picker.css";');
const d311ImportPos = layout.indexOf('import "./d311-desktop-results-toolbar.css";');
assert.ok(d310ImportPos >= 0 && d311ImportPos > d310ImportPos, "D3.11 must load after D3.10 mobile layers");

assert.match(globals, /\.shell--login\s*\{[\s\S]*grid-template-columns:\s*1fr;/);

assert.match(css, /\.workbench-panes \.results-panel > \.rc-panel-header \{[\s\S]*min-height:\s*52px;/);
assert.match(css, /\.results-panel \.rc-selection-guide-row\s*\{[\s\S]*display:\s*none;/);
assert.match(css, /\.rc-header-seq-btn\.nb-btn\s*\{[\s\S]*min-height:\s*26px;[\s\S]*height:\s*26px;/);
assert.match(css, /\.rc-toggle-track\s*\{[\s\S]*width:\s*88px;[\s\S]*height:\s*26px;[\s\S]*border-radius:\s*999px;/);
assert.match(css, /content:\s*"全選"/);
assert.match(css, /input\[type="checkbox"\][\s\S]*opacity:\s*0;/);
assert.match(css, /--results-ctrl-h:\s*36px;/);
assert.match(css, /border:\s*var\(--frame-w\) solid var\(--border\)/);

const scopePos = panel.indexOf('className="results-scope-label"');
const tabsPos = panel.indexOf("<StageFilterPills");
const endPos = panel.indexOf('className="stage-filter-end"');
assert.ok(scopePos > 0 && tabsPos > scopePos && endPos > tabsPos, "只看我的 must precede station pills in source");

assert.match(d33, /@media \(max-width:\s*959px\)[\s\S]*?\.stage-filter-row\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/);
assert.match(d33, /\.rc-selection-guide-row \.rc-header-select-all--mobile/);

console.log("D3.11 desktop results toolbar contract passed");
