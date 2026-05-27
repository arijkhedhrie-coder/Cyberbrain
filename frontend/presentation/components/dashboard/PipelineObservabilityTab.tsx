import { useMemo } from "react";
import type { CSSProperties } from "react";

import type {
  AlarmItem,
  ExplainabilityData,
  KpiData,
  PipelineLatest,
  ThresholdHistoryEntry,
  TrustData,
} from "../../../shared/types/idps";

type PipelineObservabilityTabProps = {
  alarms: AlarmItem[];
  explainability: ExplainabilityData | null;
  kpis: KpiData | null;
  pipeline: PipelineLatest | null;
  thresholdHistory: ThresholdHistoryEntry[];
  trust: TrustData | null;
};

type PipelineEvent = Record<string, unknown> & {
  alarm_delta?: number;
  attack_pattern?: string;
  event_type?: string;
  reasoning_excerpt?: string;
  rerun_engines?: string[];
  timestamp?: string;
};

/* ── Palette (Aurora Noir, lifted from globall.css) ───────────────────── */
const C = {
  surface: "rgba(20,24,38,0.72)",
  surfaceSoft: "rgba(20,24,38,0.45)",
  surfaceDeep: "rgba(10,12,20,0.6)",
  border: "rgba(148,163,184,0.14)",
  borderSoft: "rgba(148,163,184,0.08)",
  text: "#eef0fa",
  textDim: "#cbd5e1",
  muted: "#94a3b8",
  mutedDeep: "#64748b",
  purple: "#a78bfa",
  cyan: "#22d3ee",
  green: "#34d399",
  red: "#f43f5e",
  amber: "#fbbf24",
  blue: "#60a5fa",
};

/* ── Base styles ──────────────────────────────────────────────────────── */
const shell: CSSProperties = { display: "grid", gap: 24 };

const section: CSSProperties = {
  padding: "32px 28px",
  borderRadius: 24,
  border: `1px solid ${C.border}`,
  background:
    "linear-gradient(180deg, rgba(20,24,38,0.78), rgba(10,12,20,0.55))",
  boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
};

const sectionHeader: CSSProperties = {
  display: "grid",
  gap: 6,
  textAlign: "center",
  marginBottom: 24,
};

const sectionTitle: CSSProperties = {
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
  fontSize: 22,
  fontWeight: 700,
  color: C.text,
  letterSpacing: "-0.01em",
};

const sectionSubtitle: CSSProperties = {
  fontSize: 13,
  color: C.muted,
  lineHeight: 1.5,
};

const pill = (color: string, bg: string): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 14px",
  borderRadius: 999,
  fontSize: 11,
  letterSpacing: "0.06em",
  fontWeight: 600,
  textTransform: "uppercase",
  color,
  background: bg,
  border: `1px solid ${color}40`,
  fontFamily: "'JetBrains Mono', monospace",
});

const statCard: CSSProperties = {
  padding: "20px 18px",
  borderRadius: 18,
  border: `1px solid ${C.borderSoft}`,
  background: C.surfaceSoft,
  display: "grid",
  gap: 10,
  textAlign: "center",
  minHeight: 140,
  alignContent: "center",
};

const statLabel: CSSProperties = {
  fontSize: 11,
  color: C.muted,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontWeight: 500,
};

const statValue = (color: string): CSSProperties => ({
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
  fontSize: 38,
  fontWeight: 700,
  color,
  lineHeight: 1,
  letterSpacing: "-0.02em",
});

const statHint: CSSProperties = {
  fontSize: 11,
  color: C.mutedDeep,
  lineHeight: 1.45,
};

