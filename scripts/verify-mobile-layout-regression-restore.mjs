import fs from "node:fs";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}
function expect(source, pattern, message) {
  if (!pattern.test(source)) fail(message);
}

const stabilization = fs.readFileSync("src/app/stabilization.css", "utf8");
const releaseCss = fs.readFileSync("src/app/resultcard-mobile-release.css", "utf8");
const globals = fs.readFileSync("src/app/globals.css", "utf8");
const layout = fs.readFileSync("src/app/layout.tsx", "utf8");
const uploader = fs.readFileSync("src/components/listing/ImageUploader.tsx", "utf8");
const resultCard = fs.readFileSync("src/components/listing/ResultCard.tsx", "utf8");
const resultsPanel = fs.readFileSync("src/components/listing/DraftResultsPanel.tsx", "utf8");

const thumbStart = stabilization.indexOf("/* RC-THUMB / 2026-08-20:");
const cardStart = stabilization.indexOf("/* RC-CARD / 2026-08-20:");
if (thumbStart < 0 || cardStart < 0 || cardStart <= thumbStart) {
  fail("mobile release thumbnail / containment sections are missing or out of order");
}
const thumb = stabilization.slice(thumbStart, cardStart);
const card = stabilization.slice(cardStart);

expect(layout, /import "\.\/globals\.css";\s*import "\.\/stabilization\.css";\s*import "\.\/resultcard-mobile-release\.css";/s, "ResultCard release CSS must load after stabilization.css");
expect(releaseCss, /ResultCard mobile release contract — owner-corrected 2026-08-20/, "owner-corrected ResultCard release layer must be documented");

// Previously accepted uploader contract stays unchanged.
expect(thumb, /\.pthumb-strip\s*\{[^}]*flex-wrap:\s*wrap;/s, "ImageUploader strip must still wrap");
expect(thumb, /\.pthumb-strip\s+\.pthumb-img\s*\{[^}]*width:\s*64px;[^}]*height:\s*64px;/s, "desktop secondary thumbnails must keep 64x64 anchor");
expect(thumb, /\.pthumb-strip\s+\.pthumb\.is-main\s+\.pthumb-img\s*\{[^}]*width:\s*96px;[^}]*height:\s*96px;/s, "desktop main thumbnail must keep 96x96 anchor");
if (/flex-wrap:\s*nowrap/.test(thumb)) fail("P10 nowrap thumbnail geometry must not return");
expect(thumb, /@media \(max-width:\s*959px\)[\s\S]*\.pthumb-strip\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/s, "mobile ImageUploader must remain three columns");
expect(thumb, /\.pthumb-img-wrap\s*>\s*\.thumb-remove\s*\{[^}]*right:\s*-8px;[^}]*width:\s*32px;[^}]*height:\s*32px;/s, "mobile thumbnail delete control must remain top-right 32px");
expect(globals, /@keyframes\s+uploadSpin/, "upload spinner keyframes must remain");
expect(globals, /\.pthumb-dragging\s*\{/, "thumbnail drag feedback must remain");
expect(uploader, /retryUpload\(item\)/, "failed-upload retry must remain");
expect(uploader, /toggleSpecMark\(item\)/, "spec marking must remain");
expect(uploader, /draggable/, "thumbnail reorder must remain");

// Runtime-proven results containment stays underneath this visual pass.
expect(card, /\.workbench,[\s\S]*\.workbench-pane-results\.mob-active,[\s\S]*\.results-list,[\s\S]*\.result-card\s*,[\s\S]*\.result-card\s*>\s*\.rc-header\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s, "mobile results pane/card chain must remain width-bounded");
expect(card, /\.stage-filter-row\s+\.stage-filter-pills\s*\{[^}]*overflow-x:\s*auto;/s, "stage pills must scroll inside their own container");

// Corrected row 1 hierarchy: title -> station -> date -> existing soft-remove X.
expect(releaseCss, /grid-template-columns:\s*80px\s+minmax\(0,\s*1fr\)\s+max-content\s+max-content\s+28px;/, "mobile card must reserve title/station/date/remove columns");
expect(releaseCss, /\.rc-title\s*\{[^}]*grid-column:\s*1\s*\/\s*3;[^}]*grid-row:\s*1;/s, "title must lead row 1");
expect(releaseCss, /\.rc-station-chip\s*\{[^}]*grid-column:\s*3;[^}]*grid-row:\s*1;/s, "station must follow title on row 1");
expect(releaseCss, /\.rc-time-ago\s*\{[^}]*grid-column:\s*4;[^}]*grid-row:\s*1;/s, "date must follow station on row 1");
expect(releaseCss, />\s*\.rc-quick-row\s*>\s*\.rc-dismiss-btn\s*\{[^}]*grid-column:\s*5;[^}]*display:\s*inline-flex;/s, "existing soft-remove control must be visible at mobile top-right");
expect(releaseCss, />\s*\.rc-quick-row\s*>\s*\.rc-toggle\s*\{[^}]*display:\s*none;/s, "large mobile expand toggle stays hidden");

