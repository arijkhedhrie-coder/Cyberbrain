// presentation/components/panels/ExplainabilityPanel.tsx
import { useState } from "react";
import type { ExplainabilityPanelProps } from "../../../shared/types/analyticsProps";

export function ExplainabilityPanel({
  decisions,
  suggestions,
  trust,
  topAlarm,
  kpis,
  engines,
}: ExplainabilityPanelProps) {
  const [expanded, setExpanded] = useState(true);

  if (!topAlarm) {
    return (
      <div className="chart-card explain-card">
        <div className="chart-header">
          <span className="chart-title">Explainable AI</span>
        </div>
        <div className="chart-empty">Aucune alarme — système clean ✓</div>
      </div>
    );
  }

  const agreement = trust.model_agreement ?? trust.confidence_in_metrics ?? 1.0;
  const modelsAgreed = engines.filter((engine) => (engine.alarms ?? 0) > 0).length;
  const agreementPct = Math.round(agreement * 100);

  // Build feature contributions from real KPI data
  const rawFeatures = [
    { name: "SSH Failures",    value: kpis?.ssh_failures    ?? 0, label: `${kpis?.ssh_failures ?? 0}` },
    { name: "IP Entropy",      value: (kpis?.ip_entropy     ?? 0) * 20, label: (kpis?.ip_entropy ?? 0).toFixed(2) },
    { name: "Attack Velocity", value: kpis?.attack_velocity ?? 0, label: `${Math.round(kpis?.attack_velocity ?? 0)}/min` },
    { name: "Unique IPs",      value: kpis?.unique_attacking_ips ?? 0, label: `${kpis?.unique_attacking_ips ?? 0}` },
    { name: "Night Ratio",     value: (kpis?.night_ratio   ?? 0) * 100, label: `${((kpis?.night_ratio ?? 0) * 100).toFixed(0)}%` },
    { name: "Noise Ratio",     value: (kpis?.noise_ratio   ?? 0) * 100, label: `${((kpis?.noise_ratio ?? 0) * 100).toFixed(1)}%` },
  ]
    .filter(f => f.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  // Waterfall data
  const baseline = 0;
  const waterfallData = rawFeatures.map((f, idx) => {
    const start = idx === 0 ? baseline : rawFeatures.slice(0, idx).reduce((s, x) => s + x.value, baseline);
    return { ...f, start, end: start + f.value };
  });
  const total = rawFeatures.reduce((s, f) => s + f.value, 0);

  // Engine contributions
  const totalAlarms = engines.reduce((s, e) => s + (e.alarms ?? 0), 1);
  const engineContribs = engines
    .filter(e => (e.alarms ?? 0) > 0)
    .map(e => ({
      engine: e.engine,
      pct:    Math.round(((e.alarms ?? 0) / totalAlarms) * 100),
    }))
    .sort((a, b) => b.pct - a.pct);

  const lastDecision = decisions[0];
  const topSuggestion = suggestions[0] ?? null;

  const getFeatureColor = (name: string) => {
    const colors: Record<string, string> = {
      "SSH Failures":    "#ef4444",
      "IP Entropy":      "#f59e0b",
      "Attack Velocity": "#f97316",
      "Unique IPs":      "#3b82f6",
      "Night Ratio":     "#a855f7",
      "Noise Ratio":     "#8b5cf6",
    };
    return colors[name] ?? "#64748b";
  };

  return (
    <div style={{
      background: "rgba(15, 23, 42, 0.7)",
      backdropFilter: "blur(12px)",
      border: "1px solid rgba(0, 212, 255, 0.15)",
      borderRadius: 16,
      marginTop: 16,
      transition: "all 0.3s",
      overflow: "hidden",
    }}>
      {/* Collapsible Header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: "16px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: "pointer",
          borderBottom: expanded ? "1px solid rgba(0,212,255,0.1)" : "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", letterSpacing: 1 }}>
            🧠 Explainable AI
          </span>
          <span className={topAlarm.severity === "CRITICAL" ? "badge-crit" : "badge-warn"}>
            {topAlarm.type}
          </span>
        </div>
        <span style={{ color: "#64748b", fontSize: 18 }}>{expanded ? "▼" : "▶"}</span>
      </div>

      {expanded && (
        <div style={{ padding: "20px 24px" }}>
          {/* Main alarm info + Model Agreement ring */}
          <div style={{ display: "flex", gap: 32, alignItems: "center", marginBottom: 24 }}>
            {/* Agreement ring */}
            <div style={{ position: "relative", width: 100, height: 100, flexShrink: 0 }}>
              <svg viewBox="0 0 100 100" width={100} height={100}>
                <circle cx="50" cy="50" r="44" fill="none" stroke="#1e293b" strokeWidth="6" />
                <circle
                  cx="50" cy="50" r="44"
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="6"
                  strokeDasharray={`${agreementPct * 2.76} 276`}
                  strokeLinecap="round"
                  transform="rotate(-90 50 50)"
                />
              </svg>
              <div style={{
                position: "absolute", inset: 0, display: "flex",
                flexDirection: "column", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>{agreementPct}%</span>
                <span style={{ fontSize: 8, color: "#64748b" }}>agreement</span>
              </div>
            </div>

            {/* Alarm details */}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 6 }}>
                {topAlarm.action} · Score {topAlarm.score.toFixed(1)}
              </div>
              {topAlarm.human_insight && (
                <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>
                  {topAlarm.human_insight}
                </div>
              )}
              <div style={{ fontSize: 10, color: "#64748b" }}>
                IP: {topAlarm.source_ip} · Engine: {topAlarm.engine} · {modelsAgreed}/4 models agree
              </div>
            </div>
          </div>

          {/* Waterfall Feature Contributions */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 12 }}>
              Feature Contributions
            </div>
            <div style={{ position: "relative", height: waterfallData.length * 36 }}>
              {waterfallData.map((f, idx) => {
                const width = Math.max(2, (f.value / total) * 100);
                const left = (f.start / total) * 100;
                return (
                  <div key={f.name} style={{
                    position: "absolute", left: 0, right: 0,
                    height: 28, top: idx * 36,
                    display: "flex", alignItems: "center",
                  }}>
                    {/* Feature label */}
                    <span style={{
                      width: 120, textAlign: "right", paddingRight: 12,
                      fontSize: 10, color: "#64748b",
                    }}>
                      {f.name}
                    </span>
                    {/* Bar */}
                    <div style={{
                      position: "relative", flex: 1, height: 22,
                    }}>
                      <div style={{
                        position: "absolute",
                        left: `${left}%`,
                        width: `${width}%`,
                        height: "100%",
                        borderRadius: 6,
                        background: getFeatureColor(f.name),
                        opacity: 0.85,
                        display: "flex", alignItems: "center",
                        justifyContent: "flex-end",
                        paddingRight: 6,
                      }}>
                        <span style={{ fontSize: 9, color: "#fff", fontWeight: 600 }}>
                          +{f.value.toFixed(0)}
                        </span>
                      </div>
                      {/* connecting line */}
                      {idx < waterfallData.length - 1 && (
                        <div style={{
                          position: "absolute",
                          left: `${left + width}%`,
                          top: -6,
                          width: 1, height: 12,
                          background: "#475569",
                        }} />
                      )}
                    </div>
                    {/* value label */}
                    <span style={{
                      width: 60, paddingLeft: 8,
                      fontSize: 10, color: "#94a3b8",
                    }}>
                      {f.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Engine Contributions */}
          {engineContribs.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 10 }}>
                Detection Engines
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {engineContribs.map(({ engine, pct }) => (
                  <span key={engine} style={{
                    padding: "4px 10px",
                    borderRadius: 20,
                    background: "rgba(0,212,255,0.1)",
                    border: "1px solid rgba(0,212,255,0.2)",
                    fontSize: 11,
                    color: "#e2e8f0",
                    display: "flex", alignItems: "center", gap: 6,
                  }}>
                    <span style={{ fontWeight: 700 }}>{engine}</span>
                    <span style={{ color: "#00d4ff" }}>{pct}%</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Agent Decision */}
          {lastDecision && (
            <div style={{
              marginBottom: 16,
              padding: "10px 14px",
              borderRadius: 8,
              background: "rgba(30, 41, 59, 0.6)",
            }}>
              <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>Last Agent Decision</div>
              <div style={{ fontSize: 12, color: "#e2e8f0" }}>
                <b>{lastDecision.agent}</b> → {lastDecision.action}
              </div>
              {lastDecision.reasoning && (
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
                  {lastDecision.reasoning.slice(0, 150)}…
                </div>
              )}
            </div>
          )}

          {topSuggestion && (
            <div
              style={{
                marginBottom: 16,
                padding: "10px 14px",
                borderRadius: 8,
                background: "rgba(30, 41, 59, 0.6)",
              }}
            >
              <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>
                Corrective Suggestion
              </div>
              <div style={{ fontSize: 12, color: "#e2e8f0" }}>
                <b>{topSuggestion.action_type}</b> · {topSuggestion.description}
              </div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
                IP {topSuggestion.ip} · confiance {(topSuggestion.confidence * 100).toFixed(0)}%
              </div>
            </div>
          )}

          {/* Trust Metrics */}
          <div style={{ display: "flex", gap: 20, fontSize: 10, color: "#64748b" }}>
            <span>Agreement: <b style={{ color: "#00d4ff" }}>{((trust.model_agreement ?? 0) * 100).toFixed(0)}%</b></span>
            <span>Drift: <b style={{ color: trust.drift_flagged ? "#ef4444" : "#10b981" }}>{trust.drift_label}</b></span>
            <span>Stability: <b>{trust.stability}</b></span>
          </div>
        </div>
      )}
    </div>
  );
}
