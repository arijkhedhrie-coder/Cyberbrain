// src/components/dashboard/DashboardPanel.tsx


import { useState } from "react";
import type { FC, ReactNode } from "react";
import logo from "../../assets/cyberbrain.png";
import type {
  KpiData, AlarmItem, EngineScore,
  AgentDecision, TrustData, SessionSummary,
} from "../../types/idps";
import { LiveAlarmFeed } from "./LiveAlarmFeed";
import type { CorrectiveSuggestion } from "../../types/idps";
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


const Header = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
    <img src={logo} alt="Cyberbrain Logo" style={{ width: 40 }} />
    <h1 style={{ margin: 0 }}>CYBERBRAIN</h1>
  </div>
);
// ═══════════════════════════════════════════════════════════════════════════════
// KPI Card row
// ═══════════════════════════════════════════════════════════════════════════════

const KpiCard: FC<{ label: string; value: ReactNode; sub?: string; accent?: string; spike?: boolean }> = ({
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

const PieChart: FC<{ alarms: AlarmItem[] }> = ({ alarms }) => {
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

const EngineBarChart: FC<{ engines: EngineScore[] }> = ({ engines }) => {
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

const FilteredAlarmFeed: FC<{ alarms: AlarmItem[]; wsConnected: boolean }> = ({ alarms, wsConnected }) => {
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
              background: actionStyle.bg, color: actionStyle.fg,
            }}>
              {a.action.split("_")[0]}
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
// Courbe de minimisation enrichie — health score + alarmes
// ═══════════════════════════════════════════════════════════════════════════════

const MinimCurve: FC<{ sessions: SessionSummary[] }> = ({ sessions }) => {
  const [view, setView] = useState<"alarms" | "health">("alarms");
  if (!sessions.length) return (
    <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted,#6b7280)", padding: "28px 0" }}>
      Pas encore de sessions — lance le pipeline
    </div>
  );

  const recent = [...sessions].reverse().slice(0, 20);
  const vals   = recent.map(s => view === "alarms" ? s.nb_alarms_final : (s.health_score ?? 0));
  const maxVal = Math.max(...vals, 1);

  return (
    <div>
      {/* Toggle */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {(["alarms", "health"] as const).map(v => (
          <button key={v} onClick={() => setView(v)} style={{
            fontSize: 10, padding: "3px 10px", borderRadius: 20, border: "0.5px solid var(--border,#e5e7eb)",
            cursor: "pointer", fontFamily: "inherit", fontWeight: 500,
            background: view === v ? "#E1F5EE" : "transparent",
            color:      view === v ? "#0F6E56" : "var(--muted,#6b7280)",
          }}>
            {v === "alarms" ? "Alarmes" : "Health score"}
          </button>
        ))}
      </div>

      {/* Bars */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 70, marginBottom: 6 }}>
        {recent.map((s, i) => {
          const val   = vals[i];
          const pct   = Math.max(6, (val / maxVal) * 100);
          const color = view === "alarms"
            ? (val > 3 ? "#E24B4A" : val > 1 ? "#EF9F27" : "#1D9E75")
            : (val >= 90 ? "#1D9E75" : val >= 70 ? "#EF9F27" : "#E24B4A");
          return (
            <div
              key={i}
              title={`${s.date?.slice(0, 10) || ""} — ${view === "alarms" ? `${val} alarmes` : `health ${val?.toFixed ? val.toFixed(1) : val}%`}${s.pass2_ran ? " (P2)" : ""}`}
              style={{ height: `${pct}%`, flex: 1, borderRadius: "2px 2px 0 0", background: color, opacity: 0.85, cursor: "default", transition: "height .3s" }}
            />
          );
        })}
      </div>

      {/* Légende */}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--muted,#6b7280)" }}>
        <span>{recent.length} sessions</span>
        {view === "alarms"
          ? <span>max: <b style={{ color: "var(--text)" }}>{Math.max(...vals)}</b> alarmes</span>
          : <span>moy: <b style={{ color: "var(--text)" }}>{(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)}%</b></span>
        }
        <span>← plus ancien · plus récent →</span>
      </div>

      {/* Taux amélioration (si ≥ 2 sessions) */}
      {recent.length >= 2 && view === "alarms" && (() => {
        const first = vals[0], last = vals[vals.length - 1];
        const delta = first - last;
        if (first === 0) return null;
        const pct   = ((delta / first) * 100).toFixed(0);
        const improved = delta > 0;
        return (
          <div style={{ marginTop: 8, fontSize: 10, padding: "4px 8px", borderRadius: 4, background: improved ? "#E1F5EE" : "#FCEBEB", color: improved ? "#0F6E56" : "#A32D2D", fontWeight: 500 }}>
            {improved ? `↓ ${pct}% de réduction` : `↑ ${Math.abs(Number(pct))}% d'augmentation`} des alarmes sur {recent.length} sessions
          </div>
        );
      })()}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Agent workflow
// ═══════════════════════════════════════════════════════════════════════════════

const AgentWorkflow: FC<{ decisions: AgentDecision[] }> = ({ decisions }) => {
  const avatarColors: Record<string, { bg: string; fg: string }> = {
    Collecteur:    { bg: "#E1F5EE", fg: "#0F6E56" },
    Détecteur:     { bg: "#FCEBEB", fg: "#A32D2D" },
    Orchestrateur: { bg: "#FAEEDA", fg: "#633806" },
    Rapporteur:    { bg: "#E6F1FB", fg: "#185FA5" },
  };

  if (!decisions.length) return (
    <div style={{ fontSize: 11, color: "var(--muted,#6b7280)", padding: "12px 0" }}>
      Aucune décision — pipeline non lancé
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {decisions.map((d, i) => {
        const av = avatarColors[d.agent] ?? { bg: "#F1EFE8", fg: "#5F5E5A" };
        const threatColor = d.threat === "CRITICAL" ? "#A32D2D" : d.threat === "ELEVATED" ? "#854F0B" : "#0F6E56";
        return (
          <div key={d.id}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 0", borderBottom: i < decisions.length - 1 ? "0.5px solid var(--border,#e5e7eb)" : "none" }}>
              {/* Avatar */}
              <div style={{
                width: 28, height: 28, borderRadius: 7, display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 10, fontWeight: 600, flexShrink: 0,
                background: av.bg, color: av.fg,
              }}>
                {d.agent.slice(0, 2).toUpperCase()}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Nom + action */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>{d.agent}</span>
                  <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, background: "var(--color-background-secondary,#f3f4f6)", color: "var(--muted,#6b7280)", fontFamily: "monospace" }}>
                    {d.action}
                  </span>
                  <span style={{ fontSize: 10, color: threatColor, fontWeight: 500 }}>{d.threat}</span>
                </div>

                {/* Reasoning */}
                <div style={{ fontSize: 10, color: "var(--muted,#6b7280)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {d.reasoning.slice(0, 80)}{d.reasoning.length > 80 ? "…" : ""}
                </div>

                {/* Targets si présents */}
                {d.targets?.length > 0 && (
                  <div style={{ fontSize: 9, color: "#A32D2D", marginTop: 2, fontFamily: "monospace" }}>
                    Cibles : {d.targets.slice(0, 3).join(", ")}{d.targets.length > 3 ? ` +${d.targets.length - 3}` : ""}
                  </div>
                )}
              </div>

              {/* Confidence */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text)" }}>
                  {(d.confidence * 100).toFixed(0)}%
                </span>
                <div style={{ width: 36, height: 3, borderRadius: 2, background: "var(--color-background-secondary,#f3f4f6)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${d.confidence * 100}%`, background: av.fg, borderRadius: 2 }}/>
                </div>
                <span style={{ fontSize: 9, color: "var(--muted,#6b7280)" }}>{d.ts}</span>
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

const TrustPanel: FC<{ trust: TrustData | null }> = ({ trust }) => {
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
          ⚠ Drift détecté — réentraînement recommandé
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
  sessions:    SessionSummary[];
  logLines:    string[];
  trust:       TrustData | null;
  loading:     boolean;
  wsConnected: boolean;
  isLive:      boolean;
  suggestions: CorrectiveSuggestion[];
}

export const DashboardPanel: FC<Props> = ({
  kpis, alarms, engines, decisions, sessions, logLines, trust, loading, wsConnected, isLive,
  suggestions,
}) => {
  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 320, flexDirection: "column", gap: 16, color: "var(--muted,#6b7280)", fontSize: 13 }}>
      <div style={{ width: 32, height: 32, borderRadius: "50%", border: "2px solid #1D9E75", borderTopColor: "transparent", animation: "spin .8s linear infinite" }}/>
      Chargement des données pipeline…
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes live-pulse{0%,100%{opacity:1}50%{opacity:.45}}`}</style>
    </div>
  );

  const healthScore = kpis?.health_score ?? 0;
  const healthColor = healthScore >= 90 ? "#0F6E56" : healthScore >= 70 ? "#854F0B" : "#A32D2D";
  const criticalCount = alarms.filter(a => a.severity === "CRITICAL").length;
  const alarmEngines  = engines.filter(e => e.status === "ALARM").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes live-pulse{0%,100%{opacity:1}50%{opacity:.45}}`}</style>

      {/* ── Row 0 : KPI cards ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <KpiCard
          label="Health score"
          value={`${healthScore.toFixed(1)}%`}
          sub={kpis?.alert_status ?? "—"}
          accent={healthColor}
        />
        <KpiCard
          label="Lignes analysées"
          value={(kpis?.row_count ?? 0).toLocaleString()}
          sub={`après dédup: ${(kpis?.deduped_count ?? 0).toLocaleString()}`}
        />
        <KpiCard
          label="Alarmes critiques"
          value={criticalCount}
          sub={`${alarms.length} total · ${alarmEngines} moteur(s)`}
          accent={criticalCount > 0 ? "#A32D2D" : "#0F6E56"}
          spike={criticalCount > 0}
        />
        <KpiCard
          label="IP entropie"
          value={kpis?.ip_entropy?.toFixed(3) ?? "—"}
          sub={`${kpis?.unique_attacking_ips ?? 0} IPs attaquantes`}
          accent="#378ADD"
          spike={kpis?.is_velocity_spike}
        />
        <KpiCard
          label="Pattern d'attaque"
          value={kpis?.attack_pattern ?? "—"}
          sub={`vitesse: ${kpis?.attack_velocity?.toFixed(2) ?? "—"}`}
          accent={kpis?.attack_pattern ? "#854F0B" : "var(--text)"}
        />
        <KpiCard
          label="Qualité données"
          value={kpis?.data_quality ?? "—"}
          sub={`bruit: ${kpis?.noise_ratio != null ? (kpis.noise_ratio * 100).toFixed(1) + "%" : "—"}`}
          accent={(kpis?.noise_ratio ?? 0) > 0.5 ? "#A32D2D" : "#0F6E56"}
        />
      </div>

      {/* ── Row 1 : Engine bars + Pie chart sévérité ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
        <Card title="Scores par moteur" tag="Pass 1 + 2">
          <EngineBarChart engines={engines}/>
        </Card>
        <Card title="Répartition par sévérité" tag={`${alarms.length} alarmes`} tagRed={criticalCount > 0}>
          <PieChart alarms={alarms}/>
        </Card>
      </div>

      {/* ── Row 2 : Live alarms filtrées ── */}
      <FilteredAlarmFeed alarms={alarms} wsConnected={wsConnected}/>

      {/* ── Row 3 : Minimisation + Agents ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.1fr", gap: 12 }}>
        <Card title="Courbe de minimisation" tag={`${sessions.length} sessions`}>
          <MinimCurve sessions={sessions}/>
        </Card>
        <Card title="Agents CrewAI — Workflow décisions">
          <AgentWorkflow decisions={decisions}/>
        </Card>
      </div>

      {/* ── Row 4 : Terminal + Trust ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
        <Card title="Terminal — Logs pipeline" tag={`${logLines.length} lignes`}>
          <Terminal lines={logLines}/>
        </Card>
        <Card title="Trust Gate — Score de confiance">
          <TrustPanel trust={trust}/>
        </Card>
      </div>

      {/* ── Row 5 : Barre info + LIVE badge ── */}
      <div style={{
        display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center",
        background: "var(--color-background-secondary,#f3f4f6)",
        borderRadius: 6, padding: "8px 14px", fontSize: 11, color: "var(--muted,#6b7280)",
      }}>
        {isLive && (
          <span style={{
            fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 700,
            background: "#FCEBEB", color: "#A32D2D", animation: "live-pulse 1s ease-in-out infinite",
          }}>
            ● LIVE
          </span>
        )}
        <span>Health: <b style={{ color: healthColor }}>{healthScore.toFixed(1)}%</b></span>
        <span>Sources: <b style={{ color: "var(--text)" }}>{kpis?.data_sources?.length ?? 0} serveur(s)</b></span>
        <span>Dédup: <b style={{ color: "var(--text)" }}>{kpis?.deduped_count?.toLocaleString() ?? "—"}</b></span>
        <span>Bruit: <b style={{ color: (kpis?.noise_ratio ?? 0) > 0.5 ? "#A32D2D" : "var(--text)" }}>
          {kpis?.noise_ratio != null ? `${(kpis.noise_ratio * 100).toFixed(1)}%` : "—"}
        </b></span>
        <span>Pattern: <b style={{ color: "var(--text)" }}>{kpis?.attack_pattern ?? "—"}</b></span>
        <span style={{ marginLeft: "auto", fontSize: 10 }}>Nuit: {kpis?.night_ratio != null ? `${(kpis.night_ratio * 100).toFixed(0)}%` : "—"}</span>
      </div>
    </div>
  );
};