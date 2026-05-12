import { useState, type FC } from "react";
import "../../../shared/style/Sidebar.css";

import logo from "../../../shared/assets/cyberbrain.png";

interface SessionStats {
  session:      number;
  logsAnalysed: number;
  lastUpdate:   string;
  threat:       string;
}

type Section = "dashboard" | "track" | "corrective";

interface Props {
  activeSection:   Section;
  onSectionChange: (s: Section) => void;
  username:        string;
  onLogout:        () => void;
  sessionStats?:   SessionStats;
}

// ── SVG Icons ────────────────────────────────────────────────
const IconDashboard = ({ active }: { active: boolean }) => (
  <svg viewBox="0 0 14 14" width={13} height={13} fill="none"
    stroke={active ? "#a78bfa" : "currentColor"} strokeWidth="1.5" strokeLinecap="round">
    <path d="M1 10L4 7l2 2 3-4 3 3"/>
  </svg>
);

const IconGrid = ({ active }: { active: boolean }) => (
  <svg viewBox="0 0 14 14" width={13} height={13} fill="none"
    stroke={active ? "#a78bfa" : "currentColor"} strokeWidth="1.5" strokeLinecap="round">
    <rect x="1" y="1" width="5" height="5" rx="1.5"/>
    <rect x="8" y="1" width="5" height="5" rx="1.5"/>
    <rect x="1" y="8" width="5" height="5" rx="1.5"/>
    <rect x="8" y="8" width="5" height="5" rx="1.5"/>
  </svg>
);

const IconCorrective = ({ active }: { active: boolean }) => (
  <svg viewBox="0 0 14 14" width={13} height={13} fill="none"
    stroke={active ? "#a78bfa" : "currentColor"} strokeWidth="1.5" strokeLinecap="round">
    <path d="M7 1L2 3.5v4C2 10.5 4.2 12.8 7 13.5c2.8-.7 5-3 5-6v-4L7 1z"/>
    <path d="M5 7l1.5 1.5L9 5.5"/>
  </svg>
);

const IconUser = () => (
  <svg viewBox="0 0 14 14" width={13} height={13} fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="7" cy="4" r="2"/>
    <path d="M3 11c0-2.2 1.8-4 4-4s4 1.8 4 4"/>
  </svg>
);

const IconStar = () => (
  <svg viewBox="0 0 14 14" width={13} height={13} fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M7 1l1.5 3 3.5.5-2.5 2.5.6 3.5L7 9l-3.1 1.5.6-3.5L2 4.5 5.5 4z"/>
  </svg>
);

const IconLog = () => (
  <svg viewBox="0 0 14 14" width={13} height={13} fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <rect x="1" y="2" width="12" height="10" rx="1.5"/>
    <path d="M1 5h12M4 2v3"/>
  </svg>
);

const IconAlarm = () => (
  <svg viewBox="0 0 14 14" width={13} height={13} fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M3 9h8L9 5a2 2 0 00-4 0L3 9z"/>
    <path d="M5.5 9v.5a1.5 1.5 0 003 0V9M7 2v1"/>
  </svg>
);

const IconSettings = () => (
  <svg viewBox="0 0 14 14" width={13} height={13} fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="7" cy="7" r="2"/>
    <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M3.2 3.2l1 1M9.8 9.8l1 1M10.8 3.2l-1 1M4.2 9.8l-1 1"/>
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
          label="Track Servers"
          tooltip="Track Servers"
          active={activeSection === "track"}
          onClick={() => onSectionChange("track")}
          count={3}
          countVariant="cyan"
          icon={<IconGrid active={activeSection === "track"} />}
        />
        <NavBtn
          label="Agent Correcteur"
          tooltip="Agent Correcteur"
          active={activeSection === "corrective"}
          onClick={() => onSectionChange("corrective")}
          countVariant="purple"
          icon={<IconCorrective active={activeSection === "corrective"} />}
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