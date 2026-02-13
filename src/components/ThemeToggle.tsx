"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "dark" | "light";

const STORAGE_KEY = "crewclock-theme";
const THEME_EVENT = "crewclock-theme-change";

function detectInitialTheme(): Theme {
  if (typeof document !== "undefined") {
    const dataTheme = document.documentElement.dataset.theme;
    if (dataTheme === "dark" || dataTheme === "light") {
      return dataTheme;
    }
  }

  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") {
      return stored;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  return "dark";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem(STORAGE_KEY, theme);
  window.dispatchEvent(new Event(THEME_EVENT));
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(detectInitialTheme());

    const onThemeChange = () => setTheme(detectInitialTheme());
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        setTheme(detectInitialTheme());
      }
    };

    window.addEventListener(THEME_EVENT, onThemeChange);
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(THEME_EVENT, onThemeChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const isLight = theme === "light";

  return (
    <button
      type="button"
      onClick={() => {
        const nextTheme: Theme = isLight ? "dark" : "light";
        applyTheme(nextTheme);
        setTheme(nextTheme);
      }}
      className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-border bg-card text-text-muted hover:text-text hover:border-border-light transition-colors"
      aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
      title={isLight ? "Dark mode" : "Light mode"}
    >
      {isLight ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}
