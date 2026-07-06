"use client";

import { useEffect, useState } from "react";

const THEMES = [
  { value: "dark", icon: "🌑", title: "夜色" },
  { value: "nordic", icon: "🐰", title: "奶茶" },
  { value: "kitty", icon: "🎀", title: "海鹽" }
] as const;

const STORAGE_KEY = "nestory_theme";

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<string>("dark");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) setTheme(stored);
  }, []);

  useEffect(() => {
    document.body.dataset.theme = theme;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const current = THEMES.find((item) => item.value === theme) ?? THEMES[0];

  function choose(value: string) {
    setTheme(value);
    setOpen(false);
  }

  return (
    <div className="theme-picker">
      <button
        aria-expanded={open}
        className="theme-picker-toggle"
        onClick={() => setOpen((current) => !current)}
        title="切換主題"
        type="button"
      >
        {current.icon} {current.title} <span>{open ? "▴" : "▾"}</span>
      </button>
      <div className={`theme-picker-menu${open ? " open" : ""}`}>
        {THEMES.map((item) => (
          <button
            className={`theme-btn${theme === item.value ? " active" : ""}`}
            key={item.value}
            onClick={() => choose(item.value)}
            title={item.title}
            type="button"
          >
            {item.icon} {item.title}
          </button>
        ))}
      </div>
    </div>
  );
}
