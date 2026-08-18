import assert from "node:assert/strict";
import fs from "node:fs";

const helper = fs.readFileSync(
  "src/components/listing/result-card/cardGestureTarget.ts",
  "utf8"
);
const card = fs.readFileSync("src/components/listing/ResultCard.tsx", "utf8");

// Shared helper must cover native controls, semantic button/link roles, editable
// content, and an explicit escape hatch for future custom interactive widgets.
for (const selector of [
  '"button"',
  '"input"',
  '"select"',
  '"textarea"',
  '"a"',
  "'[role=\"button\"]'",
  "'[role=\"link\"]'",
  "'[contenteditable=\"true\"]'",
  '"[data-no-card-gesture]"'
]) {
  assert.ok(helper.includes(selector), `missing interactive selector ${selector}`);
}
assert.match(helper, /\.closest\(CARD_GESTURE_INTERACTIVE_SELECTOR\)/);
assert.match(helper, /export function isCardGestureInteractiveTarget/);

// ResultCard must use the guard at the touch boundary, not patch individual
// buttons one by one.
assert.match(
  card,
  /import \{ isCardGestureInteractiveTarget \} from "@\/components\/listing\/result-card\/cardGestureTarget";/
);

const startIndex = card.indexOf("function handleHeaderTouchStart");
const moveIndex = card.indexOf("function handleHeaderTouchMove");
const endIndex = card.indexOf("function handleHeaderTouchEnd");
const clickIndex = card.indexOf("function handleHeaderClick");
assert.ok(startIndex >= 0 && moveIndex > startIndex && endIndex > moveIndex && clickIndex > endIndex);

const startBody = card.slice(startIndex, moveIndex);
const moveBody = card.slice(moveIndex, endIndex);
const endBody = card.slice(endIndex, clickIndex);

assert.match(startBody, /isCardGestureInteractiveTarget\(event\.target\)/);
assert.ok(
  startBody.indexOf("isCardGestureInteractiveTarget(event.target)") <
    startBody.indexOf("onGestureStart?.()"),
  "interactive guard must run before parent gesture ownership starts"
);
assert.ok(
  startBody.indexOf("isCardGestureInteractiveTarget(event.target)") <
    startBody.indexOf("longPressTimerRef.current = setTimeout"),
  "interactive guard must run before long-press timer starts"
);

assert.match(moveBody, /isCardGestureInteractiveTarget\(event\.target\)/);
assert.match(endBody, /function handleHeaderTouchEnd\(event: ReactTouchEvent\)/);
assert.match(endBody, /isCardGestureInteractiveTarget\(event\.target\)/);

// Blank card surface gesture behavior must remain present.
assert.match(card, /export const LONG_PRESS_MS = 500/);
assert.match(card, /const swipeEnabled =/);
assert.match(card, /longPressTimerRef\.current = setTimeout/);
assert.match(card, /swipeAxisRef\.current = "h"/);
assert.match(card, /setSwipeX\(next\)/);

// Regression guard for the unrelated tab predicate accidentally caught during
// this edit: do not let a whole-file replacement change it again.
assert.match(card, /className=\{`rc-tab\$\{activeTab === tab\.id \? " active" : ""\}`\}/);

console.log("Mobile ResultCard gesture-guard checks passed");
