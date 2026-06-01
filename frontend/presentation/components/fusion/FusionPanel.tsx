// @ts-nocheck
import { createElement, useMemo, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import { useFusionViewModel } from "../../hooks/useFusionViewModel";

// ─── Inline SVG icons (no external dep) ────────────────────────────────────
type IconProps = { size?: number; color?: string };

function Ico({ size = 16, color = "currentColor", d }: IconProps & { d: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

const Icons = {
  Alert:    (p: IconProps) => <Ico {...p} d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0ZM12 9v4M12 17h.01" />,
  Shield:   (p: IconProps) => <Ico {...p} d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />,
  Activity: (p: IconProps) => <Ico {...p} d="M3 12h4l3-7 4 14 3-7h4" />,
  TrendUp:  (p: IconProps) => <Ico {...p} d="M22 7 13.5 15.5l-5-5L2 17M16 7h6v6" />,
  Zap:      (p: IconProps) => <Ico {...p} d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />,
  Network:  (p: IconProps) => <Ico {...p} d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />,
  Eye:      (p: IconProps) => <Ico {...p} d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />,
  Filter:   (p: IconProps) => <Ico {...p} d="M22 3H2l8 9.46V19l4 2V12.46L22 3Z" />,
};

// ─── Strip framer-motion props (safe SSR / plain-React fallback) ─────────────
function stripMotion<T extends Record<string, unknown>>(props: T) {
  const { initial, animate, transition, whileHover, ...rest } = props;
  void initial; void animate; void transition; void whileHover;
  return rest;
}
function motionTag(tag: string) {
  return (props: Record<string, unknown>) => createElement(tag, stripMotion(props));
}
const motion = {
  div:     motionTag("div"),
  section: motionTag("section"),
  h1:      motionTag("h1"),
  p:       motionTag("p"),
};

const RechartsTooltip = Tooltip as any;

// ─── Risk level helpers ───────────────────────────────────────────────────────
interface RiskLevel {
  label: string;
  sublabel: string;
  color: string;
  bg: string;
  border: string;
  icon: (p: IconProps) => JSX.Element;
  band: string; // for the gauge arc
}

function getRiskLevel(score: number): RiskLevel {
  if (score >= 70) return {
    label: "Critique",
    sublabel: "Activité coordonnée détectée",
    color: "#f87171",
    bg: "rgba(248,113,113,0.10)",
    border: "rgba(248,113,113,0.35)",
    icon: Icons.Alert,
    band: "#f87171",
  };
  if (score >= 40) return {
    label: "Élevé",
    sublabel: "Signaux à surveiller",
    color: "#fbbf24",
    bg: "rgba(251,191,36,0.10)",
    border: "rgba(251,191,36,0.35)",
    icon: Icons.Activity,
    band: "#fbbf24",
  };
  if (score >= 20) return {
    label: "Modéré",
    sublabel: "Activité faible",
    color: "#60a5fa",
    bg: "rgba(96,165,250,0.10)",
    border: "rgba(96,165,250,0.35)",
    icon: Icons.Eye,
    band: "#60a5fa",
  };
  return {
    label: "Calme",
    sublabel: "Aucune menace significative",
    color: "#4ade80",
    bg: "rgba(74,222,128,0.10)",
    border: "rgba(74,222,128,0.35)",
    icon: Icons.Shield,
    band: "#4ade80",
  };
}

// ─── Score bar (single IP or per-dataset) ────────────────────────────────────
function ScoreBar({ value, max = 95, accent }: { value: number; max?: number; accent: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div style={{ height: 6, background: "rgba(148,163,184,0.12)", borderRadius: 99, overflow: "hidden" }}>
      <div style={{
        width: `${pct}%`, height: "100%", borderRadius: 99,
        background: `linear-gradient(90deg, ${accent}99, ${accent})`,
        transition: "width 0.8s ease",
      }} />
    </div>
  );
}

// ─── Circular gauge ───────────────────────────────────────────────────────────
function RiskGauge({ score }: { score: number }) {
  const level = getRiskLevel(score);
  const clamped = Math.max(0, Math.min(100, score));
  const r = 70;
  const circ = 2 * Math.PI * r;
  // Arc covers 270° (from 135° to 45°) — standard gauge shape
  const arcLen = circ * 0.75;
  const offset = arcLen - (clamped / 100) * arcLen;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div style={{ position: "relative", width: 170, height: 170 }}>
        <svg width="170" height="170" viewBox="0 0 170 170">
          <defs>
            <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={level.band} stopOpacity="0.6" />
              <stop offset="100%" stopColor={level.band} />
            </linearGradient>
          </defs>
          {/* Track */}
          <circle cx="85" cy="85" r={r} fill="none" stroke="rgba(148,163,184,0.10)"
            strokeWidth="11" strokeDasharray={`${arcLen} ${circ}`}
            strokeDashoffset={0} strokeLinecap="round"
            transform="rotate(135 85 85)" />
          {/* Value arc */}
          <circle cx="85" cy="85" r={r} fill="none" stroke="url(#gaugeGrad)"
            strokeWidth="11"
            strokeDasharray={`${arcLen} ${circ}`}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform="rotate(135 85 85)"
            style={{ filter: `drop-shadow(0 0 6px ${level.band}88)` }}
          />
        </svg>
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 2,
        }}>
          <div style={{
            fontSize: 48, fontWeight: 900, color: level.color, lineHeight: 1,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            textShadow: `0 0 20px ${level.color}44`,
          }}>
            {Math.round(clamped)}
          </div>
          <div style={{ color: "#ffffff", fontSize: 10, letterSpacing: "0.15em", fontWeight: 700 }}>/ 100</div>
        </div>
      </div>
      {/* Label pill */}
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "5px 14px", borderRadius: 99,
        background: level.bg, border: `1px solid ${level.border}`,
        color: level.color, fontSize: 12, fontWeight: 700, letterSpacing: "0.05em",
      }}>
        <level.icon size={12} color={level.color} />
        {level.label}
      </div>
    </div>
  );
}

