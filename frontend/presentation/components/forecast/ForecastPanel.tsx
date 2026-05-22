import { useEffect, useMemo, useRef, useState } from "react";
import "../../../shared/style/ForecastPanel.css";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";
const FUSION_DATASETS = new Set(["fusion", "__fusion__", "merged", "__merged__"]);

interface PredictionData {
  available: boolean;
  prediction_score: number;
  flags: string[];
  predicted_events: string[];
  risk_evolution: Array<{ time: string; risk: number; failures: number }>;
  behavioral_analysis?: {
    ssh_failures_trend: number;
    unique_ips_trend: number;
    username_diversity: number;
    ftp_activity: number;
    kernel_errors: number;
  };
  signal_analysis: {
    failures: { trend_ratio: number; burst_ratio: number; last: number };
    unique_ips: { trend_ratio: number; burst_ratio: number; last: number };
    usernames: { trend_ratio: number; burst_ratio: number; last: number };
    ftp_events: { trend_ratio: number; burst_ratio: number; last: number };
    kernel_errors: { trend_ratio: number; burst_ratio: number; last: number };
  };
  prevention_suggestions: string[];
  risk_level: string;
  explanations?: string[];
  history?: Array<{ timestamp: string; score: number; flags: string[] }>;
}

type HistoryPoint = { timestamp: string; score: number; flags: string[] };
type MomentumState = {
  label: "ACCELERATING" | "STABLE" | "DECREASING";
  color: string;
  direction: string;
  delta: number;
  detail: string;
};

const DEFAULT_MOMENTUM: MomentumState = {
  label: "STABLE",
  color: "#f59e0b",
  direction: "->",
  delta: 0,
  detail: "Baseline locked. Waiting for another live sample.",
};

const FLAG_DESCRIPTIONS: Record<string, string> = {
  BOTNET_WARMUP: "Many IPs appearing slowly -> distributed attack preparation",
  SPRAY_PHASE: "Username diversity surge -> password spraying behavior",
  CRASH_COMING: "Kernel instability rising -> service degradation risk",
  DATA_EXFIL_START: "Suspicious FTP activity -> possible data exfiltration",
};

const getThreatLevel = (score: number): { level: string; color: string } => {
  if (score >= 75) return { level: "CRITICAL", color: "#ef4444" };
  if (score >= 50) return { level: "ELEVATED", color: "#f97316" };
  if (score >= 25) return { level: "WATCH", color: "#f59e0b" };
  return { level: "NORMAL", color: "#22c55e" };
};

const getCurrentPhase = (flags: string[]): string => {
  if (flags.includes("DATA_EXFIL_START")) return "DATA EXFILTRATION";
  if (flags.includes("CRASH_COMING")) return "SYSTEM INSTABILITY";
  if (flags.includes("SPRAY_PHASE")) return "PASSWORD SPRAYING";
  if (flags.includes("BOTNET_WARMUP")) return "BOTNET WARMUP";
  return "NORMAL MONITORING";
};

const buildMomentum = (previousScore: number | null, currentScore: number): MomentumState => {
  if (previousScore === null) return DEFAULT_MOMENTUM;

  const delta = currentScore - previousScore;
  if (delta >= 4) {
    return {
      label: "ACCELERATING",
      color: "#ef4444",
      direction: "++",
      delta,
      detail: `Prediction score increased by ${delta} points since the last fetch.`,
    };
  }
  if (delta <= -4) {
    return {
      label: "DECREASING",
      color: "#22c55e",
      direction: "--",
      delta,
      detail: `Prediction score dropped by ${Math.abs(delta)} points since the last fetch.`,
    };
  }
  return {
    label: "STABLE",
    color: "#f59e0b",
    direction: "->",
    delta,
    detail: `Prediction score changed by ${delta} points since the last fetch.`,
  };
};

