import type { CSSProperties } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AdaptiveThresholdPanelProps } from "../../../shared/types/analyticsProps";
import type { ThresholdHistoryEntry } from "../../../shared/types/idps";

const formatAxisTime = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(11, 16) || value;
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const formatDateTime = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getGateVisual = (entry: ThresholdHistoryEntry | null) => {
  if (!entry) {
    return {
      label: "NO HISTORY",
      bg: "rgba(71,85,105,0.16)",
      border: "rgba(71,85,105,0.34)",
      color: "#94a3b8",
    };
  }

  if (!entry.pass2_ran) {
    return {
      label: "PASS 1 ONLY",
      bg: "rgba(100,116,139,0.16)",
      border: "rgba(100,116,139,0.34)",
      color: "#cbd5e1",
    };
  }

  if (entry.gate.accepted) {
    return {
      label: entry.gate.mode === "PARTIAL" ? "PARTIAL APPLY" : "PASS 2 APPLIED",
      bg: "rgba(34,197,94,0.14)",
      border: "rgba(34,197,94,0.36)",
      color: "#4ade80",
    };
  }

  return {
    label: entry.gate.mode === "REJECTED" ? "GATE BLOCKED" : entry.gate.mode || "PASS 2 BLOCKED",
    bg: "rgba(245,158,11,0.14)",
    border: "rgba(245,158,11,0.36)",
    color: "#fbbf24",
  };
};

const summarizeEngineChanges = (entry: ThresholdHistoryEntry | null) => {
  if (!entry || entry.changed_engines.length === 0) return "Aucun seuil moteur n'a change sur le dernier passage enregistre.";

  return entry.changed_engines
    .map((engine) => {
      const snapshot = entry.engines[engine];
      if (!snapshot) return engine;
      return `${engine} ${snapshot.pass1} -> ${snapshot.pass2}`;
    })
    .join("  |  ");
};

const infoCardStyle: CSSProperties = {
  borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.12)",
  background: "linear-gradient(180deg, rgba(15,23,42,0.62), rgba(15,23,42,0.38))",
  padding: "12px 14px",
};

