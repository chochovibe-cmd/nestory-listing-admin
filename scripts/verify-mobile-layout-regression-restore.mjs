import fs from "node:fs";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function expect(source, pattern, message) {
  if (!pattern.test(source)) fail(message);
}

const stabilization = fs.readFileSync("src/app/stabilization.css", "utf8");
const globals = fs.readFileSync("src/app/globals.css", "utf8");
const uploader = fs.readFileSync("src/components/listing/ImageUploader.tsx", "utf8");
const resultCard = fs.readFileSync("src/components/listing/ResultCard.tsx", "utf8");

const thumbStart = stabilization.indexOf("/* RC-THUMB / 2026-08-20:");
const cardStart = stabilization.indexOf("/* RC-CARD / 2026-08-20:");
const polishStart = stabilization.indexOf("/* RC-POLISH / 2026-08-20:");
if (
  thumbStart < 0 ||
  cardStart < 0 ||
  polishStart < 0 ||
  cardStart <= thumbStart ||
  polishStart <= cardStart
) {
  fail("mobile release layout / polish sections are missing or out of order");
}

const thumb = stabilization.slice(thumbStart, cardStart);
const card = stabilization.slice(cardStart, polishStart);
const polish = stabilization.slice(polishStart);

// Desktop/recovered uploader contract remains available outside the phone override.
expect(thumb, /\.pthumb-strip\s*\{[^}]*flex-wrap:\s*wrap;/s, "ImageUploader strip must still wrap");
expect(thumb, /\.pthumb-strip\s+\.pthumb-img\s*\{[^}]*width:\s*64px;[^}]*height:\s*64px;/s, "desktop secondary upload thumbnails must keep 64x64 anchor");
expect(thumb, /\.pthumb-strip\s+\.pthumb\.is-main\s+\.pthumb-img\s*\{[^}]*width:\s*96px;[^}]*height:\s*96px;/s, "desktop main upload thumbnail must keep 96x96 anchor");
if (/flex-wrap:\s*nowrap/.test(thumb)) {
  fail("P10 nowrap thumbnail geometry must not return");
}

// 2026-08-20 owner runtime decision: mobile uploader is exactly three equal columns.
expect(
  thumb,
  /@media \(max-width:\s*959px\)[\s\S]*\.pthumb-strip\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/s,
  "mobile ImageUploader must use a three-column grid"
);
expect(
  thumb,
  /\.pthumb-strip\s+\.pthumb-img,[\s\S]*\.pthumb-strip\s+\.pthumb\.is-main\s+\.pthumb-img\s*\{[^}]*width:\s*100%;[^}]*height:\s*auto;[^}]*aspect-ratio:\s*1;/s,
  "mobile uploader images must fill equal square grid cells"
);
expect(
  thumb,
  /\.pthumb-img-wrap\s*>\s*\.thumb-remove\s*\{[^}]*top:\s*-8px;[^}]*right:\s*-8px;[^}]*left:\s*auto;[^}]*width:\s*32px;[^}]*height:\s*32px;/s,
  "mobile input delete control must stay 32px at top-right"
);
expect(
  thumb,
  /\.pthumb-img-wrap\s*>\s*\.pthumb-spec-badge\s*\{[^}]*right:\s*28px;[^}]*max-width:\s*calc\(100%\s*-\s*34px\);/s,
  "mobile spec badge must stay clear of the enlarged delete control"
);

