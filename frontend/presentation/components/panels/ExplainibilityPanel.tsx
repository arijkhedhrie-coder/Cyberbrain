// ────────────────────────────────────────────────────────────────
// presentation/components/panels/ExplainabilityPanel.tsx
// Source : decisions + suggestions + trust + kpis + topAlarm
// ────────────────────────────────────────────────────────────────
import type { ExplainabilityPanelProps } from "../../../shared/types/analyticsProps";

export function ExplainabilityPanel({
  decisions,
  suggestions,
  trust,
  topAlarm,
  kpis,
  engines,
}: ExplainabilityPanelProps) {
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

  // Features réelles depuis kpis backend
  const rawFeatures = [
    { name: "ssh_failures",    value: kpis?.ssh_failures    ?? 0, label: String(kpis?.ssh_failures ?? 0) },
    { name: "ip_entropy",      value: (kpis?.ip_entropy     ?? 0) * 8, label: (kpis?.ip_entropy ?? 0).toFixed(2) },
    { name: "attack_velocity", value: kpis?.attack_velocity ?? 0, label: `${Math.round(kpis?.attack_velocity ?? 0)}/min` },
    { name: "unique_ips",      value: kpis?.unique_attacking_ips ?? 0, label: `${kpis?.unique_attacking_ips ?? 0} IPs` },
    { name: "night_ratio",     value: (kpis?.night_ratio   ?? 0) * 20, label: `${((kpis?.night_ratio ?? 0) * 100).toFixed(0)}%` },
    { name: "noise_ratio",     value: (kpis?.noise_ratio   ?? 0) * 15, label: `${((kpis?.noise_ratio ?? 0) * 100).toFixed(1)}%` },
  ]
    .filter(f => f.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const maxContrib = Math.max(...rawFeatures.map(f => f.value), 1);

  // Contributions moteurs depuis engines[] réels
  const totalAlarms = engines.reduce((s, e) => s + (e.alarms ?? 0), 1);
  const engineContribs = engines
    .filter(e => (e.alarms ?? 0) > 0)
    .map(e => ({
      engine: e.engine,
      pct:    Math.round(((e.alarms ?? 0) / totalAlarms) * 100),
    }))
    .sort((a, b) => b.pct - a.pct);

  // Décision agent la plus récente
  const lastDecision = decisions[0];
  const confidence   = Math.min(1, topAlarm.score / 100);

  return (
    <div className="chart-card explain-card">
      <div className="chart-header">
        <span className="chart-title">Explainable AI — Pourquoi cette alarme ?</span>
        <span className={topAlarm.severity === "CRITICAL" ? "badge-crit" : "badge-warn"}>
          {topAlarm.type}
        </span>
      </div>

      {/* ── Décision + Confidence ── */}
      <div className="explain-header">
        <div className="explain-decision">→ {topAlarm.action}</div>
        <div className="confidence-bar-wrap">
          <span className="explain-label">Confidence</span>
          <div className="confidence-bar-bg">
            <div
              className="confidence-bar-fill"
              style={{
                width:      `${confidence * 100}%`,
                background: confidence > 0.85 ? "var(--accent-red)" : "var(--accent-amber)",
              }}
            />
          </div>
          <span className="confidence-val">{(confidence * 100).toFixed(0)}%</span>
        </div>
        {topAlarm.human_insight && (
          <div className="explain-insight">{topAlarm.human_insight}</div>
        )}
      </div>

      {/* ── Features contributives réelles ── */}
      {rawFeatures.length > 0 && (
        <div className="explain-features">
          <div className="explain-section-label">Features contributives (données KPI réelles)</div>
          {rawFeatures.map(f => (
            <div key={f.name} className="feature-row">
              <span className="feature-name">{f.name}</span>
              <div className="feature-bar-bg">
                <div
                  className="feature-bar-fill"
                  style={{
                    width:      `${(f.value / maxContrib) * 100}%`,
                    background: "var(--accent-red)",
                  }}
                />
              </div>
              <span className="feature-contrib" style={{ color: "var(--accent-red)" }}>
                +{Math.round(f.value)}
              </span>
              <span className="feature-val">{f.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Contributions moteurs réels ── */}
      {engineContribs.length > 0 && (
        <div className="engine-contributions">
          <div className="explain-section-label">Contributions moteurs (alarmes réelles)</div>
          <div className="engine-contrib-grid">
            {engineContribs.map(({ engine, pct }) => (
              <div key={engine} className="engine-contrib-item">
                <span className="engine-name">{engine}</span>
                <div className="engine-contrib-bar-bg">
                  <div className="engine-contrib-bar" style={{ width: `${pct}%` }} />
                </div>
                <span className="engine-pct">{pct}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Dernière décision agent ── */}
      {lastDecision && (
        <div className="explain-decision-box">
          <div className="explain-section-label">Dernière décision agent</div>
          <div className="decision-row">
            <span className="decision-agent">{lastDecision.agent}</span>
            <span className="decision-action">{lastDecision.action}</span>
            <span className="decision-confidence">
              conf: {(lastDecision.confidence * 100).toFixed(0)}%
            </span>
          </div>
          {lastDecision.reasoning && (
            <div className="decision-reasoning">{lastDecision.reasoning.slice(0, 120)}…</div>
          )}
        </div>
      )}

      {/* ── Trust metrics ── */}
      <div className="explain-trust">
        <span className="stat-mini">
          Model agreement: <b style={{ color: "var(--accent-cyan)" }}>
            {((trust.model_agreement ?? 0) * 100).toFixed(0)}%
          </b>
        </span>
        <span className="stat-mini">
          Drift: <b style={{ color: trust.drift_flagged ? "var(--accent-red)" : "var(--accent-green)" }}>
            {trust.drift_label}
          </b>
        </span>
        <span className="stat-mini">
          Stabilité: <b>{trust.stability}</b>
        </span>
      </div>
    </div>
  );
}
