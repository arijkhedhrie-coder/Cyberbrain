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
import { getMetricTooltip } from "../../../shared/constants/dashboardTooltips";
import { TooltipLabel } from "../common/TooltipLabel";

type PipelineObservabilityTabProps = {
  alarms: AlarmItem[];
  dataset?: string;
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
  session_id?: string;
  timestamp?: string;
};

/* ── Palette (Aurora Noir) ────────────────────────────────────────────── */
const C = {
  surface: "rgba(20,24,38,0.72)",
  surfaceSoft: "rgba(20,24,38,0.45)",
  surfaceDeep: "rgba(10,12,20,0.6)",
  border: "rgba(148,163,184,0.14)",
  borderSoft: "rgba(148,163,184,0.08)",
  text: "#eef0fa",
  textDim: "#cbd5e1",
  muted: "#dbeafe",
  mutedDeep: "#cbd5e1",
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
  background: "linear-gradient(180deg, rgba(20,24,38,0.78), rgba(10,12,20,0.55))",
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
  fontSize: 24,
  fontWeight: 700,
  color: C.text,
  letterSpacing: "-0.01em",
};

const sectionSubtitle: CSSProperties = {
  fontSize: 15,
  color: C.muted,
  lineHeight: 1.5,
};

const pill = (color: string, bg: string): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 14px",
  borderRadius: 999,
  fontSize: 13,
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
  fontSize: 17.5,
  color: "#7dd3fc",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontWeight: 800,
};

const statValue = (color: string): CSSProperties => ({
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
  fontSize: 40,
  fontWeight: 700,
  color,
  lineHeight: 1,
  letterSpacing: "-0.02em",
});

const statHint: CSSProperties = {
  fontSize: 13,
  color: C.mutedDeep,
  lineHeight: 1.45,
};

/* ── Helpers ──────────────────────────────────────────────────────────── */
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
  const map: Record<string, string> = {
    FTP: "FTP",
    KERNEL: "Kernel",
    SESSION: "Session",
    SSH: "SSH",
    WEB: "Web",
    CORRELATION: "Corrélation",
    PREDICTION: "Prédiction",
    GLOBAL: "Global",
    AUTH: "Authentification",
  };
  return map[n] ?? (n ? capitalize(n.toLowerCase()) : "Moteur");
}

function humanizeConfidence(l: string | null | undefined): string {
  const n = String(l ?? "").trim().toUpperCase();
  if (n === "TRUSTWORTHY") return "élevée";
  if (n === "ACCEPTABLE") return "correcte";
  if (n === "UNCERTAIN") return "à surveiller";
  if (n === "LOW") return "faible";
  if (!n || n === "N/A") return "indisponible";
  return capitalize(n.toLowerCase());
}

function humanizeStability(l: string | null | undefined): string {
  const n = String(l ?? "").trim().toUpperCase();
  if (n === "HIGH") return "très stable";
  if (n === "MEDIUM") return "stable";
  if (n === "LOW") return "variable";
  if (!n || n === "N/A") return "indisponible";
  return capitalize(n.toLowerCase());
}

function humanizeAgreement(l: string | null | undefined, v: number | null | undefined): string {
  const n = String(l ?? "").trim().toUpperCase();
  if (n.includes("HIGH") || n.includes("STRONG")) return "élevé";
  if (n.includes("MEDIUM") || n.includes("MODERATE")) return "correct";
  if (n.includes("LOW") || n.includes("WEAK")) return "fragile";
  if (v !== null && v !== undefined) {
    if (v >= 0.8) return "élevé";
    if (v >= 0.6) return "correct";
    return "fragile";
  }
  return "indisponible";
}

function humanizeDecisionAction(a: string | null | undefined): string {
  const n = String(a ?? "").trim().toLowerCase();
  if (!n || n === "n/a") return "Décision indisponible.";
  if (n.includes("skipped")) return "Aucun ajustement supplémentaire n'était nécessaire.";
  if (n.includes("dynamic configuration")) return "Correction appliquée pour réduire le bruit.";
  if (n.includes("coordination completed")) return "Cycle automatique mené jusqu'au bout.";
  return capitalize(String(a ?? ""));
}