// Summary: thumb left, status/tags/warnings right.
expect(releaseCss, />\s*\.rc-thumb\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*2\s*\/\s*6;/s, "thumbnail must own left summary column");
expect(releaseCss, /\.rc-sale-badge\s*\{[^}]*grid-column:\s*2\s*\/\s*6;[^}]*grid-row:\s*2;/s, "sale badge must start right summary column");
expect(releaseCss, /\.rc-detect-chips--tags\s*\{[^}]*grid-column:\s*2\s*\/\s*6;[^}]*grid-row:\s*3;/s, "tags must stay right of thumbnail");
expect(releaseCss, /\.rc-detect-chips--warns\s*\{[^}]*grid-column:\s*2\s*\/\s*6;[^}]*grid-row:\s*4;/s, "warnings must stay right of thumbnail");

// Price remains unboxed and horizontal.
expect(releaseCss, /\.rc-price-mini\s*\{[^}]*flex-direction:\s*row;[^}]*flex-wrap:\s*nowrap;[\s\S]*white-space:\s*nowrap;/s, "mobile price must remain one compact row");
expect(releaseCss, /\.rc-m-regen-slot\s*\{[^}]*display:\s*none;/s, "inline collapsed regenerate must stay hidden");

// Long-press feedback only; gesture math remains source-owned.
expect(releaseCss, /\.result-card\s*>\s*\.rc-header:active\s*\{[^}]*transform:\s*scale\(\.988\);/s, "long-press surface must have immediate press feedback");
expect(releaseCss, /\.result-card\.is-checked\s*\{[^}]*border-color:/s, "selected card must have a durable accent state");
expect(resultCard, /export const LONG_PRESS_MS = 500;/, "500ms long-press timing must remain unchanged");
expect(resultCard, /GESTURE_MOVE_PX = 10;/, "gesture move threshold must remain unchanged");
expect(resultCard, /function\s+handleHeaderTouchStart/, "long-press handler must remain");

// Scope/sort controls use equal flex weights; a sole control can fill 100%.
expect(releaseCss, /\.stage-filter-row\s+\.stage-filter-end\s*\{[^}]*display:\s*flex;[^}]*gap:\s*8px;[^}]*width:\s*100%;/s, "scope/sort peer container must be a full-width flex row");
expect(releaseCss, /\.results-scope-label,[\s\S]*\.results-sort-label\s*\{[^}]*flex:\s*1\s+1\s+0;[^}]*height:\s*44px;/s, "scope and sort must have equal flex weight and height");
expect(releaseCss, /\.ir-scope-select,[\s\S]*\.sort-sel\s*\{[^}]*height:\s*44px;/s, "scope and sort selects must share 44px height");

// Accent hint + direct single-action batch remove.
expect(releaseCss, /\.rc-gesture-hint\s*\{[^}]*border-left:\s*3px solid var\(--accent\);[^}]*background:\s*color-mix\([^;]*var\(--accent\)/s, "gesture hint must use theme accent");
expect(releaseCss, /details\.batch-more:has\(> \.batch-more-menu > :only-child\)/, "single-action batch More menu must be promoted directly");
expect(resultsPanel, /onClick=\{\(\) => void batchArchiveOrUnarchive\("archive"\)\}/, "batch soft-remove handler must remain");
expect(resultsPanel, /batchSetGenerateDetail\(true\)/, "image-review detail-compose ON action must remain");
expect(resultsPanel, /batchSetGenerateDetail\(false\)/, "image-review detail-compose OFF action must remain");

// Existing soft archive / expand / swipe code paths remain.
expect(resultCard, /async function archiveOne\(\)/, "single-card soft archive handler must remain");
expect(resultCard, /body:\s*JSON\.stringify\(\{ draftIds: \[draft\.id\], action: "archive" \}\)/, "card X must still use archive API semantics");
expect(resultCard, /function\s+handleHeaderClick\(\)/, "card tap-to-expand handler must remain");
expect(resultCard, /tryToggleExpand\(\);/, "tap-to-expand path must remain");
expect(resultCard, /className="rc-swipe-approve"/, "swipe approve action must remain");
expect(resultCard, /className="rc-swipe-secondary"/, "swipe secondary action must remain");
expect(resultCard, /selectMode/, "multi-select behavior must remain");

console.log("PASS: owner-corrected mobile ResultCard hierarchy preserves upload, gestures and existing soft-action logic.");
