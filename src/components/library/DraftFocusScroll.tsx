"use client";

import { useEffect } from "react";

/**
 * C4 Q4-A: when landing with ?focus=images, scroll to the image panel.
 * No-op when focus is missing or unknown.
 */
export function DraftFocusScroll({ focus }: { focus?: string | null }) {
  useEffect(() => {
    if (focus !== "images") return;
    const el = document.getElementById("draft-images");
    if (!el) return;
    const t = window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(t);
  }, [focus]);

  return null;
}
