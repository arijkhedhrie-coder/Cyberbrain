import { useEffect, useState } from "react";
import type { TrustData } from "../../../shared/types/idps";
import "../../../shared/style/ForecastPanel.css";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";
const FUSION_DATASETS = new Set(["fusion", "__fusion__", "merged", "__merged__"]);

type SignalKey = "failures" | "unique_ips" | "usernames" | "ftp_events" | "kernel_errors";
type SignalMetric = { trend_ratio?: number; burst_ratio?: number; last?: number };
type SignalAnalysis = Partial<Record<SignalKey, SignalMetric>>;

interface PredictionData {
  available: boolean;
  prediction_score: number;
  flags: string[];
  predicted_events: string[];
  message?: string;
  analysis_mode?: string;
  timeline_characteristics?: {
    mode_reason?: string;
    minute_buckets?: number;
    activity_ratio?: number;
    peak_share?: number;
    active_minutes?: number;
    severity_high_share?: number;
  };
  risk_evolution: Array<{ time: string; risk: number; failures: number }>;
  behavioral_analysis?: {
    ssh_failures_trend: number;
    unique_ips_trend: number;
    username_diversity: number;
    ftp_activity: number;
    kernel_errors: number;
  };
  signal_analysis?: SignalAnalysis;
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
type ConcernSignal = {
  key: SignalKey;
  icon: string;
  title: string;
  narrative: string;
  deltaLabel: string;
  trend: number;
  burst: number;
  last: number;
  color: string;
  tone: string;
  intensity: number; // 0..1 for the animated bar
};
type ScenarioCard = {
  title: string;
  summary: string;
  riskLabel: string;
  riskColor: string;
  horizon: string;
  confidence: string;
};
type ConfidenceCard = { level: string; color: string; summary: string; scoreText: string };

const DEFAULT_MOMENTUM: MomentumState = {
  label: "STABLE",
  color: "#f59e0b",
  direction: "->",
  delta: 0,
  detail: "Point de depart enregistre. En attente d'un nouvel echantillon.",
};

const FLAG_DESCRIPTIONS: Record<string, string> = {
  BOTNET_WARMUP: "Progression graduelle du nombre d'IP sources, compatible avec une preparation distribuee.",
  SPRAY_PHASE: "Diversite des comptes en hausse, compatible avec une tentative sur plusieurs identifiants.",
  CRASH_COMING: "La stabilite systeme se degrade et peut annoncer une saturation du service.",
  DATA_EXFIL_START: "L'activite FTP ressemble a un deplacement ou une sortie de donnees.",
};

const SIGNAL_STYLES: Record<SignalKey, { icon: string; color: string }> = {
  unique_ips: { icon: "IP", color: "#7dd3fc" },
  usernames: { icon: "ID", color: "#fbbf24" },
  failures: { icon: "AU", color: "#fb7185" },
  ftp_events: { icon: "FT", color: "#34d399" },
  kernel_errors: { icon: "SY", color: "#c084fc" },
};

const getThreatLevel = (score: number, riskLevel?: string | null): { level: string; color: string } => {
  const normalized = String(riskLevel ?? "").trim().toUpperCase();
  if (normalized === "CRITICAL") return { level: "CRITIQUE", color: "#ef4444" };
  if (normalized === "HIGH") return { level: "ELEVEE", color: "#f97316" };
  if (normalized === "MEDIUM") return { level: "SURVEILLANCE", color: "#f59e0b" };
  if (normalized === "LOW") return { level: "NORMAL", color: "#22c55e" };
  if (score >= 75) return { level: "CRITIQUE", color: "#ef4444" };
  if (score >= 50) return { level: "ELEVEE", color: "#f97316" };
  if (score >= 25) return { level: "SURVEILLANCE", color: "#f59e0b" };
  return { level: "NORMAL", color: "#22c55e" };
};

const getCurrentPhase = (flags: string[]): string => {
  if (flags.includes("DATA_EXFIL_START")) return "SORTIE DE DONNEES";
  if (flags.includes("CRASH_COMING")) return "INSTABILITE SYSTEME";
  if (flags.includes("SPRAY_PHASE")) return "TENTATIVE MULTI-COMPTES";
  if (flags.includes("BOTNET_WARMUP")) return "MONTEE EN CHARGE SUSPECTE";
  return "SURVEILLANCE NORMALE";
};

const buildMomentumFromHistory = (historyPoints: HistoryPoint[]): MomentumState => {
  if (historyPoints.length < 2) return DEFAULT_MOMENTUM;
  const currentScore = Number(historyPoints[historyPoints.length - 1]?.score ?? 0);
  const previousScore = Number(historyPoints[historyPoints.length - 2]?.score ?? 0);
  const delta = currentScore - previousScore;
  if (delta >= 4)
    return {
      label: "ACCELERATING",
      color: "#ef4444",
      direction: "++",
      delta,
      detail: `Le score de prevision a augmente de ${delta} points depuis la derniere mise a jour.`,
    };
  if (delta <= -4)
    return {
      label: "DECREASING",
      color: "#22c55e",
      direction: "--",
      delta,
      detail: `Le score de prevision a baisse de ${Math.abs(delta)} points depuis la derniere mise a jour.`,
    };
  return {
    label: "STABLE",
    color: "#f59e0b",
    direction: "->",
    delta,
    detail: `Le score de prevision a varie de ${delta} points depuis la derniere mise a jour.`,
  };
};

const prettifyDataset = (dataset: string): string => {
  if (!dataset) return "UNSPECIFIED DATASET";
  return dataset
    .replace(/^__|__$/g, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

const parseTimestamp = (timestamp: string): number | null => {
  const value = new Date(timestamp).getTime();
  return Number.isNaN(value) ? null : value;
};

const formatDuration = (ms: number): string => {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest}`;
};

const getTrendSummary = (historyPoints: HistoryPoint[], momentum: MomentumState): string => {
  if (historyPoints.length < 2) return "Historique insuffisant";
  const first = parseTimestamp(historyPoints[0].timestamp);
  const last = parseTimestamp(historyPoints[historyPoints.length - 1].timestamp);
  if (first == null || last == null || last <= first) return "Historique recent";
  const windowText = formatDuration(last - first);
  if (momentum.label === "ACCELERATING") return `En hausse sur ${windowText}`;
  if (momentum.label === "DECREASING") return `En baisse sur ${windowText}`;
  return `Stable depuis ${windowText}`;
};

const formatTrendDelta = (ratio: number): string => {
  const percent = Math.round((ratio - 1) * 100);
  return `${percent >= 0 ? "+" : ""}${percent}%`;
};

const humanizeBackendExplanation = (text: string): string => {
  const normalized = text.trim();
  if (!normalized) return normalized;
  const map: Record<string, string> = {
    "SSH authentication failures increasing abnormally":
      "Les echecs d'authentification SSH augmentent de facon anormale.",
    "Multiple distributed IPs detected - potential botnet warmup":
      "Le systeme observe plusieurs IP distribuees, compatibles avec une phase de preparation.",
    "Username diversity spike observed - spray phase likely":
      "La diversite des comptes cibles augmente fortement, compatible avec une phase de spray.",
    "FTP retrieval behavior abnormal - possible data exfiltration":
      "Le comportement FTP est inhabituel et peut indiquer un transfert suspect.",
    "Kernel instability increasing - system crash risk elevated":
      "L'instabilite systeme augmente et le risque de degradation se renforce.",
  };
  return map[normalized] ?? normalized;
};

const getModeLabel = (analysisMode?: string, modeReason?: string): string => {
  const mode = String(analysisMode ?? "").trim();
  if (mode === "long_timeline_forecast") return "LONG TERME";
  if (mode === "short_burst_predictive") return "RAFALES COURTES";
  const reason = String(modeReason ?? "").trim();
  return reason ? reason.replace(/[_-]+/g, " ").toUpperCase() : "MODE ACTUEL";
};

const getEventTitle = (event: string): string => {
  const normalized = String(event ?? "").trim().toUpperCase();
  if (normalized === "DATA_THEFT_IN_PROGRESS") return "EXFILTRATION DE DONNEES";
  if (normalized === "SYSTEM_FAILURE_IMMINENT") return "SATURATION SYSTEME";
  if (normalized === "BRUTE_FORCE_INCOMING") return "BRUTE FORCE MULTI-COMPTES";
  if (normalized === "DISTRIBUTED_ATTACK_IMMINENT") return "ATTAQUE DISTRIBUEE EN PREPARATION";
  return normalized.replace(/_/g, " ");
};

const getFlagTitle = (flag: string): string => {
  const normalized = String(flag ?? "").trim().toUpperCase();
  if (normalized === "DATA_EXFIL_START") return "SORTIE DE DONNEES SUSPECTE";
  if (normalized === "CRASH_COMING") return "INSTABILITE SYSTEME";
  if (normalized === "SPRAY_PHASE") return "PRESSION MULTI-COMPTES";
  if (normalized === "BOTNET_WARMUP") return "MONTEE EN CHARGE SUSPECTE";
  return normalized.replace(/_/g, " ");
};

const resolveSignal = (sa: SignalAnalysis | undefined, key: SignalKey): SignalMetric => sa?.[key] ?? {};

const buildConcernSignals = (sa: SignalAnalysis | undefined, flags: string[]): ConcernSignal[] => {
  const failures = resolveSignal(sa, "failures");
  const uniqueIps = resolveSignal(sa, "unique_ips");
  const usernames = resolveSignal(sa, "usernames");
  const ftpEvents = resolveSignal(sa, "ftp_events");
  const kernelErrors = resolveSignal(sa, "kernel_errors");

  const raw = [
    {
      key: "unique_ips" as SignalKey,
      title: "Hausse inhabituelle des IPs sources",
      narrative:
        uniqueIps.trend_ratio && uniqueIps.trend_ratio >= 1.35
          ? "Le nombre de sources distinctes grimpe rapidement sur la fenetre observee."
          : "De nouvelles IPs apparaissent plus vite que d'habitude dans les journaux surveilles.",
      trend: uniqueIps.trend_ratio ?? 1,
      burst: uniqueIps.burst_ratio ?? 1,
      last: uniqueIps.last ?? 0,
      flagBoost: flags.includes("BOTNET_WARMUP"),
    },
    {
      key: "usernames" as SignalKey,
      title: "Diversite des comptes cibles",
      narrative:
        usernames.trend_ratio && usernames.trend_ratio >= 1.35
          ? "La variete des comptes touches augmente fortement sur la fenetre observee."
          : "Le systeme voit davantage de comptes differents concernes par les tentatives recentes.",
      trend: usernames.trend_ratio ?? 1,
      burst: usernames.burst_ratio ?? 1,
      last: usernames.last ?? 0,
      flagBoost: flags.includes("SPRAY_PHASE"),
    },
    {
      key: "failures" as SignalKey,
      title: "Multiplication des echecs d'authentification",
      narrative:
        failures.burst_ratio && failures.burst_ratio >= 1.35
          ? "Les echecs se concentrent sur un court laps de temps."
          : "Les refus d'authentification s'accumulent au-dela du rythme habituel.",
      trend: failures.trend_ratio ?? 1,
      burst: failures.burst_ratio ?? 1,
      last: failures.last ?? 0,
      flagBoost: flags.includes("SPRAY_PHASE"),
    },
    {
      key: "ftp_events" as SignalKey,
      title: "Activite FTP anormale",
      narrative:
        ftpEvents.burst_ratio && ftpEvents.burst_ratio >= 1.4
          ? "Les flux FTP se densifient rapidement sur la fenetre observee."
          : "Une activite FTP plus soutenue qu'attendu merite une verification rapide.",
      trend: ftpEvents.trend_ratio ?? 1,
      burst: ftpEvents.burst_ratio ?? 1,
      last: ftpEvents.last ?? 0,
      flagBoost: flags.includes("DATA_EXFIL_START"),
    },
    {
      key: "kernel_errors" as SignalKey,
      title: "Instabilite systeme detectee",
      narrative:
        kernelErrors.burst_ratio && kernelErrors.burst_ratio >= 1.3
          ? "Les erreurs systeme montent brutalement sur la fenetre observee."
          : "Le bruit systeme augmente par rapport au niveau habituel.",
      trend: kernelErrors.trend_ratio ?? 1,
      burst: kernelErrors.burst_ratio ?? 1,
      last: kernelErrors.last ?? 0,
      flagBoost: flags.includes("CRASH_COMING"),
    },
  ];

  return raw
    .filter((s) => s.flagBoost || s.trend >= 1.08 || s.burst >= 1.2)
    .sort((a, b) => Math.max(b.trend, b.burst) - Math.max(a.trend, a.burst))
    .map((s) => {
      const primary = Math.max(s.trend, s.burst);
      const tone = primary >= 1.4 ? "FORTE HAUSSE" : primary >= 1.2 ? "HAUSSE" : "A SURVEILLER";
      const style = SIGNAL_STYLES[s.key];
      // map ratio [1 .. 1.8] -> [0.15 .. 1]
      const intensity = Math.max(0.15, Math.min(1, (primary - 1) / 0.8 + 0.15));
      return {
        key: s.key,
        icon: style.icon,
        title: s.title,
        narrative: s.narrative,
        deltaLabel: formatTrendDelta(primary),
        trend: s.trend,
        burst: s.burst,
        last: s.last,
        color: style.color,
        tone,
        intensity,
      };
    });
};

const buildScenarioNarrative = (
  flags: string[],
  predictedEvents: string[],
  predictionMessage: string | undefined,
  explanations: string[],
  preventionSuggestions: string[],
): { title: string; summary: string; outlook: string } => {
  const title =
    predictedEvents.length > 0
      ? getEventTitle(predictedEvents[0])
      : flags.length > 0
      ? getFlagTitle(flags[0])
      : "Lecture predictive en cours";
  const summary =
    explanations.length > 0
      ? humanizeBackendExplanation(explanations[0])
      : predictionMessage?.trim() || "Aucune explication detaillee n'a ete publiee par le backend.";
  const outlook =
    preventionSuggestions[0]?.trim() ||
    (explanations.length > 1 ? humanizeBackendExplanation(explanations[1]) : "") ||
    "Aucune projection supplementaire publiee pour le moment.";
  return {
    title,
    summary,
    outlook,
  };
};

const buildScenarioCards = (
  predictedEvents: string[],
  explanations: string[],
  riskLabel: string,
  riskColor: string,
  modeLabel: string,
  confidenceLevel: string,
): ScenarioCard[] => {
  return predictedEvents.slice(0, 3).map((event, index) => ({
    title: getEventTitle(event),
    summary:
      explanations[index] != null
        ? humanizeBackendExplanation(explanations[index])
        : "Signal publie par le moteur predictif pour cette source.",
    riskLabel,
    riskColor,
    horizon: modeLabel,
    confidence: confidenceLevel,
  }));
};

const buildConfidenceCard = (trust: TrustData | null | undefined): ConfidenceCard => {
  if (!trust?.available || trust.confidence_in_metrics == null)
    return { level: "Indisponible", color: "#94a3b8", summary: "Le niveau de confiance n'est pas encore consolide pour cette source.", scoreText: "—" };
  const confidence = trust.confidence_in_metrics;
  if (confidence >= 0.8)
    return {
      level: "Eleve",
      color: "#22c55e",
      summary:
        trust.model_agreement != null && trust.model_agreement >= 0.75
          ? "Le comportement actuel ressemble fortement a des schemas deja observes et relativement coherents entre modeles."
          : "Les signaux restent suffisamment coherents pour soutenir une lecture fiable de la situation.",
      scoreText: `${Math.round(confidence * 100)}%`,
    };
  if (confidence >= 0.55)
    return {
      level: "Moyen",
      color: "#f59e0b",
      summary: trust.drift_flagged
        ? "Le systeme voit des indices utiles, mais le contexte evolue vite. Il faut confirmer avant de conclure."
        : "Plusieurs indices pointent dans la meme direction, mais une partie du signal reste encore bruitée.",
      scoreText: `${Math.round(confidence * 100)}%`,
    };
  return {
    level: "Faible",
    color: "#fb7185",
    summary:
      trust.false_positive_rate != null && trust.false_positive_rate > 0.35
        ? "Les alertes restent peu correlees entre elles. La lecture predictive doit etre interpretee avec prudence."
        : "Le systeme manque encore d'indices assez convergents pour produire une anticipation robuste.",
    scoreText: `${Math.round(confidence * 100)}%`,
  };
};

/* =========================================================================
   ===== INLINE STYLE TOKENS (Aurora Noir to match the other tabs) =========
   ========================================================================= */
const C = {
  bg: "#06080f",
  panel: "rgba(15,20,35,0.55)",
  panelStrong: "rgba(18,24,42,0.78)",
  border: "rgba(120,140,200,0.14)",
  borderStrong: "rgba(120,140,200,0.28)",
  text: "#eef0fa",
  sub: "#9aa3bd",
  dim: "#6b7392",
  cyan: "#22d3ee",
  purple: "#a78bfa",
  green: "#34d399",
  amber: "#fbbf24",
  orange: "#f97316",
  red: "#fb7185",
  font: "'Space Grotesk', system-ui, -apple-system, sans-serif",
};

const STYLE_ID = "forecast-panel-styles-v2";
const ANIMATIONS = `
@keyframes fpFadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@keyframes fpPulse { 0%,100% { opacity: 1; box-shadow: 0 0 0 0 currentColor; } 50% { opacity: .55; box-shadow: 0 0 0 8px transparent; } }
@keyframes fpShimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
@keyframes fpFill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes fpRotateGlow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.fp-fade-up { animation: fpFadeUp .55s cubic-bezier(.2,.7,.2,1) both; }
.fp-card { transition: transform .25s ease, border-color .25s ease, background .25s ease; }
.fp-card:hover { transform: translateY(-3px); border-color: rgba(167,139,250,0.45) !important; }
.fp-bar-fill { transform-origin: left center; animation: fpFill .9s cubic-bezier(.2,.7,.2,1) both; }
.fp-dot-live { animation: fpPulse 1.6s ease-in-out infinite; }
.fp-shimmer { background: linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent); background-size: 200% 100%; animation: fpShimmer 3s linear infinite; }
.fp-chip { transition: transform .2s ease, background .2s ease; }
.fp-chip:hover { transform: translateY(-2px); background: rgba(167,139,250,0.12); }
`;
const ensureStyles = () => {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const tag = document.createElement("style");
  tag.id = STYLE_ID;
  tag.textContent = ANIMATIONS;
  document.head.appendChild(tag);
};

/* =========================================================================
   ===== Small visual building blocks ======================================
   ========================================================================= */

function SectionHeader({ kicker, title, subtitle }: { kicker?: string; title: string; subtitle?: string }) {
  return (
    <div style={{ textAlign: "center", marginBottom: 28 }} className="fp-fade-up">
      {kicker && (
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: C.cyan,
            fontWeight: 700,
            marginBottom: 8,
          }}
        >
          {kicker}
        </div>
      )}
      <h2 style={{ fontSize: 24, fontWeight: 700, color: C.text, margin: 0, letterSpacing: "-0.01em" }}>{title}</h2>
      {subtitle && (
        <p style={{ marginTop: 10, color: C.sub, fontSize: 14, maxWidth: 640, marginInline: "auto", lineHeight: 1.55 }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
  hint,
  delay = 0,
}: {
  label: string;
  value: React.ReactNode;
  color: string;
  hint?: string;
  delay?: number;
}) {
  return (
    <div
      className="fp-fade-up fp-card"
      style={{
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 16,
        padding: "22px 20px",
        textAlign: "center",
        backdropFilter: "blur(12px)",
        animationDelay: `${delay}ms`,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: C.dim,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 34,
          fontWeight: 700,
          color,
          marginTop: 12,
          lineHeight: 1,
          fontFeatureSettings: "'tnum'",
        }}
      >
        {value}
      </div>
      {hint && <div style={{ marginTop: 10, fontSize: 11, color: C.sub }}>{hint}</div>}
      <div
        className="fp-shimmer"
        style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.4 }}
      />
    </div>
  );
}

function Sparkline({ data, width = 220, height = 44, color = C.cyan }: { data: number[]; width?: number; height?: number; color?: string }) {
  if (!data.length) return <span style={{ color: C.dim, fontSize: 12 }}>Pas encore de tendance</span>;
  if (data.length === 1)
    return (
      <svg width={width} height={height}>
        <circle cx={width / 2} cy={height / 2} r="4" fill={color} />
      </svg>
    );
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  const area = `0,${height} ${pts} ${width},${height}`;
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <defs>
        <linearGradient id={`grad-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#grad-${color.replace("#", "")})`} />
      <polyline fill="none" stroke={color} strokeWidth="2" points={pts} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* =========================================================================
   ===== MAIN COMPONENT ====================================================
   ========================================================================= */

interface Props {
  dataset?: string;
  trust?: TrustData | null;
}

export const ForecastPanel = ({ dataset = "", trust = null }: Props) => {
  const [pred, setPred] = useState<PredictionData | null>(null);
  const [loading, setLoading] = useState(true);
  const isFusionView = FUSION_DATASETS.has(dataset.toLowerCase());
  const datasetLabel = prettifyDataset(dataset);

  useEffect(() => {
    ensureStyles();
  }, []);

  useEffect(() => {
    setPred(null);
    setLoading(!isFusionView);
  }, [isFusionView]);

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
  }, [dataset, isFusionView]);

