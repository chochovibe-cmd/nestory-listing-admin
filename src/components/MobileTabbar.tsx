"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import {
  isMoreSectionActive,
  isNavActive,
  MOBILE_MORE_LINKS,
  MOBILE_SIDE_TABS
} from "@/lib/nav";

const FAB_LONG_PRESS_MS = 500;

/**
 * C1 mobile tabbar — R4 §14-4 + UX-B + BX6 + UX-AE T135 + UX-PKG3:
 * 審核 | 工廠 | 中央凸起＋新增（短按跳轉／長按擴展選單）| 儀表板 | 更多
 * 更多僅紀錄＋選品；審核 = /drafts/new?pane=results.
 */
export function MobileTabbar() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ? `?${searchParams.toString()}` : "";
  const [moreOpen, setMoreOpen] = useState(false);
  const [fabMenuOpen, setFabMenuOpen] = useState(false);
  const titleId = useId();
  const fabMenuId = useId();
  const moreActive = isMoreSectionActive(pathname, search) || moreOpen;
  const fabWrapRef = useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);

  const leftTabs = MOBILE_SIDE_TABS.filter((t) => t.side === "left");
  const rightTabs = MOBILE_SIDE_TABS.filter((t) => t.side === "right");

  function clearFabLongPressTimer() {
    if (longPressTimerRef.current != null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  useEffect(() => {
    setMoreOpen(false);
    setFabMenuOpen(false);
    longPressTriggeredRef.current = false;
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

  // T135: close FAB menu on outside pointer / Escape
  useEffect(() => {
    if (!fabMenuOpen) return;
    function onPointerDown(event: PointerEvent) {
      const root = fabWrapRef.current;
      if (root && !root.contains(event.target as Node)) {
        setFabMenuOpen(false);
        longPressTriggeredRef.current = false;
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setFabMenuOpen(false);
        longPressTriggeredRef.current = false;
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [fabMenuOpen]);

  useEffect(() => {
    return () => clearFabLongPressTimer();
  }, []);

  const addActive = isNavActive(pathname, "/drafts/new", search, "input");

  function handleFabTouchStart() {
    longPressTriggeredRef.current = false;
    clearFabLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      setFabMenuOpen(true);
    }, FAB_LONG_PRESS_MS);
  }

  function handleFabTouchEnd() {
    clearFabLongPressTimer();
  }

  function handleFabTouchCancel() {
    clearFabLongPressTimer();
  }

  function handleFabClick() {
    // Long-press already opened the menu — swallow the synthetic click
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    if (fabMenuOpen) {
      setFabMenuOpen(false);
      return;
    }
    router.push("/drafts/new");
  }

  function goNewDraft(href: string) {
    setFabMenuOpen(false);
    longPressTriggeredRef.current = false;
    router.push(href);
  }

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

        {/* BX6 + T135: raised center ＋新增 — short press navigate, long-press menu */}
        <div
          className={`mtb-fab-wrap${addActive ? " active" : ""}`}
          ref={fabWrapRef}
        >
          <div
            aria-hidden={!fabMenuOpen}
            className={`mtb-fab-menu${fabMenuOpen ? " open" : ""}`}
            id={fabMenuId}
            role="menu"
          >
            <button
              className="mtb-fab-menu-item"
              onClick={() => goNewDraft("/drafts/new")}
              role="menuitem"
              type="button"
            >
              ✦ 新增商品
            </button>
            <button
              className="mtb-fab-menu-item"
              onClick={() => goNewDraft("/drafts/new?mode=paste")}
              role="menuitem"
              type="button"
            >
              📋 貼連結
            </button>
            <button
              className="mtb-fab-menu-item"
              disabled
              role="menuitem"
              type="button"
            >
              📷 從相簿
              <span className="soon-tag">即將</span>
            </button>
          </div>
          <button
            aria-controls={fabMenuId}
            aria-expanded={fabMenuOpen}
            aria-haspopup="menu"
            aria-label="新增商品"
            className={`mtb-fab${addActive ? " active" : ""}`}
            onClick={handleFabClick}
            onContextMenu={(event) => event.preventDefault()}
            onTouchCancel={handleFabTouchCancel}
            onTouchEnd={handleFabTouchEnd}
            onTouchStart={handleFabTouchStart}
            type="button"
          >
            <span className="mtb-fab-circle" aria-hidden>
              ＋
            </span>
            <span className="mtb-fab-label">新增</span>
          </button>
        </div>

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
