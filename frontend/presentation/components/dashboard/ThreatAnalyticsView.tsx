import { useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { AttackHeatmap } from "../charts/AttackHeatmap";
import MinimizationChart, { type MinimizationPoint } from "./MinimizationChart";

import type {
  AlarmItem,
  EngineScore,
  KpiData,
  SessionSummary,
} from "../../../shared/types/idps";

type ThreatAnalyticsViewProps = {
  dataset: string;
  kpis: KpiData | null;
  alarms: AlarmItem[];
  engines: EngineScore[];
  sessions: SessionSummary[];
};

const sectionShell: CSSProperties = {
  padding: 22,
  borderRadius: 24,
  border: "1px solid rgba(148,163,184,0.12)",
  background:
    "radial-gradient(circle at top right, rgba(56,189,248,0.08), transparent 32%), linear-gradient(180deg, rgba(8,15,28,0.98), rgba(15,23,42,0.9))",
  boxShadow: "0 24px 54px rgba(2,6,23,0.22)",
};

const metricCardStyle: CSSProperties = {
  padding: "16px 18px",
  borderRadius: 18,
  border: "1px solid rgba(148,163,184,0.12)",
  background: "linear-gradient(180deg, rgba(15,23,42,0.82), rgba(15,23,42,0.52))",
};

const buildGlobalState = (alarms: AlarmItem[], engines: EngineScore[], kpis: KpiData | null) => {
  const criticalCount = alarms.filter((alarm) => alarm.severity === "CRITICAL").length;
  const alarmEngines = engines.filter((engine) => engine.status === "ALARM");
  const topAlarm = alarms[0];

  let level: "critique" | "élevé" | "stable" = "stable";
  let levelColor = "#2dd4a8";
  let glow = "rgba(45,212,168,0.18)";
  if (criticalCount > 0) {
    level = "critique";
    levelColor = "#ff5577";
    glow = "rgba(255,85,119,0.22)";
  } else if (alarmEngines.length > 0) {
    level = "élevé";
    levelColor = "#ffc15c";
    glow = "rgba(255,193,92,0.22)";
  }

  const headline = (() => {
    if (topAlarm && criticalCount > 0) {
      return `Attaque ${topAlarm.type.replace(/_/g, " ").toLowerCase()} en cours sur ${topAlarm.source_ip} — confinée par l'IA`;
    }
    if (alarmEngines.length > 0) {
      return `${alarmEngines.length} moteur(s) sous pression — l'IA surveille et corrèle`;
    }
    return "Système calme — aucune menace active détectée";
  })();

  const subline = (() => {
    const parts: string[] = [];
    if (alarmEngines.length) parts.push(`${alarmEngines.length} moteur(s) en alerte`);
    if (kpis?.noise_ratio != null) parts.push(`bruit ${(kpis.noise_ratio * 100).toFixed(0)}%`);
    if (kpis?.unique_attacking_ips) parts.push(`${kpis.unique_attacking_ips} IP(s) attaquantes`);
    return parts.join(" · ") || "Pipeline en attente — aucune activité notable";
  })();

  return { level, levelColor, glow, headline, subline };
};

const formatMetric = (value: number | null, suffix = "") => {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value}${suffix}`;
};

export function ThreatAnalyticsView({
  dataset,
  kpis,
  alarms,
  engines,
}: ThreatAnalyticsViewProps) {
  const [minimizationSeries, setMinimizationSeries] = useState<MinimizationPoint[]>([]);
  const globalState = useMemo(() => buildGlobalState(alarms, engines, kpis), [alarms, engines, kpis]);

  const analyticsSummary = useMemo(() => {
    if (minimizationSeries.length === 0) {
      return {
        peakAlerts: null,
        currentAlerts: null,
        residualRisk: null,
        reduction24h: null,
      };
    }

    const first = minimizationSeries[0];
    const latest = minimizationSeries[minimizationSeries.length - 1];
    const peakAlerts = Math.max(...minimizationSeries.map((point) => point.alarmes));
    const residualRisk = latest?.risque ?? null;
    const currentAlerts = latest?.alarmes ?? null;
    const reduction24h =
      first && first.risque > 0
        ? Math.round(((first.risque - (latest?.risque ?? first.risque)) / first.risque) * 100)
        : null;

    return {
      peakAlerts,
      currentAlerts,
      residualRisk,
      reduction24h,
    };
  }, [minimizationSeries]);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <section style={sectionShell}>
        <div style={{ display: "grid", gap: 8, marginBottom: 18 }}>
        
          <div style={{ fontSize: 17, fontWeight: 800, color: "#e2e8f0"  }}>
            Évolution de la pression de menace
          </div>
          <div style={{ fontSize: 15, color: "#8ba5c0", lineHeight: 1.65, maxWidth: 820 }}>
            Le système a réduit la pression de menace de façon continue grâce aux contre-mesures IA.
          </div>
        </div>

        <MinimizationChart
          dataset={dataset}
          embedded
          showMetricTiles={false}
          showFooterNotes={false}
          chartHeight={400}
          onSeriesChange={(series) => setMinimizationSeries(series)}
        />
      </section>

      <section style={sectionShell}>
        <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#e2e8f0" }}>
            Lecture en un coup d'œil
          </div>
          <div style={{ fontSize: 15, color: "#8ba5c0", lineHeight: 1.65 }}>
            Les chiffres clés qui résument la courbe ci-dessus.
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 14,
          }}
        >
          {[
            {
              label: "Pic d’alertes",
              value: formatMetric(analyticsSummary.peakAlerts),
              tone: "#ff8aa3",
              sub: "point le plus haut de la série live",
            },
            {
              label: "Alertes actuelles",
              value: formatMetric(analyticsSummary.currentAlerts),
              tone: "#e2e8f0",
              sub: "dernier passage observé",
            },
            {
              label: "Risque résiduel",
              value: formatMetric(analyticsSummary.residualRisk, "%"),
              tone: "#6ee7b7",
              sub: "risque restant après traitement",
            },
            {
              label: "Réduction 24h",
              value: formatMetric(analyticsSummary.reduction24h, "%"),
              tone: "#7dd3fc",
              sub: "variation entre début et fin de série",
            },
          ].map((card) => (
            <div key={card.label} style={metricCardStyle}>
              <div style={{ fontSize: 22, color: "#7dd3fc", marginBottom: 10 }}>{card.label}</div>
              <div style={{ fontSize: 30, fontWeight: 800, color: card.tone, marginBottom: 6 }}>{card.value}</div>
              <div style={{ fontSize: 15, color: "#8ba5c0", lineHeight: 1.5 }}>{card.sub}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={sectionShell}>
        <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#e2e8f0" }}>
            Quand les attaques arrivent
          </div>
          <div style={{ fontSize: 15, color: "#8ba5c0", lineHeight: 1.65 }}>
            Heatmap 7 jours × 24h — repère les fenêtres récurrentes pour planifier la défense.
          </div>
        </div>

        <AttackHeatmap alarms={alarms} embedded days={7} />
      </section>
    </div>
  );
}
