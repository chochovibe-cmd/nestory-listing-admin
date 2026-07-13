"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  isNavActive,
  NAV_STORAGE_KEY,
  SIDEBAR_NAV
} from "@/lib/nav";

/**
 * C1 desktop collapsible sidebar.
 * Default collapsed (icon column); preference in localStorage `nestory_nav`.
 * Parent `.shell` receives `.nav-open` via `document` class on the shell node.
 */
export function AppSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  // Hydrate preference after mount. Do not sync class until ready — otherwise
  // open=false would wipe the navInitScript class before localStorage is read.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(NAV_STORAGE_KEY) === "open") {
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
        title="展開/收合選單"
        type="button"
      >
        ☰
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
      <div className="sidebar-foot">Nestory Admin</div>
    </nav>
  );
}
