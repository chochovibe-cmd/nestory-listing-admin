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

// ImageUploader geometry: owner-confirmed canonical mobile behavior.
expect(thumb, /\.pthumb-strip\s*\{[^}]*flex-wrap:\s*wrap;/s, "ImageUploader strip must wrap");
expect(thumb, /\.pthumb-strip\s*\{[^}]*overflow-x:\s*visible;/s, "ImageUploader strip must not use horizontal-scroll geometry");
expect(thumb, /\.pthumb-strip\s+\.pthumb-img\s*\{[^}]*width:\s*64px;[^}]*height:\s*64px;/s, "secondary upload thumbnails must stay 64x64");
expect(thumb, /\.pthumb-strip\s+\.pthumb\.is-main\s+\.pthumb-img\s*\{[^}]*width:\s*96px;[^}]*height:\s*96px;/s, "main upload thumbnail must stay 96x96");
if (/flex-wrap:\s*nowrap/.test(thumb) || /overflow-x:\s*auto/.test(thumb)) {
  fail("P10 nowrap/horizontal-scroll thumbnail geometry must not return");
}

// iPhone runtime evidence: mobile delete control is now a larger top-right affordance.
expect(
  thumb,
  /@media \(max-width:\s*959px\)[\s\S]*\.pthumb-img-wrap\s*>\s*\.thumb-remove\s*\{[^}]*top:\s*-8px;[^}]*right:\s*-8px;[^}]*left:\s*auto;[^}]*width:\s*32px;[^}]*height:\s*32px;/s,
  "mobile input delete control must be 32px at the top-right"
);
expect(
  thumb,
  /\.pthumb-img-wrap\s*>\s*\.pthumb-spec-badge\s*\{[^}]*right:\s*32px;[^}]*max-width:\s*calc\(100%\s*-\s*38px\);/s,
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

// ResultCard: mobile layout must honor card width regardless of chip/price content.
expect(
  card,
  /grid-template-areas:\s*\n\s*"title title"\s*\n\s*"thumb chips"\s*\n\s*"row3 row3";/,
  "mobile ResultCard must keep a bounded three-band header"
);
expect(card, /\.rc-head-chips\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*overflow:\s*hidden;/s, "mobile chip cluster must be width-bounded");
expect(card, /\.rc-detect-chip,[\s\S]*text-overflow:\s*ellipsis;[\s\S]*white-space:\s*nowrap;/, "long mobile chips must ellipsize instead of protruding");
expect(
  card,
  /\.rc-m-row3\s*\{[^}]*grid-area:\s*row3;[^}]*display:\s*grid;[^}]*grid-template-columns:\s*max-content\s+minmax\(0,\s*1fr\);/s,
  "wider mobile row3 must keep a shrink-safe regen/price grid"
);
expect(
  card,
  /@media \(max-width:\s*520px\)[\s\S]*\.rc-m-row3\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s,
  "phone row3 must be allowed to stack"
);
expect(card, /\.rc-price-mini-value,[\s\S]*white-space:\s*normal;[\s\S]*overflow-wrap:\s*anywhere;/, "phone price/profit text must be allowed to wrap");

// Later ResultCard behavior must remain.
expect(stabilization, /\.rc-toggle[\s\S]*display:\s*inline-flex;/, "explicit mobile expand affordance must remain");
expect(resultCard, /handleHeaderTouchStart/, "mobile long-press/swipe gesture handler must remain");
expect(resultCard, /rc-swipe-wrap/, "mobile swipe actions must remain");
expect(resultCard, /selectMode/, "mobile multi-select behavior must remain");
expect(resultCard, /className="rc-quick-btn rc-m-regen-btn"/, "mobile regenerate action must remain");
expect(resultCard, /\{priceMiniEl\}/, "mobile price element must remain");

console.log("PASS: runtime-confirmed mobile containment fixes preserve uploader/card UX.");