// ─── Dataset contribution bar list ───────────────────────────────────────────
function DatasetRiskBars({ breakdown }: { breakdown: Record<string, number> }) {
  const entries = Object.entries(breakdown)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;

  const fmt = (name: string) =>
    name
      .replace(/^__/, "").replace(/__$/, "")
      .replace(/[_-]+/g, " ").trim()
      .replace(/^\w/, (c) => c.toUpperCase()) || name;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {entries.map(([name, score]) => {
        const level = getRiskLevel(score);
        return (
          <div key={name}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ color: "#94a3b8", fontSize: 12, fontWeight: 500 }}>{fmt(name)}</span>
              <span style={{
                color: level.color, fontSize: 12, fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
                background: level.bg, padding: "1px 8px", borderRadius: 99,
                border: `1px solid ${level.border}`,
              }}>
                {Math.round(score)}/100
              </span>
            </div>
            <ScoreBar value={score} accent={level.color} />
          </div>
        );
      })}
    </div>
  );
}

// ─── Attack type translation ──────────────────────────────────────────────────
const ATTACK_LABELS: Record<string, string> = {
  "CORRELATION|CROSS_PROTOCOL_ATTACK":       "Attaque multi-protocoles",
  "CORRELATION|CROSS_DATASET_IP_CORRELATION":"IP présente sur plusieurs serveurs",
  "SSH|BRUTE_FORCE_SSH":                     "Force brute SSH",
  "SSH|BRUTE_FORCE":                         "Force brute SSH",
  "SSH|CORRECTIVE_EXECUTED":                 "Contre-mesure SSH appliquée",
  "SSH|CORRECTIVE_SUGGESTION":               "Suggestion corrective SSH",
  "SSH|SSH_BRUTE_FORCE":                     "Force brute SSH",
  "SSH|SSH_SUCCESS":                         "Connexion SSH réussie (suspecte)",
  "SSH|SSH_FAILED":                          "Échec de connexion SSH",
  "SESSION|POST_BREACH_LOGIN":               "Connexion post-intrusion",
  "SESSION|BEHAVIORAL_ANOMALY":              "Comportement anormal de session",
  "WEB|WEB_ATTACK":                          "Attaque web",
  "WEB|WEB_ENUMERATION":                     "Énumération web",
  "WEB|PORT_SCAN":                           "Scan de ports",
  "FTP|DATA_THEFT":                          "Vol de données FTP",
  "FTP|FTP_BRUTE_FORCE":                     "Force brute FTP",
  "FTP|FTP_DATA_EXFIL":                      "Exfiltration FTP",
  "KERNEL|CRASH_COMING":                     "Instabilité système imminente",
  "KERNEL|KERNEL_PANIC":                     "Panique noyau",
};