export function AdaptiveThresholdPanel({ thresholdHistory, engines }: AdaptiveThresholdPanelProps) {
  const latestEntry = thresholdHistory.length > 0 ? thresholdHistory[thresholdHistory.length - 1] : null;
  const gateVisual = getGateVisual(latestEntry);
  const changedSessions = thresholdHistory.filter((entry) => entry.changed_engines.length > 0).length;
  const appliedSessions = thresholdHistory.filter((entry) => entry.gate.accepted).length;
  const sshEngine = engines.find((engine) => engine.engine === "SSH");
  const latestSsh = latestEntry?.engines.SSH ?? null;

  const chartData = thresholdHistory.map((entry) => {
    const ssh = entry.engines.SSH ?? { pass1: null, pass2: null, changed: false };

    return {
      time: formatAxisTime(entry.timestamp),
      fullTime: formatDateTime(entry.timestamp),
      pass1Threshold: ssh.pass1 ?? 0,
      pass2Threshold: ssh.pass2 ?? ssh.pass1 ?? 0,
      pass1Alarms: entry.nb_alarms_pass1,
      finalAlarms: entry.nb_alarms_final,
    };
  });

  const latestTrust =
    latestEntry?.gate.trust_score !== null && latestEntry?.gate.trust_score !== undefined
      ? latestEntry.gate.trust_score.toFixed(3)
      : "N/A";

  return (
    <div
      className="chart-card"
      style={{
        padding: 18,
        background:
          "radial-gradient(circle at top right, rgba(251,191,36,0.08), transparent 30%), linear-gradient(180deg, rgba(15,23,42,0.92), rgba(15,23,42,0.74))",
      }}
    >
      <div className="chart-header" style={{ alignItems: "flex-start", marginBottom: 16 }}>
        <div style={{ display: "grid", gap: 6 }}>
          <span className="chart-title">Ajustement automatique des seuils</span>
          <span style={{ fontSize: 12, color: "#8ba5c0", lineHeight: 1.45 }}>
            Compare l'evolution des seuils SSH avec la baisse des alertes apres la decision du systeme.
          </span>
        </div>

        <span
          style={{
            padding: "6px 10px",
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            whiteSpace: "nowrap",
            background: gateVisual.bg,
            border: `1px solid ${gateVisual.border}`,
            color: gateVisual.color,
          }}
        >
          {gateVisual.label}
        </span>
      </div>

      {chartData.length === 0 ? (
        <div className="chart-empty" style={{ display: "grid", gap: 8 }}>
          <span>Aucun historique d'ajustement n'a encore ete enregistre.</span>
          {sshEngine && (
            <span style={{ fontSize: 11, color: "#7c8fa1" }}>
              Seuils SSH actuels : P1 {sshEngine.pass1} | P2 {sshEngine.pass2}
            </span>
          )}
        </div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 10,
              marginBottom: 16,
            }}
          >
            {[
              {
                label: "Dernier SSH",
                value: latestSsh ? `${latestSsh.pass1} -> ${latestSsh.pass2}` : "N/A",
                tone: latestSsh?.changed ? "#fbbf24" : "#e2e8f0",
              },
              {
                label: "Passages ajustes",
                value: String(changedSessions),
                tone: changedSessions > 0 ? "#7dd3fc" : "#94a3b8",
              },
              {
                label: "P2 applique",
                value: String(appliedSessions),
                tone: appliedSessions > 0 ? "#4ade80" : "#94a3b8",
              },
              {
                label: "Dernier ecart",
                value: latestEntry ? `${latestEntry.alarm_delta >= 0 ? "+" : ""}${latestEntry.alarm_delta}` : "0",
                tone: (latestEntry?.alarm_delta ?? 0) > 0 ? "#4ade80" : "#cbd5e1",
              },
            ].map((item) => (
              <div key={item.label} style={infoCardStyle}>
                <div style={{ fontSize: 11, color: "#7c8fa1", marginBottom: 8 }}>{item.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: item.tone }}>{item.value}</div>
              </div>
            ))}
          </div>

          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" />
              <XAxis
                dataKey="time"
                tick={{ fill: "#64748b", fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: "rgba(148,163,184,0.12)" }}
                interval="preserveStartEnd"
              />
              <YAxis
                yAxisId="threshold"
                tick={{ fill: "#64748b", fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: "rgba(148,163,184,0.12)" }}
              />
              <YAxis
                yAxisId="alarms"
                orientation="right"
                tick={{ fill: "#64748b", fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: "rgba(148,163,184,0.12)" }}
              />
              <Tooltip
                contentStyle={{
                  background: "#101826",
                  border: "1px solid rgba(148,163,184,0.18)",
                  borderRadius: 12,
                }}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.fullTime ?? ""}
              />
              <Bar
                yAxisId="alarms"
                dataKey="pass1Alarms"
                name="Alertes P1"
                fill="rgba(125,211,252,0.28)"
                radius={[5, 5, 0, 0]}
              />
              <Bar
                yAxisId="alarms"
                dataKey="finalAlarms"
                name="Alertes finales"
                fill="rgba(56,189,248,0.7)"
                radius={[5, 5, 0, 0]}
              />
              <Line
                yAxisId="threshold"
                type="monotone"
                dataKey="pass1Threshold"
                name="SSH P1"
                stroke="#94a3b8"
                strokeWidth={2}
                dot={false}
              />
              <Line
                yAxisId="threshold"
                type="monotone"
                dataKey="pass2Threshold"
                name="SSH P2"
                stroke="#fbbf24"
                strokeWidth={2.2}
                dot={{ r: 3, fill: "#fbbf24" }}
              />
            </ComposedChart>
          </ResponsiveContainer>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 10,
              marginTop: 14,
            }}
          >
            <div style={infoCardStyle}>
              <div style={{ fontSize: 11, color: "#7c8fa1", marginBottom: 8 }}>Dernier passage</div>
              <div style={{ fontSize: 12, color: "#e2e8f0", lineHeight: 1.6 }}>
                {latestEntry
                  ? `Alertes ${latestEntry.nb_alarms_pass1} -> ${latestEntry.nb_alarms_final} | Confiance ${latestTrust} | Menace ${latestEntry.threat_level}`
                  : "Aucun passage enregistre pour le moment."}
              </div>
            </div>

            <div style={infoCardStyle}>
              <div style={{ fontSize: 11, color: "#7c8fa1", marginBottom: 8 }}>Moteurs ajustes</div>
              <div style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.6 }}>{summarizeEngineChanges(latestEntry)}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