// Useful later uploader UX must remain intact.
expect(globals, /\.pthumb-status-overlay\s*\{[^}]*animation:\s*uploadSpin/s, "upload spinner overlay must remain");
expect(globals, /@keyframes\s+uploadSpin/, "upload spinner keyframes must remain");
expect(globals, /\.pthumb-dragging\s*\{/, "thumbnail drag feedback must remain");
expect(globals, /\.pthumb-drag-over\s+\.pthumb-img\s*\{/, "thumbnail drag-over feedback must remain");
expect(uploader, /item\.status\s*===\s*"uploading"/, "optimistic uploading state must remain");
expect(uploader, /retryUpload\(item\)/, "failed-upload retry must remain");
expect(uploader, /toggleSpecMark\(item\)/, "per-thumbnail spec marking must remain");
expect(uploader, /className="thumb-remove"/, "thumbnail delete control must remain");
expect(uploader, /draggable/, "thumbnail reorder capability must remain");

// Results pane remains the hard mobile width boundary.
expect(
  card,
  /\.workbench,[\s\S]*\.workbench-pane-results\.mob-active,[\s\S]*\.panel\.results-panel,[\s\S]*\.results-list,[\s\S]*\.result-card\s*,[\s\S]*\.result-card\s*>\s*\.rc-header\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s,
  "mobile results pane and card chain must be width-bounded"
);
expect(
  card,
  /\.workbench-mobile-body,[\s\S]*\.workbench-pane-results\.mob-active,[\s\S]*\.panel\.results-panel,[\s\S]*\.results-panel-body\s*\{[^}]*overflow-x:\s*clip;/s,
  "mobile results pane must clip only residual horizontal paint"
);
expect(
  card,
  /\.stage-filter-row\s+\.stage-filter-pills\s*\{[^}]*overflow-x:\s*auto;/s,
  "stage pills must scroll internally instead of widening the results pane"
);

// Owner-confirmed ResultCard polish is presentation-only.
expect(
  polish,
  /grid-template-columns:\s*64px\s+minmax\(0,\s*1fr\)\s+auto\s+auto;/,
  "mobile ResultCard polish must reserve title/meta columns without widening the card"
);
expect(
  polish,
  /\.rc-title\s*\{[^}]*grid-column:\s*1\s*\/\s*3;[^}]*grid-row:\s*1;/s,
  "mobile title must occupy the first row"
);
expect(
  polish,
  /\.rc-head-meta\s*\{[^}]*grid-column:\s*3\s*\/\s*5;[^}]*grid-row:\s*1;/s,
  "station/date meta must share the title row"
);
expect(
  polish,
  /\.rc-sale-badge\s*\{[^}]*grid-column:\s*2\s*\/\s*5;[^}]*grid-row:\s*2;/s,
  "sale-status badge must move to the thumbnail summary row"
);
expect(
  polish,
  />\s*\.rc-quick-row\s*>\s*\.rc-toggle\s*\{[^}]*display:\s*none;/s,
  "visible mobile expand toggle must stay hidden by owner decision"
);
expect(
  polish,
  /\.rc-m-regen-slot\s*\{[^}]*display:\s*none;/s,
  "inline mobile regenerate control must stay hidden"
);
expect(
  polish,
  /\.rc-m-row3\s*>\s*\.rc-price-mini,[\s\S]*border:\s*0;[\s\S]*background:\s*transparent;/,
  "collapsed mobile price must remain unboxed"
);
expect(
  polish,
  /\.rc-gesture-hint\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;/s,
  "mobile gesture hint must remain plain helper text"
);
expect(
  polish,
  /\.rc-swipe-actions\s*\{[^}]*align-items:\s*center;[^}]*gap:\s*6px;[^}]*background:\s*transparent;/s,
  "mobile swipe rail must use compact centered actions"
);
expect(
  polish,
  /\.rc-swipe-actions\s+\.rc-swipe-approve,[\s\S]*max-height:\s*64px;[\s\S]*border-radius:\s*14px;/,
  "mobile swipe buttons must not render as full-height slabs"
);

// Behavior code is explicitly outside this polish pass and must remain.
expect(resultCard, /function\s+handleHeaderClick\(\)/, "card tap-to-expand handler must remain");
expect(resultCard, /tryToggleExpand\(\);/, "tap-to-expand path must remain");
expect(resultCard, /handleHeaderTouchStart/, "mobile long-press/swipe gesture handler must remain");
expect(resultCard, /rc-swipe-wrap/, "mobile swipe actions must remain");
expect(resultCard, /selectMode/, "mobile multi-select behavior must remain");
expect(resultCard, /openRegenModal\(\)/, "regenerate handler must remain");
expect(resultCard, /className="rc-swipe-approve"/, "swipe approve action must remain");
expect(resultCard, /className="rc-swipe-secondary"/, "swipe secondary/regenerate action must remain");
expect(resultCard, /\{priceMiniEl\}/, "collapsed price data must remain");

console.log("PASS: mobile ResultCard polish changes presentation only and preserves release behavior.");
