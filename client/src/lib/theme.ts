import { useEffect, useState } from "react";

const KEY = "cshs-theme";
export type Theme = "light" | "dark";

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function currentTheme(): Theme {
  const v = localStorage.getItem(KEY);
  return v === "dark" || v === "light" ? v : systemTheme();
}

export function setStoredTheme(t: Theme) {
  localStorage.setItem(KEY, t);
  document.documentElement.classList.toggle("dark", t === "dark");
  window.dispatchEvent(new CustomEvent<Theme>("themechange", { detail: t }));
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(currentTheme());
  useEffect(() => {
    const onChange = (e: Event) => setTheme((e as CustomEvent<Theme>).detail);
    window.addEventListener("themechange", onChange);
    return () => window.removeEventListener("themechange", onChange);
  }, []);
  return { theme, toggleTheme: () => setStoredTheme(theme === "dark" ? "light" : "dark") };
}
