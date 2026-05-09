// src/components/dashboard/TopBar.tsx
import type { FC } from "react";
import "../../../shared/style/Topbar.css";
import { DarkModeToggle } from "./DarkModeToggle";
import type { Theme } from "../../../presentation/hooks/useDarkMode";


type Section = "dashboard" | "track" | "corrective";

interface Props {
  section:          Section;
  apiReady:         boolean;
  lastUpdate:       Date | null;
  wsConnected:      boolean;
  isLive:           boolean;
  theme:            Theme;
  onToggleTheme:    () => void;
  onRelancer?:      () => void;
  relancerLoading?: boolean;
}


const SECTION_TITLES: Record<Section, string> = {
  dashboard:  "Dashboard — Anomalies",
  track:      "Track Servers — Sélection & Colonnes",
  corrective: "Agent Correcteur — Validation Semi-Automatique",
};

export const TopBar: FC<Props> = ({
  section, apiReady, lastUpdate, wsConnected, isLive,
  theme, onToggleTheme, onRelancer,
  relancerLoading,
}) => (
  <div className="topbar">
    <span className="topbar__breadcrumb">IDPS</span>
    <span className="topbar__separator">›</span>
    <span className="topbar__title">
      {SECTION_TITLES[section]}
    </span>

    <div className="topbar__actions">
      {isLive && (
        <div className="topbar__badge topbar__badge--live">
          <div className="topbar__badge-dot" />
          LIVE
        </div>
      )}
      <div className={`topbar__badge ${wsConnected ? "topbar__badge--ws-on" : "topbar__badge--ws-off"}`}>
        <div className="topbar__badge-dot" />
        {wsConnected ? "WS connecté" : "WS hors ligne"}
      </div>
      <div className={`topbar__badge ${apiReady ? "topbar__badge--api-on" : "topbar__badge--api-off"}`}>
        <div className="topbar__badge-dot" />
        {apiReady
          ? `API LIVE · MAJ ${lastUpdate?.toLocaleTimeString("fr-FR") ?? "—"}`
          : "API hors ligne"}
      </div>

      {/* ── Toggle dark / light ── */}
      <DarkModeToggle theme={theme} onToggle={onToggleTheme} />

      <button
        className="topbar__btn"
        onClick={onRelancer}
        disabled={relancerLoading}
        style={{
          opacity: relancerLoading ? 0.6 : 1,
          cursor:  relancerLoading ? "not-allowed" : "pointer",
        }}
      >
        {relancerLoading ? "Relance en cours…" : "Relancer pipeline ↗"}
      </button>
    </div>
  </div>
);