function translateBehavior(raw: string): string {
  const parts = raw.split("|");
  const key = parts.length >= 2 ? `${parts[0]}|${parts[1]}` : raw;
  if (ATTACK_LABELS[key]) return ATTACK_LABELS[key];
  return raw.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Attacker row card ────────────────────────────────────────────────────────
function AttackerCard({ att, rank }: { att: any; rank: number }) {
  const level = getRiskLevel(att.risk_score);
  const fmtDs = (name: string) =>
    name.replace(/^__/, "").replace(/__$/, "").replace(/[_-]+/g, " ").trim()
      .replace(/^\w/, (c) => c.toUpperCase()) || name;

  const medals = ["🥇", "🥈", "🥉"];
  const rankLabel = rank <= 3 ? medals[rank - 1] : `#${rank}`;

  const tags = [];
  if (att.is_correlated) tags.push({ label: "Multi-serveurs", color: "#f87171" });
  if (att.is_recurrent) tags.push({ label: "Récurrent", color: "#fbbf24" });

  return (
    <div style={{
      borderRadius: 14, padding: "16px 18px",
      background: "linear-gradient(180deg, rgba(15,23,42,0.8), rgba(8,17,31,0.9))",
      border: `1px solid ${rank === 1 ? level.border : "rgba(51,65,85,0.5)"}`,
      display: "grid", gridTemplateColumns: "36px 1fr auto", gap: 14, alignItems: "start",
    }}>
      {/* rank */}
      <div style={{ fontSize: rank <= 3 ? 22 : 13, paddingTop: 2,
        color: "#475569", fontWeight: 800, fontFamily: "monospace", textAlign: "center" }}>
        {rankLabel}
      </div>

      {/* details */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <span style={{
            color: "#e2e8f0", fontSize: 14, fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
          }}>{att.ip}</span>
          {tags.map((t) => (
            <span key={t.label} style={{
              fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99,
              background: `${t.color}18`, border: `1px solid ${t.color}44`, color: t.color,
            }}>{t.label}</span>
          ))}
        </div>

        <div style={{ color: "#64748b", fontSize: 12, marginBottom: 8 }}>
          {att.event_count.toLocaleString("fr-FR")} événements
          {att.dataset_count > 1 && ` · ${att.dataset_count} serveurs`}
        </div>

        {/* Datasets */}
        {att.datasets?.length > 0 && (
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 5 }}>
            <span style={{ color: "#38bdf8" }}>Serveurs : </span>
            {att.datasets.map(fmtDs).join(", ")}
          </div>
        )}

        {/* Behaviors */}
        {att.behaviors?.slice(0, 2).map((b: string) => (
          <div key={b} style={{
            display: "inline-block", fontSize: 11, padding: "2px 8px", borderRadius: 99,
            background: "rgba(148,163,184,0.08)", border: "1px solid rgba(148,163,184,0.15)",
            color: "#94a3b8", marginRight: 6, marginTop: 4,
          }}>
            {translateBehavior(b)}
          </div>
        ))}

        {/* Score bar */}
        <div style={{ marginTop: 10 }}>
          <ScoreBar value={att.risk_score} accent={level.color} />
        </div>
      </div>

      {/* Score badge */}
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, paddingTop: 2,
      }}>
        <div style={{
          fontSize: 28, fontWeight: 900, color: level.color, lineHeight: 1,
          fontFamily: "'JetBrains Mono', monospace",
          textShadow: `0 0 12px ${level.color}44`,
        }}>
          {Math.round(att.risk_score)}
        </div>
        <div style={{ fontSize: 10, color: "#ffffff" }}>/ 100</div>
      </div>
    </div>
  );
}

// ─── Timeline tooltip ─────────────────────────────────────────────────────────
const timeLabel = (value: string) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value
    : d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
};