const prettifyDataset = (dataset: string): string => {
  if (!dataset) return "UNSPECIFIED DATASET";
  return dataset
    .replace(/^__|__$/g, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const formatHistoryTime = (timestamp: string): string => {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return timestamp;
  return value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const buildScenarioNarrative = (
  flags: string[],
  predictedEvents: string[],
  predictionScore: number,
): { title: string; summary: string; outlook: string } => {
  const eventsText = predictedEvents.slice(0, 2).join(" ");

  if (flags.includes("DATA_EXFIL_START")) {
    return {
      title: "Potential post-compromise activity detected",
      summary: "The system is seeing signals that look like an intruder shifting from access attempts into data movement.",
      outlook: eventsText || "Containment and review of outbound transfer paths should be prioritized immediately.",
    };
  }

  if (flags.includes("BOTNET_WARMUP") && flags.includes("SPRAY_PHASE")) {
    return {
      title: "Distributed SSH brute-force cluster forming",
      summary: "Multiple IPs and rising username diversity suggest a coordinated credential-spraying campaign is assembling.",
      outlook: eventsText || "Expect broader authentication pressure if the next polling windows keep rising.",
    };
  }

  if (flags.includes("SPRAY_PHASE")) {
    return {
      title: "Credential spraying campaign intensifying",
      summary: "Username diversity is expanding faster than normal, which points to an attacker testing many accounts at once.",
      outlook: eventsText || "Watch for lockout pressure and repeated auth failures across multiple accounts.",
    };
  }

  if (flags.includes("CRASH_COMING")) {
    return {
      title: "Service stability is under pressure",
      summary: "Kernel-side anomalies are increasing while the prediction engine still sees hostile pressure in the environment.",
      outlook: eventsText || "Operational risk is shifting from pure intrusion attempts toward availability degradation.",
    };
  }

  if (flags.includes("BOTNET_WARMUP")) {
    return {
      title: "Reconnaissance cluster building",
      summary: "The engine sees a gradual expansion in source diversity that fits an early distributed probing pattern.",
      outlook: eventsText || "This can evolve into brute-force or spray behavior if incoming attempts keep widening.",
    };
  }

  if (predictionScore >= 60) {
    return {
      title: "Elevated hostile conditions detected",
      summary: "Risk is materially above baseline even without a dominant flag combination, which suggests the system is in a volatile window.",
      outlook: eventsText || "Use the next few fetches to confirm whether this becomes a clear attack pattern or cools down.",
    };
  }

  return {
    title: "Threat posture remains watchable",
    summary: "The engine is active, but current indicators do not yet form a strong multi-stage attack narrative.",
    outlook: eventsText || "Continue monitoring for stronger clustering in failures, IP diversity, or transfer activity.",
  };
};

const Sparkline = ({
  data,
  width = 220,
  height = 56,
  color = "#00d4ff",
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}) => {
  if (!data.length) return <span className="forecast-no-history">No trend yet</span>;
  if (data.length === 1) {
    return (
      <svg width={width} height={height} style={{ display: "inline-block", verticalAlign: "middle" }}>
        <circle cx={width / 2} cy={height / 2} r="4" fill={color} />
      </svg>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} style={{ display: "inline-block", verticalAlign: "middle" }}>
      <polyline fill="none" stroke={color} strokeWidth="2" points={points} />
    </svg>
  );
};

interface Props {
  dataset?: string;
}

export const ForecastPanel = ({ dataset = "" }: Props) => {
  const [pred, setPred] = useState<PredictionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fallbackHistory, setFallbackHistory] = useState<HistoryPoint[]>([]);
  const [momentum, setMomentum] = useState<MomentumState>(DEFAULT_MOMENTUM);

  const previousScoreRef = useRef<number | null>(null);
  const isFusionView = FUSION_DATASETS.has(dataset.toLowerCase());
  const datasetLabel = prettifyDataset(dataset);
  const historyStorageKey = useMemo(() => `forecast-history:${dataset || "__default__"}`, [dataset]);

  useEffect(() => {
    previousScoreRef.current = null;
    setPred(null);
    setMomentum(DEFAULT_MOMENTUM);
    setLoading(!isFusionView);

    try {
      const stored = localStorage.getItem(historyStorageKey);
      if (!stored) {
        setFallbackHistory([]);
        return;
      }
      const parsed = JSON.parse(stored) as HistoryPoint[];
      setFallbackHistory(Array.isArray(parsed) ? parsed.slice(-5) : []);
    } catch {
      setFallbackHistory([]);
    }
  }, [historyStorageKey, isFusionView]);

  useEffect(() => {
    if (isFusionView) return;

    let cancelled = false;

    const fetchPrediction = async () => {
      try {
        const query = dataset ? `?dataset=${encodeURIComponent(dataset)}` : "";
        const res = await fetch(`${API_BASE}/api/prediction${query}`);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = (await res.json()) as PredictionData;
        if (cancelled) return;

        const currentScore = Number(data.prediction_score || 0);
        setMomentum(buildMomentum(previousScoreRef.current, currentScore));
        previousScoreRef.current = currentScore;

        if (!Array.isArray(data.history) || data.history.length === 0) {
          setFallbackHistory((previous) => {
            const next = [
              ...previous,
              {
                timestamp: new Date().toISOString(),
                score: currentScore,
                flags: Array.isArray(data.flags) ? data.flags : [],
              },
            ].slice(-5);
            localStorage.setItem(historyStorageKey, JSON.stringify(next));
            return next;
          });
        }

        setPred(data);
      } catch (err) {
        console.error("Prediction fetch failed", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchPrediction();
    const interval = setInterval(fetchPrediction, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [dataset, historyStorageKey, isFusionView]);

  if (loading) return <div className="forecast-panel loading">Loading threat forecast...</div>;

  if (isFusionView) {
    return (
      <div className="forecast-panel">
        <div className="forecast-header">
          <div>
            <div className="forecast-title">THREAT FORECAST ENGINE</div>
            <div className="forecast-subtitle">Dataset-scoped prediction only</div>
          </div>
          <div className="forecast-badge-row">
            <span className="forecast-mode-badge forecast-mode-fusion">FUSION READ ONLY</span>
            <span className="forecast-dataset-badge">{datasetLabel}</span>
          </div>
        </div>
        <div className="forecast-readonly-card">
          <div className="section-title">Prediction unavailable in fusion mode</div>
          <p>
            Prediction remains local to a single dataset. Switch the selector back to a local dataset to see live
            scenario, momentum, and history evolution.
          </p>
        </div>
      </div>
    );
  }

  if (!pred?.available) {
    return (
      <div className="forecast-panel empty">
        <div className="forecast-header">
          <div>
            <div className="forecast-title">THREAT FORECAST ENGINE</div>
            <div className="forecast-subtitle">Awaiting dataset prediction feed</div>
          </div>
          <div className="forecast-badge-row">
            <span className="forecast-mode-badge forecast-mode-local">LOCAL</span>
            <span className="forecast-dataset-badge">{datasetLabel}</span>
          </div>
        </div>
        No prediction data - run pipeline first.
      </div>
    );
  }

  const { prediction_score, flags, predicted_events, signal_analysis, prevention_suggestions } = pred;
  const threat = getThreatLevel(prediction_score);
  const currentPhase = getCurrentPhase(flags);
  const scenario = buildScenarioNarrative(flags, predicted_events, prediction_score);
  const historyPoints = (Array.isArray(pred.history) && pred.history.length ? pred.history : fallbackHistory).slice(-8);
  const historySource =
    Array.isArray(pred.history) && pred.history.length > 0 ? "Backend history stream" : "Local session fallback";
  const historyScores = historyPoints.map((point) => point.score);

  const signals = [
    { name: "IP Diversity", key: "unique_ips", value: signal_analysis?.unique_ips?.last || 0, trend: signal_analysis?.unique_ips?.trend_ratio || 1, color: "#a78bfa" },
    { name: "Failures/min", key: "failures", value: signal_analysis?.failures?.last || 0, trend: signal_analysis?.failures?.trend_ratio || 1, color: "#ef4444" },
    { name: "Username Diversity", key: "usernames", value: signal_analysis?.usernames?.last || 0, trend: signal_analysis?.usernames?.trend_ratio || 1, color: "#f59e0b" },
    { name: "FTP Activity", key: "ftp_events", value: signal_analysis?.ftp_events?.last || 0, trend: signal_analysis?.ftp_events?.trend_ratio || 1, color: "#10b981" },
    { name: "Kernel Errors", key: "kernel_errors", value: signal_analysis?.kernel_errors?.last || 0, trend: signal_analysis?.kernel_errors?.trend_ratio || 1, color: "#ec4899" },
  ];

  const activeFlags = flags.filter((flag) => FLAG_DESCRIPTIONS[flag]);
  const forecastItems = predicted_events.slice(0, 3).map((event) => {
    let direction = "->";
    let color = "#64748b";
    const lower = event.toLowerCase();

    if (lower.includes("imminent") || lower.includes("escalating")) {
      direction = "++";
      color = "#ef4444";
    } else if (lower.includes("incoming") || lower.includes("increasing")) {
      direction = "+";
      color = "#f97316";
    } else if (lower.includes("stable")) {
      direction = "->";
      color = "#f59e0b";
    } else if (lower.includes("decreasing")) {
      direction = "--";
      color = "#10b981";
    }

    return { text: event, direction, color };
  });

  return (
    <div className="forecast-panel">
      <div className="forecast-header">
        <div>
          <div className="forecast-title">THREAT FORECAST ENGINE</div>
          <div className="forecast-subtitle">Live dataset-scoped predictive intelligence</div>
        </div>
        <div className="forecast-badge-row">
          <span className="forecast-mode-badge forecast-mode-local">LOCAL</span>
          <span className="forecast-dataset-badge">{datasetLabel}</span>
          <span className="forecast-live-badge">LIVE</span>
        </div>
      </div>

      <div className="forecast-top">
        <div className="forecast-gauge">
          <svg viewBox="0 0 120 120" width="100" height="100">
            <circle cx="60" cy="60" r="50" fill="none" stroke="#1e293b" strokeWidth="8" />
            <circle
              cx="60"
              cy="60"
              r="50"
              fill="none"
              stroke={threat.color}
              strokeWidth="8"
              strokeDasharray={`${(prediction_score / 100) * 314} 314`}
              strokeLinecap="round"
              transform="rotate(-90 60 60)"
            />
            <text x="60" y="60" textAnchor="middle" dominantBaseline="middle" fill="#e2e8f0" fontSize="24" fontWeight="bold">
              {prediction_score}
            </text>
            <text x="60" y="80" textAnchor="middle" fill="#64748b" fontSize="8">
              /100
            </text>
          </svg>
          <div className="forecast-gauge-label">Prediction Score</div>
        </div>

        <div className="forecast-summary">
          <div className="forecast-threat" style={{ background: `${threat.color}20`, borderLeftColor: threat.color }}>
            <span className="label">Threat Level</span>
            <span className="value" style={{ color: threat.color }}>{threat.level}</span>
          </div>
          <div className="forecast-phase">
            <span className="label">Current Phase</span>
            <span className="value">{currentPhase}</span>
          </div>
        </div>

        <div className="forecast-momentum-card">
          <div className="section-title">Risk Momentum</div>
          <div className="forecast-momentum-head">
            <span className="forecast-momentum-direction" style={{ color: momentum.color }}>
              {momentum.direction}
            </span>
            <span className="forecast-momentum-label" style={{ color: momentum.color }}>
              {momentum.label}
            </span>
          </div>
          <div className="forecast-momentum-delta">
            {momentum.delta >= 0 ? "+" : ""}
            {momentum.delta} points
          </div>
          <div className="forecast-momentum-detail">{momentum.detail}</div>
        </div>
      </div>

      <div className="forecast-intel-grid">
        <div className="forecast-scenario-card">
          <div className="section-title">Prediction Scenario</div>
          <div className="forecast-scenario-title">{scenario.title}</div>
          <p className="forecast-scenario-copy">{scenario.summary}</p>
          <p className="forecast-scenario-outlook">{scenario.outlook}</p>
        </div>

        <div className="forecast-history-card">
          <div className="forecast-history-head">
            <div>
              <div className="section-title">Risk Trajectory</div>
              <div className="forecast-history-source">{historySource}</div>
            </div>
            <div className="forecast-history-count">{historyPoints.length} samples</div>
          </div>
          <div className="forecast-history-chart">
            <Sparkline data={historyScores} color={threat.color} />
          </div>
          <div className="forecast-history-points">
            {historyPoints.length === 0 && <span className="forecast-no-history">No historical samples available yet.</span>}
            {historyPoints.map((point) => (
              <div key={`${point.timestamp}-${point.score}`} className="forecast-history-point">
                <span>{formatHistoryTime(point.timestamp)}</span>
                <strong>{point.score}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="forecast-signals">
        <div className="section-title">Signal Intelligence</div>
        <div className="signal-grid">
          {signals.map((signal) => (
            <div key={signal.key} className="signal-card">
              <div className="signal-name">{signal.name}</div>
              <div className="signal-stats">
                <span className="signal-value">{signal.value}</span>
                <span
                  className="signal-trend"
                  style={{ color: signal.trend > 1.2 ? "#ef4444" : signal.trend < 0.8 ? "#10b981" : "#f59e0b" }}
                >
                  {signal.trend > 1.2 ? "ACCEL" : signal.trend > 1.05 ? "RISING" : signal.trend < 0.95 ? "COOLING" : "STEADY"}
                </span>
              </div>
              <div className="signal-ratio-bar">
                <span style={{ width: `${Math.min(Math.max(signal.trend * 45, 16), 100)}%`, background: signal.color }} />
              </div>
              <div className="signal-ratio-copy">Trend ratio {(signal.trend * 100).toFixed(0)}%</div>
            </div>
          ))}
        </div>
      </div>

      <div className="forecast-lower-grid">
        <div className="forecast-flags">
          <div className="section-title">Detection Flags</div>
          <div className="flags-container">
            {activeFlags.length === 0 && <div className="no-flags">No active flags - system stable</div>}
            {activeFlags.map((flag) => (
              <div key={flag} className="flag-item">
                <span className="flag-name">{flag.replace(/_/g, " ")}</span>
                <span className="flag-desc">{FLAG_DESCRIPTIONS[flag]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="forecast-events">
          <div className="section-title">Forecasted Events (Next 2h)</div>
          <div className="events-list">
            {forecastItems.map((item, index) => (
              <div key={`${item.text}-${index}`} className="event-item">
                <span className="event-arrow" style={{ color: item.color }}>
                  {item.direction}
                </span>
                <span className="event-text">{item.text}</span>
              </div>
            ))}
            {forecastItems.length === 0 && <div className="no-events">No imminent threats predicted</div>}
          </div>
        </div>
      </div>

      <div className="forecast-prevention">
        <div className="section-title">Operator Guidance</div>
        <div className="forecast-guidance-list">
          {(prevention_suggestions || []).slice(0, 3).map((item, index) => (
            <div key={`${item}-${index}`} className="forecast-guidance-item">
              {item}
            </div>
          ))}
          {(!prevention_suggestions || prevention_suggestions.length === 0) && (
            <div className="forecast-guidance-item">No additional prevention guidance published by the prediction engine.</div>
          )}
        </div>
      </div>

      <div className="forecast-footer">Updated live from the prediction engine using existing dataset-scoped analytics.</div>
    </div>
  );
};
