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
} from "recharts";
import { useFusionViewModel } from "../../hooks/useFusionViewModel";

type IconProps = {
  size?: number;
  color?: string;
};

function BaseIcon({
  size = 16,
  color = "currentColor",
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function Activity({ size, color }: IconProps) {
  return (
    <BaseIcon size={size} color={color}>
      <path d="M3 12h4l3-7 4 14 3-7h4" />
    </BaseIcon>
  );
}

function AlertTriangle({ size, color }: IconProps) {
  return (
    <BaseIcon size={size} color={color}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </BaseIcon>
  );
}

function Shield({ size, color }: IconProps) {
  return (
    <BaseIcon size={size} color={color}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    </BaseIcon>
  );
}

function TrendingUp({ size, color }: IconProps) {
  return (
    <BaseIcon size={size} color={color}>
      <path d="M22 7 13.5 15.5l-5-5L2 17" />
      <path d="M16 7h6v6" />
    </BaseIcon>
  );
}

function Waves({ size, color }: IconProps) {
  return (
    <BaseIcon size={size} color={color}>
      <path d="M2 6c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2" />
      <path d="M2 12c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2" />
      <path d="M2 18c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2" />
    </BaseIcon>
  );
}

function Zap({ size, color }: IconProps) {
  return (
    <BaseIcon size={size} color={color}>
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
    </BaseIcon>
  );
}

function stripMotionProps<T extends Record<string, unknown>>(props: T) {
  const {
    initial,
    animate,
    transition,
    whileHover,
    ...rest
  } = props;
  void initial;
  void animate;
  void transition;
  void whileHover;
  return rest;
}

function createMotionTag(tag: string) {
  return function MotionTag(props: Record<string, unknown>) {
    return createElement(tag, stripMotionProps(props));
  };
}

const motion = {
  circle: createMotionTag("circle"),
  div: createMotionTag("div"),
  h1: createMotionTag("h1"),
  p: createMotionTag("p"),
  section: createMotionTag("section"),
};

const RechartsTooltip = Tooltip as any;

// ---------- helpers ----------
const getRiskState = (score: number) => {
  if (score >= 70)
    return {
      label: "Tempête",
      tone: "Activité hostile soutenue",
      color: "#ff5d73",
      soft: "rgba(255,93,115,0.18)",
      ring: "rgba(255,93,115,0.45)",
      icon: AlertTriangle,
    };
  if (score >= 40)
    return {
      label: "Agité",
      tone: "Quelques signaux à surveiller",
      color: "#f6c445",
      soft: "rgba(246,196,69,0.16)",
      ring: "rgba(246,196,69,0.4)",
      icon: Activity,
    };
  return {
    label: "Calme",
    tone: "Aucune menace marquée",
    color: "#4ade80",
    soft: "rgba(74,222,128,0.16)",
    ring: "rgba(74,222,128,0.4)",
    icon: Shield,
  };
};

const timeLabel = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
};

const formatBehavior = (value?: string) => {
  if (!value) return "Activité diverse";
  const [, behavior] = value.split("|");
  const txt = (behavior || value).replace(/_/g, " ");
  return txt.charAt(0).toUpperCase() + txt.slice(1);
};

// ---------- circular gauge ----------
function RiskGauge({ score, color }: { score: number; color: string }) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = 92;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (clamped / 100) * circ;

  return (
    <div style={{ position: "relative", width: 220, height: 220 }}>
      <svg width="220" height="220" style={{ transform: "rotate(-90deg)" }}>
        <defs>
          <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color} />
            <stop offset="100%" stopColor="#7dd3fc" />
          </linearGradient>
        </defs>
        <circle
          cx="110"
          cy="110"
          r={radius}
          fill="none"
          stroke="rgba(148,163,184,0.12)"
          strokeWidth="14"
        />
        <motion.circle
          cx="110"
          cy="110"
          r={radius}
          fill="none"
          stroke="url(#gaugeGrad)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.4, ease: "easeOut" }}
          style={{ filter: `drop-shadow(0 0 12px ${color})` }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.6 }}
          style={{
            fontSize: 64,
            fontWeight: 900,
            color,
            lineHeight: 1,
            fontFamily: "'JetBrains Mono', monospace",
            textShadow: `0 0 24px ${color}55`,
          }}
        >
          {Math.round(clamped)}
        </motion.div>
        <div style={{ color: "#64748b", fontSize: 11, marginTop: 6, letterSpacing: "0.18em" }}>
          SUR 100
        </div>
      </div>
    </div>
  );
}

