"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * B17: field-side "?" help. Desktop + mobile touch ≥44px; click outside / Esc closes.
 * Spec notes only — never for warnings/errors (those stay inline).
 */
export function FieldHelp({
  label = "說明",
  children
}: {
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent | TouchEvent) {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className={`field-help${open ? " open" : ""}`} ref={rootRef}>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={label}
        className="field-help-btn"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        ?
      </button>
      {open ? (
        <span className="field-help-pop" id={panelId} role="tooltip">
          {children}
        </span>
      ) : null}
    </span>
  );
}
