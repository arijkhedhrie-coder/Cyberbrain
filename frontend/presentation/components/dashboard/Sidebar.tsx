import { useState, type FC } from "react";
import "../../../shared/style/Sidebar.css";

import logo from "../../../shared/assets/cyberbrain.png";

interface SessionStats {
  session:      number;
  logsAnalysed: number;
  lastUpdate:   string;
  threat:       string;
}

interface PredictionSummary {
  available:       boolean;
  prediction_score: number;
  flags:           string[];
  predicted_events: string[];
  message?:        string;
  risk_level:      string;
  prevention_suggestions: string[];
}

type Section = "dashboard" | "corrective" | "forecast" | "fusion";

interface Props {
  activeSection:    Section;
  onSectionChange:  (s: Section) => void;
  username:         string;
  onLogout:         () => void;
  sessionStats?:    SessionStats;
  prediction?:      PredictionSummary;
}

// ── SVG Icons ────────────────────────────────────────────────
const IconDashboard = ({ active }: { active: boolean }) => (
  <svg viewBox="0 0 14 14" width={13} height={13} fill="none"
    stroke={active ? "#a78bfa" : "currentColor"} strokeWidth="1.5" strokeLinecap="round">
    <path d="M1 10L4 7l2 2 3-4 3 3"/>
  </svg>
);

const IconCorrective = ({ active }: { active: boolean }) => (
  <svg viewBox="0 0 14 14" width={13} height={13} fill="none"
    stroke={active ? "#a78bfa" : "currentColor"} strokeWidth="1.5" strokeLinecap="round">
    <path d="M7 1L2 3.5v4C2 10.5 4.2 12.8 7 13.5c2.8-.7 5-3 5-6v-4L7 1z"/>
    <path d="M5 7l1.5 1.5L9 5.5"/>
  </svg>
);

const IconStar = () => (
  <svg viewBox="0 0 14 14" width={13} height={13} fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M7 1l1.5 3 3.5.5-2.5 2.5.6 3.5L7 9l-3.1 1.5.6-3.5L2 4.5 5.5 4z"/>
  </svg>
);

