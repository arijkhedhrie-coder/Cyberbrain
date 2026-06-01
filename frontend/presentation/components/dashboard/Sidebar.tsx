import { useState, type FC, type ReactNode } from "react";
import "../../../shared/style/Sidebar.css";

interface SessionStats {
  session:      number;
  logsAnalysed: number;
  lastUpdate:   string;
  threat:       string;
}

interface PredictionSummary {
  available: boolean;
  prediction_score: number;
  flags: string[];
  predicted_events: string[];
  message?: string;
  risk_level: string;
  prevention_suggestions: string[];
}

type Section = "dashboard" | "corrective" | "forecast" | "fusion";

interface Props {
  activeSection: Section;
  onSectionChange: (s: Section) => void;
  username: string;
  onLogout: () => void;
  sessionStats?: SessionStats;
  prediction?: PredictionSummary;
}

/* ── Icons ─────────────────────────────────────────────── */
const IconDashboard: FC = () => (
  <svg viewBox="0 0 16 16" width={16} height={16} fill="none"
    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="5" height="6" rx="1.2" />
    <rect x="9" y="2" width="5" height="3.5" rx="1.2" />
    <rect x="9" y="7" width="5" height="7" rx="1.2" />
    <rect x="2" y="10" width="5" height="4" rx="1.2" />
  </svg>
);

const IconCorrective: FC = () => (
  <svg viewBox="0 0 16 16" width={16} height={16} fill="none"
    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 1.5L2.5 4v4.2c0 3.3 2.4 5.7 5.5 6.3 3.1-.6 5.5-3 5.5-6.3V4L8 1.5z" />
    <path d="M5.8 8.2L7.3 9.7 10.4 6.6" />
  </svg>
);

const IconForecast: FC = () => (
  <svg viewBox="0 0 16 16" width={16} height={16} fill="none"
    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12l3.5-4 3 2.5L13 4" />
    <path d="M10 4h3v3" />
  </svg>
);

const IconFusion: FC = () => (
  <svg viewBox="0 0 16 16" width={16} height={16} fill="none"
    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="2.4" />
    <circle cx="8" cy="8" r="5.5" strokeDasharray="2 2" opacity="0.6" />
    <path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15" />
  </svg>
);

const IconLogout = () => (
  <svg viewBox="0 0 16 16" width={15} height={15} fill="none"
    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 3V2H3v12h7v-1" />
    <path d="M7 8h8M12 5l3 3-3 3" />
  </svg>
);

const IconChevron: FC<{ collapsed: boolean }> = ({ collapsed }) => (
  <svg viewBox="0 0 16 16" width={14} height={14} fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: collapsed ? "rotate(180deg)" : "none", transition: "transform .25s" }}>
    <path d="M10 4L6 8l4 4" />
  </svg>
);

/* ── Nav button ────────────────────────────────────────── */
interface NavBtnProps {
  label: string;
  icon: ReactNode;
  active?: boolean;
  onClick?: () => void;
  count?: string | number;
  countVariant?: "purple" | "cyan" | "red";
  tooltip: string;
}

const NavBtn: FC<NavBtnProps> = ({ label, icon, active, onClick, count, countVariant = "purple", tooltip }) => (
  <button
    type="button"
    className={`cb-sb__nav-btn${active ? " is-active" : ""}`}
    onClick={onClick}
    data-tooltip={tooltip}
  >
    <span className="cb-sb__nav-bar" aria-hidden />
    <span className="cb-sb__nav-icon">{icon}</span>
    <span className="cb-sb__nav-label">{label}</span>
    {count !== undefined && (
      <span className={`cb-sb__nav-count cb-sb__nav-count--${countVariant}`}>{count}</span>
    )}
  </button>
);

