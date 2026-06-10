import type { FC } from "react";
import "../../../shared/style/Topbar.css";
import { DarkModeToggle } from "./DarkModeToggle";
import type { Theme } from "../../../presentation/hooks/useDarkMode";

type Section = "dashboard" | "track" | "corrective" | "forecast" | "fusion";

interface Props {
  section: Section;
  apiReady: boolean;
  lastUpdate: Date | null;
  wsConnected: boolean;
  isLive: boolean;
  theme: Theme;
  onToggleTheme: () => void;
  onRelancer?: () => void;
  relancerLoading?: boolean;
}

const SECTION_TITLES: Record<Section, string> = {
  dashboard: "Tableau de bord — Surveillance",
  track: "Suivi des serveurs — Sélection",
  corrective: "Agent correcteur — Validation semi-automatique",
  forecast: "Prévision — Tendances à venir",
  fusion: "Vue consolidée — Multi-serveurs",
};

export const TopBar: FC<Props> = ({
  section,
  apiReady,
  lastUpdate,
  wsConnected,
  isLive,
  theme,
  onToggleTheme,
  onRelancer,
  relancerLoading,
}) => (
  <header className="cb-topbar">
    <div className="cb-topbar__grid-glow" aria-hidden />

    <div className="cb-topbar__left">
      <div className="cb-topbar__brand">
        <div className="cb-topbar__logo" aria-hidden>
          <svg viewBox="0 0 32 32" fill="none">
            <path
              d="M16 3c4 0 7 2.5 7 6 2.5.6 4 2.7 4 5.3 0 1.9-1 3.4-2.4 4.2.6.9.9 2 .9 3.2 0 3.4-2.7 6-6.2 6-1.3 0-2.5-.4-3.3-1.1-.8.7-2 1.1-3.3 1.1-3.5 0-6.2-2.6-6.2-6 0-1.2.3-2.3.9-3.2C6 17.7 5 16.2 5 14.3c0-2.6 1.5-4.7 4-5.3 0-3.5 3-6 7-6z"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <circle cx="16" cy="16" r="2.4" fill="currentColor" />
            <path d="M10 12l3 2M22 12l-3 2M10 20l3-2M22 20l-3-2M16 8v3M16 21v3" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </div>
        <div className="cb-topbar__brand-text">
          <span className="cb-topbar__brand-name">
            cyber<span className="cb-topbar__brand-accent">brain</span>
          </span>
          <span className="cb-topbar__brand-tag">Centre des opérations de sécurité</span>
        </div>
      </div>

      <div className="cb-topbar__divider" />

      
    </div>

    <div className="cb-topbar__right">
      <div className={`cb-pill ${wsConnected ? (isLive ? "cb-pill--live" : "cb-pill--calm") : "cb-pill--off"}`}>
        <span className="cb-pill__pulse" />
        {wsConnected ? (isLive ? "DONNÉES RÉELLES" : "EN DIRECT · calme") : "HORS LIGNE"}
      </div>

      <div className={`cb-pill ${wsConnected ? "cb-pill--ok" : "cb-pill--off"}`}>
        <span className="cb-pill__dot" />
        {wsConnected ? "WS connecté" : "WS hors ligne"}
      </div>

      <div className={`cb-pill ${apiReady ? "cb-pill--ok" : "cb-pill--off"}`}>
        <span className="cb-pill__dot" />
        {apiReady
          ? `  ${lastUpdate?.toLocaleTimeString("fr-FR") ?? "—"}`
          : " hors ligne"}
      </div>

      

      
    </div>
  </header>
);
