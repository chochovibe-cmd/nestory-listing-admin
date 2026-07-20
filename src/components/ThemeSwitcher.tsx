"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

const THEMES = [
  { value: "dark", icon: "🌑", title: "夜色" },
  { value: "nordic", icon: "🐰", title: "奶茶" },
  { value: "kitty", icon: "🎀", title: "海鹽" }
] as const;

const STORAGE_KEY = "nestory_theme";

/**
 * Theme picker. UX-B2-P15-r2: on ≤959px the menu portals to body + fixed
 * bottom placement so it is not clipped by topbar backdrop-filter / edges.
 */
export function ThemeSwitcher() {
  const [theme, setTheme] = useState<string>("dark");
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    setMounted(true);
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) setTheme(stored);
  }, []);

  useEffect(() => {
    document.body.dataset.theme = theme;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 959px)");
    function sync() {
      setIsMobile(mql.matches);
    }
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent | TouchEvent) {
      const root = wrapRef.current;
      const target = event.target;
      if (!(target instanceof Node)) return;
      // Portal menu lives outside wrap — still treat as inside if it has our id
      const menuEl = document.getElementById(menuId);
      if (root?.contains(target) || menuEl?.contains(target)) return;
      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, menuId]);

  const current = THEMES.find((item) => item.value === theme) ?? THEMES[0];

  function choose(value: string) {
    setTheme(value);
    setOpen(false);
  }

  const menu = (
    <div
      className={`theme-picker-menu${open ? " open" : ""}${
        isMobile && open ? " theme-picker-menu--mobile-fixed" : ""
      }`}
      id={menuId}
      role="listbox"
      aria-label="主題"
    >
      {THEMES.map((item) => (
        <button
          className={`theme-btn${theme === item.value ? " active" : ""}`}
          key={item.value}
          onClick={() => choose(item.value)}
          role="option"
          aria-selected={theme === item.value}
          title={item.title}
          type="button"
        >
          {item.icon} {item.title}
        </button>
      ))}
    </div>
  );

  return (
    <div className="theme-picker" ref={wrapRef}>
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="theme-picker-toggle"
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        title="切換主題"
        type="button"
      >
        {current.icon} {current.title} <span>{open ? "▴" : "▾"}</span>
      </button>
      {isMobile && open && mounted
        ? createPortal(menu, document.body)
        : menu}
    </div>
  );
}