/* ── Helpers (unchanged backend logic) ────────────────────────────────── */
function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return `${(value * 100).toFixed(digits)}%`;
}
function formatNullable(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return value.toFixed(digits);
}
function formatTime(value: unknown): string {
  if (typeof value !== "string" || !value) return "N/A";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString([], {
    month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}
function capitalize(v: string) { return v ? v.charAt(0).toUpperCase() + v.slice(1) : v; }
function humanizeEngine(e: string | null | undefined): string {
  const n = String(e ?? "").trim().toUpperCase();
  return ({ FTP: "FTP", KERNEL: "Kernel", SESSION: "Session", SSH: "SSH", WEB: "WEB" } as Record<string,string>)[n] ?? (n || "Moteur");
}
function humanizeConfidence(l: string | null | undefined) {
  const n = String(l ?? "").trim().toUpperCase();
  if (n === "TRUSTWORTHY") return "elevee";
  if (n === "ACCEPTABLE") return "correcte";
  if (n === "UNCERTAIN") return "a surveiller";
  if (n === "LOW") return "faible";
  if (!n || n === "N/A") return "indisponible";
  return capitalize(n.toLowerCase());
}
function humanizeDrift(l: string | null | undefined) {
  const n = String(l ?? "").trim().toUpperCase();
  if (n === "STABLE") return "stable";
  if (n === "SHIFTING") return "leger";
  if (n === "DRIFTING") return "detecte";
  if (!n || n === "N/A") return "indisponible";
  return capitalize(n.toLowerCase());
}
function humanizeStability(l: string | null | undefined) {
  const n = String(l ?? "").trim().toUpperCase();
  if (n === "HIGH") return "tres stable";
  if (n === "MEDIUM") return "stable";
  if (n === "LOW") return "variable";
  if (!n || n === "N/A") return "indisponible";
  return capitalize(n.toLowerCase());
}
function humanizeAgreement(l: string | null | undefined, v: number | null | undefined) {
  const n = String(l ?? "").trim().toUpperCase();
  if (n.includes("HIGH") || n.includes("STRONG")) return "eleve";
  if (n.includes("MEDIUM") || n.includes("MODERATE")) return "correct";
  if (n.includes("LOW") || n.includes("WEAK")) return "fragile";
  if (v !== null && v !== undefined) {
    if (v >= 0.8) return "eleve";
    if (v >= 0.6) return "correct";
    return "fragile";
  }
  return "indisponible";
}
function humanizeDecisionAction(a: string | null | undefined) {
  const n = String(a ?? "").trim().toLowerCase();
  if (!n || n === "n/a") return "Decision indisponible.";
  if (n.includes("skipped")) return "Aucun ajustement supplementaire n'etait necessaire.";
  if (n.includes("dynamic configuration")) return "Correction appliquee pour reduire le bruit.";
  if (n.includes("coordination completed")) return "Cycle automatique mene jusqu'au bout.";
  return capitalize(String(a ?? ""));
}
function humanizeDecisionShort(a: string | null | undefined) {
  const n = String(a ?? "").trim().toLowerCase();
  if (!n || n === "n/a") return "Decision indisponible";
  if (n.includes("skipped")) return "Ajustement non necessaire";
  if (n.includes("dynamic configuration")) return "Correction appliquee";
  if (n.includes("coordination completed")) return "Cycle termine";
  return capitalize(String(a ?? ""));
}
function humanizeAlarmNarrative(topAlarm: ExplainabilityData["top_alarm"], thresholdContext: ExplainabilityData["threshold_context"]) {
  if (!topAlarm) return "Signal principal indisponible.";
  const engine = humanizeEngine(topAlarm.engine);
  if (thresholdContext && thresholdContext.pass1 !== undefined && thresholdContext.pass2 !== undefined) {
    return `Signal principal : ${engine}`;
  }
  return `Signal principal : ${engine}`;
}
function describePattern(p: string | null | undefined): { detail: string; label: string; tone: string } {
  const n = String(p ?? "").trim().toLowerCase();
  if (n === "concentrated_attacker") return { detail: "Pression concentree sur peu de sources.", label: "Attaque concentree", tone: C.amber };
  if (n === "distributed_botnet") return { detail: "Plusieurs sources actives en parallele.", label: "Attaque distribuee", tone: C.blue };
  if (n) return { detail: "Repartition detectee sans detail supplementaire.", label: n.replace(/_/g, " "), tone: C.muted };
  return { detail: "Type d'attaque non disponible.", label: "Type indisponible", tone: C.muted };
}
function buildTopSources(alarms: AlarmItem[]) {
  const grouped = new Map<string, { count: number; engines: Set<string>; severities: Set<string> }>();
  for (const alarm of alarms) {
    const ip = String(alarm.source_ip ?? "").trim();
    if (!ip || ip === "unknown") continue;
    const entry = grouped.get(ip) ?? { count: 0, engines: new Set<string>(), severities: new Set<string>() };
    entry.count += 1;
    if (alarm.engine) entry.engines.add(String(alarm.engine));
    if (alarm.severity) entry.severities.add(String(alarm.severity));
    grouped.set(ip, entry);
  }
  return Array.from(grouped.entries())
    .map(([ip, info]) => ({ count: info.count, engines: Array.from(info.engines), ip, severities: Array.from(info.severities) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}
function getLatestEvent(events: PipelineEvent[], eventType: string): PipelineEvent | null {
  for (let i = events.length - 1; i >= 0; i -= 1) if (events[i]?.event_type === eventType) return events[i];
  return null;
}

/* ── Component ────────────────────────────────────────────────────────── */
export function PipelineObservabilityTab({
  alarms, explainability, kpis, pipeline, thresholdHistory, trust,
}: PipelineObservabilityTabProps) {
  const latestThreshold = thresholdHistory.length > 0 ? thresholdHistory[thresholdHistory.length - 1] : null;
  const changedEngines = latestThreshold?.changed_engines ?? [];
  const changedSessions = thresholdHistory.filter((e) => e.changed_engines.length > 0).length;
  const pipelineEvents = (pipeline?.events ?? []) as PipelineEvent[];
  const dynamicConfigEvent = getLatestEvent(pipelineEvents, "DYNAMIC_CONFIG_ISSUED");
  const sessionSummaryEvent = getLatestEvent(pipelineEvents, "SESSION_SUMMARY");
  const topSources = useMemo(() => buildTopSources(alarms), [alarms]);
  const pattern = describePattern(kpis?.attack_pattern);
  const topAlarm = explainability?.top_alarm ?? null;
  const thresholdContext = explainability?.threshold_context ?? null;
  const latestDecision = explainability?.latest_decision ?? null;
  const primaryEngine = changedEngines[0] ?? thresholdContext?.engine ?? topAlarm?.engine ?? "SSH";
  const primaryShift = latestThreshold?.engines[primaryEngine];
  const alertReductionPct =
    latestThreshold && latestThreshold.nb_alarms_pass1 > 0
      ? ((latestThreshold.nb_alarms_pass1 - latestThreshold.nb_alarms_final) / latestThreshold.nb_alarms_pass1) * 100
      : null;
  const primaryNarrative = humanizeAlarmNarrative(topAlarm, thresholdContext);
  const currentObservationTime = sessionSummaryEvent?.timestamp ?? latestDecision?.timestamp ?? dynamicConfigEvent?.timestamp;

  /* ═══════════════ SECTION 1 — Cards (system reaction) ═══════════════ */
  const systemCards = [
    {
      label: "Seuil ajuste",
      value:
        primaryShift && primaryShift.pass1 !== null && primaryShift.pass2 !== null
          ? `${formatNullable(primaryShift.pass1, 0)} → ${formatNullable(primaryShift.pass2, 0)}`
          : "N/A",
      tone: C.purple,
      hint: "dernier ajustement detecte",
    },
    {
      label: "Passages ajustes",
      value: String(changedSessions),
      tone: C.cyan,
      hint: "observes recemment",
    },
    {
      label: "Reduction alertes",
      value:
        latestThreshold && alertReductionPct !== null
          ? `${alertReductionPct >= 0 ? "−" : "+"}${Math.abs(alertReductionPct).toFixed(0)}%`
          : "N/A",
      tone: alertReductionPct !== null && alertReductionPct > 0 ? C.green : C.text,
      hint: "apres ajustement",
    },
    {
      label: "Derniere reaction",
      value: latestThreshold && currentObservationTime ? formatTime(currentObservationTime) : "En attente",
      tone: C.text,
      hint: "derniere observation",
    },
  ];

  /* ═══════════════ SECTION 2 — Narrative + trust meters ═══════════════ */
  const trustMeters = [
    { label: "Confiance", value: trust?.confidence_in_metrics ?? explainability?.model_context.trust_score ?? null, text: humanizeConfidence(trust?.confidence_label ?? explainability?.model_context.trust_label), tone: C.green },
    { label: "Accord modeles", value: trust?.model_agreement ?? explainability?.model_context.agreement ?? null, text: humanizeAgreement(explainability?.model_context.agreement_label, trust?.model_agreement ?? explainability?.model_context.agreement), tone: C.cyan },
    { label: "Drift", value: trust?.drift_score ?? null, text: humanizeDrift(trust?.drift_label ?? explainability?.model_context.drift_label), tone: C.purple, raw: true },
    { label: "Stabilite", value: null, text: humanizeStability(trust?.stability ?? explainability?.model_context.stability), tone: C.amber, textOnly: true },
  ];

  return (
    <div style={shell}>
      {/* ════════════════════ HERO STATUS BANNER ════════════════════ */}
      <div
        style={{
          padding: "24px 28px",
          borderRadius: 20,
          border: `1px solid ${C.red}40`,
          background: `linear-gradient(135deg, ${C.red}18, ${C.red}06)`,
          display: "grid",
          gap: 8,
          textAlign: "center",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", gap: 10, alignItems: "center" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.red, boxShadow: `0 0 12px ${C.red}` }} />
          <span style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: C.red, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
            Explainable AI · {latestDecision ? humanizeDecisionShort(latestDecision.action) : "Surveillance active"}
          </span>
        </div>
        <div style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontSize: 24, fontWeight: 700, color: C.text, lineHeight: 1.2 }}>
          {primaryNarrative}
        </div>
        <div style={{ fontSize: 13, color: C.muted }}>
          {latestDecision ? humanizeDecisionAction(latestDecision.action) : "Lecture live des seuils et des modeles."}
        </div>
      </div>

      {/* ════════════════════ SECTION 1 ════════════════════ */}
      <section style={section}>
        <header style={sectionHeader}>
          <div style={sectionTitle}>Le systeme a-t-il bien reagi ?</div>
          <div style={sectionSubtitle}>Les chiffres cles de l'ajustement le plus recent.</div>
        </header>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
          {systemCards.map((c) => (
            <div key={c.label} style={statCard}>
              <div style={statLabel}>{c.label}</div>
              <div style={statValue(c.tone)}>{c.value}</div>
              <div style={statHint}>{c.hint}</div>
            </div>
          ))}
        </div>
        {!latestThreshold && (
          <div style={{ ...sectionSubtitle, textAlign: "center", marginTop: 18 }}>
            Aucun ajustement exploitable n'est encore disponible pour cette source.
          </div>
        )}
      </section>

      {/* ════════════════════ SECTION 2 — Decision story ════════════════════ */}
      <section style={section}>
        <header style={sectionHeader}>
          <div style={sectionTitle}>Pourquoi cette decision</div>
          <div style={sectionSubtitle}>Le signal principal et l'etat des modeles.</div>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(280px, 1fr)", gap: 18 }}>
          {/* Narrative panel */}
          <div
            style={{
              padding: 24,
              borderRadius: 20,
              border: `1px solid ${C.purple}30`,
              background: `linear-gradient(160deg, ${C.purple}12, ${C.surfaceDeep})`,
              display: "grid",
              gap: 18,
              alignContent: "start",
            }}
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {topAlarm && <span style={pill(C.cyan, `${C.cyan}14`)}>{humanizeEngine(topAlarm.engine)}</span>}
              {topAlarm && <span style={pill(C.red, `${C.red}14`)}>Score {topAlarm.score.toFixed(1)}</span>}
              {latestDecision && <span style={pill(C.green, `${C.green}14`)}>{humanizeDecisionShort(latestDecision.action)}</span>}
            </div>
            <div style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontSize: 26, lineHeight: 1.25, fontWeight: 700, color: C.text }}>
              {topAlarm ? `Signal principal : ${humanizeEngine(topAlarm.engine)}` : "Signal principal indisponible."}
            </div>
            <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.6 }}>
              {latestDecision ? humanizeDecisionAction(latestDecision.action) : "Activite jugee suffisamment suspecte pour correction."}
            </div>
            <div style={{ height: 1, background: `linear-gradient(90deg, ${C.purple}30, transparent)` }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {[
                ["Seuil retenu", thresholdContext ? (thresholdContext.pass1 !== undefined && thresholdContext.pass2 !== undefined ? `${formatNullable(thresholdContext.pass1, 1)} → ${formatNullable(thresholdContext.pass2, 1)}` : formatNullable(thresholdContext.threshold, 1)) : "N/A"],
                ["Action appliquee", latestDecision ? humanizeDecisionShort(latestDecision.action) : "N/A"],
                ["Moteur concerne", humanizeEngine(topAlarm?.engine)],
                ["Observation", formatTime(latestDecision?.timestamp ?? dynamicConfigEvent?.timestamp)],
              ].map(([label, value]) => (
                <div key={label}>
                  <div style={statLabel}>{label}</div>
                  <div style={{ fontSize: 14, color: C.text, fontWeight: 600, marginTop: 6, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Trust meters */}
          <div
            style={{
              padding: 24,
              borderRadius: 20,
              border: `1px solid ${C.borderSoft}`,
              background: C.surface,
              display: "grid",
              gap: 16,
              alignContent: "start",
            }}
          >
            <div style={{ ...statLabel, color: C.cyan }}>Etat des modeles</div>
            {trustMeters.map((m) => {
              const pct = m.value !== null && m.value !== undefined && !m.raw ? Math.max(0, Math.min(1, m.value)) : 0;
              return (
                <div key={m.label} style={{ display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontSize: 12, color: C.textDim, fontWeight: 600 }}>{m.label}</span>
                    <span style={{ fontSize: 12, color: m.tone, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                      {m.textOnly ? m.text : m.raw ? formatNullable(m.value, 3) : formatPercent(m.value, 0)}
                    </span>
                  </div>
                  {!m.textOnly && (
                    <div style={{ height: 6, borderRadius: 999, background: "rgba(148,163,184,0.08)", overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: m.raw ? "30%" : `${pct * 100}%`,
                          background: `linear-gradient(90deg, ${m.tone}, ${m.tone}80)`,
                          borderRadius: 999,
                          transition: "width 600ms ease",
                        }}
                      />
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: C.mutedDeep }}>{m.text}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ════════════════════ SECTION 3 — Attacker behavior ════════════════════ */}
      <section style={section}>
        <header style={sectionHeader}>
          <div style={sectionTitle}>Comportement de l'attaquant</div>
          <div style={sectionSubtitle}>Attaque concentree ou distribuee, avec les sources les plus actives.</div>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) minmax(0, 1.4fr)", gap: 18 }}>
          {/* Pattern hero */}
          <div
            style={{
              padding: "28px 24px",
              borderRadius: 20,
              border: `1px solid ${pattern.tone}40`,
              background: `radial-gradient(circle at 30% 20%, ${pattern.tone}22, ${C.surfaceDeep})`,
              display: "grid",
              gap: 18,
              alignContent: "start",
            }}
          >
            <span style={pill(pattern.tone, `${pattern.tone}14`)}>Type detecte</span>
            <div style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontSize: 32, fontWeight: 700, color: C.text, lineHeight: 1.1, letterSpacing: "-0.02em" }}>
              {pattern.label}
            </div>
            <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.6 }}>{pattern.detail}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 6 }}>
              {[
                { label: "Dispersion", value: formatNullable(kpis?.ip_entropy, 2), tone: C.cyan },
                { label: "Sources", value: kpis?.unique_attacking_ips != null ? String(kpis.unique_attacking_ips) : "N/A", tone: C.text },
                { label: "Cadence", value: kpis?.attack_velocity != null ? `${kpis.attack_velocity.toFixed(1)}/m` : "N/A", tone: C.amber },
              ].map((m) => (
                <div key={m.label} style={{ padding: "12px 8px", borderRadius: 12, background: "rgba(0,0,0,0.25)", textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: C.mutedDeep, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500 }}>{m.label}</div>
                  <div style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontSize: 20, fontWeight: 700, color: m.tone, marginTop: 6 }}>{m.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* IP leaderboard */}
          <div
            style={{
              padding: 24,
              borderRadius: 20,
              border: `1px solid ${C.borderSoft}`,
              background: C.surface,
              display: "grid",
              gap: 14,
              alignContent: "start",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ ...statLabel, color: C.cyan }}>Sources IP les plus actives</div>
              <div style={{ fontSize: 11, color: C.mutedDeep, fontFamily: "'JetBrains Mono', monospace" }}>{topSources.length} visibles</div>
            </div>
            {topSources.length > 0 ? (
              <div style={{ display: "grid", gap: 8 }}>
                {topSources.map((source, index) => {
                  const max = topSources[0]?.count || 1;
                  const pct = (source.count / max) * 100;
                  return (
                    <div
                      key={source.ip}
                      style={{
                        position: "relative",
                        padding: "14px 16px",
                        borderRadius: 14,
                        border: `1px solid ${C.borderSoft}`,
                        background: C.surfaceDeep,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          position: "absolute", inset: 0,
                          background: `linear-gradient(90deg, ${C.red}12 0%, ${C.red}04 ${pct}%, transparent ${pct}%)`,
                          pointerEvents: "none",
                        }}
                      />
                      <div style={{ position: "relative", display: "grid", gridTemplateColumns: "28px 1fr auto", gap: 14, alignItems: "center" }}>
                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: C.mutedDeep, fontWeight: 600 }}>
                          {String(index + 1).padStart(2, "0")}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, color: C.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {source.ip}
                          </div>
                          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                            {source.engines.join(" · ") || "Moteur inconnu"}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontSize: 22, fontWeight: 700, color: C.red, lineHeight: 1 }}>{source.count}</div>
                          <div style={{ fontSize: 9, color: C.mutedDeep, letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 2 }}>alertes</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ ...sectionSubtitle, textAlign: "center", padding: "30px 0" }}>
                Pas d'IP source exploitable dans les alarmes courantes.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