function humanizeDecisionShort(a: string | null | undefined): string {
  const n = String(a ?? "").trim().toLowerCase();
  if (!n || n === "n/a") return "Décision indisponible";
  if (n.includes("skipped")) return "Ajustement non nécessaire";
  if (n.includes("dynamic configuration")) return "Correction appliquée";
  if (n.includes("coordination completed")) return "Cycle terminé";
  return capitalize(String(a ?? ""));
}

function describeCorrectionType(entry: ThresholdHistoryEntry | null): string {
  if (!entry || !entry.pass2_ran) return "Aucune correction";

  const parts: string[] = [];
  const changedEngines = entry.changed_engines
    .map((engine) => humanizeEngine(engine))
    .filter((engine) => engine && engine !== "Moteur");

  // No "Seuils:" prefix — just list the engine names directly
  if (changedEngines.length > 0) {
    parts.push(changedEngines.join(", "));
  }

  const config = String(entry.agent_config_summary ?? "");
  const rerunMatch = config.match(/rerun=\[([^\]]+)\]/i);
  if (rerunMatch) {
    const rerunValue = rerunMatch[1].replace(/["'\[\]]/g, "").trim();
    parts.push(rerunValue ? `Relance : ${rerunValue}` : "Relance ciblée");
  }

  const escalateMatch = config.match(/escalate=\[([^\]]+)\]/i);
  if (escalateMatch) {
    parts.push("Escalade IP");
  }

  const suppressMatch = config.match(/suppress=\[([^\]]+)\]/i);
  if (suppressMatch) {
    parts.push("Suppression IP");
  }

  if (parts.length === 0) return "Correction de configuration";
  return parts.join(" · ");
}

function humanizeAlarmNarrative(
  topAlarm: ExplainabilityData["top_alarm"],
  _thresholdContext: ExplainabilityData["threshold_context"],
): string {
  if (!topAlarm) return "Signal principal indisponible.";
  return `Signal principal : ${humanizeEngine(topAlarm.engine)}`;
}

function describePattern(p: string | null | undefined): { detail: string; label: string; tone: string } {
  const n = String(p ?? "").trim().toLowerCase();
  if (n === "concentrated_attacker")
    return { detail: "Pression concentrée sur peu de sources.", label: "Attaque concentrée", tone: C.amber };
  if (n === "distributed_botnet")
    return { detail: "Plusieurs sources actives en parallèle.", label: "Attaque distribuée", tone: C.blue };
  if (n)
    return { detail: "Répartition détectée sans détail supplémentaire.", label: n.replace(/_/g, " "), tone: C.muted };
  return { detail: "Type d'attaque non disponible.", label: "Type indisponible", tone: C.muted };
}

function buildTopSources(alarms: AlarmItem[]) {
  const grouped = new Map<string, { count: number; engines: Set<string>; severities: Set<string> }>();
  for (const alarm of alarms) {
    const ip = String(alarm.source_ip ?? "").trim();
    if (!ip || ip === "unknown") continue;
    const entry = grouped.get(ip) ?? { count: 0, engines: new Set<string>(), severities: new Set<string>() };
    entry.count += 1;
    if (alarm.engine) entry.engines.add(humanizeEngine(String(alarm.engine)));
    if (alarm.severity) entry.severities.add(String(alarm.severity));
    grouped.set(ip, entry);
  }
  return Array.from(grouped.entries())
    .map(([ip, info]) => ({
      count: info.count,
      engines: Array.from(info.engines),
      ip,
      severities: Array.from(info.severities),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

function humanizeSourceLabel(value: string): string {
  const n = String(value ?? "").trim().toUpperCase();
  if (!n || n === "UNKNOWN" || n === "N/A" || n === "NA") return "Source inconnue";
  if (n === "SYSTEM") return "Signal système";
  if (n === "GLOBAL") return "Signal global";
  if (n === "PREDICTION") return "Moteur prédictif";
  if (n === "CORRELATION") return "Corrélation multi-moteurs";
  return value;
}

function getLatestEvent(events: PipelineEvent[], eventType: string): PipelineEvent | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]?.event_type === eventType) return events[i];
  }
  return null;
}

