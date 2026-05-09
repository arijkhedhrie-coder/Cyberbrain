// src/hooks/useDarkMode.ts
// ─────────────────────────────────────────────────────────────
// Hook : gère le mode clair/sombre
// Persiste dans localStorage + applique data-theme sur <html>
// ─────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";

export type Theme = "dark" | "light";

export const useDarkMode = (): [Theme, () => void] => {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("idps-theme") as Theme | null;
    if (saved === "light" || saved === "dark") return saved;
    // Détection OS
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("idps-theme", theme);
  }, [theme]);

  const toggle = () => setTheme(t => t === "dark" ? "light" : "dark");

  return [theme, toggle];
};