/* ── Main ──────────────────────────────────────────────── */
export const Sidebar: FC<Props> = ({
  activeSection,
  onSectionChange,
  onLogout,
  username,
  prediction,
  sessionStats = { session: 0, logsAnalysed: 0, lastUpdate: "—", threat: "NORMAL" },
}) => {
  const [collapsed, setCollapsed] = useState(false);

  const threat = sessionStats.threat.toUpperCase();
  const threatTone =
    threat === "CRITICAL" || threat === "CRITIQUE" ? "danger" :
    threat === "HIGH" || threat === "ELEVE" ? "warn" :
    threat === "NORMAL" || threat === "LOW" ? "ok" : "neutral";

  return (
    <aside className={`cb-sb${collapsed ? " cb-sb--collapsed" : ""}`}>
      <div className="cb-sb__glow" aria-hidden />

      {/* Brand */}
      <div className="cb-sb__brand">
        <div className="cb-sb__logo" aria-hidden>
          <svg viewBox="0 0 32 32" fill="none">
            <path d="M16 3c4 0 7 2.5 7 6 2.5.6 4 2.7 4 5.3 0 1.9-1 3.4-2.4 4.2.6.9.9 2 .9 3.2 0 3.4-2.7 6-6.2 6-1.3 0-2.5-.4-3.3-1.1-.8.7-2 1.1-3.3 1.1-3.5 0-6.2-2.6-6.2-6 0-1.2.3-2.3.9-3.2C6 17.7 5 16.2 5 14.3c0-2.6 1.5-4.7 4-5.3 0-3.5 3-6 7-6z"
              stroke="currentColor" strokeWidth="1.4" />
            <circle cx="16" cy="16" r="2.4" fill="currentColor" />
            <path d="M10 12l3 2M22 12l-3 2M10 20l3-2M22 20l-3-2M16 8v3M16 21v3" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </div>
        <div className="cb-sb__brand-text">
          <div className="cb-sb__brand-name">
            cyber<span>brain</span>
          </div>
          <div className="cb-sb__brand-sub">IDPS · SOC v2.4</div>
        </div>
        <button
          type="button"
          className="cb-sb__toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Ouvrir le menu" : "Réduire le menu"}
          title={collapsed ? "Ouvrir" : "Réduire"}
        >
          <IconChevron collapsed={collapsed} />
        </button>
      </div>

      {/* User */}
      <div className="cb-sb__user">
        <div className="cb-sb__avatar">{username.slice(0, 2).toUpperCase()}</div>
        <div className="cb-sb__user-text">
          <div className="cb-sb__user-name">{username}</div>
          <div className="cb-sb__user-role">Security Analyst</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="cb-sb__nav">
        <div className="cb-sb__section-label">Navigation</div>

        <NavBtn
          label="Dashboard"
          tooltip="Dashboard"
          active={activeSection === "dashboard"}
          onClick={() => onSectionChange("dashboard")}
          icon={<IconDashboard />}
        />
        <NavBtn
          label="Agent Correcteur"
          tooltip="Agent Correcteur"
          active={activeSection === "corrective"}
          onClick={() => onSectionChange("corrective")}
          icon={<IconCorrective />}
        />
        <NavBtn
          label="Prévision"
          tooltip="Prévision"
          active={activeSection === "forecast"}
          onClick={() => onSectionChange("forecast")}
          count={prediction?.available ? `${prediction.prediction_score}%` : undefined}
          countVariant="cyan"
          icon={<IconForecast />}
        />
        <NavBtn
          label="Vue consolidée"
          tooltip="Vue consolidée"
          active={activeSection === "fusion"}
          onClick={() => onSectionChange("fusion")}
          icon={<IconFusion />}
        />
      </nav>

      {/* Stats card */}
      

      {/* Logout */}
      <button type="button" className="cb-sb__logout" onClick={onLogout}>
        <span className="cb-sb__logout-icon"><IconLogout /></span>
        <span className="cb-sb__logout-label">Déconnexion</span>
      </button>
    </aside>
  );
};
