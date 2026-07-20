"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  isNavActive,
  NAV_STORAGE_KEY,
  SETTINGS_NAV,
  SIDEBAR_NAV
} from "@/lib/nav";

/**
 * C1 desktop collapsible sidebar + C2 settings pin at bottom (Q1-C).
 * UX-PKG1 1-5: default expanded when no preference; icon «/» by open state.
 * Preference in localStorage `nestory_nav` (open / closed).
 * Parent `.shell` receives `.nav-open` via class on the shell node.
 */
export function AppSidebar() {
  const pathname = usePathname();
  // Default open until hydrate; navInitScript also defaults to open when no key.
  const [open, setOpen] = useState(true);
  const [ready, setReady] = useState(false);

  // Hydrate preference after mount. Do not sync class until ready — otherwise
  // open would wipe / fight the navInitScript class before localStorage is read.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(NAV_STORAGE_KEY);
      if (stored === "closed") {
        setOpen(false);
      } else if (stored === "open") {
        setOpen(true);
      } else {
        // Never written → default expanded
        setOpen(true);
      }
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  // Sync shell class for CSS (width, label opacity).
  useEffect(() => {
    if (!ready) return;
    const shell = document.getElementById("app-shell");
    if (!shell) return;
    shell.classList.toggle("nav-open", open);
  }, [open, ready]);

  function toggle() {
    setOpen((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(NAV_STORAGE_KEY, next ? "open" : "closed");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const settingsActive = isNavActive(pathname, SETTINGS_NAV.href);

  return (
    <nav
      aria-label="主導覽"
      className={`sidebar${ready ? "" : " sidebar--hydrating"}`}
    >
      <button
        aria-expanded={open}
        aria-label={open ? "收合側邊選單" : "展開側邊選單"}
        className="sidebar-toggle"
        onClick={toggle}
        title={open ? "收合選單" : "展開選單"}
        type="button"
      >
        {open ? "«" : "»"}
      </button>
      {SIDEBAR_NAV.map((item) => {
        const active = isNavActive(pathname, item.href);
        return (
          <Link
            className={`sidebar-item${active ? " active" : ""}`}
            href={item.href}
            key={item.href}
            title={item.label}
          >
            <span aria-hidden className="sidebar-ic">
              {item.icon}
            </span>
            <span className="sidebar-label">{item.label}</span>
          </Link>
        );
      })}
      <div className="sidebar-bottom">
        <Link
          className={`sidebar-item${settingsActive ? " active" : ""}`}
          href={SETTINGS_NAV.href}
          title={SETTINGS_NAV.label}
        >
          <span aria-hidden className="sidebar-ic">
            {SETTINGS_NAV.icon}
          </span>
          <span className="sidebar-label">{SETTINGS_NAV.label}</span>
        </Link>
        <div className="sidebar-foot">Nestory Admin</div>
      </div>
    </nav>
  );
}
