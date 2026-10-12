"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";

type Theme = "light" | "dark";
const STORAGE_KEY = "gz-theme";

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "light" || attr === "dark" ? attr : systemTheme();
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onChange);
  };
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "light" as Theme);

  // In dev, React Strict Mode remounts and resets <html> to the attributes its JSX manages,
  // clearing the one the inline script set. Re-apply the stored choice before paint. A no-op
  // in production.
  useLayoutEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark") document.documentElement.setAttribute("data-theme", stored);
    } catch {
      // Storage can be blocked; the system setting applies.
    }
  }, []);

  function toggle() {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be blocked; the choice still applies for this visit.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={theme === "dark"}
      className="inline-flex h-11 min-w-11 items-center justify-center px-3 font-display text-sm font-semibold"
    >
      <span aria-hidden="true" className="mr-2 inline-block h-4 w-4 rounded-full border-2 border-current">
        <span
          className="block h-full w-1/2 rounded-l-full bg-current"
          style={{ opacity: theme === "dark" ? 1 : 0.35 }}
        />
      </span>
      Dark theme
    </button>
  );
}