// ---------- main ----------
interface Props {
  dataset?: string;
  isFusionView?: boolean;
}

export function FusionPanel({ dataset = "", isFusionView = true }: Props) {
  const { summary, attackers, timeline, riskPoints, loading, error } = useFusionViewModel(dataset);
  const hasRealFusionData =
    summary.available || timeline.length > 0 || attackers.length > 0 || riskPoints.length > 0;
  const riskState = getRiskState(summary.current_risk_score);
  const RiskIcon = riskState.icon;
  const latestCluster = timeline[timeline.length - 1] ?? null;
  const peakCluster = useMemo(
    () =>
      timeline.reduce(
        (best, e) => (!best || e.risk_score > best.risk_score ? e : best),
        null as (typeof timeline)[number] | null,
      ),
    [timeline],
  );
  const totalRisk = attackers.reduce((s, a) => s + a.risk_score, 0) || 1;
  const top3 = attackers.slice(0, 3);
  const rest = attackers.slice(3, 6);
  const displayHeadline = latestCluster
    ? `${formatBehavior(latestCluster.dominant_behaviors[0]?.behavior)} en cours`
    : hasRealFusionData
      ? "Aucune activite notable"
      : "Flux fusion indisponible";

  if (!loading && !hasRealFusionData) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <section
          style={{
            borderRadius: 28,
            padding: "32px 36px",
            border: "1px solid rgba(148,163,184,0.2)",
            background: "linear-gradient(135deg, #0a1224 0%, #0f172a 100%)",
          }}
        >
          <div style={{ color: "#7dd3fc", fontSize: 11, fontWeight: 800, letterSpacing: "0.18em", marginBottom: 14 }}>
            FUSION DATASET SCOPE
          </div>
          <div style={{ color: "#f1f5f9", fontSize: 28, fontWeight: 800, lineHeight: 1.15 }}>
            Donnees fusion indisponibles.
          </div>
          <div style={{ color: "#94a3b8", fontSize: 15, lineHeight: 1.6, marginTop: 12, maxWidth: 720 }}>
            Aucun recoupement exploitable n'a ete retourne pour les datasets selectionnes.
            {isFusionView
              ? " Verifiez que plusieurs datasets avec evenements rejouables sont bien disponibles."
              : " Cette vue reste basee sur les datasets selectionnes dans le scope courant."}
          </div>
          {error && (
            <div style={{ color: "#64748b", fontSize: 12, marginTop: 16 }}>
              {error}
            </div>
          )}
        </section>
      </div>
    );
  }

  // Plain-language headline
  const headline = latestCluster
    ? `${formatBehavior(latestCluster.dominant_behaviors[0]?.behavior)} en cours`
    : "Aucune activité notable";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ====================== HERO ====================== */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 28,
          padding: "32px 36px",
          border: `1px solid ${riskState.ring}`,
          background: `radial-gradient(circle at 85% 20%, ${riskState.soft}, transparent 55%), linear-gradient(135deg, #0a1224 0%, #0f172a 100%)`,
          boxShadow: `0 30px 80px -20px ${riskState.soft}, inset 0 1px 0 rgba(255,255,255,0.04)`,
        }}
      >
        {/* animated aurora */}
        <motion.div
          aria-hidden
          animate={{ opacity: [0.35, 0.6, 0.35] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          style={{
            position: "absolute",
            top: -120,
            right: -120,
            width: 420,
            height: 420,
            background: `radial-gradient(circle, ${riskState.color}33, transparent 60%)`,
            filter: "blur(40px)",
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 32,
            alignItems: "center",
            position: "relative",
          }}
        >
          <div>
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 14px",
                borderRadius: 999,
                background: riskState.soft,
                border: `1px solid ${riskState.ring}`,
                color: riskState.color,
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.18em",
                marginBottom: 18,
              }}
            >
              <RiskIcon size={13} />
              ÉTAT DU RÉSEAU · {riskState.label.toUpperCase()}
            </motion.div>

            <motion.h1
              title={headline}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.5 }}
              style={{
                margin: 0,
                fontSize: 38,
                lineHeight: 1.15,
                fontWeight: 800,
                color: "#f1f5f9",
                letterSpacing: "-0.02em",
              }}
            >
              {displayHeadline}
              <span style={{ color: riskState.color }}>.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.5 }}
              style={{
                margin: "12px 0 0",
                color: "#94a3b8",
                fontSize: 16,
                maxWidth: 520,
                lineHeight: 1.55,
              }}
            >
              {riskState.tone}. {summary.attacker_count} sources observées,{" "}
              {summary.correlated_attacker_count} agissent en réseau.
            </motion.p>

            <div style={{ display: "flex", gap: 28, marginTop: 28 }}>
              {[
                { label: "Sources", value: summary.attacker_count, icon: Activity },
                { label: "Pic du jour", value: Math.round(summary.peak_risk_score), icon: TrendingUp },
                { label: "Vagues", value: summary.cluster_count, icon: Waves },
              ].map((m, i) => (
                <motion.div
                  key={m.label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 + i * 0.08 }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#64748b", fontSize: 11, letterSpacing: "0.14em" }}>
                    <m.icon size={12} />
                    {m.label.toUpperCase()}
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: "#e2e8f0", marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                    {m.value}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          <RiskGauge score={summary.current_risk_score} color={riskState.color} />
        </div>
      </motion.section>

      {/* ====================== TIMELINE STORY ====================== */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1 }}
        style={{
          borderRadius: 24,
          padding: 28,
          background: "linear-gradient(180deg, #0b1224 0%, #0f172a 100%)",
          border: "1px solid rgba(125,211,252,0.12)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20 }}>
          <div>
            <div style={{ color: "#7dd3fc", fontSize: 11, letterSpacing: "0.18em", fontWeight: 800, marginBottom: 6 }}>
              DERNIÈRES HEURES
            </div>
            <div style={{ color: "#f1f5f9", fontSize: 22, fontWeight: 700 }}>
              L'activité {summary.current_risk_score > summary.average_risk_score ? "monte" : "redescend"}
            </div>
          </div>
          {peakCluster && (
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "#64748b", fontSize: 11, letterSpacing: "0.14em" }}>PIC À</div>
              <div style={{ color: "#e2e8f0", fontSize: 18, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                {timeLabel(peakCluster.window_end)}
              </div>
            </div>
          )}
        </div>

        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={riskPoints} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="riskArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={riskState.color} stopOpacity={0.5} />
                <stop offset="100%" stopColor={riskState.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 6" stroke="rgba(148,163,184,0.08)" vertical={false} />
            <XAxis dataKey="timestamp" tickFormatter={timeLabel} tick={{ fill: "#475569", fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} tick={{ fill: "#475569", fontSize: 10 }} axisLine={false} tickLine={false} />
            <RechartsTooltip
              contentStyle={{
                background: "rgba(8,17,31,0.95)",
                border: "1px solid rgba(125,211,252,0.25)",
                borderRadius: 12,
                color: "#dbeafe",
              }}
              labelFormatter={(l: any) => timeLabel(String(l))}
              formatter={(v: number, k) => [k === "risk_score" ? `${Math.round(v)}/100` : v, k === "risk_score" ? "Niveau" : "Évén."]}
            />
            <Area
              type="monotone"
              dataKey="risk_score"
              stroke={riskState.color}
              strokeWidth={3}
              fill="url(#riskArea)"
              animationDuration={1500}
            />
          </AreaChart>
        </ResponsiveContainer>
      </motion.section>

      {/* ====================== TOP SOURCES — PODIUM ====================== */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        style={{
          borderRadius: 24,
          padding: 28,
          background: "linear-gradient(180deg, #0b1224 0%, #0f172a 100%)",
          border: "1px solid rgba(125,211,252,0.12)",
        }}
      >
        <div style={{ marginBottom: 24 }}>
          <div style={{ color: "#7dd3fc", fontSize: 11, letterSpacing: "0.18em", fontWeight: 800, marginBottom: 6 }}>
            QUI EST DERRIÈRE
          </div>
          <div style={{ color: "#f1f5f9", fontSize: 22, fontWeight: 700 }}>
            Les sources les plus actives
          </div>
        </div>

        {/* podium */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: rest.length ? 18 : 0 }}>
          {top3.map((a, i) => {
            const state = getRiskState(a.risk_score);
            const share = Math.round((a.risk_score / totalRisk) * 100);
            const medals = ["🥇", "🥈", "🥉"];
            return (
              <motion.div
                key={a.ip}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.1, duration: 0.5 }}
                whileHover={{ y: -4, transition: { duration: 0.2 } }}
                style={{
                  position: "relative",
                  padding: "20px 18px",
                  borderRadius: 18,
                  background: `radial-gradient(circle at 50% 0%, ${state.soft}, transparent 70%), rgba(15,23,42,0.7)`,
                  border: `1px solid ${state.ring}`,
                  boxShadow: i === 0 ? `0 12px 40px -12px ${state.soft}` : undefined,
                  overflow: "hidden",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                  <div style={{ fontSize: 28 }}>{medals[i]}</div>
                  <div
                    style={{
                      color: state.color,
                      fontSize: 24,
                      fontWeight: 900,
                      fontFamily: "'JetBrains Mono', monospace",
                      textShadow: `0 0 12px ${state.color}55`,
                    }}
                  >
                    {Math.round(a.risk_score)}
                  </div>
                </div>
                <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>
                  {a.ip}
                </div>
                <div style={{ color: "#64748b", fontSize: 11, marginBottom: 12 }}>
                  {a.event_count} actions · {a.dataset_count} sources
                </div>
                <div style={{ height: 6, borderRadius: 999, background: "rgba(148,163,184,0.1)", overflow: "hidden" }}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(8, share)}%` }}
                    transition={{ delay: 0.5 + i * 0.1, duration: 0.8, ease: "easeOut" }}
                    style={{ height: "100%", background: `linear-gradient(90deg, ${state.color}, #7dd3fc)` }}
                  />
                </div>
                <div style={{ color: "#94a3b8", fontSize: 10, marginTop: 6 }}>
                  {share}% du risque global
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* rest as compact rows */}
        {rest.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rest.map((a, i) => {
              const state = getRiskState(a.risk_score);
              return (
                <motion.div
                  key={a.ip}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.6 + i * 0.05 }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "40px 1fr auto",
                    alignItems: "center",
                    gap: 14,
                    padding: "12px 16px",
                    borderRadius: 14,
                    background: "rgba(15,23,42,0.5)",
                    border: "1px solid rgba(51,65,85,0.5)",
                  }}
                >
                  <div style={{ color: "#475569", fontWeight: 800, fontFamily: "'JetBrains Mono', monospace" }}>
                    #{i + 4}
                  </div>
                  <div>
                    <div style={{ color: "#cbd5e1", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>{a.ip}</div>
                    <div style={{ color: "#64748b", fontSize: 11 }}>{a.event_count} actions</div>
                  </div>
                  <div
                    style={{
                      color: state.color,
                      background: state.soft,
                      border: `1px solid ${state.ring}`,
                      padding: "4px 10px",
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 800,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {Math.round(a.risk_score)}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </motion.section>

      {/* ====================== FOOTER — what was filtered ====================== */}
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 14,
        }}
      >
        {[
          {
            icon: Zap,
            label: "Évén. analysés",
            value: summary.source_events.replayed_event_count.toLocaleString("fr-FR"),
            hint: "tout ce qui est passé par le moteur",
          },
          {
            icon: Shield,
            label: "Incidents retenus",
            value: summary.source_events.deduped_alert_event_count.toLocaleString("fr-FR"),
            hint: "doublons écartés",
          },
          {
            icon: Activity,
            label: "Bruit filtré",
            value: summary.source_events.deduped_duplicate_alerts.toLocaleString("fr-FR"),
            hint: "ignoré comme répétitif",
          },
        ].map((m, i) => (
          <motion.div
            key={m.label}
            whileHover={{ y: -2 }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 + i * 0.08 }}
            style={{
              padding: "18px 20px",
              borderRadius: 16,
              background: "linear-gradient(180deg, rgba(15,23,42,0.7), rgba(11,18,36,0.7))",
              border: "1px solid rgba(51,65,85,0.6)",
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                display: "grid",
                placeItems: "center",
                background: "rgba(125,211,252,0.1)",
                color: "#7dd3fc",
              }}
            >
              <m.icon size={20} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ color: "#64748b", fontSize: 10, letterSpacing: "0.14em" }}>
                {m.label.toUpperCase()}
              </div>
              <div style={{ color: "#e2e8f0", fontSize: 22, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.1, marginTop: 2 }}>
                {m.value}
              </div>
              <div style={{ color: "#475569", fontSize: 10, marginTop: 2 }}>{m.hint}</div>
            </div>
          </motion.div>
        ))}
      </motion.section>

      {error && (
        <div style={{ color: "#94a3b8", fontSize: 12, textAlign: "right" }}>Source partielle : {error}</div>
      )}
      {loading && (
        <div style={{ color: "#64748b", fontSize: 12, textAlign: "right" }}>Chargement…</div>
      )}
    </div>
  );
}