/* ── Trust meter description helpers ─────────────────────────────────── */
function confidenceDescription(value: number | null | undefined): string {
  if (value == null) return "Données insuffisantes.";
  if (value >= 0.8) return "Les prédictions sont fiables.";
  if (value >= 0.55) return "Fiabilité acceptable.";
  return "Résultats à confirmer.";
}

function agreementDescription(value: number | null | undefined): string {
  if (value == null) return "Données insuffisantes.";
  if (value >= 0.8) return "Les modèles sont unanimes.";
  if (value >= 0.6) return "Accord partiel entre les modèles.";
  return "Divergences entre les modèles.";
}

function stabilityDescription(label: string | null | undefined): string {
  const n = String(label ?? "").trim().toUpperCase();
  if (n === "HIGH") return "Comportement très régulier.";
  if (n === "MEDIUM") return "Comportement stable.";
  if (n === "LOW") return "Comportement irrégulier.";
  return "Stabilité non disponible.";
}

/* ── Data freshness helper ────────────────────────────────────────────── */
type FreshnessInfo = { label: string; color: string; ageMs: number };

function computeFreshness(timestamp: string | null | undefined): FreshnessInfo {
  if (!timestamp) return { label: "Données en attente", color: C.mutedDeep, ageMs: -1 };
  const ageMs = Date.now() - new Date(timestamp).getTime();
  if (Number.isNaN(ageMs) || ageMs < 0) return { label: "Horodatage invalide", color: C.mutedDeep, ageMs: -1 };
  const seconds = Math.floor(ageMs / 1000);
  const minutes = Math.floor(ageMs / 60000);
  if (seconds < 60) return { label: `Actualisé il y a ${seconds}s`, color: C.green, ageMs };
  if (minutes < 5)  return { label: `Actualisé il y a ${minutes} min`, color: C.green, ageMs };
  if (minutes < 15) return { label: `Données âgées de ${minutes} min`, color: C.amber, ageMs };
  return { label: `Données âgées de ${minutes} min — vérifier la connexion`, color: C.red, ageMs };
}

