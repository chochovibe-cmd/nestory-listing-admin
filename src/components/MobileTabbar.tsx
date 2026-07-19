"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useId, useState } from "react";
import {
  isMoreSectionActive,
  isNavActive,
  MOBILE_MORE_LINKS,
  MOBILE_SIDE_TABS
} from "@/lib/nav";

/**
 * C1 mobile tabbar — R4 §14-4 + UX-B + BX6:
 * 審核 | 工廠 | 中央凸起＋新增 | 更多
 * 紀錄收進更多；審核 = /drafts/new?pane=results.
 */
export function MobileTabbar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ? `?${searchParams.toString()}` : "";
  const [moreOpen, setMoreOpen] = useState(false);
  const titleId = useId();
  const moreActive = isMoreSectionActive(pathname, search) || moreOpen;

  const leftTabs = MOBILE_SIDE_TABS.filter((t) => t.side === "left");
  const rightTabs = MOBILE_SIDE_TABS.filter((t) => t.side === "right");

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname, search]);

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

  const addActive = isNavActive(pathname, "/drafts/new", search, "input");

  return (
    <>
      <nav aria-label="行動導覽" className="mobile-tabbar mobile-tabbar--fab">
        {leftTabs.map((tab) => (
          <Link
            className={
              isNavActive(pathname, tab.href, search, tab.workbenchPane)
                ? "active"
                : ""
            }
            href={tab.href}
            key={tab.href}
          >
            <span className="mtb-ic">{tab.icon}</span>
            <span>{tab.shortLabel}</span>
          </Link>
        ))}

        {/* BX6: raised center ＋新增 */}
        <Link
          aria-label="新增商品"
          className={`mtb-fab${addActive ? " active" : ""}`}
          href="/drafts/new"
        >
          <span className="mtb-fab-circle" aria-hidden>
            ＋
          </span>
          <span className="mtb-fab-label">新增</span>
        </Link>

        {rightTabs.map((tab) => (
          <Link
            className={
              isNavActive(pathname, tab.href, search, tab.workbenchPane)
                ? "active"
                : ""
            }
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
                    isNavActive(pathname, item.href, search, item.workbenchPane)
                      ? " active"
                      : ""
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
