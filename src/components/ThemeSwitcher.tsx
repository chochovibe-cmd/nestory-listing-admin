"use client";

import { useEffect, useState } from "react";

const THEMES = [
  { value: "dark", icon: "🌑", title: "暗色" },
  { value: "nordic", icon: "🐰", title: "北歐 Miffy 風" },
  { value: "kitty", icon: "🎀", title: "Hello Kitty 風" }
] as const;

const STORAGE_KEY = "nestory_theme";

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<string>("dark");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) setTheme(stored);
  }, []);

  useEffect(() => {
    document.body.dataset.theme = theme;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return (
    <>
      {THEMES.map((item) => (
        <button
          className={`theme-btn${theme === item.value ? " active" : ""}`}
          key={item.value}
          onClick={() => setTheme(item.value)}
          title={item.title}
          type="button"
        >
          {item.icon}
        </button>
      ))}
    </>
  );
}