  /* --------- States: loading / fusion / empty (kept, restyled) --------- */
  if (loading)
    return (
      <div style={{ fontFamily: C.font, color: C.sub, padding: 48, textAlign: "center" }}>Chargement de la prevision...</div>
    );

  if (isFusionView)
    return (
      <div style={{ fontFamily: C.font, padding: 32 }}>
        <SectionHeader kicker="Prevision" title="Prevision & Risque Anticipe" subtitle="Disponible uniquement source par source." />
        <div
          style={{
            background: C.panel,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            padding: 28,
            color: C.sub,
            textAlign: "center",
          }}
        >
          La prevision reste locale a une seule source. Revenez a une source locale pour voir le scenario, l'evolution du risque
          et l'historique.
        </div>
      </div>
    );

  if (!pred?.available)
    return (
      <div style={{ fontFamily: C.font, padding: 32 }}>
        <SectionHeader kicker="Prevision" title="Prevision & Risque Anticipe" subtitle="En attente des donnees de prevision." />
        <div
          style={{
            background: C.panel,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            padding: 28,
            color: C.sub,
            textAlign: "center",
          }}
        >
          Aucune donnee de prevision pour le moment.
        </div>
      </div>
    );

  /* --------- Derived (kept identical) --------- */
  const { prediction_score, flags, predicted_events, signal_analysis, prevention_suggestions } = pred;
  const threat = getThreatLevel(prediction_score, pred.risk_level);
  const currentPhase = getCurrentPhase(flags);
  const historyPoints = (Array.isArray(pred.history) ? pred.history : []).slice(-8);
  const historyScores = historyPoints.map((p) => p.score);
  const momentum = buildMomentumFromHistory(historyPoints);
  const concernSignals = buildConcernSignals(signal_analysis, flags);
  const trendSummary = getTrendSummary(historyPoints, momentum);
  const backendExplanations = Array.isArray(pred.explanations) ? pred.explanations : [];
  const modeLabel = getModeLabel(pred.analysis_mode, pred.timeline_characteristics?.mode_reason);
  const scenario = buildScenarioNarrative(
    flags,
    predicted_events,
    pred.message,
    backendExplanations,
    prevention_suggestions,
  );
  const confidenceCard = buildConfidenceCard(trust);
  const scenarioCards = buildScenarioCards(
    predicted_events,
    backendExplanations,
    threat.level,
    threat.color,
    modeLabel,
    confidenceCard.level,
  );

