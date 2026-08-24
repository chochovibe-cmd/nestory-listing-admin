"use client";

import { useEffect } from "react";

const CHARACTER_DIALOG = '.variant-editor-modal[data-modal-kind="character"]';
const CHARACTER_SEARCH = `${CHARACTER_DIALOG} .v-char-search`;
const CHARACTER_ROWS = `${CHARACTER_DIALOG} .v-char-list--modal > label`;
const KEYBOARD_THRESHOLD_PX = 120;
const KEYBOARD_LIST_MIN_PX = 96;
const KEYBOARD_LIST_MAX_PX = 132;

function characterBackdrop(): HTMLElement | null {
  const dialog = document.querySelector<HTMLElement>(CHARACTER_DIALOG);
  return dialog?.closest<HTMLElement>(".variant-editor-modal-backdrop") ?? null;
}

function hideBlankCharacterRows(backdrop: HTMLElement) {
  backdrop.querySelectorAll<HTMLLabelElement>(CHARACTER_ROWS).forEach((label) => {
    const textHost = label.querySelector<HTMLElement>(":scope > span");
    const firstNode = textHost?.firstChild;
    const name = firstNode?.nodeType === Node.TEXT_NODE ? firstNode.textContent?.trim() ?? "" : "";
    label.hidden = name.length === 0;
  });
}

function keyboardInsetFor(visualHeight: number) {
  return Math.max(0, Math.round(window.innerHeight - visualHeight));
}

export function VariantCharacterViewportBridge() {
  useEffect(() => {
    const mobileMq = window.matchMedia("(max-width: 959px)");
    let activeBackdrop: HTMLElement | null = null;
    let cleanupViewport: (() => void) | null = null;
    let allowSearchFocusUntil = 0;
    let focusStabilizationPending = false;
    let focusStabilizationRaf: number | null = null;

    const cancelFocusStabilization = () => {
      focusStabilizationPending = false;
      if (focusStabilizationRaf != null) {
        window.cancelAnimationFrame(focusStabilizationRaf);
        focusStabilizationRaf = null;
      }
    };

    const scheduleDialogScrollReset = () => {
      if (!focusStabilizationPending) return;
      focusStabilizationPending = false;
      if (focusStabilizationRaf != null) window.cancelAnimationFrame(focusStabilizationRaf);
      focusStabilizationRaf = window.requestAnimationFrame(() => {
        focusStabilizationRaf = null;
        const dialog = activeBackdrop?.querySelector<HTMLElement>(CHARACTER_DIALOG);
        if (dialog) dialog.scrollTop = 0;
      });
    };

    const clearActiveBackdrop = () => {
      cleanupViewport?.();
      cleanupViewport = null;
      cancelFocusStabilization();
      if (activeBackdrop) {
        activeBackdrop.removeAttribute("data-modal-kind");
        activeBackdrop.removeAttribute("data-keyboard-open");
        activeBackdrop.style.removeProperty("--ve-visual-height");
        activeBackdrop.style.removeProperty("--ve-char-list-max");
      }
      activeBackdrop = null;
    };

    const syncBackdrop = () => {
      const nextBackdrop = characterBackdrop();
      if (nextBackdrop === activeBackdrop) {
        if (activeBackdrop) hideBlankCharacterRows(activeBackdrop);
        return;
      }

      clearActiveBackdrop();
      if (!nextBackdrop) return;

      activeBackdrop = nextBackdrop;
      activeBackdrop.dataset.modalKind = "character";
      activeBackdrop.dataset.keyboardOpen = "false";
      hideBlankCharacterRows(activeBackdrop);

      if (!mobileMq.matches || !window.visualViewport) return;
      const viewport = window.visualViewport;

      const syncVisualViewport = () => {
        if (!activeBackdrop) return;
        const visualHeight = Math.max(0, Math.round(viewport.height));
        const keyboardInset = keyboardInsetFor(visualHeight);
        const keyboardOpen = keyboardInset >= KEYBOARD_THRESHOLD_PX;
        const listMax = keyboardOpen
          ? Math.max(KEYBOARD_LIST_MIN_PX, Math.min(KEYBOARD_LIST_MAX_PX, Math.round(visualHeight * 0.22)))
          : 192;

        activeBackdrop.style.setProperty("--ve-visual-height", `${visualHeight}px`);
        activeBackdrop.style.setProperty("--ve-char-list-max", `${listMax}px`);
        activeBackdrop.dataset.keyboardOpen = keyboardOpen ? "true" : "false";

        if (keyboardOpen && focusStabilizationPending) scheduleDialogScrollReset();
      };

      syncVisualViewport();
      viewport.addEventListener("resize", syncVisualViewport);
      cleanupViewport = () => {
        viewport.removeEventListener("resize", syncVisualViewport);
      };
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof HTMLInputElement && event.target.matches(CHARACTER_SEARCH)) {
        allowSearchFocusUntil = performance.now() + 800;
      }
    };

    const onFocusIn = (event: FocusEvent) => {
      if (!mobileMq.matches) return;
      if (!(event.target instanceof HTMLInputElement) || !event.target.matches(CHARACTER_SEARCH)) return;
      if (performance.now() > allowSearchFocusUntil) {
        cancelFocusStabilization();
        event.target.blur();
        return;
      }

      focusStabilizationPending = true;
      const viewport = window.visualViewport;
      if (!viewport || keyboardInsetFor(viewport.height) >= KEYBOARD_THRESHOLD_PX) {
        scheduleDialogScrollReset();
      }
    };

    const observer = new MutationObserver(syncBackdrop);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    syncBackdrop();

    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
      clearActiveBackdrop();
    };
  }, []);

  return null;
}
