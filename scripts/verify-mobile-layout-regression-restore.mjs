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

const thumbStart = stabilization.indexOf("/* RC-THUMB / 2026-08-19:");
const cardStart = stabilization.indexOf("/* RC-CARD / 2026-08-19:");
if (thumbStart < 0 || cardStart < 0 || cardStart <= thumbStart) {
  fail("mobile regression restore sections are missing or out of order");
}

const thumb = stabilization.slice(thumbStart, cardStart);
const card = stabilization.slice(cardStart);

// ImageUploader: restore only the owner-confirmed geometry regression.
expect(thumb, /\.pthumb-strip\s*\{[^}]*flex-wrap:\s*wrap;/s, "ImageUploader strip must wrap");
expect(thumb, /\.pthumb-strip\s*\{[^}]*overflow-x:\s*visible;/s, "ImageUploader strip must not use horizontal-scroll geometry");
expect(thumb, /\.pthumb-strip\s+\.pthumb-img\s*\{[^}]*width:\s*64px;[^}]*height:\s*64px;/s, "secondary upload thumbnails must stay 64x64");
expect(thumb, /\.pthumb-strip\s+\.pthumb\.is-main\s+\.pthumb-img\s*\{[^}]*width:\s*96px;[^}]*height:\s*96px;/s, "main upload thumbnail must stay 96x96");
if (/flex-wrap:\s*nowrap/.test(thumb) || /overflow-x:\s*auto/.test(thumb)) {
  fail("P10 nowrap/horizontal-scroll thumbnail geometry must not return");
}
if (/\.pthumb-spec-badge\s*\{|\.thumb-remove\s*\{/.test(thumb)) {
  fail("geometry-only restore must not reposition P10/P09 spec/remove controls");
}

// Deliberate P10/P09 A-scope controls remain unchanged unless runtime proves a bug.
expect(
  globals,
  /\.pthumb-img-wrap\s*>\s*\.thumb-remove\s*\{[^}]*top:\s*6px;[^}]*left:\s*6px;[^}]*right:\s*auto;/s,
  "input delete control must keep audited P10/P09 top-left placement"
);
expect(
  globals,
  /\.pthumb-spec-badge\s*\{[^}]*position:\s*absolute;[^}]*top:\s*6px;[^}]*right:\s*6px;/s,
  "input spec badge must keep audited P10/P09 top-right placement"
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

// ResultCard: preserve P04 A; repair only its accidental row-3 track coupling.
expect(
  card,
  /grid-template-areas:\s*\n\s*"title title"\s*\n\s*"thumb chips"\s*\n\s*"row3 row3";/,
  "mobile ResultCard must preserve P04 three-row semantics"
);
expect(
  card,
  /\.rc-m-row3\s*\{[^}]*grid-area:\s*row3;[^}]*display:\s*grid;[^}]*grid-template-columns:\s*max-content\s+minmax\(0,\s*1fr\);/s,
  "row3 must own an independent regen/price grid"
);
expect(card, /\.rc-m-regen-slot\s*\{[^}]*grid-area:\s*auto;[^}]*grid-column:\s*1;/s, "mobile regen must occupy row3 column 1");
expect(card, /\.rc-m-row3\s*>\s*\.rc-price-mini,[\s\S]*grid-area:\s*auto;[\s\S]*grid-column:\s*2;/, "mobile price must occupy row3 column 2");
if (/"thumb main"|"price price"|"regen regen"/.test(card)) {
  fail("provisional full-width-row rewrite must not replace P04 three-row A");
}

expect(stabilization, /\.rc-toggle[\s\S]*display:\s*inline-flex;/, "explicit mobile expand affordance must remain");
expect(resultCard, /handleHeaderTouchStart/, "mobile long-press/swipe gesture handler must remain");
expect(resultCard, /rc-swipe-wrap/, "mobile swipe actions must remain");
expect(resultCard, /selectMode/, "mobile multi-select behavior must remain");
expect(resultCard, /className="rc-quick-btn rc-m-regen-btn"/, "P04 mobile regen action must remain");
expect(resultCard, /\{priceMiniEl\}/, "P04 mobile price element must remain");

console.log("PASS: collateral geometry repaired while intentional later UX stays intact.");
