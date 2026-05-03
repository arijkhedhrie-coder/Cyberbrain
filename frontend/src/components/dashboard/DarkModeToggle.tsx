// src/components/dashboard/DarkModeToggle.tsx
// ─────────────────────────────────────────────────────────────
// Bouton toggle mode clair ↔ sombre
// À placer dans <TopBar> à droite des badges
// ─────────────────────────────────────────────────────────────

import type { FC } from "react";

interface Props {
  theme:    "dark" | "light";
  onToggle: () => void;
}

export const DarkModeToggle: FC<Props> = ({ theme, onToggle }) => (
  <button
    onClick={onToggle}
    title={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
    aria-label="Toggle dark mode"
    style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      width: 32, height: 32,
      borderRadius: 8,
      border: "1px solid var(--border)",
      background: "var(--bg-hover, rgba(255,255,255,.05))",
      cursor: "pointer",
      color: "var(--text-secondary)",
      flexShrink: 0,
      transition: "background .2s, border-color .2s, color .2s",
    }}
    onMouseEnter={e => {
      (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-glow)";
      (e.currentTarget as HTMLButtonElement).style.color = "var(--cyan)";
    }}
    onMouseLeave={e => {
      (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)";
      (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)";
    }}
  >
    {theme === "dark" ? (
      /* Soleil */
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="12" r="5"/>
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
      </svg>
    ) : (
      /* Lune */
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>
    )}
  </button>
);