const IconFusion = ({ active }: { active: boolean }) => (
  <svg viewBox="0 0 14 14" width={13} height={13} fill="none"
    stroke={active ? "#22d3ee" : "currentColor"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7" cy="7" r="2.2" />
    <path d="M7 1.2v1.6M7 11.2v1.6M1.2 7h1.6M11.2 7h1.6M2.7 2.7l1.1 1.1M10.2 10.2l1.1 1.1M10.2 3.8l1.1-1.1M2.7 11.3l1.1-1.1" />
  </svg>
);


const IconChevron = () => (
  <svg viewBox="0 0 14 14" width={12} height={12} fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 11L5 7l4-4"/>
  </svg>
);

// ── Nav button sub-component ─────────────────────────────────
interface NavBtnProps {
  label:         string;
  icon:          React.ReactNode;
  active?:       boolean;
  onClick?:      () => void;
  count?:        string | number;
  countVariant?: "purple" | "cyan" | "red";
  tooltip:       string;
}

const NavBtn: FC<NavBtnProps> = ({
  label, icon, active, onClick, count, countVariant = "purple", tooltip,
}) => (
  <button
    className={`sidebar__nav-btn${active ? " sidebar__nav-btn--active" : ""}`}
    onClick={onClick}
    data-tooltip={tooltip}
  >
    <div className="sidebar__nav-icon">{icon}</div>
    <span className="sidebar__nav-label">{label}</span>
    {count !== undefined && (
      <span className={`sidebar__nav-count sidebar__nav-count--${countVariant}`}>
        {count}
      </span>
    )}
  </button>
);

// ── Main Component ───────────────────────────────────────────
export const Sidebar: FC<Props> = ({
  activeSection,
  onSectionChange,
  onLogout,
  prediction,
  sessionStats = { session: 0, logsAnalysed: 0, lastUpdate: "—", threat: "NORMAL" },
}) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`sidebar${collapsed ? " sidebar--collapsed" : ""}`}>

      {/* ── Brand ── */}
      <div className="sidebar__brand">
        <div className="sidebar__logo">
          <img src={logo} alt="Cyberbrain" className="sidebar__logo-img" />
        </div>
        <div className="sidebar__brand-text">
          <div className="sidebar__brand-name">IDPS — SOC</div>
          <div className="sidebar__brand-sub">v2.4 · Pipeline actif</div>
        </div>
        <div className="sidebar__status-dot" />
        <button
          className="sidebar__toggle"
          onClick={() => setCollapsed(c => !c)}
          aria-label={collapsed ? "Ouvrir le menu" : "Reduire le menu"}
          title={collapsed ? "Ouvrir" : "Reduire"}
        >
          <IconChevron />
        </button>
      </div>

      {/* ── Nav ── */}
      <nav className="sidebar__nav">

        <div className="sidebar__section-label">Navigation</div>

        <NavBtn
          label="Dashboard"
          tooltip="Dashboard"
          active={activeSection === "dashboard"}
          onClick={() => onSectionChange("dashboard")}
          count={3}
          countVariant="purple"
          icon={<IconDashboard active={activeSection === "dashboard"} />}
        />
        <NavBtn
          label="Agent Correcteur"
          tooltip="Agent Correcteur"
          active={activeSection === "corrective"}
          onClick={() => onSectionChange("corrective")}
          countVariant="purple"
          icon={<IconCorrective active={activeSection === "corrective"} />}
        />
        <NavBtn
          label="Prévision"
          tooltip="Prévision"
          active={activeSection === "forecast"}
          onClick={() => onSectionChange("forecast")}
          count={prediction?.available ? `${prediction.prediction_score}%` : undefined}
          countVariant="cyan"
          icon={<IconStar />}   // you can use any icon, e.g. IconStar already exists
        />
        <NavBtn
          label="Fusion"
          tooltip="Fusion"
          active={activeSection === "fusion"}
          onClick={() => onSectionChange("fusion")}
          countVariant="cyan"
          icon={<IconFusion active={activeSection === "fusion"} />}
        />

        {/* ── System block ── */}
        <div className="sidebar__system">
          <div className="sidebar__system-header">
            <div className="sidebar__system-dot" />
            <span className="sidebar__system-title">Systeme</span>
            <span className="sidebar__system-status">Operationnel</span>
          </div>
          <div className="sidebar__system-row">
            <span>Session</span>
            <span className="sidebar__system-val">#{sessionStats.session}</span>
          </div>
          <div className="sidebar__system-row">
            <span>Logs</span>
            <span className="sidebar__system-val">{sessionStats.logsAnalysed.toLocaleString()}</span>
          </div>
          <div className="sidebar__system-row">
            <span>Prévision</span>
            <span className="sidebar__system-val">
              {prediction
                ? prediction.available
                  ? `${prediction.prediction_score}%`
                  : "N/A"
                : "…"}
            </span>
          </div>
          {prediction?.available && (
            <div className="sidebar__system-card" style={{ marginTop: 10, padding: 10, borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>
                Détail prévision
              </div>
              <div style={{ fontSize: 11, color: "#e2e8f0", marginBottom: 4 }}>
                Risque: <span style={{
                  color: prediction.risk_level === "CRITICAL" ? "#ef4444" :
                         prediction.risk_level === "HIGH" ? "#f59e0b" : "#22c55e"
                }}>{prediction.risk_level}</span>
              </div>
              {prediction.message && (
                <div style={{ fontSize: 10, color: "#cbd5e1", marginBottom: 4 }}>
                  {prediction.message}
                </div>
              )}
              {prediction.predicted_events.length > 0 && (
                <div style={{ fontSize: 10, color: "#cbd5e1", marginBottom: 4 }}>
                  Événements: {prediction.predicted_events.slice(0, 2).join(", ")}
                </div>
              )}
              {prediction.flags.length > 0 && (
                <div style={{ fontSize: 10, color: "#fde68a", marginBottom: 4 }}>
                  Signaux: {prediction.flags.slice(0, 2).join(", ")}
                </div>
              )}
              {prediction.prevention_suggestions.length > 0 && (
                <div style={{ fontSize: 10, color: "#22c55e" }}>
                  Prévention: {prediction.prevention_suggestions[0]}
                </div>
              )}
            </div>
          )}
          <div className="sidebar__system-row">
            <span>MAJ</span>
            <span className="sidebar__system-val">{sessionStats.lastUpdate}</span>
          </div>

          {/* ✅ Bouton Déconnexion */}
          <button
            onClick={onLogout}
            style={{
              marginTop: 12,
              padding: "6px 12px",
              borderRadius: 6,
              background: "#E24B4A",
              border: "none",
              color: "white",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              width: "100%",
            }}
          >
            🚪 Déconnexion
          </button>
        </div>

      </nav>

    </div>
  );
};
