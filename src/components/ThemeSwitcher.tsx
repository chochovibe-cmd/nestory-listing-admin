"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

const THEMES = [
  { value: "dark", icon: "🌙", title: "夜色" },
  { value: "nordic", icon: "🐱", title: "奶茶" },
  { value: "kitty", icon: "🐉", title: "龍珠" }
] as const;

type ThemeId = (typeof THEMES)[number]["value"];

const STORAGE_KEY = "nestory_theme";
const VALID_THEMES = new Set<string>(THEMES.map((t) => t.value));

function isThemeId(value: string | null | undefined): value is ThemeId {
  return Boolean(value && VALID_THEMES.has(value));
}

/** Read last theme from localStorage or body (themeInitScript). Never invent dark overwrite. */
function readPersistedTheme(): ThemeId {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isThemeId(stored)) return stored;
  } catch {
    /* ignore */
  }
  const bodyTheme = document.body?.dataset?.theme;
  if (isThemeId(bodyTheme)) return bodyTheme;
  return "dark";
}

/**
 * Theme picker.
 * UX-B2-P15-r2b: mobile opens bottom sheet (same shell as library / more),
 * not a clipped fixed list. Desktop keeps compact dropdown.
 *
 * Persistence: only write localStorage AFTER hydrate from stored value.
 * (Previously default "dark" mounted and overwrote last theme on refresh.)
 */
export function ThemeSwitcher() {
  const [theme, setTheme] = useState<string>("dark");
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const sheetTitleId = useId();

  useEffect(() => {
    setMounted(true);
    setTheme(readPersistedTheme());
    setHydrated(true);
  }, []);

  useEffect(() => {
    // Gate writes until we restored the real preference — otherwise the
    // initial useState("dark") wipes nordic/kitty on every refresh (Strict Mode too).
    if (!hydrated || !isThemeId(theme)) return;
    document.body.dataset.theme = theme;
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme, hydrated]);

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
    if (!open || isMobile) return;

    function onPointerDown(event: MouseEvent | TouchEvent) {
      const root = wrapRef.current;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (root?.contains(target)) return;
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
  }, [open, isMobile]);

  useEffect(() => {
    if (!open || !isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, isMobile]);

  const current = THEMES.find((item) => item.value === theme) ?? THEMES[0];

  function choose(value: string) {
    setTheme(value);
    setOpen(false);
  }

  const desktopMenu = (
    <div
      className={`theme-picker-menu${open ? " open" : ""}`}
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

  const mobileSheet =
    mounted && open && isMobile
      ? createPortal(
          <div
            aria-labelledby={sheetTitleId}
            aria-modal="true"
            className="modal-overlay open"
            onClick={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
            role="dialog"
          >
            <div className="modal-box mobile-more-sheet theme-picker-sheet">
              <div className="modal-hdr">
                <span id={sheetTitleId}>選擇主題</span>
                <button
                  aria-label="關閉"
                  className="modal-close"
                  onClick={() => setOpen(false)}
                  type="button"
                >
                  ×
                </button>
              </div>
              <div className="modal-body theme-picker-sheet-body">
                {THEMES.map((item) => (
                  <button
                    className={`theme-sheet-option${
                      theme === item.value ? " active" : ""
                    }`}
                    key={item.value}
                    onClick={() => choose(item.value)}
                    type="button"
                  >
                    <span aria-hidden className="theme-sheet-option-ic">
                      {item.icon}
                    </span>
                    <span>{item.title}</span>
                    {theme === item.value ? (
                      <span className="theme-sheet-option-check" aria-hidden>
                        ✓
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="theme-picker" ref={wrapRef}>
      <button
        aria-controls={isMobile ? undefined : menuId}
        aria-expanded={open}
        aria-haspopup={isMobile ? "dialog" : "listbox"}
        className="theme-picker-toggle"
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        title="切換主題"
        type="button"
      >
        {current.icon} {current.title} <span>{open ? "▴" : "▾"}</span>
      </button>
      {isMobile ? mobileSheet : desktopMenu}
    </div>
  );
}