// ─── Stat tile ────────────────────────────────────────────────────────────────
function StatTile({ icon: Icon, label, value, hint, accent = "#7dd3fc" }: {
  icon: (p: IconProps) => JSX.Element;
  label: string; value: string | number; hint?: string; accent?: string;
}) {
  return (
    <div style={{
      padding: "16px 18px", borderRadius: 14,
      background: "linear-gradient(180deg, rgba(15,23,42,0.7), rgba(11,18,36,0.7))",
      border: "1px solid rgba(51,65,85,0.5)",
      display: "flex", alignItems: "flex-start", gap: 14,
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 10, flexShrink: 0,
        display: "grid", placeItems: "center",
        background: `${accent}18`, border: `1px solid ${accent}30`,
      }}>
        <Icon size={17} color={accent} />
      </div>
      <div>
            <div style={{ color: "#38bdf8", fontSize: 12, letterSpacing: "0.12em", fontWeight: 700 }}>
          {label.toUpperCase()}
        </div>
        <div style={{
          color: "#e2e8f0", fontSize: 22, fontWeight: 800, lineHeight: 1.1, marginTop: 3,
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {value}
        </div>
        {hint && <div style={{ color: "#e2e8f0", fontSize: 11, marginTop: 3 }}>{hint}</div>}
      </div>
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({ children, style = {} }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      borderRadius: 20, padding: "24px 26px",
      background: "linear-gradient(180deg, #0b1224 0%, #0f172a 100%)",
      border: "1px solid rgba(125,211,252,0.10)",
      ...style,
    }}>
      {children}
    </div>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ color: "#7dd3fc", fontSize: 10, letterSpacing: "0.18em", fontWeight: 800, marginBottom: 5 }}>
        {eyebrow}
      </div>
      <div style={{ color: "#f1f5f9", fontSize: 20, fontWeight: 700 }}>{title}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
interface Props {
  dataset?: string;
  isFusionView?: boolean;
}

export function FusionPanel({ dataset = "", isFusionView = true }: Props) {
  const { summary, attackers, timeline, riskPoints, loading, error } = useFusionViewModel(dataset);

  const hasData =
    summary.available || timeline.length > 0 || attackers.length > 0 || riskPoints.length > 0;

  // ── Score ──────────────────────────────────────────────────────────────────
  const rawScore = summary.current_risk_score;
  const currentScore =
    typeof rawScore === "number" && Number.isFinite(rawScore)
      ? Math.max(0, Math.min(100, rawScore))
      : null;
  const level = currentScore !== null ? getRiskLevel(currentScore) : getRiskLevel(0);

  // ── Attacker pool ──────────────────────────────────────────────────────────
  const topPool: any[] = attackers.length > 0 ? attackers : summary.top_attackers ?? [];

  // ── Risk breakdown ─────────────────────────────────────────────────────────
  const riskBreakdown: Record<string, number> = useMemo(() => {
    if (summary.fusion?.risk_breakdown) return summary.fusion.risk_breakdown;
    const map: Record<string, number> = {};
    for (const att of topPool) {
      for (const ds of att.datasets || []) {
        map[ds] = Math.max(map[ds] || 0, att.risk_score ?? 0);
      }
    }
    return map;
  }, [summary, topPool]);

  // ── Timeline peak ──────────────────────────────────────────────────────────
  const peakPoint = useMemo(
    () => riskPoints.reduce(
      (best, e) => (!best || (e.risk_score ?? 0) > (best.risk_score ?? 0) ? e : best),
      null as (typeof riskPoints)[number] | null,
    ),
    [riskPoints],
  );

  // ── Activity trend ─────────────────────────────────────────────────────────
  const trend = useMemo(() => {
    if (riskPoints.length < 4) return "stable";
    const half = Math.floor(riskPoints.length / 2);
    const first = riskPoints.slice(0, half).reduce((s, p) => s + (p.risk_score ?? 0), 0) / half;
    const last  = riskPoints.slice(-half).reduce((s, p) => s + (p.risk_score ?? 0), 0) / half;
    const delta = last - first;
    if (delta > 5)  return "monte";
    if (delta < -5) return "descend";
    return "stable";
  }, [riskPoints]);

  const trendLabel: Record<string, string> = {
    monte: "↑ En hausse",
    descend: "↓ En baisse",
    stable: "→ Stable",
  };

  // ── Correlated IPs ─────────────────────────────────────────────────────────
  const correlatedCount = summary.correlated_attacker_count ?? 0;
  const recurrentCount  = summary.recurrent_attacker_count  ?? 0;

  // ─────────────────── EMPTY STATE ───────────────────────────────────────────
  if (!loading && !hasData) {
    return (
      <Section style={{ background: "linear-gradient(135deg, #0a1224 0%, #0f172a 100%)" }}>
        <div style={{ color: "#7dd3fc", fontSize: 10, fontWeight: 800, letterSpacing: "0.18em", marginBottom: 12 }}>
          VUE CONSOLIDÉE
        </div>
        <div style={{ color: "#f1f5f9", fontSize: 26, fontWeight: 800, marginBottom: 10 }}>
          Données indisponibles
        </div>
        <div style={{ color: "#64748b", fontSize: 14, lineHeight: 1.6, maxWidth: 600 }}>
          Aucun recoupement exploitable n'a été retourné pour les datasets sélectionnés.
          {isFusionView
            ? " Vérifiez que plusieurs datasets avec événements rejouables sont disponibles."
            : " Cette vue reste basée sur les datasets sélectionnés dans le scope courant."}
        </div>
        {error && <div style={{ color: "#475569", fontSize: 12, marginTop: 12 }}>{error}</div>}
      </Section>
    );
  }

  // ─────────────────── MAIN RENDER ───────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* ══════════════════ HERO ══════════════════ */}
      <div style={{
        borderRadius: 22, padding: "28px 30px",
        background: `radial-gradient(ellipse at 90% 0%, ${level.bg.replace("0.10", "0.15")}, transparent 55%),
                     linear-gradient(160deg, #0a1224 0%, #0f172a 100%)`,
        border: `1px solid ${level.border}`,
        boxShadow: `0 24px 60px -20px ${level.bg}`,
      }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 32,
          alignItems: "center",
        }}>
          {/* Left: text */}
          <div>
            {/* Pill badge */}
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "5px 13px", borderRadius: 99, marginBottom: 16,
              background: level.bg, border: `1px solid ${level.border}`,
              color: level.color, fontSize: 11, fontWeight: 800, letterSpacing: "0.1em",
            }}>
              <level.icon size={12} color={level.color} />
              VUE CONSOLIDÉE · {level.label.toUpperCase()}
            </div>

            <h1 style={{
              margin: "0 0 10px", fontSize: 32, fontWeight: 800, color: "#f1f5f9",
              letterSpacing: "-0.02em", lineHeight: 1.15,
            }}>
              Analyse globale des serveurs
              <span style={{ color: level.color }}>.</span>
            </h1>

            <p style={{ margin: "0 0 24px", color: "#64748b", fontSize: 15, lineHeight: 1.6 }}>
              {level.sublabel}
              {summary.attacker_count > 0 && (
                <> · <strong style={{ color: "#94a3b8" }}>{summary.attacker_count}</strong> sources détectées</>
              )}
              {correlatedCount > 0 && (
                <>, <strong style={{ color: level.color }}>{correlatedCount}</strong> agissent en réseau</>
              )}
            </p>

            {/* 3 key stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {[
                {
                  label: "Score de risque",
                  value: currentScore === null ? "N/A" : `${Math.round(currentScore)}/100`,
                  sub: level.sublabel,
                  icon: Icons.Alert,
                  accent: level.color,
                },
                {
                  label: "Sources actives",
                  value: summary.attacker_count ?? "—",
                  sub: correlatedCount > 0
                    ? `${correlatedCount} en réseau · ${recurrentCount} récurrentes`
                    : "Aucune corrélation détectée",
                  icon: Icons.Network,
                  accent: correlatedCount > 0 ? "#f87171" : "#7dd3fc",
                },
                {
                  label: "Tendance",
                  value: trendLabel[trend],
                  sub: peakPoint
                    ? `Pic à ${timeLabel(peakPoint.timestamp)} — score ${Math.round(peakPoint.risk_score ?? 0)}`
                    : "Historique insuffisant",
                  icon: Icons.TrendUp,
                  accent: trend === "monte" ? "#f87171" : trend === "descend" ? "#4ade80" : "#fbbf24",
                },
              ].map((card) => (
                <div key={card.label} style={{
                  borderRadius: 14, padding: "16px 18px",
                  background: "rgba(8,17,31,0.9)",
                  border: `1px solid ${card.accent}30`,
                  boxShadow: `inset 0 1px 0 rgba(255,255,255,0.03)`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
                    <card.icon size={12} color={card.accent} />
                    <span style={{ color: "#38bdf8", fontSize: 12, fontWeight: 700, letterSpacing: "0.12em" }}>
                      {card.label.toUpperCase()}
                    </span>
                  </div>
                  <div style={{
                    color: "#f1f5f9", fontSize: card.label === "Tendance" ? 16 : 26,
                    fontWeight: 800, lineHeight: 1.1, fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: "-0.02em",
                  }}>
                    {card.value}
                  </div>
                  <div style={{ color: "#e2e8f0", fontSize: 11, marginTop: 6, lineHeight: 1.4 }}>
                    {card.sub}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: gauge */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <RiskGauge score={currentScore ?? 0} />
          </div>
        </div>
      </div>

      {/* ══════════════════ RISQUE PAR SERVEUR ══════════════════ */}
      {Object.keys(riskBreakdown).length > 0 && (
        <Section>
          <SectionTitle eyebrow="RÉPARTITION" title="Risque par serveur" />
          <DatasetRiskBars breakdown={riskBreakdown} />
        </Section>
      )}

      {/* ══════════════════ CHRONOLOGIE ══════════════════ */}
      {riskPoints.length > 0 && (
        <Section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20 }}>
            <SectionTitle eyebrow="CHRONOLOGIE" title="Évolution du niveau de risque" />
            {peakPoint && (
              <div style={{ textAlign: "right", paddingBottom: 4 }}>
                <div style={{ color: "#cbd5e1", fontSize: 10, letterSpacing: "0.12em" }}>PIC DÉTECTÉ</div>
                <div style={{ color: "#e2e8f0", fontSize: 16, fontWeight: 700, fontFamily: "monospace" }}>
                  {timeLabel(peakPoint.timestamp)}
                <span style={{ color: "#cbd5e1", fontSize: 12, marginLeft: 6 }}>
                    score {Math.round(peakPoint.risk_score ?? 0)}
                  </span>
                </div>
              </div>
            )}
          </div>

          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={riskPoints} margin={{ top: 8, right: 6, left: -22, bottom: 0 }}>
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={level.band} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={level.band} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 6" stroke="rgba(148,163,184,0.07)" vertical={false} />
              <ReferenceLine y={70} stroke="rgba(248,113,113,0.3)" strokeDasharray="4 4" />
              <ReferenceLine y={40} stroke="rgba(251,191,36,0.25)" strokeDasharray="4 4" />
              <XAxis dataKey="timestamp" tickFormatter={timeLabel}
                tick={{ fill: "#cbd5e1", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: "#cbd5e1", fontSize: 10 }}
                axisLine={false} tickLine={false} />
              <RechartsTooltip
                contentStyle={{
                  background: "rgba(8,17,31,0.95)",
                  border: "1px solid rgba(125,211,252,0.2)",
                  borderRadius: 10, color: "#e2e8f0",
                }}
                labelFormatter={(l: any) => timeLabel(String(l))}
                formatter={(v: number, k: string) => [
                  k === "risk_score" ? `${Math.round(v)} / 100` : v,
                  k === "risk_score" ? "Score" : "Événements",
                ]}
              />
              <Area type="monotone" dataKey="risk_score" stroke={level.band} strokeWidth={2.5}
                fill="url(#areaGrad)" dot={false} activeDot={{ r: 4, fill: level.band }} />
            </AreaChart>
          </ResponsiveContainer>

          {/* Legend */}
          <div style={{ display: "flex", gap: 18, marginTop: 12 }}>
            {[
              { color: "rgba(248,113,113,0.5)", label: "Critique" },
              { color: "rgba(251,191,36,0.5)",  label: "Élevé" },
            ].map((item) => (
              <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 24, height: 2, background: item.color, borderRadius: 1 }} />
                <span style={{ color: "#cbd5e1", fontSize: 10 }}>{item.label}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ══════════════════ SOURCES D'ATTAQUE ══════════════════ */}
      {topPool.length > 0 && (
        <Section>
          <SectionTitle eyebrow="SOURCES" title="Attaquants détectés" />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {topPool.slice(0, 8).map((att, i) => (
              <AttackerCard key={att.ip} att={att} rank={i + 1} />
            ))}
          </div>
        </Section>
      )}

      {/* ══════════════════ STATS OPÉRATIONNELLES ══════════════════ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <StatTile
          icon={Icons.Zap}
          label="Événements analysés"
          value={(summary.source_events?.replayed_event_count ?? 0).toLocaleString("fr-FR")}
          hint="Passés par le moteur de détection"
          accent="#addef5"
        />
        <StatTile
          icon={Icons.Filter}
          label="Incidents retenus"
          value={(summary.source_events?.deduped_alert_event_count ?? 0).toLocaleString("fr-FR")}
          hint="Après déduplication"
          accent="#4ade80"
        />
        <StatTile
          icon={Icons.Activity}
          label="Bruit filtré"
          value={(summary.source_events?.deduped_duplicate_alerts ?? 0).toLocaleString("fr-FR")}
          hint="Alertes répétitives écartées"
          accent="#94a3b8"
        />
      </div>

      {/* Status bar */}
      {(error || loading) && (
        <div style={{ color: "#475569", fontSize: 11, textAlign: "right" }}>
          {loading && "Chargement en cours…"}
          {error && !loading && `Source partielle : ${error}`}
        </div>
      )}
    </div>
  );
}
