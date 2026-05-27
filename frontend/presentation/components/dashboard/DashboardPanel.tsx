
import { useRef, useState } from "react";
import type { FC, ReactNode } from "react";

import type {
  KpiData,
  AlarmItem,
  EngineScore,
  AgentDecision,
  TrustData,
  WorkflowActivity,
} from "../../../shared/types/idps";
import { RadarEngineChart } from "../charts/RadarEngineChart";
import { AgentActivityFlow } from "./AgentActivityFlow";
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

const Card: FC<{ title: string; tag?: string; tagRed?: boolean; children: ReactNode; style?: React.CSSProperties }> = ({
  title, tag, tagRed, children, style,
}) => (
  <div style={{ background: "var(--card,#fff)", border: "0.5px solid var(--border,#e5e7eb)", borderRadius: 8, padding: 14, ...style }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
      <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text)" }}>{title}</span>
      {tag && (
        <span style={{
          fontSize: 10, padding: "2px 7px", borderRadius: 20, fontWeight: 500,
          background: tagRed ? "#FCEBEB" : "var(--color-background-secondary,#f3f4f6)",
          color:      tagRed ? "#A32D2D" : "var(--muted,#6b7280)",
        }}>{tag}</span>
      )}
    </div>
    {children}
  </div>
);



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
    <div style={{ fontSize: 10, color: "var(--muted,#6b7280)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 20, fontWeight: 500, color: accent, lineHeight: 1 }}>{value}</div>
    {sub && <div style={{ fontSize: 10, color: "var(--muted,#6b7280)", marginTop: 4 }}>{sub}</div>}
    {spike && <div style={{ fontSize: 9, color: "#A32D2D", marginTop: 3 }}>⚠ spike détecté</div>}
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
    <div style={{ textAlign: "center", padding: "20px 0", fontSize: 11, color: "var(--muted,#6b7280)" }}>
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
        <text x={cx} y={cy - 5} textAnchor="middle" fontSize={10} fontWeight={500} fill="var(--text,#111)" fontFamily="inherit">{total}</text>
        <text x={cx} y={cy + 8} textAnchor="middle" fontSize={8} fill="var(--muted,#6b7280)" fontFamily="inherit">alarmes</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {entries.map(([sev, count]) => (
          <div key={sev} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: SEV_COLOR[sev], flexShrink: 0 }}/>
            <span style={{ color: "var(--muted,#6b7280)", width: 58 }}>{sev}</span>
            <span style={{ fontWeight: 500, color: "var(--text)", fontFamily: "monospace" }}>{count}</span>
            <span style={{ color: "var(--muted,#6b7280)", fontSize: 10 }}>({((count / total) * 100).toFixed(0)}%)</span>
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
    <div style={{ fontSize: 11, color: "var(--muted,#6b7280)", padding: "12px 0" }}>
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
              <span style={{ fontSize: 10, color: "var(--muted,#6b7280)", width: 70, flexShrink: 0 }}>{e.engine}</span>
              <div style={{ flex: 1, height: 14, borderRadius: 3, background: "var(--color-background-secondary,#f3f4f6)", overflow: "hidden", position: "relative" }}>
                <div style={{
                  height: "100%", borderRadius: 3, width: `${pct}%`,
                  background: isAlarm ? color : "#D3D1C7",
                  transition: "width .5s ease",
                }}/>
              </div>
              <span style={{ fontSize: 11, fontWeight: 500, width: 24, textAlign: "right", color: isAlarm ? color : "var(--muted,#6b7280)", fontFamily: "monospace" }}>
                {e.alarms ?? 0}
              </span>
              <span style={{
                fontSize: 9, padding: "1px 5px", borderRadius: 3, fontWeight: 500, flexShrink: 0, minWidth: 38, textAlign: "center",
                background: isAlarm ? "#FCEBEB" : "#E1F5EE",
                color:      isAlarm ? "#A32D2D" : "#0F6E56",
              }}>
                {e.status}
              </span>
              {e.rerun_p2 && (
                <span style={{ fontSize: 9, color: "#854F0B", fontWeight: 500 }} title="Pass 2 réanalysé">P2</span>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, paddingLeft: 78, fontSize: 9, color: "var(--muted,#6b7280)" }}>
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

  const filtered = filter === "ALL" ? alarms : alarms.filter(a => a.severity === filter);
  const filterBtns: Array<"ALL" | "CRITICAL" | "HIGH" | "MED"> = ["ALL", "CRITICAL", "HIGH", "MED"];

  return (
    <div style={{ background: "var(--card,#fff)", border: "0.5px solid var(--border,#e5e7eb)", borderRadius: 8, padding: 14, display: "flex", flexDirection: "column", gap: 0 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text)" }}>Live Alarm Feed</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Filtre sévérité */}
          <div style={{ display: "flex", gap: 3 }}>
            {filterBtns.map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  fontSize: 9, padding: "2px 7px", borderRadius: 20, border: "0.5px solid",
                  cursor: "pointer", fontFamily: "inherit", fontWeight: 500, transition: "all .15s",
                  borderColor: filter === f ? (SEV_COLOR[f] ?? "#1D9E75") : "var(--border,#e5e7eb)",
                  background:  filter === f ? (f === "ALL" ? "#E1F5EE" : `${SEV_COLOR[f]}22`) : "transparent",
                  color:       filter === f ? (f === "ALL" ? "#0F6E56" : SEV_COLOR[f]) : "var(--muted,#6b7280)",
                }}
              >
                {f} {f !== "ALL" && <span style={{ fontFamily: "monospace" }}>({alarms.filter(a => a.severity === f).length})</span>}
              </button>
            ))}
          </div>
          {/* Badge WS */}
          <span style={{
            fontSize: 10, padding: "2px 7px", borderRadius: 20, fontWeight: 500,
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
        <div style={{ textAlign: "center", padding: "16px 0", fontSize: 11, color: "var(--muted,#6b7280)" }}>
          {wsConnected ? (filter === "ALL" ? "Aucune alarme — système clean ✓" : `Aucune alarme ${filter}`) : "En attente du pipeline…"}
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
              <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {a.type.replace(/_/g, " ")} — <span style={{ color: SEV_COLOR[a.severity] }}>{a.severity}</span>
              </div>
              <div style={{ fontSize: 10, color: "var(--muted,#6b7280)", fontFamily: "monospace" }}>
                {a.source_ip} · score <b>{a.score}</b> · {a.engine} · {a.country}
              </div>
              {a.human_insight && (
                <div style={{ fontSize: 10, color: "var(--muted,#6b7280)", marginTop: 2, fontStyle: "italic", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {a.human_insight.slice(0, 72)}{a.human_insight.length > 72 ? "…" : ""}
                </div>
              )}
            </div>
            <div style={{ fontSize: 10, color: "var(--muted,#6b7280)", flexShrink: 0 }}>{a.timestamp}</div>
            <span style={{
              fontSize: 10, padding: "2px 6px", borderRadius: 3, fontWeight: 500, flexShrink: 0,
              background: isFusionView ? "#E6F1FB" : actionStyle.bg,
              color: isFusionView ? "#0C447C" : actionStyle.fg,
            }}>
              {isFusionView ? "VIEW ONLY" : a.action.split("_")[0]}
            </span>
          </div>
        );
      })}

      {filtered.length > 8 && (
        <div style={{ fontSize: 10, color: "var(--muted,#6b7280)", textAlign: "center", marginTop: 8, paddingTop: 6, borderTop: "0.5px solid var(--border,#e5e7eb)" }}>
          +{filtered.length - 8} alarmes supplémentaires
        </div>
      )}
    </div>
  );
};



