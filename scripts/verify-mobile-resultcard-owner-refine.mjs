import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync("src/app/resultcard-mobile-release.css", "utf8");
const card = fs.readFileSync("src/components/listing/ResultCard.tsx", "utf8");
const panel = fs.readFileSync("src/components/listing/DraftResultsPanel.tsx", "utf8");

assert.match(css, /OWNER-R3-2026-08-20/);
assert.match(card, /className="rc-title-flow"[\s\S]*rc-title-inline-station[\s\S]*mobileCardSecondary[\s\S]*rc-title-inline-time/);
assert.match(card, /mobileCardPrimary = stationFlowPrimaryLabel\(draft\)/);
assert.match(css, /\.rc-title-flow\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/s);
assert.match(css, /\.rc-head-meta \.rc-station-chip,[\s\S]*\.rc-head-meta \.rc-time-ago\s*\{[^}]*display:\s*none;/s);
assert.match(css, /@media \(max-width:\s*959px\)[\s\S]*> \.rc-quick-row > \.rc-dismiss-btn\s*\{\s*display:\s*none;/s);
assert.match(css, /grid-template-columns:\s*94px\s+minmax\(0,\s*1fr\)/);
assert.match(css, /@media \(max-width:\s*420px\)[\s\S]*grid-template-columns:\s*88px\s+minmax\(0,\s*1fr\)/);
assert.match(css, /\.rc-price-mini-main,[\s\S]*\.rc-price-mini-sub\s*\{[^}]*display:\s*contents;/s);
assert.match(css, /\.results-scope-label,[\s\S]*\.results-sort-label\s*\{[^}]*height:\s*38px;/s);

// D3.4A owner contract: one integrated select-all remains in the controls row;
// the dismissible gesture helper is a separate real DOM row before batch actions.
const controlsPos = panel.indexOf('className="stage-filter-row"');
const selectAllPos = panel.indexOf('className="rc-header-select-all rc-header-select-all--desktop"', controlsPos);
const toggleAllPos = panel.indexOf("onChange={toggleAll}", selectAllPos);
const toggleTrackPos = panel.indexOf('className="rc-toggle-track rc-toggle-track--labeled"', toggleAllPos);
const selectAllCopyPos = panel.indexOf('className="rc-toggle-copy">全選</b>', toggleTrackPos);
const tabsPos = panel.indexOf("<StageFilterPills", selectAllCopyPos);
const controlsEndPos = panel.indexOf('className="stage-filter-end"', tabsPos);
const helperGatePos = panel.indexOf("{showToolbar && showGestureHint ? (", controlsEndPos);
const guidePos = panel.indexOf('className="rc-selection-guide-row"', helperGatePos);
const hintPos = panel.indexOf('className="rc-gesture-hint"', guidePos);
const dismissPos = panel.indexOf('className="rc-gesture-hint-dismiss"', hintPos);
const batchStripPos = panel.indexOf("rc-batch-strip", dismissPos);

assert.equal(
  [
    controlsPos,
    selectAllPos,
    toggleAllPos,
    toggleTrackPos,
    selectAllCopyPos,
    tabsPos,
    controlsEndPos,
    helperGatePos,
    guidePos,
    hintPos,
    dismissPos,
    batchStripPos
  ].every((position) => position >= 0),
  true,
  "D3.4A owner controls/helper/batch anchors must all exist"
);
assert.equal(
  controlsPos < selectAllPos &&
    selectAllPos < toggleAllPos &&
    toggleAllPos < toggleTrackPos &&
    toggleTrackPos < selectAllCopyPos &&
    selectAllCopyPos < tabsPos &&
    tabsPos < controlsEndPos &&
    controlsEndPos < helperGatePos &&
    helperGatePos < guidePos &&
    guidePos < hintPos &&
    hintPos < dismissPos &&
    dismissPos < batchStripPos,
  true,
  "D3.4A owner layout must remain controls -> helper -> batch actions"
);
assert.equal(
  (panel.match(/className="rc-header-select-all rc-header-select-all--desktop"/g) ?? []).length,
  1,
  "D3.4A owner layout must render one integrated select-all control"
);
assert.doesNotMatch(panel, /rc-header-select-all--mobile/);
assert.match(panel, /rc-batch-strip--copy/);
assert.match(panel, /className="batch-remove-action"[\s\S]*batchArchiveOrUnarchive\("archive"\)/);
assert.doesNotMatch(panel, /<details className="batch-more">/);
assert.match(panel, /className="batch-detail-action"[\s\S]*batchSetGenerateDetail\(true\)[\s\S]*className="batch-detail-action"[\s\S]*batchSetGenerateDetail\(false\)/);
assert.match(css, /@media \(min-width:\s*960px\)[\s\S]*grid-template-rows:\s*auto minmax\(72px, auto\)/);
assert.match(css, /> \.rc-quick-row > \.rc-toggle\s*\{\s*display:\s*none;/);
assert.match(card, /export const LONG_PRESS_MS = 500;/);
assert.match(card, /GESTURE_MOVE_PX = 10;/);
assert.match(card, /async function archiveOne\(\)/);
assert.match(card, /function handleHeaderClick\(\)/);

console.log("Mobile ResultCard owner R3 checks passed (D3.4A integrated select-all contract)");
