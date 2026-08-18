const CARD_GESTURE_INTERACTIVE_SELECTOR = [
  "button",
  "input",
  "select",
  "textarea",
  "a",
  '[role="button"]',
  '[role="link"]',
  '[contenteditable="true"]',
  "[data-no-card-gesture]"
].join(",");

/**
 * ResultCard mobile long-press/swipe belongs to the card surface, not controls
 * nested inside the header. Use a closest()-based guard so future buttons and
 * custom controls are protected without adding touch stopPropagation handlers
 * one by one.
 *
 * The duck-typed closest() check avoids depending on the global Element class,
 * which keeps this helper safe to import in Node/source-contract verifiers.
 */
export function isCardGestureInteractiveTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  return Boolean((target as Element).closest(CARD_GESTURE_INTERACTIVE_SELECTOR));
}