// ═══════════════════════════════════════════════════════════════════════════════
// Agent workflow
// ═══════════════════════════════════════════════════════════════════════════════

const AgentWorkflow: FC<{ decisions: AgentDecision[] }> = ({ decisions }) => {
  const safe = Array.isArray(decisions) ? decisions : [];

  if (!safe.length) return (
    <div style={{ fontSize: 11, color: "var(--muted,#6b7280)", padding: "12px 0" }}>
      Aucune décision — pipeline non lancé
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {safe.map((d, i) => {
        const dd = d as any;
const agent = dd.agent ?? dd.event_type ?? "Agent";
const action = dd.action ?? dd.config ?? "—";
const reasoning = dd.reasoning ?? dd.message ?? dd.note ?? "";
const threat = dd.threat ?? "NORMAL";
const confidence = typeof dd.confidence === "number" ? dd.confidence : 1.0;
const ts = dd.ts ?? dd.timestamp ?? "";

        const avatarColors: Record<string, { bg: string; fg: string }> = {
          Collecteur:    { bg: "#E1F5EE", fg: "#0F6E56" },
          Détecteur:     { bg: "#FCEBEB", fg: "#A32D2D" },
          Orchestrateur: { bg: "#FAEEDA", fg: "#633806" },
          Rapporteur:    { bg: "#E6F1FB", fg: "#185FA5" },
        };
        const av = avatarColors[agent] ?? { bg: "#F1EFE8", fg: "#5F5E5A" };
        const threatColor = threat === "CRITICAL" ? "#A32D2D" : threat === "ELEVATED" ? "#854F0B" : "#0F6E56";

        return (
          <div key={String(dd.id ?? i)}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 0", borderBottom: i < safe.length - 1 ? "0.5px solid var(--border,#e5e7eb)" : "none" }}>
              <div style={{
                width: 28, height: 28, borderRadius: 7, display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 10, fontWeight: 600, flexShrink: 0,
                background: av.bg, color: av.fg,
              }}>
                {String(agent).slice(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>{agent}</span>
                  <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, background: "var(--color-background-secondary,#f3f4f6)", color: "var(--muted,#6b7280)", fontFamily: "monospace" }}>
                    {action}
                  </span>
                  <span style={{ fontSize: 10, color: threatColor, fontWeight: 500 }}>{threat}</span>
                </div>
                <div style={{ fontSize: 10, color: "var(--muted,#6b7280)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {String(reasoning).slice(0, 80)}{reasoning.length > 80 ? "…" : ""}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text)" }}>
                  {(confidence * 100).toFixed(0)}%
                </span>
                <span style={{ fontSize: 9, color: "var(--muted,#6b7280)" }}>{String(ts).slice(11, 19)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Trust Gate enrichi
// ═══════════════════════════════════════════════════════════════════════════════

const TrustPanel: FC<{ trust: TrustData | null; isFusionView: boolean }> = ({ trust, isFusionView }) => {
  if (!trust?.available) return (
    <div style={{ fontSize: 11, color: "var(--muted,#6b7280)" }}>
      {trust?.signals_summary ?? "Lance le pipeline pour obtenir le trust score."}
    </div>
  );

  const score = trust.confidence_in_metrics ?? 0;
  const scoreColor = score >= 0.8 ? "#0F6E56" : score >= 0.6 ? "#854F0B" : "#A32D2D";
  const pct = Math.round(score * 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Score principal avec arc */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ position: "relative", width: 56, height: 56, flexShrink: 0 }}>
          <svg viewBox="0 0 56 56" width={56} height={56}>
            <circle cx={28} cy={28} r={24} fill="none" stroke="var(--color-background-secondary,#f3f4f6)" strokeWidth={5}/>
            <circle cx={28} cy={28} r={24} fill="none" stroke={scoreColor} strokeWidth={5}
              strokeDasharray={`${(pct / 100) * 150.8} 150.8`}
              strokeLinecap="round" transform="rotate(-90 28 28)"/>
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: scoreColor }}>{pct}%</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{trust.confidence_label}</div>
          <div style={{ fontSize: 10, color: "var(--muted,#6b7280)", marginTop: 2 }}>Score de confiance</div>
        </div>
      </div>

      {/* Métriques */}
      {([
        ["Accord modèles",  `${((trust.model_agreement ?? 0) * 100).toFixed(0)}%`,  (trust.model_agreement ?? 0) >= 0.8],
        ["Taux FP",         `${((trust.false_positive_rate ?? 0) * 100).toFixed(1)}%`, (trust.false_positive_rate ?? 0) <= 0.1],
        ["Drift",           `${trust.drift_score?.toFixed(3) ?? "—"} (${trust.drift_label})`, !trust.drift_flagged],
        ["Stabilité",       trust.stability, trust.stability === "HIGH"],
      ] as [string, string, boolean][]).map(([k, v, ok]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
          <span style={{ color: "var(--muted,#6b7280)" }}>{k}</span>
          <span style={{ color: ok ? "#0F6E56" : "#A32D2D", fontFamily: "monospace", fontWeight: 500 }}>{v}</span>
        </div>
      ))}

      {trust.drift_flagged && (
        <div style={{ fontSize: 10, padding: "4px 8px", borderRadius: 4, background: "#FCEBEB", color: "#A32D2D", fontWeight: 500 }}>
          {isFusionView
            ? "Drift elevated in one or more local datasets. Review retraining per dataset only."
            : "Drift détecté — réentraînement recommandé"}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Terminal
// ═══════════════════════════════════════════════════════════════════════════════

const Terminal: FC<{ lines: string[] }> = ({ lines }) => (
  <div style={{
    background: "#111827", borderRadius: 6, padding: "8px 10px",
    fontFamily: "monospace", fontSize: 10, color: "#9ca3af",
    maxHeight: 120, overflowY: "auto", lineHeight: 1.8,
  }}>
    {lines.length === 0
      ? <span style={{ color: "#4b5563" }}>En attente des logs pipeline…</span>
      : lines.map((l, i) => {
          const color = l.includes("[ERROR") ? "#E24B4A"
            : l.includes("[WARN") ? "#EF9F27"
            : l.includes("[PASS1") || l.includes("[PASS2") ? "#EF9F27"
            : l.includes("[AGENTS") || l.includes("[PIPELINE") || l.includes("[SESSION") ? "#1D9E75"
            : l.includes("[TRUST") ? "#378ADD"
            : "#9ca3af";
          const sp = l.indexOf(" ");
          return (
            <div key={i}>
              <span style={{ color: "#4b5563" }}>{l.slice(0, sp)}</span>
              <span style={{ color }}>{l.slice(sp)}</span>
            </div>
          );
        })
    }
  </div>
);

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
        fontSize: 10, fontWeight: 700, letterSpacing: "0.18em",
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
        fontSize: 20, fontWeight: 600, color: "var(--text-primary)",
        letterSpacing: "-0.01em", lineHeight: 1.3, position: "relative",
      }}>
        {headline}
      </div>
      <div style={{
        marginTop: 6, fontSize: 12, color: "var(--text-muted)",
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

const KpiTile: FC<{ label: string; value: ReactNode; accent?: string; sub?: string }> = ({
  label, value, accent = "var(--text-primary)", sub,
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
      fontSize: 9.5, fontWeight: 700, letterSpacing: "0.12em",
      color: "var(--text-muted)", textTransform: "uppercase",
      fontFamily: "var(--font-mono)", marginBottom: 8,
    }}>{label}</div>
    <div style={{
      fontFamily: "var(--font-mono)", fontSize: 26, fontWeight: 700,
      color: accent, lineHeight: 1, letterSpacing: "-0.5px",
    }}>{value}</div>
    {sub && <div style={{ marginTop: 6, fontSize: 10, color: "var(--text-muted)" }}>{sub}</div>}
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
        overflow: "hidden",
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
          fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 600,
          color: "var(--text-primary)", letterSpacing: "-0.005em",
        }}>
          Pression par moteur de détection
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
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
              fontSize: 12,
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
                    fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700,
                    color: "var(--text-primary)", letterSpacing: "0.08em",
                  }}>
                    {e.engine}
                  </span>
                  <div style={{ display: "grid", gap: 4 }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      Seuils <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>{e.pass1}/{e.pass2}</span>
                    </span>
                    <PressureMeter value={e.alarms ?? 0} max={maxAlarms} color={visual.color} />
                  </div>
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700,
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
      height: 340,
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
          fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 600,
          color: "var(--text-primary)",
        }}>
          Flux d'alertes en direct
        </div>
        {criticals > 0 && (
          <span style={{
            padding: "4px 12px", borderRadius: 999,
            fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
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
                fontSize: 10,
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
          fontSize: 12, color: "var(--text-muted)",
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
                    fontFamily: "var(--font-mono)", fontSize: 10,
                    color: "var(--text-muted)", fontWeight: 600,
                  }}>
                    {String(a.timestamp).slice(11, 16) || "—"}
                  </span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700,
                    color: "var(--text-primary)", letterSpacing: "0.04em",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {a.type.replace(/_/g, " ")} · {a.source_ip}
                  </div>
                  <div style={{
                    fontSize: 10.5, color: "var(--text-muted)", marginTop: 2,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {a.country || "—"} · {a.engine} · {isFusionView ? "view only" : (a.action || "—").split("_")[0]}
                  </div>
                </div>
                <div style={{
                  fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700,
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

type JourneyVisualState = "completed" | "active" | "skipped" | "error" | "pending";

const JourneyPipeline: FC<{
  trust: TrustData | null;
  activities: WorkflowActivity[];
}> = ({ trust, activities }) => {
  const liveWindowStartedAt = useRef(Date.now());
  const liveWindowStart = liveWindowStartedAt.current - 1500;

  const liveActivities = activities.filter((activity) => {
    const ts = Date.parse(activity.timestamp);
    return Number.isFinite(ts) && ts >= liveWindowStart;
  });

  const liveSessionId =
    liveActivities.find((activity) => !!activity.session_id)?.session_id ?? null;
  const scopedActivities = liveSessionId
    ? liveActivities.filter((activity) => activity.session_id === liveSessionId)
    : liveActivities;

  const hasEvent = (eventType: string) =>
    scopedActivities.some((activity) => activity.event_type === eventType);

  const pipelineStarted = hasEvent("PIPELINE_START");
  const metricsDone = hasEvent("METRICS_COMPUTED");
  const pass1Done = hasEvent("PASS1_COMPLETE");
  const trustDone = hasEvent("TRUST_COMPUTED");
  const pass2Skipped = hasEvent("DYNAMIC_CONFIG_DEFAULT");
  const pass2Issued = hasEvent("DYNAMIC_CONFIG_ISSUED");
  const pass2Done = hasEvent("PASS2_COMPLETE");
  const agentsDone = hasEvent("AGENTS_COMPLETE");
  const sessionDone = hasEvent("SESSION_SUMMARY");

  const baseStages = [
    {
      id: "collecte",
      label: "Collecte",
      technical: "PIPELINE_START",
      tooltip: "Ingestion des logs et demarrage du pipeline.",
      state: pipelineStarted ? "completed" : "pending",
    },
    {
      id: "analyse",
      label: "Analyse",
      technical: "METRICS_COMPUTED",
      tooltip: "Calcul des metriques et lecture du contexte de securite.",
      state: metricsDone ? "completed" : "pending",
    },
    {
      id: "pass1",
      label: "Detection initiale",
      technical: "PASS1_COMPLETE",
      tooltip: "Analyse initiale des anomalies et comportements suspects.",
      state: pass1Done ? "completed" : "pending",
    },
    {
      id: "trust",
      label: "Verification IA",
      technical: "TRUST_COMPUTED",
      tooltip: "Validation de fiabilite via trust score et stabilite.",
      state: trustDone ? "completed" : "pending",
    },
    {
      id: "pass2",
      label: "Reanalyse adaptative",
      technical: pass2Skipped ? "DYNAMIC_CONFIG_DEFAULT" : "PASS2_COMPLETE",
      tooltip: "Analyse secondaire avec ajustements adaptatifs si necessaire.",
      state: pass2Done ? "completed" : pass2Skipped ? "skipped" : "pending",
    },
    {
      id: "agents",
      label: "Decision IA",
      technical: "AGENTS_COMPLETE",
      tooltip: "Coordination des agents pour choisir la reponse finale.",
      state: agentsDone ? "completed" : "pending",
    },
    {
      id: "session",
      label: "Session finale",
      technical: "SESSION_SUMMARY",
      tooltip: "Synthese de fin de session et publication du resultat.",
      state: sessionDone ? "completed" : "pending",
    },
  ] as const satisfies Array<{
    id: string;
    label: string;
    technical: string;
    tooltip: string;
    state: Exclude<JourneyVisualState, "active" | "error">;
  }>;

  const firstPendingIndex = baseStages.findIndex((stage) => stage.state === "pending");
  const lastResolvedIndex = Math.max(
    ...baseStages.map((stage, index) => (stage.state === "pending" ? -1 : index)),
  );
  const explicitActiveIndex = pass2Issued && !pass2Done && !pass2Skipped ? 4 : -1;

  let activeIndex = -1;
  if (pipelineStarted && !sessionDone) {
    activeIndex = explicitActiveIndex >= 0 ? explicitActiveIndex : firstPendingIndex;
  }

  const latestErrorActivity =
    [...scopedActivities].reverse().find((activity) => activity.status === "error" || activity.event_type === "ERROR") ?? null;
  const hasPipelineError = latestErrorActivity !== null;
  const errorIndex =
    hasPipelineError && !sessionDone
      ? Math.max(activeIndex, Math.min(lastResolvedIndex + 1, baseStages.length - 1))
      : -1;

  const stages = baseStages.map((stage, index) => {
    let visualState: JourneyVisualState = stage.state;
    if (index === errorIndex) visualState = "error";
    else if (stage.state === "pending" && index === activeIndex) visualState = "active";
    return {
      ...stage,
      key: stage.label,
      done: stage.state === "completed",
      visualState,
    };
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
  const trustHighlights = [
    trust?.model_agreement == null
      ? null
      : trust.model_agreement >= 0.8
        ? "Les modeles sont en accord eleve"
        : trust.model_agreement >= 0.6
          ? "Les modeles restent globalement coherents"
          : "Les modeles montrent un accord plus fragile",
    trust?.false_positive_rate == null
      ? null
      : trust.false_positive_rate <= 0.1
        ? "Le taux de faux positifs reste faible"
        : trust.false_positive_rate <= 0.25
          ? "Le bruit reste sous controle"
          : "Le taux de faux positifs demande plus de vigilance",
    trust?.drift_flagged
      ? "Un changement de comportement reduit la confiance"
      : trust?.stability === "HIGH" || (trust?.stable_signals ?? 0) >= 3
        ? "Le comportement du systeme est stable"
        : trust?.stability === "MEDIUM" || (trust?.stable_signals ?? 0) >= 1
          ? "La stabilite recente reste correcte"
          : trust?.drift_score != null || trust?.stability != null
            ? "La stabilite recente limite un peu la confiance"
            : null,
  ].filter((item): item is string => Boolean(item)).slice(0, 3);
  const dominantSignal =
    trust?.drift_flagged
      ? "Drift detecte dans le comportement recent"
      : trust?.model_agreement != null && trust.model_agreement >= 0.85
        ? "Accord modele eleve"
        : trust?.false_positive_rate != null && trust.false_positive_rate <= 0.1
          ? "Faible risque de faux positifs"
          : trust?.stability === "HIGH" || (trust?.stable_signals ?? 0) >= 3
            ? "Signaux stables sur les dernieres sessions"
            : null;

  const getTone = (state: JourneyVisualState) => {
    switch (state) {
      case "completed":
        return {
          border: "#2dd4a8",
          background: "rgba(45,212,168,0.12)",
          text: "#9ae6c8",
          shadow: "0 0 14px rgba(45,212,168,0.22)",
          line: "rgba(45,212,168,0.72)",
          icon: "✓",
        };
      case "active":
        return {
          border: "#35d4ff",
          background: "rgba(53,212,255,0.14)",
          text: "#8ee8ff",
          shadow: "0 0 16px rgba(53,212,255,0.24)",
          line: "rgba(53,212,255,0.7)",
          icon: "•",
        };
      case "skipped":
        return {
          border: "#5b7cff",
          background: "rgba(91,124,255,0.14)",
          text: "#a8b6ff",
          shadow: "0 0 14px rgba(91,124,255,0.2)",
          line: "rgba(91,124,255,0.68)",
          icon: "S",
        };
      case "error":
        return {
          border: "#ff5b7f",
          background: "rgba(255,91,127,0.14)",
          text: "#ff9eb0",
          shadow: "0 0 16px rgba(255,91,127,0.24)",
          line: "rgba(255,91,127,0.72)",
          icon: "!",
        };
      default:
        return {
          border: "rgba(112,138,167,0.45)",
          background: "rgba(15,23,42,0.18)",
          text: "var(--text-muted)",
          shadow: "none",
          line: "rgba(112,138,167,0.3)",
          icon: "○",
        };
    }
  };

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        height: 316,
        overflow: "visible",
      }}
    >
      <style>{`
        .journey-stage {
          position: relative;
        }
        .journey-tooltip {
          position: absolute;
          left: 50%;
          bottom: calc(100% + 12px);
          transform: translate(-50%, 8px);
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
          transition: opacity .18s ease, transform .18s ease, visibility .18s ease;
          width: max-content;
          max-width: 220px;
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid rgba(83,103,134,0.35);
          background: linear-gradient(180deg, rgba(7,14,24,0.98), rgba(10,20,34,0.94));
          box-shadow: 0 14px 32px rgba(2,6,23,0.36);
          z-index: 4;
          text-align: left;
        }
        .journey-stage:hover .journey-tooltip {
          opacity: 1;
          visibility: visible;
          transform: translate(-50%, 0);
        }
      `}</style>

      <div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
        >
          Parcours du systeme
        </div>
        <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 3 }}>
          Lecture live du dernier passage du pipeline.
        </div>
        {lastSignal && (
          <div
            style={{
              marginTop: 6,
              display: "inline-flex",
              maxWidth: "100%",
              padding: "4px 9px",
              borderRadius: 999,
              border: "1px solid rgba(125,211,252,0.18)",
              background: "rgba(125,211,252,0.08)",
              color: "#7dd3fc",
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: "0.06em",
              fontFamily: "var(--font-mono)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            Dernier signal · {lastSignal}
          </div>
        )}
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          position: "relative",
          minHeight: 0,
          overflow: "visible",
        }}
      >
        {stages.map((stage, index) => {
          const tone = getTone(stage.visualState);
          const nextTone = index < stages.length - 1 ? getTone(stages[index + 1].visualState) : null;

          return (
            <div
              key={stage.id}
              style={{
                display: "flex",
                alignItems: "center",
                flex: index === stages.length - 1 ? "0 0 auto" : 1,
              }}
            >
              <div className="journey-stage" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
                <div className="journey-tooltip" role="tooltip">
                  <div style={{ fontSize: 10.5, lineHeight: 1.35, color: "var(--text-primary)", fontWeight: 600 }}>
                    {stage.tooltip}
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 9,
                      letterSpacing: "0.08em",
                      fontFamily: "var(--font-mono)",
                      color: "#7dd3fc",
                    }}
                  >
                    {stage.technical}
                  </div>
                </div>

                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: `1.5px solid ${tone.border}`,
                    background: tone.background,
                    color: tone.text,
                    fontSize: 12,
                    fontWeight: 700,
                    boxShadow: tone.shadow,
                    transition: "all .24s ease",
                    animation: stage.visualState === "active" ? "pulse-dot 1.4s ease-in-out infinite" : "none",
                  }}
                >
                  {tone.icon}
                </div>

                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 8.6,
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    color: tone.text,
                    textAlign: "center",
                    lineHeight: 1.15,
                    maxWidth: 76,
                  }}
                >
                  {stage.label}
                </span>
              </div>

              {index < stages.length - 1 && (
                <div
                  style={{
                    flex: 1,
                    height: 1.5,
                    margin: "0 5px",
                    marginBottom: 24,
                    borderRadius: 999,
                    background:
                      stage.visualState === "pending" && stages[index + 1].visualState === "pending"
                        ? "rgba(112,138,167,0.24)"
                        : `linear-gradient(90deg, ${tone.line}, ${nextTone?.line ?? tone.line})`,
                    opacity: 0.9,
                  }}
                />
              )}
            </div>
          );
        })}
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
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.14em",
                color: "var(--text-muted)",
                textTransform: "uppercase",
                fontFamily: "var(--font-mono)",
              }}
            >
              Niveau de confiance
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 19,
                fontWeight: 700,
                color: confidenceTone,
              }}
            >
              {confidence == null ? "--" : `${confidence}%`}
            </div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  fontSize: 9.5,
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
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                Stabilite
              </span>
              <span
                style={{
                  fontSize: 10,
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

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 5,
            padding: "7px 9px",
            borderRadius: 10,
            background: "rgba(15,23,42,0.26)",
            border: "1px solid rgba(148,163,184,0.12)",
          }}
        >
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.12em",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              fontFamily: "var(--font-mono)",
            }}
          >
            Pourquoi ce niveau de confiance ?
          </div>
          {trustHighlights.map((item) => (
            <div
              key={item}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 7,
                fontSize: 10.5,
                lineHeight: 1.3,
                color: "var(--text-secondary)",
              }}
            >
              <span style={{ color: "#7dd3fc", fontSize: 9, marginTop: 2 }}>•</span>
              <span>{item}</span>
            </div>
          ))}
          {dominantSignal && (
            <div
              style={{
                paddingTop: 2,
                fontSize: 9.5,
                color: "#9fb7d4",
                fontFamily: "var(--font-mono)",
              }}
            >
              Signal dominant: {dominantSignal}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: 14,
      padding: "16px 18px",
      display: "flex", flexDirection: "column", gap: 14,
      height: 340,
      overflow: "hidden",
    }}>
      <div>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 600,
          color: "var(--text-primary)",
        }}>
          Parcours du système
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
          Où en est le pipeline pour le dernier passage.
        </div>
        {lastSignal && (
          <div style={{
            marginTop: 6,
            display: "inline-flex",
            maxWidth: "100%",
            padding: "4px 9px",
            borderRadius: 999,
            border: "1px solid rgba(125,211,252,0.18)",
            background: "rgba(125,211,252,0.08)",
            color: "#7dd3fc",
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: "0.06em",
            fontFamily: "var(--font-mono)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}>
            Dernier signal · {lastSignal}
          </div>
        )}
      </div>

      {/* stages */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4, position: "relative", minHeight: 0 }}>
        {stages.map((s, i) => {
          const isActive = i === activeIndex;
          return (
            <div key={s.key} style={{ display: "flex", alignItems: "center", flex: i === stages.length - 1 ? "0 0 auto" : 1 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  border: `1.5px solid ${s.done ? "var(--purple)" : isActive ? "var(--amber)" : "var(--border)"}`,
                  background: s.done ? "rgba(45,212,168,0.12)" : isActive ? "rgba(251,191,36,0.1)" : "transparent",
                  color: s.done ? "var(--purple)" : isActive ? "var(--amber)" : "var(--text-muted)",
                  fontSize: 12, fontWeight: 700,
                  boxShadow: s.done ? "0 0 12px rgba(45,212,168,0.25)" : isActive ? "0 0 14px rgba(251,191,36,0.2)" : "none",
                  transition: "all .3s ease",
                  animation: isActive ? "pulse-dot 1.8s ease-in-out infinite" : "none",
                }}>
                  {s.done ? "✓" : isActive ? "…" : "○"}
                </div>
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 8.5, fontWeight: 700,
                  letterSpacing: "0.1em", color: s.done ? "var(--text-secondary)" : isActive ? "var(--amber)" : "var(--text-muted)",
                  whiteSpace: "nowrap",
                }}>
                  {s.key}
                </span>
              </div>
              {i < stages.length - 1 && (
                <div style={{
                  flex: 1, height: 1.5, margin: "0 4px", marginBottom: 18,
                  background: s.done && stages[i + 1].done
                    ? "linear-gradient(90deg, var(--purple), var(--purple))"
                    : s.done || isActive
                    ? "linear-gradient(90deg, var(--purple), var(--amber), var(--border))"
                    : "var(--border)",
                  opacity: 0.7,
                }}/>
              )}
            </div>
          );
        })}
      </div>

      {/* confidence footer */}
      <div style={{
        paddingTop: 10, borderTop: "1px solid var(--border-subtle)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: "0.14em",
            color: "var(--text-muted)", textTransform: "uppercase",
            fontFamily: "var(--font-mono)", marginBottom: 4,
          }}>
            Niveau de confiance
          </div>
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 700,
            color: confidenceTone,
          }}>
            {confidence == null ? "—" : `${confidence}%`}
          </div>
        </div>
        <span style={{
          padding: "4px 10px", borderRadius: 999,
          fontSize: 9.5, fontWeight: 700, letterSpacing: "0.1em",
          fontFamily: "var(--font-mono)",
          border: `1px solid ${isTrusted ? "rgba(45,212,168,0.4)" : "var(--border)"}`,
          background: isTrusted ? "rgba(45,212,168,0.12)" : "transparent",
          color: isTrusted ? "var(--green)" : "var(--text-muted)",
        }}>
          {confLabel}
        </span>
      </div>
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

