import assert from "node:assert/strict";
import fs from "node:fs";

const panel = fs.readFileSync("src/components/listing/DraftResultsPanel.tsx", "utf8");
const variantMain = fs.readFileSync("src/components/listing/VariantEditor.tsx", "utf8");
const variantRender = fs.readFileSync("src/components/listing/VariantEditorRender.tsx", "utf8");
const variant = `${variantMain}\n${variantRender}`;
const css = fs.readFileSync("src/app/d34b-iphone-corrective.css", "utf8");
const login = fs.readFileSync("src/app/login/page.tsx", "utf8");

assert.doesNotMatch(css, /!important/);

// D3.6 supersedes D3.5 mobile select-all presentation only. Semantic checkbox,
// checked/indeterminate/toggleAll stay shared; desktop remains the D3.5 native checkbox.
assert.match(panel, /aria-label="全選目前列表"/);
assert.match(panel, /type="checkbox"/);
assert.match(panel, /el\.indeterminate\s*=\s*someSelected/);
assert.match(panel, /onChange=\{toggleAll\}/);
assert.match(css, /@media \(min-width:\s*960px\)[\s\S]*?\.rc-header-select-all \.rc-toggle-track\s*\{[\s\S]*?display:\s*none;/);
assert.match(css, /@media \(min-width:\s*960px\)[\s\S]*?input\[type="checkbox"\][\s\S]*?position:\s*static;[\s\S]*?opacity:\s*1;[\s\S]*?accent-color:\s*var\(--accent\)/);
assert.match(css, /@media \(max-width:\s*959px\)[\s\S]*?\.rc-toggle-track\s*\{[\s\S]*?display:\s*block;/);

// Desktop result controls: filter/scope/sort share one row; select-all is lifted
// out of the filter flow and positioned against results-panel itself so progress
// content cannot shift the review group.
assert.match(css, /@media \(min-width:\s*960px\)[\s\S]*\.results-panel\s*\{[\s\S]*position:\s*relative;/);
assert.match(css, /\.stage-filter-row\s*\{[\s\S]*flex-flow:\s*row nowrap;/);
assert.match(css, /\.stage-filter-row \.stage-filter-end\s*\{[\s\S]*flex-wrap:\s*nowrap;/);
assert.match(css, /\.stage-filter-row > \.rc-header-select-all--desktop\s*\{[\s\S]*position:\s*absolute;[\s\S]*top:\s*5px;/);
assert.match(css, /\.results-panel:has\(\.rc-header-seq-btn\)[\s\S]*right:\s*120px;/);
assert.match(panel, /rc-header-seq-btn/);

// Desktop login is widened only in the >=960px presentation layer; form/auth source stays simple.
assert.match(css, /@media \(min-width:\s*960px\)[\s\S]*\.login-panel\s*\{[\s\S]*max-width:\s*640px;/);
assert.match(login, /supabase\.auth\.signInWithPassword/);
assert.doesNotMatch(login, /mock-safe 骨架模式|潮巢 商品上架助手/);

// Mobile character picker uses the shared portal modal/bottom sheet. Desktop may
// still use charOpen inline; mobile action explicitly opens kind=character.
assert.match(variantMain, /vh-mobile-primary-actions[\s\S]*openEditorModal\(\{ kind: "character" \}\)/);
assert.match(variantRender, /\{ kind: "character" \}/);
assert.match(variantRender, /editorModal\.kind === "character"/);
assert.match(variantRender, /createPortal\(/);
assert.match(variantRender, /variant-editor-modal-backdrop/);
assert.match(variantRender, /v-char-list v-char-list--modal/);
assert.match(variantRender, /取消[\s\S]*建立所選角色列/);
assert.match(variantMain, /characterPickerOpen = charOpen \|\| editorModal\?\.kind === "character"/);
assert.match(variantMain, /\.from\("ip_characters"\)/);
assert.match(variantMain, /appendCharacterRows\(dimensions, rows, names\)/);

// Mobile top actions are exactly the final owner group. The old mobile-only add
// Variant entry is gone, while the underlying addRow/add-variant capability remains.
const mobileToolbar = variantMain.match(/<div className="vh-mobile-primary-actions"[\s\S]*?<\/div>/)?.[0] ?? "";
assert.match(mobileToolbar, /＋新增維度/);
assert.match(mobileToolbar, /依角色建立/);
assert.match(mobileToolbar, /批次手動覆蓋價格/);
assert.ok(mobileToolbar.indexOf("＋新增維度") < mobileToolbar.indexOf("依角色建立"));
assert.ok(mobileToolbar.indexOf("依角色建立") < mobileToolbar.indexOf("批次手動覆蓋價格"));
assert.doesNotMatch(variantRender, /vh-mobile-batch-actions/);
assert.doesNotMatch(variantRender, /vh-mobile-batch-btn[\s\S]{0,180}新增 Variant/);
assert.match(variantMain, /function addRow\(/);
assert.match(variantRender, /\{ kind: "add-variant" \}/);
assert.match(variantRender, /variant-editor-modal-title">新增 Variant/);

// Pricing/touch guards remain the same constants/helpers.
assert.match(variantMain, /ROW_LONG_PRESS_MS = 500/);
assert.match(variantMain, /TOUCH_DRAG_PX = 8/);
assert.match(variantMain, /recalculateUnlockedVariantPrices\(next,/);
assert.match(variantMain, /costIsInherited:\s*false/);

// Mobile row polish: bounded grid, compact chrome, max two readonly lines, and
// readonly option/price surfaces have no input-like frame. Editable cost remains input.
assert.match(css, /\.v-mobile-row-core\s*\{[\s\S]*display:\s*grid;[\s\S]*width:\s*100%;[\s\S]*max-width:\s*100%;/);
assert.match(css, /\.vdrag--touch\s*\{[\s\S]*font-size:\s*14px;/);
assert.match(css, /\.v-row-badge\s*\{[\s\S]*inline-size:\s*22px;/);
assert.match(css, /\.v-row-dup--icon\s*\{[\s\S]*border:\s*0;[\s\S]*background:\s*transparent;/);
assert.match(css, /\.v-mobile-option\s*\{[\s\S]*border:\s*0;[\s\S]*background:\s*transparent;/);
assert.match(css, /\.v-mobile-option-value\s*\{[\s\S]*-webkit-line-clamp:\s*2;[\s\S]*overflow-wrap:\s*anywhere;/);
assert.match(css, /\.v-mobile-price-result\s*\{[\s\S]*border:\s*0;[\s\S]*background:\s*transparent;/);
assert.match(css, /\.v-mobile-cost input\s*\{[\s\S]*inline-size:\s*88px;/);

// Desktop Variant result path remains a separate native grid/drag path.
assert.match(variantRender, /\) : isNarrow \? \([\s\S]*v-mobile-results[\s\S]*\) : \([\s\S]*vgrid-hdr/);
assert.match(variantRender, /className="vdrag"[\s\S]*draggable/);

console.log("D3.5 final pre-Shopify responsive UI source contract passed with D3.6 mobile select-all supersession");