function prettifyDataset(dataset: string | undefined): string {
  if (!dataset) return "Source par défaut";
  const n = dataset.trim().toLowerCase();
  if (n === "fusion" || n === "__fusion__" || n === "merged") return "Vue consolidée";
  return dataset
    .replace(/^__|__$/g, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ── Component ────────────────────────────────────────────────────────── */
export function PipelineObservabilityTab({
  alarms, dataset, explainability, kpis, pipeline, thresholdHistory, trust,
}: PipelineObservabilityTabProps) {
  const sortedThresholdHistory = useMemo(
    () => [...thresholdHistory].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
    [thresholdHistory],
  );

  const pipelineEvents = (pipeline?.events ?? []) as PipelineEvent[];
  const latestPipelineEvent = pipelineEvents.length > 0 ? pipelineEvents[pipelineEvents.length - 1] : null;
  const latestCompletedThreshold =
    sortedThresholdHistory.length > 0 ? sortedThresholdHistory[sortedThresholdHistory.length - 1] : null;

  const observedSessionId =
    typeof latestPipelineEvent?.session_id === "string" && latestPipelineEvent.session_id.trim()
      ? latestPipelineEvent.session_id.trim()
      : latestCompletedThreshold?.session_id ?? null;

  const scopedThresholdHistory = observedSessionId
    ? sortedThresholdHistory.filter((entry) => entry.session_id === observedSessionId)
    : latestCompletedThreshold
      ? [latestCompletedThreshold]
      : [];

  const latestThreshold =
    scopedThresholdHistory.length > 0
      ? scopedThresholdHistory[scopedThresholdHistory.length - 1]
      : latestCompletedThreshold;

  const changedEngines = latestThreshold?.changed_engines ?? [];
  const adjustedEngineNames = changedEngines
    .map((engine) => humanizeEngine(engine))
    .filter((engine) => engine && engine !== "Moteur");

  const dynamicConfigEvent = getLatestEvent(pipelineEvents, "DYNAMIC_CONFIG_ISSUED");
  const topSources = useMemo(() => buildTopSources(alarms), [alarms]);
  const pattern = describePattern(kpis?.attack_pattern);
  const topAlarm = explainability?.top_alarm ?? null;
  const thresholdContext = explainability?.threshold_context ?? null;
  const latestDecision = explainability?.latest_decision ?? null;
  const correctionType = describeCorrectionType(latestThreshold);

  const alertDelta =
    latestThreshold ? latestThreshold.nb_alarms_final - latestThreshold.nb_alarms_pass1 : null;

  const primaryNarrative = humanizeAlarmNarrative(topAlarm, thresholdContext);
  const currentObservationTime = latestThreshold?.timestamp ?? latestPipelineEvent?.timestamp ?? null;

  // Bilan alertes : avant → après la correction (pass1 → final)
  const alertBilan =
    latestThreshold
      ? `${latestThreshold.nb_alarms_pass1} → ${latestThreshold.nb_alarms_final} alertes`
      : "N/A";

  // Alert delta as a percentage of the total alarm population — gives real context
  const totalAlarmCount = alarms.length;
  const alertDeltaPercent =
    alertDelta !== null && latestThreshold && latestThreshold.nb_alarms_pass1 > 0
      ? ((alertDelta / latestThreshold.nb_alarms_pass1) * 100)
      : null;

  // Data freshness — tells users if they're looking at live or stale data
  const freshnessInfo = computeFreshness(currentObservationTime);

  // Dataset label for display
  const datasetLabel = prettifyDataset(dataset);

  /* ═══════════════ SECTION 1 — Cards ═══════════════════════════════════ */
  const systemCards = [
    {
      label: "Moteurs ajustés",
      value: String(changedEngines.length),
      tone: C.purple,
      hint: adjustedEngineNames.length > 0 ? adjustedEngineNames.join(" · ") : "Aucun moteur ajusté",
      title: adjustedEngineNames.length > 0 ? adjustedEngineNames.join(", ") : "Aucun moteur ajusté",
    },
    {
      label: "Décision validée",
      value: latestThreshold?.gate.accepted ? "Oui" : "Non",
      tone: latestThreshold?.gate.accepted ? C.green : C.red,
      hint: latestThreshold?.gate.accepted
        ? "Correction acceptée par le système."
        : "Correction non validée.",
    },
    {
      label: "Variation des alertes",
      value:
        latestThreshold && alertDelta !== null
          ? `${alertDelta > 0 ? "+" : ""}${alertDelta} alerte${Math.abs(alertDelta) > 1 ? "s" : ""}`
          : "N/A",
      tone: alertDelta !== null && alertDelta < 0 ? C.green : alertDelta !== null && alertDelta > 0 ? C.red : C.text,
      hint:
        latestThreshold && alertDelta !== null
          ? alertDeltaPercent !== null
            ? alertDelta === 0
              ? "Aucun changement après correction."
              : `${alertDelta > 0 ? "+" : ""}${alertDeltaPercent.toFixed(1)}% des alertes initiales — ${
                  Math.abs(alertDeltaPercent) < 5
                    ? "variation dans la marge normale."
                    : Math.abs(alertDeltaPercent) < 20
                    ? "variation notable."
                    : "variation significative."
                }`
            : alertDelta < 0
            ? `Réduction de ${Math.abs(alertDelta)} alerte${Math.abs(alertDelta) > 1 ? "s" : ""} après correction.`
            : alertDelta > 0
            ? `${alertDelta} alerte${alertDelta > 1 ? "s" : ""} supplémentaire${alertDelta > 1 ? "s" : ""} après analyse.`
            : "Aucun changement après correction."
          : "",
    },
    {
      label: "Fraîcheur des données",
      value: freshnessInfo.ageMs >= 0
        ? freshnessInfo.ageMs < 300000
          ? "En direct"
          : "Récent"
        : "—",
      tone: freshnessInfo.color,
      hint: freshnessInfo.label,
    },
  ];

  /* ═══════════════ SECTION 2 — Trust meters ════════════════════════════ */
  const confidenceValue = trust?.confidence_in_metrics ?? explainability?.model_context.trust_score ?? null;
  const agreementValue = trust?.model_agreement ?? explainability?.model_context.agreement ?? null;

  const trustMeters = [
    {
      label: "Confiance",
      tooltip: getMetricTooltip("confidence"),
      value: confidenceValue,
      text: humanizeConfidence(trust?.confidence_label ?? explainability?.model_context.trust_label),
      description: confidenceDescription(confidenceValue),
      tone: C.green,
      raw: false,
      textOnly: false,
    },
    {
      label: "Accord des modèles",
      tooltip: getMetricTooltip("agreement"),
      value: agreementValue,
      text: humanizeAgreement(
        explainability?.model_context.agreement_label,
        agreementValue,
      ),
      description: agreementDescription(agreementValue),
      tone: C.cyan,
      raw: false,
      textOnly: false,
    },
    {
      label: "Stabilité",
      tooltip: getMetricTooltip("stability"),
      value: null as number | null,
      text: humanizeStability(trust?.stability ?? explainability?.model_context.stability),
      description: stabilityDescription(trust?.stability ?? explainability?.model_context.stability),
      tone: C.amber,
      raw: false,
      textOnly: true,
    },
  ];

  return (
    <div style={shell}>


      {/* ════════════════════ SECTION 1 — Le système a-t-il réagi ? ════════════════════ */}
      <section style={section}>
        <header style={sectionHeader}>
          <div style={sectionTitle}>Le système a-t-il bien réagi ?</div>
        </header>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
          {systemCards.map((c) => (
            <div key={c.label} style={statCard} title={c.title}>
              <div style={statLabel}>{c.label}</div>
              <div style={statValue(c.tone)}>{c.value}</div>
              {c.hint ? <div style={statHint}>{c.hint}</div> : null}
            </div>
          ))}
        </div>
        {!latestThreshold && (
          <div style={{ ...sectionSubtitle, textAlign: "center", marginTop: 18 }}>
            Aucun ajustement exploitable n'est encore disponible pour cette source.
          </div>
        )}
      </section>

      {/* ════════════════════ SECTION 2 — Pourquoi cette décision ════════════════════ */}
      <section style={section}>
        <header style={sectionHeader}>
          <div style={sectionTitle}>Pourquoi cette décision</div>
          <div style={sectionSubtitle}>L'état des modèles.</div>
        </header>

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
            <div style={{ ...statLabel, color: C.cyan }}>État des modèles</div>

            {trustMeters.map((m) => {
              // For normal metrics: value is already in [0, 1]
              const pct = m.raw
                ? Math.min(1, Math.max(0, m.value ?? 0))
                : Math.max(0, Math.min(1, m.value ?? 0));

              return (
                <div key={m.label} style={{ display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontSize: 14, color: C.textDim, fontWeight: 600 }}>
                      <TooltipLabel tooltip={m.tooltip} style={{ gap: 4 }}>
                        {m.label}
                      </TooltipLabel>
                    </span>
                    <span
                      style={{
                        fontSize: 14,
                        color: m.tone,
                        fontWeight: 700,
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      {m.textOnly
                        ? m.text
                        : m.raw
                        ? formatNullable(m.value, 3)
                        : formatPercent(m.value, 0)}
                    </span>
                  </div>

                  {!m.textOnly && (
                    <div
                      style={{
                        height: 6,
                        borderRadius: 999,
                        background: "rgba(148,163,184,0.08)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${pct * 100}%`,
                          background: `linear-gradient(90deg, ${m.tone}, ${m.tone}80)`,
                          borderRadius: 999,
                          transition: "width 600ms ease",
                        }}
                      />
                    </div>
                  )}

                  {/* Show description (not m.text) — avoids "stable stable" duplication */}
                  <div style={{ fontSize: 13, color: C.mutedDeep }}>{m.description}</div>
                </div>
              );
            })}
          </div>
      </section>

      {/* ════════════════════ SECTION 3 — Comportement de l'attaquant ════════════════════ */}
      <section style={section}>
        <header style={sectionHeader}>
          <div style={sectionTitle}>Comportement de l'attaquant</div>
          <div style={sectionSubtitle}>
            Attaque concentrée ou distribuée, avec les sources les plus actives.
          </div>
        </header>

        <div
          style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) minmax(0, 1.4fr)", gap: 18 }}
        >
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
            <span style={pill(pattern.tone, `${pattern.tone}14`)}>Type détecté</span>
            <div
              style={{
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
                fontSize: 34,
                fontWeight: 700,
                color: C.text,
                lineHeight: 1.1,
                letterSpacing: "-0.02em",
              }}
            >
              {pattern.label}
            </div>
            <div style={{ fontSize: 15, color: C.textDim, lineHeight: 1.6 }}>{pattern.detail}</div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 6 }}>
              {[
                {
                  label: "Dispersion",
                  value: formatNullable(kpis?.ip_entropy, 2),
                  tone: C.cyan,
                },
                {
                  label: "Sources",
                  value: kpis?.unique_attacking_ips != null ? String(kpis.unique_attacking_ips) : "N/A",
                  tone: C.text,
                },
                {
                  label: "Vitesse",
                  value:
                    kpis?.attack_velocity != null
                      ? kpis.attack_velocity < 0.05
                        ? "< 1/min"
                        : `${kpis.attack_velocity.toFixed(1)}/min`
                      : "N/A",
                  tone: C.amber,
                },
              ].map((m) => (
                <div
                  key={m.label}
                  style={{
                    padding: "12px 8px",
                    borderRadius: 12,
                    background: "rgba(0,0,0,0.25)",
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      color: C.blue,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      fontWeight: 600,
                    }}
                  >
                    {m.label}
                  </div>
                  <div
                    style={{
                      fontFamily: "'Space Grotesk', system-ui, sans-serif",
                      fontSize: 22,
                      fontWeight: 700,
                      color: m.tone,
                      marginTop: 6,
                    }}
                  >
                    {m.value}
                  </div>
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
              <div style={{ ...statLabel, color: C.cyan }}>Sources et signaux les plus actifs</div>
              <div style={{ fontSize: 13, color: C.mutedDeep, fontFamily: "'JetBrains Mono', monospace" }}>
                {topSources.length} visible{topSources.length > 1 ? "s" : ""}
              </div>
            </div>

            {topSources.length > 0 ? (
              <div style={{ display: "grid", gap: 8 }}>
                {topSources.map((source, index) => {
                  const max = topSources[0]?.count || 1;
                  const pct = (source.count / max) * 100;
                  const isSystemSource = source.ip === "SYSTEM" || source.ip === "GLOBAL" || source.ip === "PREDICTION";

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
                          position: "absolute",
                          inset: 0,
                          background: `linear-gradient(90deg, ${C.red}12 0%, ${C.red}04 ${pct}%, transparent ${pct}%)`,
                          pointerEvents: "none",
                        }}
                      />
                      <div
                        style={{
                          position: "relative",
                          display: "grid",
                          gridTemplateColumns: "28px 1fr auto",
                          gap: 14,
                          alignItems: "center",
                        }}
                      >
                        <div
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 14,
                            color: C.mutedDeep,
                            fontWeight: 600,
                          }}
                        >
                          {String(index + 1).padStart(2, "0")}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: 16,
                              color: C.text,
                              fontWeight: 600,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {humanizeSourceLabel(source.ip)}
                          </div>
                          <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
                            {isSystemSource
                              ? "Aucune IP source distincte"
                              : source.engines.join(" · ") || "Moteur inconnu"}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div
                            style={{
                              fontFamily: "'Space Grotesk', system-ui, sans-serif",
                              fontSize: 24,
                              fontWeight: 700,
                              color: C.red,
                              lineHeight: 1,
                            }}
                          >
                            {source.count}
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: C.mutedDeep,
                              letterSpacing: "0.1em",
                              textTransform: "uppercase",
                              marginTop: 2,
                            }}
                          >
                            alertes
                          </div>
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




