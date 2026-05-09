// ────────────────────────────────────────────────────────────────
// presentation/components/charts/RadarEngineChart.tsx
// Source : engines[] depuis /api/engine-scores
// ────────────────────────────────────────────────────────────────
import { useState } from "react";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis,
  ResponsiveContainer as RC,
} from "recharts";
import type { RadarEngineChartProps } from "../../../shared/types/analyticsProps";
import type { EngineScore } from "../../../shared/types/idps";

const ENGINE_COLORS: Record<string, string> = {
  SSH: "#ff3b5c", WEB: "#ffb800", FTP: "#00d4ff", KERNEL: "#a855f7", SESSION: "#00ff88",
};

function engineToRadar(e: EngineScore) {
  // Toutes les métriques viennent des champs réels de EngineScore
  const totalPossible = Math.max(e.pass2 * 2, 1);
  return [
    { subject: "Frequency",  value: Math.min(100, Math.round((e.alarms / Math.max(e.pass1, 1)) * 100)) },
    { subject: "Burst",      value: Math.min(100, Math.round(e.score ?? 0)) },
    { subject: "Anomaly",    value: Math.min(100, Math.round((e.alarms / Math.max(e.pass2, 1)) * 100)) },
    { subject: "Risk",       value: e.rerun_p2 ? Math.min(100, Math.round((e.alarms / totalPossible) * 150)) : Math.min(100, e.alarms * 8) },
    { subject: "Confidence", value: e.status === "ALARM" ? 85 : 35 },
    { subject: "Pass2 Rate", value: e.rerun_p2 ? 80 : 20 },
  ];
}

export function RadarEngineChart({ engines }: RadarEngineChartProps) {
  const validEngines = engines.filter(e => ["SSH", "WEB", "FTP", "KERNEL", "SESSION"].includes(e.engine));
  const [active, setActive] = useState(validEngines[0]?.engine ?? "SSH");
  const engine = validEngines.find(e => e.engine === active) ?? validEngines[0];

  if (validEngines.length === 0) {
    return (
      <div className="chart-card">
        <div className="chart-header">
          <span className="chart-title">Engine Radar Analysis</span>
        </div>
        <div className="chart-empty">Lance le pipeline pour voir les moteurs</div>
      </div>
    );
  }

  const color = ENGINE_COLORS[active] ?? "#00ff88";
  const chartData = engine ? engineToRadar(engine) : [];

  return (
    <div className="chart-card">
      <div className="chart-header">
        <span className="chart-title">Engine Radar Analysis</span>
        <div className="engine-tabs">
          {validEngines.map(e => (
            <button
              key={e.engine}
              className={`engine-tab${active === e.engine ? " active" : ""}`}
              style={active === e.engine ? { borderColor: ENGINE_COLORS[e.engine], color: ENGINE_COLORS[e.engine] } : {}}
              onClick={() => setActive(e.engine)}
            >
              {e.engine}
              {e.status === "ALARM" && <span style={{ marginLeft: 3, color: "#ff3b5c" }}>●</span>}
            </button>
          ))}
        </div>
      </div>

      <RC width="100%" height={220}>
        <RadarChart data={chartData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
          <PolarGrid stroke="rgba(255,255,255,0.08)" />
          <PolarAngleAxis dataKey="subject" tick={{ fill: "#8ba5c0", fontSize: 11 }} />
          <Radar
            name={active}
            dataKey="value"
            stroke={color}
            fill={color}
            fillOpacity={0.18}
            strokeWidth={2}
          />
        </RadarChart>
      </RC>

      {engine && (
        <div className="chart-footer">
          <span className="stat-mini">
            Alarmes : <b style={{ color }}>{engine.alarms}</b>
          </span>
          <span className="stat-mini">
            Pass1: <b>{engine.pass1}</b> · Pass2: <b>{engine.pass2}</b>
          </span>
          <span className={engine.status === "ALARM" ? "badge-crit" : "badge-ok"}>
            {engine.status}
          </span>
        </div>
      )}
    </div>
  );
}
