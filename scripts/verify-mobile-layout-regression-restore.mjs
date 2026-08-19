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
if (thumbStart < 0 || cardStart < 0 || cardStart <= thumbStart) {
  fail("mobile release layout sections are missing or out of order");
}

const thumb = stabilization.slice(thumbStart, cardStart);
const card = stabilization.slice(cardStart);

// Desktop/recovered uploader contract remains available outside the phone override.
expect(thumb, /\.pthumb-strip\s*\{[^}]*flex-wrap:\s*wrap;/s, "ImageUploader strip must still wrap");
expect(thumb, /\.pthumb-strip\s+\.pthumb-img\s*\{[^}]*width:\s*64px;[^}]*height:\s*64px;/s, "desktop secondary upload thumbnails must keep 64x64 anchor");
expect(thumb, /\.pthumb-strip\s+\.pthumb\.is-main\s+\.pthumb-img\s*\{[^}]*width:\s*96px;[^}]*height:\s*96px;/s, "desktop main upload thumbnail must keep 96x96 anchor");
if (/flex-wrap:\s*nowrap/.test(thumb) || /overflow-x:\s*auto;[\s\S]*P10/.test(thumb)) {
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

// Results pane must be the hard mobile width boundary, not just ResultCard itself.
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

// ResultCard keeps all content inside the bounded pane and adapts on phone widths.
expect(
  card,
  /grid-template-areas:\s*\n\s*"title title"\s*\n\s*"thumb chips"\s*\n\s*"row3 row3";/,
  "mobile ResultCard must keep a bounded title/summary/action structure"
);
expect(card, /\.rc-head-chips\s*\{[^}]*width:\s*100%;[^}]*overflow:\s*hidden;/s, "mobile chip cluster must be width-bounded");
expect(card, /\.rc-detect-chip,[\s\S]*text-overflow:\s*ellipsis;[\s\S]*white-space:\s*nowrap;/, "long mobile chips must not protrude");
expect(
  card,
  /@media \(max-width:\s*639px\)[\s\S]*\.rc-m-row3\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s,
  "phone regen/price row must be allowed to stack"
);
expect(card, /\.rc-price-mini-value,[\s\S]*white-space:\s*normal;[\s\S]*overflow-wrap:\s*anywhere;/, "phone price/profit text must be allowed to wrap");
expect(card, /\.rc-tone-chip\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s, "phone tone chip must be allowed to wrap");

// Later ResultCard behavior must remain.
expect(stabilization, /\.rc-toggle[\s\S]*display:\s*inline-flex;/, "explicit mobile expand affordance must remain");
expect(resultCard, /handleHeaderTouchStart/, "mobile long-press/swipe gesture handler must remain");
expect(resultCard, /rc-swipe-wrap/, "mobile swipe actions must remain");
expect(resultCard, /selectMode/, "mobile multi-select behavior must remain");
expect(resultCard, /className="rc-quick-btn rc-m-regen-btn"/, "mobile regenerate action must remain");
expect(resultCard, /\{priceMiniEl\}/, "mobile price element must remain");

console.log("PASS: mobile release layout is bounded, three-column, and preserves later UX.");
