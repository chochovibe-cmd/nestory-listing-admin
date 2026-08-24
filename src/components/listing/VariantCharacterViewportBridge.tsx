"use client";

import { useEffect } from "react";

const CHARACTER_DIALOG = '.variant-editor-modal[data-modal-kind="character"]';
const CHARACTER_SEARCH = `${CHARACTER_DIALOG} .v-char-search`;
const CHARACTER_ROWS = `${CHARACTER_DIALOG} .v-char-list--modal > label`;

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

export function VariantCharacterViewportBridge() {
  useEffect(() => {
    const mobileMq = window.matchMedia("(max-width: 959px)");
    let activeBackdrop: HTMLElement | null = null;
    let cleanupViewport: (() => void) | null = null;
    let allowSearchFocusUntil = 0;

    const clearActiveBackdrop = () => {
      cleanupViewport?.();
      cleanupViewport = null;
      if (activeBackdrop) {
        activeBackdrop.removeAttribute("data-modal-kind");
        activeBackdrop.style.removeProperty("--ve-visual-height");
        activeBackdrop.style.removeProperty("--ve-visual-top");
        activeBackdrop.style.removeProperty("--ve-char-list-max");
        activeBackdrop.style.removeProperty("top");
        activeBackdrop.style.removeProperty("height");
        activeBackdrop.style.removeProperty("bottom");
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
      hideBlankCharacterRows(activeBackdrop);

      if (!mobileMq.matches || !window.visualViewport) return;
      const viewport = window.visualViewport;

      const syncVisualViewport = () => {
        if (!activeBackdrop) return;
        const visualHeight = Math.max(0, Math.round(viewport.height));
        const visualTop = Math.max(0, Math.round(viewport.offsetTop));
        const listMax = Math.max(96, Math.min(192, Math.round(visualHeight * 0.26)));
        activeBackdrop.style.setProperty("--ve-visual-height", `${visualHeight}px`);
        activeBackdrop.style.setProperty("--ve-visual-top", `${visualTop}px`);
        activeBackdrop.style.setProperty("--ve-char-list-max", `${listMax}px`);
        activeBackdrop.style.top = `${visualTop}px`;
        activeBackdrop.style.height = `${visualHeight}px`;
        activeBackdrop.style.bottom = "auto";
      };

      syncVisualViewport();
      viewport.addEventListener("resize", syncVisualViewport);
      viewport.addEventListener("scroll", syncVisualViewport);
      cleanupViewport = () => {
        viewport.removeEventListener("resize", syncVisualViewport);
        viewport.removeEventListener("scroll", syncVisualViewport);
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
      if (performance.now() > allowSearchFocusUntil) event.target.blur();
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
