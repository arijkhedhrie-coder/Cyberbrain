import { useEffect, useState } from "react";
import "../../../shared/style/ForecastPanel.css";   // <-- adjust path if needed

interface Prediction {
  available: boolean;
  prediction_score: number;
  flags: string[];
  predicted_events: string[];
  message?: string;
  risk_evolution: Array<{ time: string; risk: number; failures: number }>;
  behavioral_analysis: {
    ssh_failures_trend: number;
    unique_ips_trend: number;
    username_diversity: number;
    ftp_activity: number;
    kernel_errors: number;
  };
  prevention_suggestions: string[];
  risk_level: string;
  signal_analysis?: Record<string, any>;
  explanations?: string[];
  history?: Array<{ timestamp: string; score: number; flags: string[] }>;
}

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

export const ForecastPanel = () => {
  const [pred, setPred] = useState<Prediction | null>(null);

  const fetchPrediction = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/prediction`);
      const data = await res.json();
      setPred(data);
    } catch (e) {
      // keep last known
    }
  };

  useEffect(() => {
    fetchPrediction();
    const id = setInterval(fetchPrediction, 10000);
    return () => clearInterval(id);
  }, []);

  if (!pred) return <div className="forecast-loading">Chargement…</div>;
  if (!pred.available)
    return <div className="forecast-empty">{pred.message || "Aucune prévision"}</div>;

  const scoreColor =
    pred.prediction_score >= 70 ? "#ef4444" :
    pred.prediction_score >= 40 ? "#f59e0b" :
    "#22c55e";

  const riskLevelColor = {
    "CRITICAL": "#ef4444",
    "HIGH": "#f59e0b",
    "MEDIUM": "#f59e0b",
    "LOW": "#22c55e",
  }[pred.risk_level] || "#22c55e";

  // Circular gauge
  const gaugeRadius = 70;
  const circumference = 2 * Math.PI * gaugeRadius;
  const dashOffset = circumference - (pred.prediction_score / 100) * circumference;

  // Threat evolution SVG from history
  const renderHistoryChart = () => {
    const rawData = pred.history || pred.risk_evolution;
    if (!rawData || rawData.length < 2) return null;

    // Normalize data to consistent format
    const data = rawData.map((d: any) => ({
      value: 'score' in d ? d.score : d.risk,
    }));

    const maxRisk = Math.max(...data.map(d => d.value));
    const width = 400, height = 120;
    const points = data.map((d, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - (d.value / maxRisk) * height;
      return `${x},${y}`;
    }).join(' ');

    return (
      <svg width={width} height={height} className="forecast-evolution-chart">
        <polyline fill="none" stroke={scoreColor} strokeWidth="2" points={points} />
        {data.map((d, i) => {
          const x = (i / (data.length - 1)) * width;
          const y = height - (d.value / maxRisk) * height;
          return <circle key={i} cx={x} cy={y} r="3" fill={scoreColor} />;
        })}
      </svg>
    );
  };

  // Signal intelligence cards
  const signalCards = [
    { label: "SSH Failures", field: "failures", unit: "burst_ratio" },
    { label: "Unique IPs", field: "unique_ips", unit: "trend_ratio" },
    { label: "Username Diversity", field: "usernames", unit: "last" },
    { label: "FTP Activity", field: "ftp_events", unit: "last" },
    { label: "Kernel Errors", field: "kernel_errors", unit: "last" },
  ];

  return (
    <div className="forecast-container">
      {/* Header */}
      <div className="forecast-header">
        <div className="forecast-dot" style={{ background: scoreColor }} />
        <span className="forecast-title">🔮 THREAT FORECAST ENGINE</span>
      </div>

      {/* Hero gauge */}
      <div className="forecast-hero">
        <div className="forecast-gauge">
          <svg width="160" height="160" viewBox="0 0 160 160">
            <circle cx="80" cy="80" r={gaugeRadius} fill="none" stroke="#1e293b" strokeWidth="10" />
            <circle
              cx="80" cy="80" r={gaugeRadius}
              fill="none" stroke={scoreColor} strokeWidth="10"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              transform="rotate(-90 80 80)"
              style={{ transition: "stroke-dashoffset 0.6s ease" }}
            />
          </svg>
          <div className="forecast-gauge-value" style={{ color: scoreColor }}>
            {pred.prediction_score}<small>%</small>
          </div>
        </div>
        <div className="forecast-hero-info">
          <span className="forecast-risk-badge" style={{ background: riskLevelColor }}>
            {pred.risk_level}
          </span>
          <div className="forecast-score-label">Probabilité d'attaque imminente</div>
        </div>
      </div>

      {/* Threat evolution graph */}
      <div className="forecast-chart-section">
        <div className="forecast-chart-title">Évolution de la menace</div>
        {renderHistoryChart()}
      </div>

      {/* Signal intelligence grid */}
      <div className="forecast-signals-grid">
        <div className="forecast-chart-title">Signal Intelligence</div>
        <div className="forecast-signal-cards">
          {signalCards.map(card => {
            const sig = pred.signal_analysis?.[card.field] || {};
            const val = sig[card.unit] || 0;
            const trend = sig.trend_ratio > 1.3 ? "↑" : sig.trend_ratio < 0.7 ? "↓" : "→";
            return (
              <div key={card.label} className="forecast-signal-card">
                <div className="forecast-signal-name">{card.label}</div>
                <div className="forecast-signal-value">{typeof val === 'number' ? val.toFixed(2) : val}</div>
                <div className="forecast-signal-trend">{trend}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Attack phases */}
      {pred.flags.length > 0 && (
        <div className="forecast-flags-section">
          <div className="forecast-flags-title">Phases d'attaque détectées</div>
          <div className="forecast-phases">
            {["BOTNET_WARMUP", "SPRAY_PHASE", "DATA_EXFIL_START", "CRASH_COMING"].map(phase => {
              const active = pred.flags.includes(phase);
              return (
                <div key={phase} className={`forecast-phase ${active ? 'active' : ''}`}>
                  <div className="forecast-phase-dot" style={{ background: active ? scoreColor : '#374151' }} />
                  <span>{phase.replace(/_/g, " ")}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Explainability */}
      {pred.explanations && pred.explanations.length > 0 && (
        <div className="forecast-flags-section">
          <div className="forecast-flags-title">Pourquoi cette prévision ?</div>
          {pred.explanations.map((exp, i) => (
            <div key={i} className="forecast-event-item">
              • {exp}
            </div>
          ))}
        </div>
      )}

      {/* Prevention suggestions */}
      {pred.prevention_suggestions.length > 0 && (
        <div className="forecast-prevention-section">
          <div className="forecast-prevention-title">Actions recommandées</div>
          <div className="forecast-suggestion-box">
            {pred.prevention_suggestions.map((s, i) => (
              <div key={i} className="forecast-suggestion-item">✓ {s}</div>
            ))}
          </div>
        </div>
      )}

      <div className="forecast-footer">
        Prévision mise à jour après chaque pipeline
      </div>
    </div>
  );
};