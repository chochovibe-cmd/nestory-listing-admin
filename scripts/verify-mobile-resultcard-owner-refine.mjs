import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync("src/app/resultcard-mobile-release.css", "utf8");
const card = fs.readFileSync("src/components/listing/ResultCard.tsx", "utf8");
const panel = fs.readFileSync("src/components/listing/DraftResultsPanel.tsx", "utf8");

assert.match(css, /OWNER-R3-2026-08-20/);
assert.match(card, /className="rc-title-flow"[\s\S]*rc-title-inline-station[\s\S]*rc-title-inline-time/);
assert.match(card, /mobileCardPrimary = stationFlowPrimaryLabel\(draft\)/);
assert.match(css, /\.rc-title-flow\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/s);
assert.match(css, /\.rc-head-meta \.rc-station-chip,[\s\S]*\.rc-head-meta \.rc-time-ago\s*\{[^}]*display:\s*none;/s);
assert.match(css, /> \.rc-quick-row > \.rc-dismiss-btn\s*\{[^}]*top:\s*0;[^}]*transform:\s*translateY\(-50%\);/s);
assert.match(css, /grid-template-columns:\s*94px\s+minmax\(0,\s*1fr\)/);
assert.match(css, /@media \(max-width:\s*420px\)[\s\S]*grid-template-columns:\s*88px\s+minmax\(0,\s*1fr\)/);
assert.match(css, /\.rc-price-mini-main,[\s\S]*\.rc-price-mini-sub\s*\{[^}]*display:\s*contents;/s);
assert.match(css, /\.results-scope-label,[\s\S]*\.results-sort-label\s*\{[^}]*height:\s*38px;/s);
assert.match(css, /\.rc-panel-header \.rc-header-actions\s*\{[^}]*display:\s*contents;/s);
assert.match(panel, /rc-batch-strip--copy/);
assert.match(panel, /className="batch-remove-action"[\s\S]*batchArchiveOrUnarchive\("archive"\)/);
assert.match(panel, /<details className="batch-more">[\s\S]*batchSetGenerateDetail\(true\)[\s\S]*batchSetGenerateDetail\(false\)/);
assert.match(card, /export const LONG_PRESS_MS = 500;/);
assert.match(card, /GESTURE_MOVE_PX = 10;/);
assert.match(card, /async function archiveOne\(\)/);
assert.match(card, /function handleHeaderClick\(\)/);

console.log("Mobile ResultCard owner R3 checks passed");
