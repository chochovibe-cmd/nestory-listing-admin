import assert from "node:assert/strict";
import fs from "node:fs";

const panel = fs.readFileSync("src/components/listing/DraftResultsPanel.tsx", "utf8");
const card = fs.readFileSync("src/components/listing/ResultCard.tsx", "utf8");
const css = fs.readFileSync("src/app/d39a-mobile-review-polish.css", "utf8");
const layout = fs.readFileSync("src/app/layout.tsx", "utf8");

const finalHint = "長按可多選，進行批次核准／送審；右滑開啟核准／重生等快速操作，左滑移出佇列。";

assert.doesNotMatch(css, /!important/);
assert.match(css, /@media \(max-width:\s*959px\)/);
assert.doesNotMatch(css, /@media \(min-width:/);

// Final cascade only: D3.9A loads after prior mobile corrective layers.
const d38ImportPos = layout.indexOf('import "./d38-mobile-variant-horizontal.css";');
const d39aImportPos = layout.indexOf('import "./d39a-mobile-review-polish.css";');
assert.ok(d38ImportPos >= 0 && d39aImportPos > d38ImportPos);

// ITEM A — teaching copy/semantics stay exactly D3.7; no dismiss state or X returns.
assert.match(panel, /className="rc-gesture-hint" role="note"/);
assert.match(panel, /className="rc-gesture-hint-mark">△<\/span>/);
assert.ok(panel.includes(finalHint));
assert.doesNotMatch(panel, /RC_GESTURE_HINT_KEY|showGestureHint|dismissGestureHint|rc-gesture-hint-dismiss|關閉提示/);

// Compact transparent row contract.
assert.match(css, /\.rc-selection-guide-row\s*\{[\s\S]*?margin:\s*var\(--sp-1\) 0 var\(--sp-2\);[\s\S]*?padding:\s*0;/);
assert.match(css, /\.rc-selection-guide-row \.rc-gesture-hint\s*\{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*flex-start;[\s\S]*?gap:\s*var\(--sp-1\);[\s\S]*?margin:\s*0;[\s\S]*?padding:\s*0;[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;[\s\S]*?font-size:\s*11px;[\s\S]*?font-weight:\s*700;[\s\S]*?line-height:\s*1\.35;/);
assert.match(css, /\.rc-selection-guide-row \.rc-gesture-hint-mark\s*\{[\s\S]*?font-size:\s*11px;[\s\S]*?line-height:\s*1\.35;/);
assert.match(css, /\.rc-selection-guide-row \.rc-gesture-hint-text\s*\{[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?font-size:\s*11px;[\s\S]*?font-weight:\s*700;[\s\S]*?line-height:\s*1\.35;/);

// ITEM B — existing action classes and panel structure remain in ResultCard.
assert.match(card, /className="rc-swipe-approve"/);
assert.match(card, /className="rc-swipe-secondary"/);
assert.match(card, /className="rc-swipe-remove"/);
assert.match(card, /className="rc-swipe-actions rc-swipe-actions--workflow"/);
assert.match(card, /className="rc-swipe-actions rc-swipe-actions--remove"/);
assert.match(card, />\s*✓ 核准\s*<\/button>/);
assert.match(card, />\s*↻ 重生\s*<\/button>/);
assert.match(card, />\s*移出佇列\s*<\/button>/);

// D3.7 gesture/reveal contracts are frozen: widths, direction, mapping, and handlers.
assert.match(card, /const SWIPE_WORKFLOW_W = 156;/);
assert.match(card, /const SWIPE_WORKFLOW_W_SINGLE = 108;/);
assert.match(card, /const SWIPE_REMOVE_W = 96;/);
assert.match(card, /isNarrow && swipeX > 0 && workflowSwipeActions/);
assert.match(card, /isNarrow && swipeX < 0 && removeSwipeAction/);
assert.match(card, /style=\{\{ width: workflowWidth \}\}/);
assert.match(card, /style=\{\{ width: SWIPE_REMOVE_W \}\}/);
assert.match(card, /onClick=\{\(\) => runSwipeAction\(\(\) => void approveOnly\(\)\)\}/);
assert.match(card, /onClick=\{\(\) => runSwipeAction\(\(\) => openRegenModal\(\)\)\}/);
assert.match(card, /onClick=\{\(\) => runSwipeAction\(\(\) => void archiveOne\(\)\)\}/);

// Panel alignment improves density without changing reveal width math.
assert.match(css, /\.rc-swipe-actions--workflow\s*\{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center;[\s\S]*?gap:\s*var\(--sp-1\);[\s\S]*?padding:\s*0 var\(--sp-2\);/);
assert.match(css, /\.rc-swipe-actions--remove\s*\{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center;[\s\S]*?padding:\s*0 var\(--sp-2\);/);

// All three action types share the same 44px rounded-button geometry.
assert.match(css, /\.rc-swipe-actions--workflow \.rc-swipe-approve,[\s\S]*?\.rc-swipe-actions--remove \.rc-swipe-remove\s*\{[\s\S]*?display:\s*inline-flex;[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center;[\s\S]*?min-height:\s*44px;[\s\S]*?height:\s*44px;[\s\S]*?padding:\s*0 var\(--sp-2\);[\s\S]*?border-radius:\s*var\(--radius-s\);[\s\S]*?font-size:\s*12px;[\s\S]*?font-weight:\s*800;[\s\S]*?line-height:\s*1;[\s\S]*?white-space:\s*nowrap;/);
assert.match(css, /\.rc-swipe-actions--workflow \.rc-swipe-approve,[\s\S]*?\.rc-swipe-actions--workflow \.rc-swipe-secondary\s*\{[\s\S]*?flex:\s*1 1 0;/);
assert.match(css, /\.rc-swipe-actions--remove \.rc-swipe-remove\s*\{[\s\S]*?width:\s*100%;[\s\S]*?flex:\s*0 1 auto;/);

// Semantic styling: approve primary fill, regen neutral outline, remove danger outline.
assert.match(css, /\.rc-swipe-actions--workflow \.rc-swipe-approve\s*\{[\s\S]*?border-color:\s*var\(--accent\);[\s\S]*?background:\s*var\(--accent\);[\s\S]*?color:\s*var\(--accent-fg\);/);
assert.match(css, /\.rc-swipe-actions--workflow \.rc-swipe-secondary\s*\{[\s\S]*?border-color:\s*var\(--border\);[\s\S]*?background:\s*var\(--surface\);[\s\S]*?color:\s*var\(--text\);/);
assert.match(css, /\.rc-swipe-actions--remove \.rc-swipe-remove\s*\{[\s\S]*?border-color:\s*color-mix\(in srgb, var\(--danger\) 48%, var\(--border\)\);[\s\S]*?background:\s*var\(--surface\);[\s\S]*?color:\s*var\(--danger\);/);

console.log("D3.9A mobile review hint and swipe action presentation contract passed");