  return (
    <div style={{ fontFamily: C.font, color: C.text, padding: "8px 4px 32px" }}>
      {/* ============== HEADER ============== */}
      <SectionHeader
        kicker={`Source · ${datasetLabel}`}
        title="Prevision & Risque Anticipe"
        subtitle="Analyse comportementale des signaux faibles et evolutions suspectes detectees dans les journaux."
      />

      {/* ============== SECTION 1 — STAT CARDS ============== */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 16,
          marginBottom: 44,
        }}
      >
        <StatCard label="Score Anticipe" value={prediction_score} color={threat.color} hint={`${threat.level} · ${trendSummary}`} delay={0} />
        <StatCard label="Phase Actuelle" value={<span style={{ fontSize: 18 }}>{currentPhase}</span>} color={C.purple} delay={80} />
        <StatCard
          label="Momentum"
          value={`${momentum.delta >= 0 ? "+" : ""}${momentum.delta} pts`}
          color={momentum.color}
          hint={momentum.label}
          delay={160}
        />
        <StatCard
          label="Confiance Systeme"
          value={confidenceCard.scoreText}
          color={confidenceCard.color}
          hint={confidenceCard.level}
          delay={240}
        />
      </div>

      {/* ============== SECTION 2 — RISK CURVE (creative, no cards) ============== */}
      <section style={{ marginBottom: 56 }} className="fp-fade-up">
        <SectionHeader title="Evolution du score de risque" subtitle="Lecture rapide de l'historique recent capture pour cette source." />
        <div
          style={{
            background: C.panel,
            border: `1px solid ${C.border}`,
            borderRadius: 20,
            padding: "28px 32px",
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) 280px",
            gap: 32,
            alignItems: "center",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* radial glow accent */}
          <div
            style={{
              position: "absolute",
              right: -120,
              top: -120,
              width: 360,
              height: 360,
              background: `radial-gradient(circle, ${threat.color}22 0%, transparent 65%)`,
              pointerEvents: "none",
            }}
          />
          <div style={{ position: "relative" }}>
            <Sparkline data={historyScores} width={620} height={120} color={threat.color} />
            <div style={{ marginTop: 16, color: C.sub, fontSize: 13, lineHeight: 1.6 }}>{momentum.detail}</div>
          </div>
          <div style={{ position: "relative", textAlign: "center" }}>
            {/* circular gauge */}
            <div style={{ position: "relative", width: 180, height: 180, margin: "0 auto" }}>
              <svg viewBox="0 0 120 120" width="180" height="180">
                <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
                <circle
                  cx="60"
                  cy="60"
                  r="50"
                  fill="none"
                  stroke={threat.color}
                  strokeWidth="6"
                  strokeDasharray={`${(prediction_score / 100) * 314} 314`}
                  strokeLinecap="round"
                  transform="rotate(-90 60 60)"
                  style={{ transition: "stroke-dasharray 1s ease" }}
                />
              </svg>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div style={{ fontSize: 44, fontWeight: 700, color: C.text, lineHeight: 1 }}>{prediction_score}</div>
                <div style={{ fontSize: 11, color: C.dim, marginTop: 4, letterSpacing: "0.15em" }}>/ 100</div>
              </div>
            </div>
            <div
              style={{
                marginTop: 14,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 14px",
                borderRadius: 999,
                color: threat.color,
                border: `1px solid ${threat.color}55`,
                fontSize: 11,
                letterSpacing: "0.18em",
                fontWeight: 700,
              }}
            >
              <span
                className="fp-dot-live"
                style={{ width: 8, height: 8, borderRadius: "50%", background: threat.color, color: threat.color }}
              />
              {threat.level}
            </div>
          </div>
        </div>
      </section>

