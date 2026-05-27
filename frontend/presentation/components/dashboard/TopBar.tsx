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
  dashboard: "Tableau de bord - Surveillance",
  track: "Suivi des serveurs - Selection",
  corrective: "Agent correcteur - Validation semi-automatique",
  forecast: "Prevision - Tendances a venir",
  fusion: "Fusion - Vue globale multi-serveurs",
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
  <div className="topbar">
    <span className="topbar__breadcrumb">IDPS</span>
    <span className="topbar__separator">›</span>
    <span className="topbar__title">{SECTION_TITLES[section]}</span>

    <div className="topbar__actions">
      <div className={`topbar__badge ${wsConnected ? "topbar__badge--live" : "topbar__badge--ws-off"}`}>
        <div className="topbar__badge-dot" />
        {wsConnected ? (isLive ? "DONNEES REELLES" : "EN DIRECT (calme)") : "HORS LIGNE"}
      </div>

      <div className={`topbar__badge ${wsConnected ? "topbar__badge--ws-on" : "topbar__badge--ws-off"}`}>
        <div className="topbar__badge-dot" />
        {wsConnected ? "WS connecte" : "WS hors ligne"}
      </div>

      <div className={`topbar__badge ${apiReady ? "topbar__badge--api-on" : "topbar__badge--api-off"}`}>
        <div className="topbar__badge-dot" />
        {apiReady ? `API EN DIRECT · MAJ ${lastUpdate?.toLocaleTimeString("fr-FR") ?? "-"}` : "API hors ligne"}
      </div>

      <DarkModeToggle theme={theme} onToggle={onToggleTheme} />

      <button
        className="topbar__btn"
        onClick={onRelancer}
        disabled={relancerLoading}
        style={{
          opacity: relancerLoading ? 0.6 : 1,
          cursor: relancerLoading ? "not-allowed" : "pointer",
        }}
      >
        {relancerLoading ? "Relance en cours..." : "Relancer le systeme ↗"}
      </button>
    </div>
  </div>
);
