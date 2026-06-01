
import { useState } from "react";
import type { FC, ReactNode } from "react";

import type {
  KpiData,
  AlarmItem,
  EngineScore,
  AgentDecision,
  TrustData,
  WorkflowActivity,
} from "../../../shared/types/idps";
import { getEngineTooltip, getMetricTooltip } from "../../../shared/constants/dashboardTooltips";
import { RadarEngineChart } from "../charts/RadarEngineChart";
import { TooltipLabel } from "../common/TooltipLabel";
// ═══════════════════════════════════════════════════════════════════════════════
// Helpers visuels
// ═══════════════════════════════════════════════════════════════════════════════

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "#E24B4A", HIGH: "#EF9F27", MED: "#378ADD", LOW: "#888780", INFO: "#888780",
};
const ENGINE_COLOR: Record<string, string> = {
  SSH: "#E24B4A", WEB: "#EF9F27", FTP: "#378ADD",
  SESSION: "#1D9E75", KERNEL: "#854F0B", PREDICTION: "#534AB7",
};

const getEnginePressureVisual = (engine: EngineScore, alarms: AlarmItem[]) => {
  const relatedAlarms = alarms.filter((alarm) => alarm.engine === engine.engine);
  const hasCritical = relatedAlarms.some((alarm) => alarm.severity === "CRITICAL");
  const hasMediumBand = relatedAlarms.some((alarm) => alarm.severity === "HIGH" || alarm.severity === "MED");

  if (hasCritical) {
    return { color: "#ff5b7f", glow: "rgba(255,91,127,0.24)" };
  }
  if (hasMediumBand) {
    return { color: "#fbbf24", glow: "rgba(251,191,36,0.22)" };
  }
  return { color: "#35d4ff", glow: "rgba(53,212,255,0.22)" };
};

// ═══════════════════════════════════════════════════════════════════════════════
// KPI Card row
// ═══════════════════════════════════════════════════════════════════════════════