      {/* ============== SECTION 3 — SIGNAL LEADERBOARD (creative, bars) ============== */}
      <section style={{ marginBottom: 56 }} className="fp-fade-up">
        <SectionHeader
          kicker="Diagnostic"
          title="Pourquoi le systeme s'inquiete"
          subtitle="Traduction operationnelle des signaux qui s'accelerent en ce moment."
        />
        {concernSignals.length === 0 ? (
          <div
            style={{
              background: C.panel,
              border: `1px solid ${C.border}`,
              borderRadius: 16,
              padding: 28,
              color: C.sub,
              textAlign: "center",
            }}
          >
            Aucun signal faible ne s'accelere de facon marquante. Le moteur reste actif sans motif d'inquietude prioritaire.
          </div>
        ) : (
          <div
            style={{
              background: C.panelStrong,
              border: `1px solid ${C.border}`,
              borderRadius: 20,
              padding: "10px 4px",
            }}
          >
            {concernSignals.map((s, i) => (
              <div
                key={s.key}
                className="fp-fade-up"
                style={{
                  display: "grid",
                  gridTemplateColumns: "44px minmax(0,1fr) 96px",
                  gap: 18,
                  alignItems: "center",
                  padding: "16px 22px",
                  borderBottom: i < concernSignals.length - 1 ? `1px solid ${C.border}` : "none",
                  animationDelay: `${i * 90}ms`,
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: `${s.color}18`,
                    border: `1px solid ${s.color}55`,
                    color: s.color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: 12,
                    letterSpacing: "0.05em",
                  }}
                >
                  {s.icon}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                    <strong style={{ color: C.text, fontSize: 14 }}>{s.title}</strong>
                    <span
                      style={{
                        fontSize: 10,
                        letterSpacing: "0.16em",
                        padding: "2px 8px",
                        borderRadius: 999,
                        color: s.color,
                        background: `${s.color}14`,
                        border: `1px solid ${s.color}33`,
                        fontWeight: 700,
                      }}
                    >
                      {s.tone}
                    </span>
                  </div>
                  <div style={{ color: C.sub, fontSize: 12.5, lineHeight: 1.5, marginBottom: 10 }}>{s.narrative}</div>
                  <div style={{ position: "relative", height: 6, background: "rgba(255,255,255,0.04)", borderRadius: 999, overflow: "hidden" }}>
                    <div
                      className="fp-bar-fill"
                      style={{
                        width: `${Math.round(s.intensity * 100)}%`,
                        height: "100%",
                        background: `linear-gradient(90deg, ${s.color}aa, ${s.color})`,
                        borderRadius: 999,
                        boxShadow: `0 0 12px ${s.color}66`,
                      }}
                    />
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.deltaLabel}</div>
                  <div style={{ fontSize: 10, color: C.dim, marginTop: 4, letterSpacing: "0.1em" }}>
                    NIVEAU {s.last}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ============== SECTION 4 — NARRATIVE READING ============== */}
      <section style={{ marginBottom: 56 }} className="fp-fade-up">
        <SectionHeader title="Lecture operationnelle" subtitle="Ce que le systeme comprend de la situation actuelle." />
        <div
          style={{
            background: `linear-gradient(135deg, ${C.panelStrong} 0%, rgba(30,20,50,0.55) 100%)`,
            border: `1px solid ${C.borderStrong}`,
            borderRadius: 20,
            padding: "32px 40px",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: -100,
              bottom: -100,
              width: 320,
              height: 320,
              background: `radial-gradient(circle, ${C.purple}22 0%, transparent 65%)`,
              pointerEvents: "none",
            }}
          />
          <div style={{ position: "relative", maxWidth: 820, marginInline: "auto", textAlign: "center" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.22em", color: C.purple, textTransform: "uppercase", fontWeight: 700, marginBottom: 12 }}>
              Scenario detecte
            </div>
            <h3 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: "0 0 16px" }}>{scenario.title}</h3>
            <p style={{ color: C.sub, fontSize: 14.5, lineHeight: 1.7, margin: 0 }}>{scenario.summary}</p>
            <div
              style={{
                marginTop: 22,
                paddingTop: 22,
                borderTop: `1px solid ${C.border}`,
                color: C.text,
                fontSize: 13.5,
                lineHeight: 1.65,
                fontStyle: "italic",
              }}
            >
              {scenario.outlook}
            </div>
            <div
              style={{
                marginTop: 22,
                display: "inline-block",
                padding: "8px 18px",
                borderRadius: 999,
                background: `${confidenceCard.color}14`,
                border: `1px solid ${confidenceCard.color}44`,
                color: confidenceCard.color,
                fontSize: 11,
                letterSpacing: "0.16em",
                fontWeight: 700,
              }}
            >
              CONFIANCE {confidenceCard.level.toUpperCase()} · {confidenceCard.scoreText}
            </div>
          </div>
        </div>
      </section>

      {/* ============== SECTION 5 — SCENARIO CARDS (horizontal) ============== */}
      {scenarioCards.length > 0 && (
        <section style={{ marginBottom: 56 }} className="fp-fade-up">
          <SectionHeader kicker="Anticipation" title="Ce qui pourrait arriver ensuite" subtitle="Scenarios possibles a partir des indices actuels." />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.min(scenarioCards.length, 3)}, minmax(0,1fr))`,
              gap: 18,
            }}
          >
            {scenarioCards.map((card, i) => (
              <div
                key={`${card.title}-${i}`}
                className="fp-fade-up fp-card"
                style={{
                  background: C.panel,
                  border: `1px solid ${card.riskColor}33`,
                  borderRadius: 18,
                  padding: "22px 22px 20px",
                  position: "relative",
                  overflow: "hidden",
                  animationDelay: `${i * 100}ms`,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 3,
                    background: `linear-gradient(90deg, ${card.riskColor}, transparent)`,
                  }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <span
                    style={{
                      fontSize: 10,
                      letterSpacing: "0.18em",
                      fontWeight: 700,
                      color: card.riskColor,
                      padding: "4px 10px",
                      borderRadius: 999,
                      background: `${card.riskColor}14`,
                      border: `1px solid ${card.riskColor}44`,
                    }}
                  >
                    {card.riskLabel}
                  </span>
                  <span style={{ fontSize: 11, color: C.dim, letterSpacing: "0.1em" }}>{card.horizon}</span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 10, letterSpacing: "0.01em" }}>
                  {card.title}
                </div>
                <p style={{ color: C.sub, fontSize: 13, lineHeight: 1.6, margin: "0 0 18px" }}>{card.summary}</p>
                <div
                  style={{
                    paddingTop: 14,
                    borderTop: `1px solid ${C.border}`,
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 11,
                    color: C.dim,
                  }}
                >
                  <span style={{ letterSpacing: "0.12em" }}>CONFIANCE</span>
                  <strong style={{ color: C.text }}>{card.confidence}</strong>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ============== SECTION 6 — BEHAVIORAL FLAGS (chips) ============== */}
      {flags.length > 0 && (
        <section style={{ marginBottom: 56 }} className="fp-fade-up">
          <SectionHeader title="Signatures comportementales" subtitle="Motifs detectes dans le flux courant." />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
            {flags.map((flag, i) => (
              <div
                key={flag}
                className="fp-chip fp-fade-up"
                style={{
                  background: "rgba(167,139,250,0.06)",
                  border: `1px solid ${C.borderStrong}`,
                  borderRadius: 14,
                  padding: "12px 18px",
                  maxWidth: 340,
                  animationDelay: `${i * 80}ms`,
                }}
                title={FLAG_DESCRIPTIONS[flag] || flag}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: C.purple, letterSpacing: "0.1em" }}>{flag}</div>
                {FLAG_DESCRIPTIONS[flag] && (
                  <div style={{ marginTop: 6, fontSize: 12, color: C.sub, lineHeight: 1.5 }}>
                    {FLAG_DESCRIPTIONS[flag]}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ============== SECTION 7 — GUIDANCE (numbered narrative) ============== */}
      <section style={{ marginBottom: 24 }} className="fp-fade-up">
        <SectionHeader title="Conseils de surveillance" subtitle="A garder a l'oeil dans les prochaines minutes." />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 16,
          }}
        >
          {((prevention_suggestions && prevention_suggestions.length ? prevention_suggestions : ["Aucun conseil supplementaire publie pour le moment."]) ?? [])
            .slice(0, 3)
            .map((item, idx) => (
              <div
                key={`${item}-${idx}`}
                className="fp-card fp-fade-up"
                style={{
                  position: "relative",
                  background: C.panel,
                  border: `1px solid ${C.border}`,
                  borderRadius: 16,
                  padding: "22px 22px 22px 64px",
                  color: C.text,
                  fontSize: 13.5,
                  lineHeight: 1.6,
                  animationDelay: `${idx * 90}ms`,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 18,
                    top: 20,
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: `linear-gradient(135deg, ${C.cyan}, ${C.purple})`,
                    color: "#0b0f1e",
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                  }}
                >
                  {idx + 1}
                </div>
                {item}
              </div>
            ))}
        </div>
      </section>

      <div style={{ textAlign: "center", fontSize: 11, color: C.dim, letterSpacing: "0.12em", marginTop: 12 }}>
        MISE A JOUR AUTOMATIQUE · ANALYSE LOCALE · {datasetLabel.toUpperCase()}
      </div>
    </div>
  );
};

export default ForecastPanel;
