import assert from "node:assert/strict";
import fs from "node:fs";

const panel = fs.readFileSync("src/components/listing/DraftResultsPanel.tsx", "utf8");
const card = fs.readFileSync("src/components/listing/ResultCard.tsx", "utf8");
const d32Css = fs.readFileSync("src/app/d32-corrective.css", "utf8");
const d33Css = fs.readFileSync("src/app/d33-mobile-uiux.css", "utf8");

const finalHint = "長按可多選，進行批次核准／送審；右滑開啟核准／重生等快速操作，左滑移出佇列。";

// Hint — persistent JSX source of truth; old dismiss/storage/pseudo contracts are gone.
assert.match(panel, /className="rc-gesture-hint" role="note"/);
assert.match(panel, /className="rc-gesture-hint-mark">△<\/span>/);
assert.ok(panel.includes(finalHint));
assert.match(panel, /右滑/);
assert.match(panel, /左滑/);
assert.match(panel, /重生/);
assert.doesNotMatch(panel, /RC_GESTURE_HINT_KEY|showGestureHint|dismissGestureHint|rc-gesture-hint-dismiss|關閉提示/);
assert.doesNotMatch(d32Css, /rc-gesture-hint-dismiss|rc-selection-guide-row::after|長按卡片可多選；左滑顯示/);
assert.doesNotMatch(d33Css, /rc-gesture-hint-dismiss|rc-gesture-hint > span::before|向左滑可核准／重送|向右滑可移除/);
assert.match(d33Css, /@media \(min-width:\s*960px\)[\s\S]*\.rc-selection-guide-row \.rc-gesture-hint\s*\{[\s\S]*display:\s*none;/);
const mobileMediaStart = d33Css.indexOf("@media (max-width: 959px)");
const hintStyleStart = d33Css.indexOf(".rc-selection-guide-row .rc-gesture-hint {", mobileMediaStart);
const hintStyleEnd = d33Css.indexOf("}", hintStyleStart);
assert.ok(mobileMediaStart >= 0 && hintStyleStart > mobileMediaStart && hintStyleEnd > hintStyleStart);
const hintStyle = d33Css.slice(hintStyleStart, hintStyleEnd + 1);
assert.match(hintStyle, /display:\s*flex;/);
assert.match(hintStyle, /align-items:\s*flex-start;/);
assert.match(hintStyle, /gap:\s*var\(--sp-2\);/);
assert.match(hintStyle, /margin:\s*var\(--sp-2\) 0;/);
assert.match(hintStyle, /padding:\s*0 var\(--sp-1\);/);
assert.match(hintStyle, /border:\s*0;/);
assert.match(hintStyle, /border-radius:\s*0;/);
assert.match(hintStyle, /background:\s*transparent;/);
assert.match(hintStyle, /box-shadow:\s*none;/);
assert.match(hintStyle, /color:\s*var\(--accent\);/);
assert.match(hintStyle, /font-size:\s*11px;/);
assert.match(hintStyle, /font-weight:\s*700;/);
assert.match(hintStyle, /line-height:\s*1\.45;/);
assert.match(d33Css, /\.rc-gesture-hint-text\s*\{[\s\S]*overflow-wrap:\s*anywhere;/);

// Gesture constants + signed clamp/snap.
assert.match(card, /export const LONG_PRESS_MS = 500;/);
assert.match(card, /const GESTURE_MOVE_PX = 10;/);
assert.match(card, /const SWIPE_WORKFLOW_W = 156;/);
assert.match(card, /const SWIPE_WORKFLOW_W_SINGLE = 108;/);
assert.match(card, /const SWIPE_REMOVE_W = 96;/);
assert.match(card, /const next = dx > 0\s*\? Math\.min\(dx, workflowWidth\)\s*:\s*Math\.max\(dx, -SWIPE_REMOVE_W\);/);
assert.doesNotMatch(card, /Math\.max\(Math\.min\(dx, 0\)/);
assert.match(card, /current > workflowWidth \/ 2[\s\S]*\? workflowWidth[\s\S]*current < -SWIPE_REMOVE_W \/ 2[\s\S]*\? -SWIPE_REMOVE_W[\s\S]*:\s*0;/);
assert.match(card, /onSwipeOpenChange\?\.\(next !== 0\);/);

// Left-anchored workflow panel and right-anchored remove panel are distinct.
assert.match(card, /className="rc-swipe-actions rc-swipe-actions--workflow"/);
assert.match(card, /className="rc-swipe-actions rc-swipe-actions--remove"/);
assert.match(d33Css, /\.rc-swipe-actions--workflow\s*\{[\s\S]*inset:\s*0 auto 0 0;/);
assert.match(d33Css, /\.rc-swipe-actions--remove\s*\{[\s\S]*inset:\s*0 0 0 auto;/);
assert.match(card, /isNarrow && swipeX > 0 && workflowSwipeActions/);
assert.match(card, /isNarrow && swipeX < 0 && removeSwipeAction/);

const workflowStart = card.indexOf("const workflowSwipeActions =");
const removeStart = card.indexOf("const removeSwipeAction =", workflowStart);
const renderStart = card.indexOf("return (", removeStart);
assert.ok(workflowStart >= 0 && removeStart > workflowStart && renderStart > removeStart);
const workflowSource = card.slice(workflowStart, removeStart);
const removeSource = card.slice(removeStart, renderStart);
assert.doesNotMatch(workflowSource, /rc-swipe-remove|archiveOne\(\)/);
assert.match(workflowSource, /rc-swipe-approve/);
assert.match(workflowSource, /rc-swipe-secondary/);
assert.match(workflowSource, /approveOnly\(\)/);
assert.match(workflowSource, /openRegenModal\(\)/);
assert.match(workflowSource, /stationReview\(\)/);
assert.match(workflowSource, /requestRevision\(\)/);
assert.match(workflowSource, /發布／匯出/);
assert.match(removeSource, /rc-swipe-remove/);
assert.match(removeSource, /archiveOne\(\)/);
assert.doesNotMatch(removeSource, /rc-swipe-approve|rc-swipe-secondary|approveOnly\(|stationReview\(|requestRevision\(/);

// Existing gesture safety / close behavior stays in place.
assert.match(card, /if \(!isNarrow \|\| sequentialMode \|\| isCardGestureInteractiveTarget\(event\.target\)\) return;/);
assert.match(card, /if \(Math\.abs\(dy\) > GESTURE_MOVE_PX && Math\.abs\(dy\) >= Math\.abs\(dx\)\)/);
assert.match(card, /!expanded &&\s*!selectMode &&\s*!sequentialMode/);
assert.match(card, /if \(isNarrow && selectMode && onToggle\)[\s\S]*onToggle\(\);/);
assert.match(card, /function runSwipeAction\(action: \(\) => void\)\s*\{\s*action\(\);\s*closeSwipe\(\);\s*\}/);
assert.match(panel, /onSwipeOpenChange=\{\(open\) => \{\s*setOpenSwipeId\(open \? draft\.id : null\);\s*\}\}/);

console.log("D3.7 mobile gesture guidance and bidirectional swipe source contract passed");