export const KpiCard: FC<{ label: string; value: ReactNode; sub?: string; accent?: string; spike?: boolean }> = ({
  label, value, sub, accent = "var(--text)", spike,
}) => (
  <div style={{
    background: "var(--card,#fff)", border: `0.5px solid ${spike ? "#E24B4A44" : "var(--border,#e5e7eb)"}`,
    borderRadius: 8, padding: "10px 14px", flex: 1,
  }}>
    <div style={{ fontSize: 12, color: "var(--muted,#6b7280)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 500, color: accent, lineHeight: 1 }}>{value}</div>
    {sub && <div style={{ fontSize: 12, color: "var(--muted,#6b7280)", marginTop: 4 }}>{sub}</div>}
    {spike && <div style={{ fontSize: 11, color: "#A32D2D", marginTop: 3 }}>⚠ spike détecté</div>}
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════════
// Pie chart — répartition alarmes par sévérité (SVG inline)
// ═══════════════════════════════════════════════════════════════════════════════

export const PieChart: FC<{ alarms: AlarmItem[] }> = ({ alarms }) => {
  const counts: Record<string, number> = { CRITICAL: 0, HIGH: 0, MED: 0, LOW: 0 };
  alarms.forEach(a => { if (a.severity in counts) counts[a.severity]++; });
  const total = Object.values(counts).reduce((s, v) => s + v, 0);

  if (total === 0) return (
    <div style={{ textAlign: "center", padding: "20px 0", fontSize: 13, color: "var(--muted,#6b7280)" }}>
      Aucune alarme à afficher
    </div>
  );

  const entries = Object.entries(counts).filter(([, v]) => v > 0);
  const cx = 60, cy = 60, r = 50;
  let angle = -Math.PI / 2;
  const slices = entries.map(([sev, count]) => {
    const theta = (count / total) * 2 * Math.PI;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    angle += theta;
    const x2 = cx + r * Math.cos(angle);
    const y2 = cy + r * Math.sin(angle);
    return { sev, count, x1, y1, x2, y2, theta, color: SEV_COLOR[sev] ?? "#888" };
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <svg viewBox="0 0 120 120" width={100} height={100} style={{ flexShrink: 0 }}>
        {slices.map(({ sev, x1, y1, x2, y2, theta, color }) => (
          <path
            key={sev}
            d={`M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${theta > Math.PI ? 1 : 0},1 ${x2.toFixed(1)},${y2.toFixed(1)} Z`}
            fill={color} stroke="var(--card,#fff)" strokeWidth="1.5"
          />
        ))}
        {/* centre */}
        <circle cx={cx} cy={cy} r={28} fill="var(--card,#fff)"/>
        <text x={cx} y={cy - 5} textAnchor="middle" fontSize={12} fontWeight={500} fill="var(--text,#111)" fontFamily="inherit">{total}</text>
        <text x={cx} y={cy + 8} textAnchor="middle" fontSize={10} fill="var(--muted,#6b7280)" fontFamily="inherit">alarmes</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {entries.map(([sev, count]) => (
          <div key={sev} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: SEV_COLOR[sev], flexShrink: 0 }}/>
            <span style={{ color: "var(--muted,#6b7280)", width: 58 }}>{sev}</span>
            <span style={{ fontWeight: 500, color: "var(--text)", fontFamily: "monospace" }}>{count}</span>
            <span style={{ color: "var(--muted,#6b7280)", fontSize: 12 }}>({((count / total) * 100).toFixed(0)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Bar chart — scores par moteur (horizontal, avec valeurs)
// ═══════════════════════════════════════════════════════════════════════════════

export const EngineBarChart: FC<{ engines: EngineScore[] }> = ({ engines }) => {
  if (!engines.length) return (
    <div style={{ fontSize: 13, color: "var(--muted,#6b7280)", padding: "12px 0" }}>
      Aucun résultat — pipeline non lancé
    </div>
  );
  const maxAlarms = Math.max(...engines.map(e => e.alarms ?? 0), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {engines.map(e => {
        const pct = Math.max(2, ((e.alarms ?? 0) / maxAlarms) * 100);
        const color = ENGINE_COLOR[e.engine] ?? "#888780";
        const isAlarm = e.status === "ALARM";
        return (
          <div key={e.engine}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <span
                title={getEngineTooltip(e.engine)}
                style={{ fontSize: 12, color: "var(--muted,#6b7280)", width: 70, flexShrink: 0, cursor: "help" }}
              >
                {e.engine}
              </span>
              <div style={{ flex: 1, height: 14, borderRadius: 3, background: "var(--color-background-secondary,#f3f4f6)", overflow: "hidden", position: "relative" }}>
                <div style={{
                  height: "100%", borderRadius: 3, width: `${pct}%`,
                  background: isAlarm ? color : "#D3D1C7",
                  transition: "width .5s ease",
                }}/>
              </div>
              <span style={{ fontSize: 13, fontWeight: 500, width: 24, textAlign: "right", color: isAlarm ? color : "var(--muted,#6b7280)", fontFamily: "monospace" }}>
                {e.alarms ?? 0}
              </span>
              <span style={{
                fontSize: 11, padding: "1px 5px", borderRadius: 3, fontWeight: 500, flexShrink: 0, minWidth: 38, textAlign: "center",
                background: isAlarm ? "#FCEBEB" : "#E1F5EE",
                color:      isAlarm ? "#A32D2D" : "#0F6E56",
              }}>
                {e.status}
              </span>
              {e.rerun_p2 && (
                <span style={{ fontSize: 11, color: "#854F0B", fontWeight: 500 }} title="Pass 2 réanalysé">P2</span>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, paddingLeft: 78, fontSize: 11, color: "var(--muted,#6b7280)" }}>
              <span>seuil P1: <b style={{ color: "var(--text)" }}>{e.pass1}</b></span>
              <span>·</span>
              <span>seuil P2: <b style={{ color: "var(--text)" }}>{e.pass2}</b></span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Alarm feed avec filtre sévérité
// ═══════════════════════════════════════════════════════════════════════════════

export const FilteredAlarmFeed: FC<{ alarms: AlarmItem[]; wsConnected: boolean; isFusionView: boolean }> = ({
  alarms,
  wsConnected,
  isFusionView,
}) => {
  const [filter, setFilter] = useState<"ALL" | "CRITICAL" | "HIGH" | "MED">("ALL");
  const filterLabel = (value: "ALL" | "CRITICAL" | "HIGH" | "MED") => {
    if (value === "ALL") return "TOUT";
    if (value === "CRITICAL") return "CRITIQUE";
    if (value === "HIGH") return "ELEVE";
    return "MOYEN";
  };
  const humanizeActionBadge = (action?: string) => {
    const normalized = String(action ?? "").toUpperCase();
    if (normalized.includes("BLOCK")) return "BLOCAGE";
    if (normalized.includes("WATCH")) return "SURVEILLANCE";
    if (normalized.includes("ALERT")) return "ALERTE";
    return "ACTION";
  };

  const filtered = filter === "ALL" ? alarms : alarms.filter(a => a.severity === filter);
  const filterBtns: Array<"ALL" | "CRITICAL" | "HIGH" | "MED"> = ["ALL", "CRITICAL", "HIGH", "MED"];

  return (
    <div style={{ background: "var(--card,#fff)", border: "0.5px solid var(--border,#e5e7eb)", borderRadius: 8, padding: 14, display: "flex", flexDirection: "column", gap: 0 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>Flux d'alertes en direct</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Filtre sévérité */}
          <div style={{ display: "flex", gap: 3 }}>
            {filterBtns.map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  fontSize: 11, padding: "2px 7px", borderRadius: 20, border: "0.5px solid",
                  cursor: "pointer", fontFamily: "inherit", fontWeight: 500, transition: "all .15s",
                  borderColor: filter === f ? (SEV_COLOR[f] ?? "#1D9E75") : "var(--border,#e5e7eb)",
                  background:  filter === f ? (f === "ALL" ? "#E1F5EE" : `${SEV_COLOR[f]}22`) : "transparent",
                  color:       filter === f ? (f === "ALL" ? "#0F6E56" : SEV_COLOR[f]) : "var(--muted,#6b7280)",
                }}
              >
                {filterLabel(f)} {f !== "ALL" && <span style={{ fontFamily: "monospace" }}>({alarms.filter(a => a.severity === f).length})</span>}
              </button>
            ))}
          </div>
          {/* Badge WS */}
          <span style={{
            fontSize: 12, padding: "2px 7px", borderRadius: 20, fontWeight: 500,
            display: "flex", alignItems: "center", gap: 4,
            background: wsConnected ? "#E1F5EE" : "#FCEBEB",
            color:      wsConnected ? "#085041" : "#A32D2D",
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: "50%", display: "inline-block",
              background: wsConnected ? "#1D9E75" : "#E24B4A",
              animation: wsConnected ? "ws-pulse 2s infinite" : "none",
            }}/>
          {wsConnected ? "WS actif" : "WS hors ligne"}
            <style>{`@keyframes ws-pulse{0%,100%{opacity:1}50%{opacity:.35}}`}</style>
          </span>
        </div>
      </div>

      {/* Liste */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "16px 0", fontSize: 13, color: "var(--muted,#6b7280)" }}>
          {wsConnected ? (filter === "ALL" ? "Aucune alerte — système calme ✓" : `Aucune alerte ${filterLabel(filter)}`) : "En attente du pipeline…"}
        </div>
      ) : filtered.slice(0, 8).map((a, i) => {
        const isLast = i === Math.min(filtered.length, 8) - 1;
        const actionStyle = a.action.includes("BLOCK")
          ? { bg: "#FCEBEB", fg: "#A32D2D" }
          : a.action.includes("WATCH")
          ? { bg: "#FAEEDA", fg: "#633806" }
          : { bg: "var(--color-background-secondary,#f3f4f6)", fg: "var(--muted,#6b7280)" };

        return (
          <div key={a.id} style={{
            display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 0",
            borderBottom: isLast ? "none" : "0.5px solid var(--border,#e5e7eb)",
          }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: SEV_COLOR[a.severity], marginTop: 4, flexShrink: 0 }}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {a.type.replace(/_/g, " ")} — <span style={{ color: SEV_COLOR[a.severity] }}>{a.severity}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted,#6b7280)", fontFamily: "monospace" }}>
                {a.source_ip} · score <b>{a.score}</b> · {a.engine} · {a.country}
              </div>
              {a.human_insight && (
                <div style={{ fontSize: 12, color: "var(--muted,#6b7280)", marginTop: 2, fontStyle: "italic", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {a.human_insight.slice(0, 72)}{a.human_insight.length > 72 ? "…" : ""}
                </div>
              )}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted,#6b7280)", flexShrink: 0 }}>{a.timestamp}</div>
            <span style={{
              fontSize: 12, padding: "2px 6px", borderRadius: 3, fontWeight: 500, flexShrink: 0,
              background: isFusionView ? "#E6F1FB" : actionStyle.bg,
              color: isFusionView ? "#0C447C" : actionStyle.fg,
            }}>
              {isFusionView ? "LECTURE SEULE" : humanizeActionBadge(a.action)}
            </span>
          </div>
        );
      })}

      {filtered.length > 8 && (
        <div style={{ fontSize: 12, color: "var(--muted,#6b7280)", textAlign: "center", marginTop: 8, paddingTop: 6, borderTop: "0.5px solid var(--border,#e5e7eb)" }}>
          +{filtered.length - 8} alarmes supplémentaires
        </div>
      )}
    </div>
  );
};



// ═══════════════════════════════════════════════════════════════════════════════
// Props + composant principal
// ═══════════════════════════════════════════════════════════════════════════════

interface Props {
  kpis:        KpiData | null;
  alarms:      AlarmItem[];
  engines:     EngineScore[];
  decisions:   AgentDecision[];
  logLines:    string[];
  trust:       TrustData | null;
  activities:  WorkflowActivity[];
  loading:     boolean;
  wsConnected: boolean;
  isLive:      boolean;
  isFusionView: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEW · Storytelling Status Banner
// ═══════════════════════════════════════════════════════════════════════════════

const StoryBanner: FC<{
  criticalCount: number;
  alarms: AlarmItem[];
  engines: EngineScore[];
  kpis: KpiData | null;
}> = ({ criticalCount, alarms, engines, kpis }) => {
  const alarmEngines = engines.filter(e => e.status === "ALARM");
  const top = alarms[0];

  let level: "critique" | "élevé" | "stable" = "stable";
  let levelColor = "#2dd4a8";
  let glow = "rgba(45,212,168,0.18)";
  if (criticalCount > 0) { level = "critique"; levelColor = "#ff5577"; glow = "rgba(255,85,119,0.22)"; }
  else if (alarmEngines.length > 0) { level = "élevé"; levelColor = "#ffc15c"; glow = "rgba(255,193,92,0.22)"; }

  const headline = (() => {
    if (top && criticalCount > 0)
      return `Attaque ${top.type.replace(/_/g, " ").toLowerCase()} en cours sur ${top.source_ip} — confinée par l'IA`;
    if (alarmEngines.length > 0)
      return `${alarmEngines.length} moteur(s) sous pression — l'IA surveille et corrèle`;
    return "Système calme — aucune menace active détectée";
  })();

  const sub = (() => {
    const parts: string[] = [];
    if (alarmEngines.length) parts.push(`${alarmEngines.length} moteur(s) en alerte`);
    if (kpis?.noise_ratio != null) parts.push(`bruit ${(kpis.noise_ratio * 100).toFixed(0)}%`);
    if (kpis?.unique_attacking_ips) parts.push(`${kpis.unique_attacking_ips} IP(s) attaquantes`);
    return parts.join(" · ") || "Pipeline en attente — aucune activité notable";
  })();

  return (
    <div style={{
      position: "relative",
      padding: "18px 22px",
      borderRadius: 14,
      border: `1px solid ${levelColor}55`,
      background: `linear-gradient(135deg, var(--card) 0%, ${glow} 180%)`,
      boxShadow: `0 0 0 1px ${levelColor}11, 0 8px 32px rgba(0,0,0,0.35)`,
      overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", inset: 0,
        background: `radial-gradient(circle at 0% 50%, ${glow} 0%, transparent 60%)`,
        pointerEvents: "none",
      }}/>
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        fontSize: 12, fontWeight: 700, letterSpacing: "0.18em",
        color: levelColor, textTransform: "uppercase",
        fontFamily: "var(--font-mono)", marginBottom: 8,
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: "50%",
          background: levelColor, boxShadow: `0 0 10px ${levelColor}`,
          animation: "pulse-dot 1.6s ease-in-out infinite",
        }}/>
        État global · {level}
      </div>
      <div style={{
        fontFamily: "var(--font-display)",
        fontSize: 22, fontWeight: 600, color: "var(--text-primary)",
        letterSpacing: "-0.01em", lineHeight: 1.3, position: "relative",
      }}>
        {headline}
      </div>
      <div style={{
        marginTop: 6, fontSize: 14, color: "var(--text-muted)",
        position: "relative",
      }}>
        {sub}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// NEW · Big clean KPI tile (storytelling row)
// ═══════════════════════════════════════════════════════════════════════════════

const KpiTile: FC<{ label: string; value: ReactNode; accent?: string; sub?: string; tooltip?: string }> = ({
  label, value, accent = "var(--text-primary)", sub, tooltip,
}) => (
  <div style={{
    flex: 1, minWidth: 140,
    padding: "16px 18px",
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    transition: "border-color .25s ease, transform .25s ease",
  }}
  onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border-glow)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
  onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.transform = "translateY(0)"; }}
  >
    <div style={{
      fontSize: 12.5, fontWeight: 700, letterSpacing: "0.12em",
      color: "#7dd3fc", textTransform: "uppercase",
      fontFamily: "var(--font-mono)", marginBottom: 8,
    }}>
      {tooltip ? <TooltipLabel tooltip={tooltip} style={{ gap: 4 }}>{label}</TooltipLabel> : label}
    </div>
    <div style={{
      fontFamily: "var(--font-mono)", fontSize: 28, fontWeight: 700,
      color: accent, lineHeight: 1, letterSpacing: "-0.5px",
    }}>{value}</div>
    {sub && <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)" }}>{sub}</div>}
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════════
// NEW · Engine Pressure — radar + rows + sparkline (replaces pie + bars)
// ═══════════════════════════════════════════════════════════════════════════════

const PressureMeter: FC<{ value: number; max: number; color: string }> = ({ value, max, color }) => {
  const ratio = max > 0 ? Math.max(0.06, value / max) : 0;

  return (
    <div
      style={{
        width: 92,
        height: 8,
        borderRadius: 999,
        overflow: "visible",
        position: "relative",
        background: "rgba(148,163,184,0.12)",
        border: "1px solid rgba(148,163,184,0.12)",
      }}
    >
      <div
        style={{
          width: `${Math.min(100, ratio * 100)}%`,
          height: "100%",
          borderRadius: 999,
          background: `linear-gradient(90deg, ${color}99, ${color})`,
          boxShadow: `0 0 18px ${color}55`,
          transition: "width .35s ease",
        }}
      />
    </div>
  );
};

const EnginePressurePanel: FC<{ engines: EngineScore[]; alarms: AlarmItem[] }> = ({ engines, alarms }) => {
  const list = engines;
  const maxAlarms = Math.max(...list.map(e => e.alarms ?? 0), 1);

  return (
    <div style={{
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: 14,
      padding: "18px 20px",
    }}>
      <div style={{ marginBottom: 4 }}>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600,
          color: "var(--text-primary)", letterSpacing: "-0.005em",
        }}>
          Pression par moteur de détection
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 3 }}>
          Fingerprint live des moteurs à gauche, détail des seuils et de la pression en temps réel à droite.
        </div>
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "minmax(220px, 260px) minmax(0, 1fr)", gap: 24,
        marginTop: 18, alignItems: "center",
      }}>
        <div style={{ minWidth: 0 }}>
          <RadarEngineChart engines={list} compact />
        </div>

        {/* ── Engine rows ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {list.length === 0 ? (
            <div style={{
              minHeight: 180,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 12,
              border: "1px dashed var(--border)",
              color: "var(--text-muted)",
              fontSize: 14,
              textAlign: "center",
              padding: 18,
            }}>
              Aucun score moteur live disponible pour cette source.
            </div>
          ) : (
            list.map((e, i) => {
              const visual = getEnginePressureVisual(e, alarms);
              return (
                <div key={e.engine} style={{
                  display: "grid",
                  gridTemplateColumns: "20px 74px 1fr auto",
                  alignItems: "center", gap: 12,
                  padding: "8px 0",
                  borderBottom: i < list.length - 1 ? "1px solid var(--border-subtle)" : "none",
                }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: "50%",
                    background: visual.color,
                    boxShadow: `0 0 10px ${visual.glow}`,
                    animation: (e.alarms ?? 0) > 0 ? "pulse-dot 1.4s ease-in-out infinite" : "none",
                  }}/>
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700,
                    color: "var(--text-primary)", letterSpacing: "0.08em",
                  }}>
                    {e.engine}
                  </span>
                  <div style={{ display: "grid", gap: 4 }}>
                    <PressureMeter value={e.alarms ?? 0} max={maxAlarms} color={visual.color} />
                  </div>
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 700,
                    color: visual.color,
                    minWidth: 20, textAlign: "right",
                  }}>
                    {e.alarms ?? 0}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// NEW · Live Alarm Feed with slide-in animation
// ═══════════════════════════════════════════════════════════════════════════════

const LiveAlarmFeed: FC<{ alarms: AlarmItem[]; isFusionView: boolean }> = ({ alarms, isFusionView }) => {
  const [filter, setFilter] = useState<"ALL" | "CRITICAL" | "HIGH" | "MED">("ALL");
  const criticals = alarms.filter(a => a.severity === "CRITICAL").length;
  const list = filter === "ALL" ? alarms : alarms.filter(a => a.severity === filter);
  const filterOptions: Array<{ key: "ALL" | "CRITICAL" | "HIGH" | "MED"; label: string; count: number; color: string }> = [
    { key: "ALL", label: "All", count: alarms.length, color: "#7dd3fc" },
    { key: "CRITICAL", label: "Critical", count: alarms.filter(a => a.severity === "CRITICAL").length, color: "#ff5b7f" },
    { key: "HIGH", label: "High", count: alarms.filter(a => a.severity === "HIGH").length, color: "#fbbf24" },
    { key: "MED", label: "Medium", count: alarms.filter(a => a.severity === "MED").length, color: "#7c82ff" },
  ];

  return (
    <div style={{
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: 14,
      padding: "16px 18px",
      display: "flex", flexDirection: "column", gap: 14,
      height: 470,
      overflow: "hidden",
    }}>
      <style>{`
        @keyframes alarm-slide {
          0%   { opacity: 0; transform: translateX(-14px); }
          60%  { opacity: 1; }
          100% { opacity: 1; transform: translateX(0); }
        }
        .alarm-row {
          animation: alarm-slide .45s cubic-bezier(.2,.8,.2,1) both;
          position: relative;
        }
        .alarm-row::before {
          content: ''; position: absolute; left: -20px; top: 0; bottom: 0;
          width: 2px; background: var(--sev-color); opacity: 0;
          transition: opacity .25s;
        }
        .alarm-row:hover::before { opacity: 1; }
        .alarm-row:hover { background: var(--bg-hover); }
        .alarm-scroll {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding-right: 6px;
          overscroll-behavior: contain;
          scroll-behavior: smooth;
          scrollbar-width: thin;
          scrollbar-color: rgba(125,211,252,0.38) rgba(15,23,42,0.32);
        }
        .alarm-scroll::-webkit-scrollbar {
          width: 8px;
        }
        .alarm-scroll::-webkit-scrollbar-track {
          background: rgba(15,23,42,0.28);
          border-radius: 999px;
        }
        .alarm-scroll::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, rgba(125,211,252,0.55), rgba(124,130,255,0.5));
          border-radius: 999px;
          border: 1px solid rgba(15,23,42,0.18);
        }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600,
          color: "var(--text-primary)",
        }}>
          Flux d'alertes en direct
        </div>
        {criticals > 0 && (
          <span style={{
            padding: "4px 12px", borderRadius: 999,
            fontSize: 12, fontWeight: 700, letterSpacing: "0.1em",
            fontFamily: "var(--font-mono)",
            background: "rgba(255,85,119,0.12)",
            color: "var(--red)",
            border: "1px solid rgba(255,85,119,0.35)",
          }}>
            {criticals} CRITIQUE{criticals > 1 ? "S" : ""}
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {filterOptions.map((option) => {
          const active = filter === option.key;
          return (
            <button
              key={option.key}
              onClick={() => setFilter(option.key)}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: `1px solid ${active ? `${option.color}55` : "rgba(148,163,184,0.16)"}`,
                background: active ? `${option.color}18` : "rgba(15,23,42,0.3)",
                color: active ? option.color : "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.08em",
                cursor: "pointer",
                transition: "all .2s ease",
              }}
            >
              {option.label} · {option.count}
            </button>
          );
        })}
      </div>

      {list.length === 0 ? (
        <div style={{
          flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, color: "var(--text-muted)",
        }}>
          Aucune alarme pour ce filtre.
        </div>
      ) : (
        <div className="alarm-scroll">
          <div style={{ display: "flex", flexDirection: "column" }}>
          {list.map((a, i) => {
            const sev = SEV_COLOR[a.severity] ?? "#888";
            return (
              <div
                key={a.id ?? i}
                className="alarm-row"
                style={{
                  ["--sev-color" as any]: sev,
                  display: "grid",
                  gridTemplateColumns: "48px 1fr auto",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 4px",
                  borderBottom: i < list.length - 1 ? "1px solid var(--border-subtle)" : "none",
                  animationDelay: `${Math.min(i, 8) * 70}ms`,
                  borderRadius: 6,
                  transition: "background .2s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: sev,
                    boxShadow: a.severity === "CRITICAL" ? `0 0 8px ${sev}` : "none",
                    animation: a.severity === "CRITICAL" ? "pulse-dot 1.2s ease-in-out infinite" : "none",
                  }}/>
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: 12,
                    color: "var(--text-muted)", fontWeight: 600,
                  }}>
                    {String(a.timestamp).slice(11, 16) || "—"}
                  </span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700,
                    color: "var(--text-primary)", letterSpacing: "0.04em",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {a.type.replace(/_/g, " ")} · {a.source_ip}
                  </div>
                  <div style={{
                    fontSize: 12.5, color: "var(--text-muted)", marginTop: 2,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {a.country || "—"} · {a.engine} · {isFusionView ? "view only" : (a.action || "—").split("_")[0]}
                  </div>
                </div>
                <div style={{
                  fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 700,
                  color: sev, minWidth: 32, textAlign: "right",
                }}>
                  {a.score ?? 0}
                </div>
              </div>
            );
          })}
          </div>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// NEW · Journey Pipeline — "Parcours du système"
// ═══════════════════════════════════════════════════════════════════════════════

type JourneyVisualState = "done" | "active" | "pending" | "error";

const JourneyPipeline: FC<{
  trust: TrustData | null;
  activities: WorkflowActivity[];
  isLive: boolean;
}> = ({ trust, activities, isLive }) => {
  const latestActivities = [...activities].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const latestSessionId = latestActivities.find((activity) => !!activity.session_id)?.session_id ?? null;
  const scopedActivities = latestSessionId
    ? latestActivities.filter((activity) => activity.session_id === latestSessionId)
    : latestActivities;

  const baseStages = [
    { id: "collecte", label: "Collecte", technical: "PIPELINE_START", tooltip: "Ingestion des logs et demarrage du pipeline." },
    { id: "analyse", label: "Analyse", technical: "METRICS_COMPUTED", tooltip: "Calcul des metriques et lecture du contexte de securite." },
    { id: "pass1", label: "Detection initiale", technical: "PASS1_COMPLETE", tooltip: "Analyse initiale des anomalies et comportements suspects." },
    { id: "trust", label: "Verification IA", technical: "TRUST_COMPUTED", tooltip: "Validation de fiabilite via trust score et stabilite." },
    { id: "pass2", label: "Reanalyse adaptative", technical: "PASS2_COMPLETE", tooltip: "Analyse secondaire avec ajustements adaptatifs si necessaire." },
    { id: "agents", label: "Decision IA", technical: "AGENTS_COMPLETE", tooltip: "Coordination des agents pour choisir la reponse finale." },
    { id: "session", label: "Session finale", technical: "SESSION_SUMMARY", tooltip: "Synthese de fin de session et publication du resultat." },
  ] as const;

  const hasEvent = (eventType: string) => scopedActivities.some((activity) => activity.event_type === eventType);
  const pipelineStarted = hasEvent("PIPELINE_START");
  const sessionDone = hasEvent("SESSION_SUMMARY");

  const eventIndexByType = new Map<string, number>([
    ["PIPELINE_START", 0],
    ["METRICS_COMPUTED", 1],
    ["PASS1_COMPLETE", 2],
    ["TRUST_COMPUTED", 3],
    ["PASS2_COMPLETE", 4],
    ["DYNAMIC_CONFIG_DEFAULT", 4],
    ["AGENTS_COMPLETE", 5],
    ["SESSION_SUMMARY", 6],
  ]);

  const latestCompletedIndex = scopedActivities.reduce((max, activity) => {
    const eventType = activity.event_type ?? "";
    if (eventType === "ERROR" || eventType === "DYNAMIC_CONFIG_ISSUED") return max;
    const index = eventIndexByType.get(eventType);
    return index == null ? max : Math.max(max, index);
  }, -1);

  const latestErrorActivity = [...scopedActivities].find((activity) => activity.status === "error" || activity.event_type === "ERROR") ?? null;
  const activeIndex = pipelineStarted && !sessionDone ? Math.min(latestCompletedIndex + 1, baseStages.length - 1) : -1;
  const errorIndex = latestErrorActivity && !sessionDone
    ? Math.max(activeIndex, Math.min(latestCompletedIndex + 1, baseStages.length - 1))
    : -1;
  const livePulseActive = isLive && activeIndex >= 0 && !latestErrorActivity;
  const stages = baseStages.map((stage, index) => {
    let visualState: JourneyVisualState = "pending";
    if (index === errorIndex) visualState = "error";
    else if (sessionDone || index <= latestCompletedIndex) visualState = "done";
    else if (index === activeIndex) visualState = "active";
    return { ...stage, key: stage.label, visualState };
  });

  const lastSignal =
    [...scopedActivities]
      .reverse()
      .find((activity) =>
        [
          "PIPELINE_START",
          "METRICS_COMPUTED",
          "PASS1_COMPLETE",
          "TRUST_COMPUTED",
          "DYNAMIC_CONFIG_ISSUED",
          "DYNAMIC_CONFIG_DEFAULT",
          "PASS2_COMPLETE",
          "AGENTS_COMPLETE",
          "SESSION_SUMMARY",
          "ERROR",
        ].includes(activity.event_type ?? ""),
      )?.event_type ?? null;

  const confidence = trust?.confidence_in_metrics != null ? Math.round(trust.confidence_in_metrics * 100) : null;
  const confLabel = confidence == null ? "--" : confidence >= 80 ? "TRUSTWORTHY" : confidence >= 60 ? "ACCEPTABLE" : "LOW";
  const confidenceTone =
    confidence == null
      ? "var(--text-muted)"
      : confidence >= 80
        ? "var(--green)"
        : confidence >= 60
          ? "var(--amber)"
          : "var(--red)";
  const isTrusted = confidence != null && confidence >= 80;
  const stabilityLabel = trust?.stability || "N/A";
  const stabilityTone =
    stabilityLabel === "HIGH"
      ? "#2dd4a8"
      : stabilityLabel === "MEDIUM"
        ? "#fbbf24"
        : stabilityLabel === "LOW"
          ? "#ff5b7f"
          : "var(--text-muted)";

  const getTone = (state: JourneyVisualState) => {
    switch (state) {
      case "done":
        return { border: "#2dd4a8", background: "rgba(45,212,168,0.12)", text: "#9ae6c8", shadow: "0 0 14px rgba(45,212,168,0.22)", line: "rgba(45,212,168,0.72)", icon: "✓" };
      case "active":
        return { border: "#35d4ff", background: "rgba(53,212,255,0.14)", text: "#8ee8ff", shadow: "0 0 16px rgba(53,212,255,0.24)", line: "rgba(53,212,255,0.7)", icon: "•" };
      case "error":
        return { border: "#ff5b7f", background: "rgba(255,91,127,0.14)", text: "#ff9eb0", shadow: "0 0 16px rgba(255,91,127,0.24)", line: "rgba(255,91,127,0.72)", icon: "!" };
      default:
        return { border: "rgba(112,138,167,0.45)", background: "rgba(15,23,42,0.18)", text: "var(--text-muted)", shadow: "none", line: "rgba(112,138,167,0.3)", icon: "◦" };
    }
  };

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        height: 330,
        overflow: "visible",
        position: "relative",
      }}
    >
      <style>{`\n        @keyframes journey-live-pulse { 0%,100% { opacity: 1; } 50% { opacity: .42; } }\n        .journey-stage { position: relative; z-index: 2; }\n      `}</style>

      <div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 16,
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
        >
          Parcours du systeme
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 18 }}>
          Lecture live du dernier passage du pipeline.
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowX: "auto", overflowY: "visible", paddingTop: 30, paddingBottom: 16 }}>
        <div style={{ minWidth: 900, display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 0, position: "relative" }}>
        {stages.map((stage, index) => {
          const tone = getTone(stage.visualState);
          const nextTone = index < stages.length - 1 ? getTone(stages[index + 1].visualState) : null;
          const isActive = stage.visualState === "active";
          const isDone = stage.visualState === "done";

          return (
            <div key={stage.id} style={{ display: "flex", alignItems: "center", flex: "0 0 auto", minWidth: 104 }}>
              <div
                className="journey-stage"
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, minWidth: 104 }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: `1.5px solid ${tone.border}`,
                    background: tone.background,
                    color: tone.text,
                    fontSize: 15,
                    fontWeight: 700,
                    boxShadow: isActive && livePulseActive ? "0 0 18px rgba(53,212,255,0.32)" : tone.shadow,
                    transition: "all .24s ease",
                    animation: isActive && livePulseActive ? "journey-live-pulse 1.4s ease-in-out infinite" : "none",
                  }}
                >
                  {tone.icon}
                </div>

                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.4, fontWeight: 700, letterSpacing: "0.04em", color: isDone ? "var(--text-secondary)" : isActive ? "var(--amber)" : "var(--text-muted)", textAlign: "center", lineHeight: 1.2, maxWidth: 100, whiteSpace: "normal" }}>
                  {stage.label}
                </span>
              </div>

              {index < stages.length - 1 && (
                <div
                  style={{
                    flex: "0 0 20px",
                    width: 20,
                    height: 2,
                    margin: "0 6px",
                    marginBottom: 26,
                    borderRadius: 999,
                    background:
                      stage.visualState === "pending" && stages[index + 1].visualState === "pending"
                        ? "rgba(112,138,167,0.22)"
                        : `linear-gradient(90deg, ${tone.line}, ${nextTone?.line ?? tone.line})`,
                    opacity: 0.9,
                  }}
                />
              )}
            </div>
          );
        })}
        </div>
      </div>

      <div
        style={{
          paddingTop: 10,
          borderTop: "1px solid var(--border-subtle)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 21,
                fontWeight: 700,
                color: confidenceTone,
                lineHeight: 1,
              }}
            >
              {confidence == null ? "--" : `${confidence}%`}
            </div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.14em",
                color: "var(--text-muted)",
                textTransform: "uppercase",
                fontFamily: "var(--font-mono)",
              }}
            >
              <TooltipLabel tooltip={getMetricTooltip("confidence")} style={{ gap: 4 , color: "#7dd3fc"  }}>
                Niveau de confiance
              </TooltipLabel>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 6,
              flexShrink: 0,
              paddingBottom: 2,
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                justifyContent: "flex-end",
              }}
            >
              <span
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  fontSize: 11.5,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  fontFamily: "var(--font-mono)",
                  border: `1px solid ${isTrusted ? "rgba(45,212,168,0.4)" : "var(--border)"}`,
                  background: isTrusted ? "rgba(45,212,168,0.12)" : "transparent",
                  color: isTrusted ? "var(--green)" : "var(--text-muted)",
                }}
              >
                {confidence == null ? "--" : confLabel}
              </span>
            </div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                justifyContent: "flex-end",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                <TooltipLabel tooltip={getMetricTooltip("stability")} style={{ gap: 4 , color: "#7dd3fc"}}>
                  Stabilite
                </TooltipLabel>
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: stabilityTone,
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.08em",
                }}
              >
                {stabilityLabel}
              </span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

// Props + composant principal
// ═══════════════════════════════════════════════════════════════════════════════

interface Props {
  kpis:        KpiData | null;
  alarms:      AlarmItem[];
  engines:     EngineScore[];
  decisions:   AgentDecision[];
  logLines:    string[];
  trust:       TrustData | null;
  activities:  WorkflowActivity[];
  loading:     boolean;
  wsConnected: boolean;
  isLive:      boolean;
  isFusionView: boolean;
}

export const DashboardPanel: FC<Props> = ({
  kpis, alarms, engines, trust, activities, loading, isLive, isFusionView,
}) => {
  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 320, flexDirection: "column", gap: 16, color: "var(--text-muted)", fontSize: 15 }}>
      <div style={{ width: 32, height: 32, borderRadius: "50%", border: "2px solid var(--purple)", borderTopColor: "transparent", animation: "spin .8s linear infinite" }}/>
      Chargement des données pipeline…
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  const criticalCount = alarms.filter(a => a.severity === "CRITICAL").length;
  const attackingIps  = kpis?.unique_attacking_ips ?? 0;
  const noisePct      = kpis?.noise_ratio != null ? (kpis.noise_ratio * 100) : null;
  const confidencePct = trust?.confidence_in_metrics != null ? Math.round(trust.confidence_in_metrics * 100) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse-dot { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
        @keyframes live-pulse { 0%,100% { opacity: 1; } 50% { opacity: .45; } }
      `}</style>

      

      {/* ── 2. KPI strip (5 essentials) ── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <KpiTile
          label="Lignes analysées"
          value={(kpis?.row_count ?? 0).toLocaleString()}
          sub={`dédup: ${(kpis?.deduped_count ?? 0).toLocaleString()}`}
        />
        <KpiTile
          label="Alarmes critiques"
          value={criticalCount}
          accent={criticalCount > 0 ? "var(--red)" : "var(--green)"}
          sub={`${alarms.length} total`}
        />
        <KpiTile
          label="IPs attaquantes"
          value={attackingIps}
          accent={attackingIps > 0 ? "var(--amber)" : "var(--text-primary)"}
        />
        <KpiTile
          label="Bruit"
          value={noisePct != null ? `${noisePct.toFixed(1)}%` : "—"}
          accent={noisePct != null && noisePct > 50 ? "var(--amber)" : "var(--text-primary)"}
        />
        <KpiTile
          label="Confiance"
          value={confidencePct != null ? `${confidencePct}%` : "—"}
          accent={confidencePct != null && confidencePct >= 80 ? "var(--green)" : confidencePct != null && confidencePct >= 60 ? "var(--amber)" : "var(--text-muted)"}
          tooltip={getMetricTooltip("confidence")}
        />
      </div>

      {/* ── 3. Engine pressure (radar + rows + sparklines) ── */}
      <EnginePressurePanel engines={engines} alarms={alarms}/>

      {/* ── 4. Alerts + Journey side-by-side ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <JourneyPipeline
          trust={trust}
          activities={activities}
          isLive={isLive}
        />
        <LiveAlarmFeed alarms={alarms} isFusionView={isFusionView}/>
      </div>

    </div>
  );
};
