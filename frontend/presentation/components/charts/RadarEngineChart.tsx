import { useEffect, useState } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";

import type { RadarEngineChartProps } from "../../../shared/types/analyticsProps";
import type { EngineScore } from "../../../shared/types/idps";

const ENGINE_COLORS: Record<string, string> = {
  SSH: "#ff5b7f",
  WEB: "#ffb84d",
  FTP: "#35d4ff",
  KERNEL: "#7c82ff",
  SESSION: "#28e0a6",
};

const getPressureVisual = (engine: EngineScore) => {
  const threshold = Math.max(engine.rerun_p2 ? engine.pass2 : engine.pass1, 1);
  const pressure = (engine.alarms ?? 0) / threshold;

  if ((engine.alarms ?? 0) <= 0) {
    return { color: "#2dd4a8", glow: "rgba(45,212,168,0.2)" };
  }
  if (pressure >= 1) {
    return { color: "#ff5b7f", glow: "rgba(255,91,127,0.24)" };
  }
  if (pressure >= 0.55) {
    return { color: "#fbbf24", glow: "rgba(251,191,36,0.22)" };
  }
  return { color: "#7c82ff", glow: "rgba(124,130,255,0.2)" };
};

function engineToRadar(engine: EngineScore) {
  const totalPossible = Math.max(engine.pass2 * 2, 1);

  return [
    { subject: "Frequency", value: Math.min(100, Math.round((engine.alarms / Math.max(engine.pass1, 1)) * 100)) },
    { subject: "Burst", value: Math.min(100, Math.round(engine.score ?? 0)) },
    { subject: "Anomaly", value: Math.min(100, Math.round((engine.alarms / Math.max(engine.pass2, 1)) * 100)) },
    {
      subject: "Risk",
      value: engine.rerun_p2
        ? Math.min(100, Math.round((engine.alarms / totalPossible) * 150))
        : Math.min(100, engine.alarms * 8),
    },
    { subject: "Confidence", value: engine.status === "ALARM" ? 85 : 35 },
  ];
}

export function RadarEngineChart({ engines, compact = false }: RadarEngineChartProps) {
  const validEngines = engines.filter((engine) =>
    ["SSH", "WEB", "FTP", "KERNEL", "SESSION"].includes(engine.engine),
  );
  const [active, setActive] = useState(validEngines[0]?.engine ?? "SSH");

  useEffect(() => {
    if (!validEngines.some((engine) => engine.engine === active)) {
      setActive(validEngines[0]?.engine ?? "SSH");
    }
  }, [active, validEngines]);

  const engine = validEngines.find((item) => item.engine === active) ?? validEngines[0];
  const pressureVisual = engine ? getPressureVisual(engine) : null;
  const color = pressureVisual?.color ?? ENGINE_COLORS[active] ?? "#35d4ff";
  const chartData = engine ? engineToRadar(engine) : [];
  const height = compact ? 188 : 228;

  if (validEngines.length === 0) {
    return (
      <div
        className={compact ? undefined : "chart-card"}
        style={
          compact
            ? {
                minHeight: 188,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 12,
                border: "1px dashed rgba(148,163,184,0.22)",
                background: "rgba(15,23,42,0.32)",
                color: "#8ba5c0",
                fontSize: 12,
                textAlign: "center",
                padding: 18,
              }
            : undefined
        }
      >
        <div>
          {!compact && (
            <div className="chart-header">
              <span className="chart-title">Engine Radar Analysis</span>
            </div>
          )}
          Aucun score moteur disponible pour le moment.
        </div>
      </div>
    );
  }

  return (
    <div
      className={compact ? undefined : "chart-card"}
      style={
        compact
          ? {
              display: "grid",
              gap: 10,
            }
          : undefined
      }
    >
      {!compact && (
        <div className="chart-header">
          <span className="chart-title">Engine Radar Analysis</span>
          <div className="engine-tabs">
            {validEngines.map((item) => {
              const itemVisual = getPressureVisual(item);
              return (
                <button
                  key={item.engine}
                  className={`engine-tab${active === item.engine ? " active" : ""}`}
                  style={active === item.engine ? { borderColor: itemVisual.color, color: itemVisual.color } : {}}
                  onClick={() => setActive(item.engine)}
                >
                  {item.engine}
                  {item.status === "ALARM" && <span style={{ marginLeft: 3, color: itemVisual.color }}>•</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {compact && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {validEngines.map((item) => {
            const itemVisual = getPressureVisual(item);
            const isActive = active === item.engine;

            return (
              <button
                key={item.engine}
                onClick={() => setActive(item.engine)}
                style={{
                  borderRadius: 999,
                  border: `1px solid ${isActive ? `${itemVisual.color}66` : "rgba(148,163,184,0.18)"}`,
                  background: isActive ? itemVisual.glow : "rgba(15,23,42,0.38)",
                  color: isActive ? itemVisual.color : "#8ba5c0",
                  padding: "5px 10px",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  cursor: "pointer",
                  boxShadow: isActive ? `0 0 18px ${itemVisual.glow}` : "none",
                }}
              >
                {item.engine}
              </button>
            );
          })}
        </div>
      )}

      <ResponsiveContainer width="100%" height={height}>
        <RadarChart
          data={chartData}
          margin={compact ? { top: 10, right: 18, bottom: 8, left: 18 } : { top: 10, right: 30, bottom: 10, left: 30 }}
        >
          <PolarGrid stroke="rgba(148,163,184,0.14)" />
          <PolarAngleAxis
            dataKey="subject"
            tick={{ fill: compact ? "#94a3b8" : "#8ba5c0", fontSize: compact ? 9 : 11 }}
          />
          <Radar
            name={active}
            dataKey="value"
            stroke={color}
            fill={color}
            fillOpacity={compact ? 0.26 : 0.18}
            strokeWidth={compact ? 2.2 : 2}
          />
        </RadarChart>
      </ResponsiveContainer>

      {engine && !compact && (
        <div
          className="chart-footer"
          style={{
            gap: compact ? 8 : undefined,
            flexWrap: "wrap",
          }}
        >
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
