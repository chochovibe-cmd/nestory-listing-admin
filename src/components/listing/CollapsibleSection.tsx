"use client";

import type { ReactNode } from "react";

/**
 * B17: advanced form section (settings-toggle rhythm).
 * Parent owns open state so B13 restore can force-open when content is filled.
 */
export function CollapsibleSection({
  title,
  open,
  onToggle,
  summary,
  children,
  className = ""
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  /** Optional one-line hint when collapsed (e.g. "已填 2 列") */
  summary?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`adv-section${open ? " open" : ""}${className ? ` ${className}` : ""}`}>
      <button
        aria-expanded={open}
        className="adv-section-toggle"
        onClick={onToggle}
        type="button"
      >
        <span className="adv-section-title">
          <span>{open ? "▾" : "▸"}</span>
          <span>{title}</span>
          {!open && summary ? <span className="adv-section-summary">{summary}</span> : null}
        </span>
      </button>
      {open ? <div className="adv-section-body">{children}</div> : null}
    </div>
  );
}

/**
 * Open a section when `hasContent` flips false→true (typing / B13 restore).
 * Manual collapse stays until content is cleared and re-filled.
 */
export function shouldAutoOpenSection(
  hasContent: boolean,
  prevHasContent: boolean
): boolean {
  return hasContent && !prevHasContent;
}