export const DashboardPanel: FC<Props> = ({
  kpis, alarms, engines, decisions, logLines, trust, activities, loading, wsConnected, isLive, isFusionView,
}) => {
  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 320, flexDirection: "column", gap: 16, color: "var(--text-muted)", fontSize: 13 }}>
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

      {/* ── 1. Story banner ── */}
      <StoryBanner
        criticalCount={criticalCount}
        alarms={alarms}
        engines={engines}
        kpis={kpis}
      />

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
        />
      </div>

      {/* ── 3. Engine pressure (radar + rows + sparklines) ── */}
      <EnginePressurePanel engines={engines} alarms={alarms}/>

      {/* ── 4. Alerts + Journey side-by-side ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 16 }}>
        <LiveAlarmFeed alarms={alarms} isFusionView={isFusionView}/>
        <JourneyPipeline
          trust={trust}
          activities={activities}
        />
      </div>

      {/* ── 5. Secondary: agent flow / terminal / trust details ── */}
      <details style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: "14px 18px",
      }}>
        <summary style={{
          cursor: "pointer", listStyle: "none",
          fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700,
          letterSpacing: "0.1em", textTransform: "uppercase",
          color: "var(--text-secondary)", userSelect: "none",
        }}>
          ▸ Détails techniques · agents, logs &amp; trust gate
        </summary>
        <div style={{ display: "grid", gap: 16, marginTop: 16 }}>
          <Card
            title="Agent Interaction Flow"
            tag={`${activities.length} événements`}
            style={{ maxHeight: 420, overflowY: "auto" }}
          >
            <AgentActivityFlow
              activities={activities}
              decisions={decisions}
              wsConnected={wsConnected}
              isLive={isLive}
            />
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border-subtle)" }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 8 }}>
                Structured decisions snapshot
              </div>
              <AgentWorkflow decisions={decisions.slice(0, 4)}/>
            </div>
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
            <Card title="Terminal — Logs pipeline" tag={`${logLines.length} lignes`}>
              <Terminal lines={logLines}/>
            </Card>
            <Card title="Trust Gate — Score de confiance">
              <TrustPanel trust={trust} isFusionView={isFusionView}/>
            </Card>
          </div>
        </div>
      </details>
    </div>
  );
};
