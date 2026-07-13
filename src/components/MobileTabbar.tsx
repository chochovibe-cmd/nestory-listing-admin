"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import {
  isMoreSectionActive,
  isNavActive,
  MOBILE_MORE_LINKS,
  MOBILE_PRIMARY_TABS
} from "@/lib/nav";

/**
 * C1 mobile tabbar — 4 cells (Q2-C): 新增 / 佇列 / 圖審 / 更多.
 * 「更多」opens bottom sheet (modal-overlay pattern, same as B7/B11).
 * BX6 raised center「＋」is NOT in this package.
 */
export function MobileTabbar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const titleId = useId();
  const moreActive = isMoreSectionActive(pathname) || moreOpen;

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMoreOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  return (
    <>
      <nav aria-label="行動導覽" className="mobile-tabbar">
        {MOBILE_PRIMARY_TABS.map((tab) => (
          <Link
            className={isNavActive(pathname, tab.href) ? "active" : ""}
            href={tab.href}
            key={tab.href}
          >
            <span className="mtb-ic">{tab.icon}</span>
            <span>{tab.shortLabel}</span>
          </Link>
        ))}
        <button
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
          className={moreActive ? "active" : ""}
          onClick={() => setMoreOpen(true)}
          type="button"
        >
          <span className="mtb-ic">⋯</span>
          <span>更多</span>
        </button>
      </nav>

      {moreOpen ? (
        <div
          aria-labelledby={titleId}
          aria-modal="true"
          className="modal-overlay open"
          onClick={(event) => {
            if (event.target === event.currentTarget) setMoreOpen(false);
          }}
          role="dialog"
        >
          <div className="modal-box mobile-more-sheet">
            <div className="modal-hdr">
              <span id={titleId}>更多</span>
              <button
                aria-label="關閉"
                className="modal-close"
                onClick={() => setMoreOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="modal-body mobile-more-list">
              {MOBILE_MORE_LINKS.map((item) => (
                <Link
                  className={`mobile-more-link${
                    isNavActive(pathname, item.href) ? " active" : ""
                  }`}
                  href={item.href}
                  key={item.href}
                  onClick={() => setMoreOpen(false)}
                >
                  <span aria-hidden className="mobile-more-ic">
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
