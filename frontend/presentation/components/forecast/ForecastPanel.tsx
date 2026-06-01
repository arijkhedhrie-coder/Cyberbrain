import { useEffect, useState } from "react";
import type { TrustData } from "../../../shared/types/idps";
import "../../../shared/style/ForecastPanel.css";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";
const FUSION_DATASETS = new Set(["fusion", "__fusion__", "merged", "__merged__"]);

type SignalKey = "failures" | "unique_ips" | "usernames" | "ftp_events" | "kernel_errors";
type SignalMetric = { trend_ratio?: number; burst_ratio?: number; last?: number };
type SignalAnalysis = Partial<Record<SignalKey, SignalMetric>>;
type ForecastEvidenceItem = {
  label?: string;
  value?: string;
  detail?: string;
  weight?: number;
  tone?: string;
  source?: string;
};
type ForecastContext = {
  available?: boolean;
  generated_from?: string;
  summary?: string;
  dominant_engine?: string;
  dominant_label?: string;
  dominant_reason?: string;
  model_context?: {
    agreement?: number | null;
    models_agreed?: number | null;
    agreement_label?: string;
    trust_score?: number | null;
    trust_label?: string;
    drift_label?: string;
    stability?: string;
    signals_summary?: string;
  };
  top_alarm?: {
    engine?: string;
    type?: string;
    score?: number | null;
    source_ip?: string;
    human_insight?: string;
    message?: string;
    failures?: number | null;
  };
  evidence?: ForecastEvidenceItem[];
  engine_contributions?: Array<{
    engine: string;
    alarms: number;
    status: string;
    pass1?: number | null;
    pass2?: number | null;
    rerun_p2?: boolean;
  }>;
  threshold_context?: {
    engine?: string;
    pass?: string | number;
    threshold?: number | null;
    pass1?: number | null;
    pass2?: number | null;
    changed?: boolean;
    gate_mode?: string | null;
    gate_accepted?: boolean;
    threat_level?: string;
    confidence?: number | null;
  };
  prediction_context?: {
    score?: number;
    risk_level?: string;
    flags?: string[];
    explanations?: string[];
    message?: string;
  };
  fallback_events?: string[];
  fallback_flags?: string[];
  fallback_explanations?: string[];
  fallback_suggestions?: string[];
  presentation_ready?: boolean;
};

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
  forecast_context?: ForecastContext;
}

type HistoryPoint = {
  timestamp: string;
  score: number;
  flags: string[];
  risk_level?: string;
  analysis_mode?: string;
  predicted_events?: string[];
  message?: string;
  explanations?: string[];
  timeline_characteristics?: Record<string, unknown>;
  signal_summary?: Record<string, unknown>;
};
type MomentumState = {
  label: "ACCELERATING" | "STABLE" | "DECREASING";
  color: string;
  direction: string;
  delta: number;
  detail: string;
};
type ConcernSignal = {
  key: string;
  styleKey: SignalKey;
  icon: string;
  title: string;
  narrative: string;
  deltaLabel: string;
  trend: number;
  burst: number;
  last: number;
  color: string;
  tone: string;
  intensity: number;
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
  detail: "Point de départ enregistré. En attente de la prochaine prévision.",
};

const FLAG_DESCRIPTIONS: Record<string, string> = {
  BOTNET_WARMUP: "Plusieurs machines sources apparaissent. Cela ressemble à une préparation.",
  SPRAY_PHASE: "Plusieurs comptes sont visés. Cela ressemble à une tentative large.",
  CRASH_COMING: "Le système semble plus fragile. Il peut se saturer.",
  DATA_EXFIL_START: "L'activité FTP ressemble à un possible transfert de données.",
  DOMINANT_SSH: "Le SSH est la piste la plus visible.",
  DOMINANT_WEB: "Le web ressort le plus.",
  DOMINANT_FTP: "Le FTP attire le plus l'attention.",
  DOMINANT_KERNEL: "La stabilité du système attire surtout l'attention.",
  DOMINANT_SESSION: "La session est le signal le plus visible.",
  DOMINANT_CORRELATION: "Plusieurs indices vont dans le même sens.",
  THRESHOLD_SHIFT: "Le niveau de sensibilité a changé.",
  MODEL_AGREEMENT_HIGH: "Les modèles disent globalement la même chose.",
  HIGH_TRUST: "Les données sont assez solides.",
  PRIMARY_SIGNAL: "Le système a retenu le signal le plus fort.",
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
  if (normalized === "HIGH") return { level: "ÉLEVÉE", color: "#f97316" };
  if (normalized === "MEDIUM") return { level: "SURVEILLANCE", color: "#f59e0b" };
  if (normalized === "LOW") return { level: "NORMAL", color: "#22c55e" };
  if (score >= 75) return { level: "CRITIQUE", color: "#ef4444" };
  if (score >= 50) return { level: "ÉLEVÉE", color: "#f97316" };
  if (score >= 25) return { level: "SURVEILLANCE", color: "#f59e0b" };
  return { level: "NORMAL", color: "#22c55e" };
};

const getCurrentPhase = (flags: string[]): string => {
  if (flags.includes("THRESHOLD_SHIFT")) return "Seuil ajusté";
  if (flags.includes("MODEL_AGREEMENT_HIGH")) return "Modèles en accord";
  if (flags.includes("HIGH_TRUST")) return "Confiance élevée";
  if (flags.includes("PRIMARY_SIGNAL")) return "Signal principal";
  if (flags.includes("DOMINANT_CORRELATION")) return "Lecture croisée";
  if (flags.includes("DOMINANT_SSH")) return "SSH dominant";
  if (flags.includes("DOMINANT_WEB")) return "Le web ressort le plus";
  if (flags.includes("DOMINANT_FTP")) return "FTP dominant";
  if (flags.includes("DOMINANT_KERNEL") || flags.includes("DOMINANT_SESSION")) return "Stabilité système";
  if (flags.includes("DATA_EXFIL_START")) return "Sortie de données";
  if (flags.includes("CRASH_COMING")) return "Instabilité système";
  if (flags.includes("SPRAY_PHASE")) return "Tentative multi-comptes";
  if (flags.includes("BOTNET_WARMUP")) return "Montée en charge suspecte";
  return "Surveillance normale";
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
      detail: `Le score de prévision a augmenté de ${delta} points depuis la dernière analyse.`,
    };
  if (delta <= -4)
    return {
      label: "DECREASING",
      color: "#22c55e",
      direction: "--",
      delta,
      detail: `Le score de prévision a baissé de ${Math.abs(delta)} points depuis la dernière analyse.`,
    };
  return {
    label: "STABLE",
    color: "#f59e0b",
    direction: "->",
    delta,
    detail: `Le score de prévision est resté stable depuis la dernière analyse.`,
  };
};

const prettifyDataset = (dataset: string): string => {
  if (!dataset) return "UNSPECIFIED DATASET";
  const normalized = dataset.trim().toLowerCase();
  if (FUSION_DATASETS.has(normalized)) return "Vue consolidée";
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
  if (first == null || last == null || last <= first) return "Historique récent";
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
      "Les échecs de connexion SSH augmentent de façon anormale.",
    "Multiple distributed IPs detected - potential botnet warmup":
      "Plusieurs adresses IP différentes se connectent en même temps — signe d'une activité coordonnée.",
    "Username diversity spike observed - spray phase likely":
      "De nombreux comptes différents sont testés en rafale, ce qui ressemble à une attaque ciblant les mots de passe faibles.",
    "FTP retrieval behavior abnormal - possible data exfiltration":
      "Des transferts de fichiers inhabituels ont été détectés — une extraction non autorisée est possible.",
    "Kernel instability increasing - system crash risk elevated":
      "Le serveur montre des signes d'instabilité croissante, ce qui pourrait entraîner une interruption de service.",
  };
  return map[normalized] ?? normalized;
};

const getModeLabel = (analysisMode?: string, modeReason?: string): string => {
  const mode = String(analysisMode ?? "").trim();
  if (mode === "long_timeline_forecast") return "Long terme";
  if (mode === "short_burst_predictive") return "Court terme";
  const reason = String(modeReason ?? "").trim();
  return reason ? reason.replace(/[_-]+/g, " ") : "Analyse en cours";
};

const getEventTitle = (event: string): string => {
  const normalized = String(event ?? "").trim().toUpperCase();
  if (normalized === "DATA_THEFT_IN_PROGRESS") return "Possible sortie de données";
  if (normalized === "SYSTEM_FAILURE_IMMINENT") return "Le serveur pourrait saturer";
  if (normalized === "BRUTE_FORCE_INCOMING") return "Tentatives de connexion en série";
  if (normalized === "DISTRIBUTED_ATTACK_IMMINENT") return "Attaque depuis plusieurs sources";
  if (normalized === "SSH_DOMINANT_SIGNAL") return "Connexions SSH suspectes";
  if (normalized === "WEB_DOMINANT_SIGNAL") return "Trafic web anormal";
  if (normalized === "FTP_DOMINANT_SIGNAL") return "Transferts de fichiers inhabituels";
  if (normalized === "KERNEL_DOMINANT_SIGNAL") return "Stabilité du serveur en baisse";
  if (normalized === "SESSION_DOMINANT_SIGNAL") return "Connexions ouvertes inhabituelles";
  if (normalized === "CORRELATION_DOMINANT_SIGNAL") return "Plusieurs anomalies simultanées";
  if (normalized === "WEB_ATTACK_OBSERVED" || normalized === "WEB_ATTACK") return "Activité web suspecte";
  if (normalized === "THRESHOLD_SHIFT_RECORDED") return "Sensibilité de détection ajustée";
  if (normalized === "MODEL_AGREEMENT_STABLE") return "Analyses en accord";
  if (normalized === "PRIMARY_SIGNAL_DETECTED") return "Signal principal identifié";
  return normalized.replace(/_/g, " ").toLowerCase().replace(/(^|\s)\w/g, (match) => match.toUpperCase());
};

const getFlagTitle = (flag: string): string => {
  const normalized = String(flag ?? "").trim().toUpperCase();
  if (normalized === "DATA_EXFIL_START") return "Possible sortie de données";
  if (normalized === "CRASH_COMING") return "Risque de surcharge serveur";
  if (normalized === "SPRAY_PHASE") return "Attaque sur plusieurs comptes";
  if (normalized === "BOTNET_WARMUP") return "Activité coordonnée suspecte";
  if (normalized === "DOMINANT_SSH") return "Connexions SSH suspectes";
  if (normalized === "DOMINANT_WEB") return "Trafic web anormal";
  if (normalized === "DOMINANT_FTP") return "Transferts de fichiers inhabituels";
  if (normalized === "DOMINANT_KERNEL") return "Stabilité du serveur en baisse";
  if (normalized === "DOMINANT_SESSION") return "Connexions ouvertes inhabituelles";
  if (normalized === "DOMINANT_CORRELATION") return "Plusieurs anomalies simultanées";
  if (normalized === "THRESHOLD_SHIFT") return "Sensibilité ajustée";
  if (normalized === "MODEL_AGREEMENT_HIGH") return "Analyses en accord";
  if (normalized === "HIGH_TRUST") return "Résultats fiables";
  if (normalized === "PRIMARY_SIGNAL") return "Signal principal";
  return normalized.replace(/_/g, " ").toLowerCase().replace(/(^|\s)\w/g, (match) => match.toUpperCase());
};

const getSignatureTitle = (flag: string): string => {
  const normalized = String(flag ?? "").trim().toUpperCase();
  if (normalized === "DOMINANT_WEB") return "Web en tête";
  if (normalized === "DOMINANT_SSH") return "SSH en tête";
  if (normalized === "DOMINANT_FTP") return "FTP en tête";
  if (normalized === "DOMINANT_KERNEL") return "Système sensible";
  if (normalized === "DOMINANT_SESSION") return "Session visible";
  if (normalized === "DOMINANT_CORRELATION") return "Signaux combinés";
  if (normalized === "THRESHOLD_SHIFT") return "Sensibilité ajustée";
  if (normalized === "MODEL_AGREEMENT_HIGH") return "Analyses cohérentes";
  if (normalized === "HIGH_TRUST") return "Confiance élevée";
  if (normalized === "PRIMARY_SIGNAL") return "Signal principal";
  if (normalized === "DATA_EXFIL_START") return "Sortie possible";
  if (normalized === "CRASH_COMING") return "Risque de saturation";
  if (normalized === "SPRAY_PHASE") return "Tentative large";
  if (normalized === "BOTNET_WARMUP") return "Préparation";
  return normalized.replace(/_/g, " ").toLowerCase().replace(/(^|\s)\w/g, (match) => match.toUpperCase());
};

const getSignatureDescription = (flag: string): string => {
  const normalized = String(flag ?? "").trim().toUpperCase();
  if (normalized === "DOMINANT_WEB") return "Le web est le signal le plus visible.";
  if (normalized === "DOMINANT_SSH") return "Le SSH ressort surtout.";
  if (normalized === "DOMINANT_FTP") return "Le FTP ressort surtout.";
  if (normalized === "DOMINANT_KERNEL") return "Le système semble sensible.";
  if (normalized === "DOMINANT_SESSION") return "La session ressort surtout.";
  if (normalized === "DOMINANT_CORRELATION") return "Plusieurs indices vont dans le même sens.";
  if (normalized === "THRESHOLD_SHIFT") return "Le niveau de sensibilité a changé.";
  if (normalized === "MODEL_AGREEMENT_HIGH") return "Les analyses sont cohérentes.";
  if (normalized === "HIGH_TRUST") return "Le signal est assez fiable.";
  if (normalized === "PRIMARY_SIGNAL") return "C'est le signal le plus fort.";
  if (normalized === "DATA_EXFIL_START") return "Possible sortie de données.";
  if (normalized === "CRASH_COMING") return "Risque de saturation.";
  if (normalized === "SPRAY_PHASE") return "Tentative large sur plusieurs comptes.";
  if (normalized === "BOTNET_WARMUP") return "Préparation probable.";
  return "Signal inhabituel.";
};

/* =========================================================================
   ===== ENHANCED EVENT DESCRIPTIONS (realistic attack predictions) =======
   ========================================================================= */
const getEnhancedEventDescription = (
  event: string,
  flags: string[],
  score: number,
  riskLevel: string,
  uniqueIpCount?: number,   // NEW: number of distinct source IPs
): string => {
  const normalized = String(event ?? "").trim().toUpperCase();
  const isCritical = score >= 75 || riskLevel === "CRITICAL" || riskLevel === "HIGH";
  const ipPhrase = uniqueIpCount !== undefined
    ? (uniqueIpCount === 1 ? "Depuis une seule adresse IP" : `Depuis ${uniqueIpCount} adresses IP différentes`)
    : "";

  if (normalized === "BRUTE_FORCE_INCOMING") {
    if (flags.includes("BOTNET_WARMUP"))
      return `Plusieurs appareils différents sont en train d'essayer de deviner les mots de passe en même temps. ${ipPhrase ? ipPhrase + ". " : ""}Si ça continue, certains comptes risquent de se bloquer automatiquement.`;
    if (flags.includes("SPRAY_PHASE"))
      return `Quelqu'un teste un grand nombre de comptes différents avec des mots de passe courants. ${ipPhrase ? ipPhrase + ". " : ""}Les comptes simples ou peu sécurisés sont les premiers en danger.`;
    if (isCritical)
      return `Des tentatives de connexion répétées et intenses sont attendues. ${ipPhrase ? ipPhrase + ". " : ""}Sans action rapide, des comptes pourraient être bloqués ou compromis.`;
    return `Des connexions suspectes vont probablement continuer. ${ipPhrase ? ipPhrase + ". " : ""}Quelqu'un explore méthodiquement les accès disponibles sur ce serveur.`;
  }

  if (normalized === "DATA_THEFT_IN_PROGRESS") {
    if (flags.includes("DOMINANT_FTP"))
      return `Des fichiers semblent être copiés sans autorisation. ${ipPhrase ? ipPhrase + ". " : ""}L'activité détectée ressemble à quelqu'un qui récupère des données de façon organisée.`;
    if (flags.includes("DOMINANT_SSH"))
      return `Des données pourraient être copiées via une connexion distante. ${ipPhrase ? ipPhrase + ". " : ""}Des transferts inhabituels ont été repérés.`;
    return `Des données pourraient être en train d'être copiées ou extraites du serveur. ${ipPhrase ? ipPhrase + ". " : ""}Une activité de transfert anormale a été détectée.`;
  }

  if (normalized === "SYSTEM_FAILURE_IMMINENT") {
    if (flags.includes("CRASH_COMING"))
      return `Le serveur montre des signes de surcharge. ${ipPhrase ? ipPhrase + ". " : ""}S'il n'est pas soulagé rapidement, certains services risquent de s'interrompre.`;
    return `La charge actuelle pourrait provoquer un ralentissement ou un arrêt partiel de certains services. ${ipPhrase ? ipPhrase + ". " : ""}`;
  }

  if (normalized === "DISTRIBUTED_ATTACK_IMMINENT") {
    return `Une attaque organisée depuis plusieurs endroits différents est probable. ${ipPhrase ? ipPhrase + ". " : ""}Ce type d'attaque est difficile à bloquer car elle vient de partout à la fois.`;
  }

  if (normalized === "SSH_DOMINANT_SIGNAL") {
    if (isCritical)
      return `Les connexions SSH concentrent l'essentiel de l'activité suspecte. ${ipPhrase ? ipPhrase + ". " : ""}Si rien ne change, les tentatives vont probablement s'intensifier.`;
    return `Le service de connexion à distance (SSH) est le principal point surveillé en ce moment. ${ipPhrase ? ipPhrase + ". " : ""}L'activité reste gérable mais mérite attention.`;
  }

  if (normalized === "WEB_DOMINANT_SIGNAL" || normalized === "WEB_ATTACK_OBSERVED" || normalized === "WEB_ATTACK") {
    if (isCritical)
      return `L'activité sur le site ou l'application web est à un niveau préoccupant. ${ipPhrase ? ipPhrase + ". " : ""}Des tentatives d'intrusion ou de contournement sont probables.`;
    return `Le trafic web anormal est le signal le plus visible en ce moment. ${ipPhrase ? ipPhrase + ". " : ""}Des scans ou tentatives d'accès non autorisé sont à anticiper.`;
  }

  if (normalized === "FTP_DOMINANT_SIGNAL") {
    return `L'activité de transfert de fichiers ressort comme signal principal. ${ipPhrase ? ipPhrase + ". " : ""}Des téléchargements inhabituels en volume ou en fréquence sont à vérifier.`;
  }

  if (normalized === "KERNEL_DOMINANT_SIGNAL") {
    return `Le serveur lui-même montre des signes d'instabilité. ${ipPhrase ? ipPhrase + ". " : ""}Des erreurs internes pourraient entraîner des ralentissements ou des coupures de service.`;
  }

  if (normalized === "CORRELATION_DOMINANT_SIGNAL") {
    return `Plusieurs types d'anomalies ont été détectées en même temps. ${ipPhrase ? ipPhrase + ". " : ""}C'est souvent le signe d'une activité coordonnée plutôt que d'un simple incident isolé.`;
  }

  if (normalized === "THRESHOLD_SHIFT_RECORDED") {
    return `Le système a ajusté sa sensibilité de détection. Les prochaines alertes tiendront compte de ce nouveau réglage.`;
  }

  if (normalized === "MODEL_AGREEMENT_STABLE") {
    return `Les différents outils d'analyse sont d'accord sur l'évaluation du risque. Cela renforce la fiabilité de cette prévision.`;
  }

  if (normalized === "PRIMARY_SIGNAL_DETECTED") {
    return `Un signal principal clair a été identifié. L'analyse se concentre sur ce point pour affiner la prévision.`;
  }

  if (normalized === "SESSION_DOMINANT_SIGNAL") {
    return `Des connexions ouvertes inhabituelles ont été repérées. ${ipPhrase ? ipPhrase + ". " : ""}Cela pourrait indiquer un accès non autorisé maintenu sur le serveur.`;
  }

  // Fallback enriched by flag context
  if (flags.includes("DOMINANT_SSH")) return `L'activité SSH va probablement continuer à augmenter. ${ipPhrase ? ipPhrase + ". " : ""}Quelqu'un semble tester les accès disponibles de façon méthodique.`;
  if (flags.includes("DOMINANT_WEB")) return `Les tentatives sur le service web vont probablement s'intensifier si aucune protection n'est activée. ${ipPhrase ? ipPhrase + ". " : ""}`;
  if (flags.includes("DOMINANT_FTP")) return `L'activité de transfert anormale va probablement continuer ou s'amplifier. ${ipPhrase ? ipPhrase + ". " : ""}`;
  if (isCritical) return `L'évolution actuelle suggère une escalade proche. ${ipPhrase ? ipPhrase + ". " : ""}La situation correspond aux signaux qui précèdent généralement un incident sérieux.`;
  return `Une activité anormale devrait se poursuivre. ${ipPhrase ? ipPhrase + ". " : ""}Une surveillance active est recommandée pour détecter rapidement tout changement.`;
};

/* =========================================================================
   ===== CONTEXTUAL GUIDANCE (plain French actions) =======================
   ========================================================================= */
const buildContextualGuidanceItems = (
  flags: string[],
  predictedEvents: string[],
  score: number,
  riskLevel: string,
  rawSuggestions: string[],
): string[] => {
  const actions: string[] = [];
  const used = new Set<string>();

  const add = (action: string) => {
    const key = action.slice(0, 40).toLowerCase();
    if (!used.has(key)) {
      used.add(key);
      actions.push(action);
    }
  };

  const normalized = (s: string) => s.trim().toUpperCase();
  const hasEvent = (e: string) => predictedEvents.map(normalized).includes(e);
  const hasFlag = (f: string) => flags.map(normalized).includes(f);
  const isCritical = score >= 75 || riskLevel === "CRITICAL";
  const isHigh = score >= 50 || riskLevel === "HIGH";

  // ── Niveau critique : intervention immédiate ─────────────────────────────
  if (isCritical) {
    add("Contactez immédiatement votre administrateur système ou votre équipe informatique. Le niveau de risque actuel nécessite une intervention rapide pour bloquer les connexions suspectes.");
  }

  // ── Activité coordonnée depuis plusieurs sources ─────────────────────────
  if (hasFlag("BOTNET_WARMUP")) {
    add("Demandez à votre administrateur de vérifier d'où viennent les connexions suspectes. Si elles proviennent d'un pays ou d'une région inhabituelle, un blocage temporaire peut stopper l'activité rapidement.");
    add("Réduisez temporairement le nombre de connexions simultanées autorisées sur le serveur pour freiner les tentatives coordonnées depuis plusieurs sources.");
  }

  // ── Attaque sur plusieurs comptes ────────────────────────────────────────
  if (hasFlag("SPRAY_PHASE")) {
    add("Vérifiez que les comptes inutilisés sont bien désactivés, et changez les mots de passe des comptes exposés dès que possible — les comptes de service sont souvent les premières cibles.");
    add("Activez une règle qui bloque automatiquement un compte après plusieurs tentatives de connexion échouées. Cela ralentit considérablement ce type d'attaque.");
  }

  // ── Risque de sortie de données ──────────────────────────────────────────
  if (hasFlag("DATA_EXFIL_START") || hasEvent("DATA_THEFT_IN_PROGRESS")) {
    add("Vérifiez les transferts de fichiers récents et signalez toute copie non autorisée à votre équipe informatique. Limitez temporairement les transferts depuis l'extérieur le temps d'y voir plus clair.");
    add("Restreignez l'accès aux transferts de fichiers aux seules adresses connues et faites vérifier les droits d'accès aux répertoires sensibles.");
  }

  // ── Tentatives de connexion SSH en série ─────────────────────────────────
  if (hasEvent("BRUTE_FORCE_INCOMING")) {
    if (!hasFlag("BOTNET_WARMUP")) {
      add("Demandez à votre administrateur de changer le port de connexion SSH pour un port non standard. Cette simple modification réduit immédiatement la grande majorité des tentatives automatisées.");
    }
    add("Désactivez la connexion par mot de passe sur SSH et exigez une clé d'accès personnelle. Cela empêche toute tentative de deviner les mots de passe, quelle qu'en soit la fréquence.");
  }

  // ── Risque de surcharge serveur ──────────────────────────────────────────
  if (hasFlag("CRASH_COMING") || hasEvent("SYSTEM_FAILURE_IMMINENT")) {
    add("Vérifiez l'état du serveur maintenant : mémoire disponible, espace disque et messages d'erreur récents. Une saturation peut précipiter une coupure de service dans ce contexte.");
    add("Préparez une procédure de redémarrage propre des services non critiques pour libérer des ressources rapidement si la situation se dégrade.");
  }

  // ── Attaque depuis plusieurs sources ─────────────────────────────────────
  if (hasEvent("DISTRIBUTED_ATTACK_IMMINENT")) {
    add("Limitez le nombre de requêtes acceptées depuis une même adresse IP sur une courte période. Votre administrateur peut configurer cette protection en quelques minutes.");
  }

  // ── SSH dominant ─────────────────────────────────────────────────────────
  if (hasFlag("DOMINANT_SSH")) {
    if (!hasEvent("BRUTE_FORCE_INCOMING") && !isCritical) {
      add("Consultez les journaux de connexion SSH pour identifier les adresses IP les plus actives et établir une liste de blocage ciblée avant que l'activité ne s'aggrave.");
    }
    if (isHigh) {
      add("Limitez l'accès SSH aux seules adresses IP autorisées. Cela bloque directement les tentatives provenant de sources non reconnues.");
    }
  }

  // ── Web dominant ─────────────────────────────────────────────────────────
  if (hasFlag("DOMINANT_WEB")) {
    add("Vérifiez les journaux du serveur web pour identifier les pages ou fonctions les plus ciblées. Un blocage ciblé peut suffire à stopper l'activité suspecte.");
    if (isHigh) {
      add("Si votre hébergeur propose un pare-feu applicatif, activez-le. Il peut bloquer automatiquement les tentatives d'intrusion sur votre site ou votre application.");
    }
  }

  // ── FTP dominant ─────────────────────────────────────────────────────────
  if (hasFlag("DOMINANT_FTP")) {
    add("Vérifiez les répertoires accessibles en transfert de fichiers et leurs droits d'accès. Limitez l'accès en lecture aux seuls dossiers nécessaires.");
  }

  // ── Instabilité système ──────────────────────────────────────────────────
  if (hasFlag("DOMINANT_KERNEL")) {
    add("Consultez les messages d'erreur récents du serveur pour en comprendre la source. Votre administrateur peut identifier rapidement si c'est lié à la charge réseau actuelle.");
  }

  // ── Anomalies multiples simultanées ─────────────────────────────────────
  if (hasFlag("DOMINANT_CORRELATION")) {
    add("Plusieurs types d'anomalies ont été détectés simultanément. Demandez à votre équipe de consulter l'ensemble des journaux pour trouver un éventuel lien entre les incidents.");
  }

  // ── Changement de sensibilité ────────────────────────────────────────────
  if (hasFlag("THRESHOLD_SHIFT")) {
    add("La sensibilité de détection a changé. Revérifiez vos règles d'alerte pour éviter une surcharge de notifications et assurez-vous que les alertes importantes restent visibles.");
  }

  // ── Niveau élevé sans action spécifique ──────────────────────────────────
  if (isHigh && !isCritical && actions.length < 2) {
    add("Vérifiez les connexions actives sur le serveur et signalez toute session ouverte depuis une adresse non reconnue. Elle doit être interrompue et analysée immédiatement.");
  }

  // ── Analyses convergentes ────────────────────────────────────────────────
  if ((hasFlag("MODEL_AGREEMENT_HIGH") || hasFlag("HIGH_TRUST")) && actions.length < 3) {
    add("Les outils d'analyse sont unanimes sur ce risque. Ne différez pas les mesures préventives en attendant de nouveaux signaux — c'est le bon moment d'agir.");
  }

  // ── Complément générique si besoin ───────────────────────────────────────
  const GENERIC_FALLBACKS = [
    "Notez les adresses IP et les horaires des anomalies détectées dans un rapport pour faciliter l'analyse et améliorer la protection future.",
    "Vérifiez que les sauvegardes récentes sont intactes et accessibles en dehors du serveur, au cas où une intervention d'urgence serait nécessaire.",
    "Informez votre équipe informatique des anomalies détectées et demandez une surveillance renforcée. Une deuxième lecture des journaux peut révéler des détails importants.",
    "Contrôlez les tâches planifiées sur le serveur pour détecter tout script qui aurait été ajouté sans autorisation.",
    "Vérifiez l'intégrité des fichiers système essentiels pour détecter toute modification non autorisée depuis la dernière vérification.",
  ];

  for (const fallback of GENERIC_FALLBACKS) {
    if (actions.length >= 3) break;
    add(fallback);
  }

  return actions.slice(0, 3);
};

const resolveSignal = (sa: SignalAnalysis | undefined, key: SignalKey): SignalMetric => sa?.[key] ?? {};

const SIGNAL_FALLBACK_ORDER: SignalKey[] = ["failures", "unique_ips", "usernames", "ftp_events", "kernel_errors"];

const pickFallbackStyleKey = (source: string | undefined, tone: string | undefined, index: number): SignalKey => {
  const normalizedSource = String(source ?? "").toLowerCase();
  const normalizedTone = String(tone ?? "").toLowerCase();
  if (normalizedSource.includes("threshold") || normalizedSource.includes("drift") || normalizedSource.includes("stability")) return "kernel_errors";
  if (normalizedSource.includes("trust") || normalizedSource.includes("agreement") || normalizedSource.includes("confidence")) return "usernames";
  if (normalizedSource.includes("prediction") || normalizedSource.includes("alarm.score") || normalizedSource.includes("failures")) return "failures";
  if (normalizedSource.includes("ip") || normalizedSource.includes("velocity") || normalizedSource.includes("entropy")) return "unique_ips";
  if (normalizedSource.includes("ftp")) return "ftp_events";
  if (normalizedTone === "risk") return "failures";
  if (normalizedTone === "support") return "usernames";
  return SIGNAL_FALLBACK_ORDER[index % SIGNAL_FALLBACK_ORDER.length];
};

const buildConcernSignals = (sa: SignalAnalysis | undefined, flags: string[], forecastContext?: ForecastContext | null): ConcernSignal[] => {
  const failures = resolveSignal(sa, "failures");
  const uniqueIps = resolveSignal(sa, "unique_ips");
  const usernames = resolveSignal(sa, "usernames");
  const ftpEvents = resolveSignal(sa, "ftp_events");
  const kernelErrors = resolveSignal(sa, "kernel_errors");

  const signals: ConcernSignal[] = [];

  const tryAdd = (
    key: SignalKey,
    metric: SignalMetric,
    icon: string,
    title: string,
    narrative: string,
    color: string,
  ) => {
    const trend = Number(metric.trend_ratio ?? 1);
    const burst = Number(metric.burst_ratio ?? 1);
    const last = Number(metric.last ?? 0);
    if (trend < 1.05 && burst < 1.05 && last === 0) return;
    const intensity = Math.max(0.1, Math.min(1, ((trend - 1) * 2 + (burst - 1)) / 3));
    signals.push({
      key,
      styleKey: key,
      icon,
      title,
      narrative,
      deltaLabel: trend > 1 ? formatTrendDelta(trend) : last > 0 ? String(last) : "—",
      trend,
      burst,
      last,
      color,
      tone: trend > 1.3 || burst > 1.5 ? "FORTE HAUSSE" : trend > 1.1 ? "EN HAUSSE" : "À SURVEILLER",
      intensity,
    });
  };

  tryAdd("failures", failures, "AU", "Échecs de connexion", "Nombre d'échecs d'authentification SSH.", "#fb7185");
  tryAdd("unique_ips", uniqueIps, "IP", "Sources distinctes", "Nombre d'adresses IP différentes actives.", "#7dd3fc");
  tryAdd("usernames", usernames, "ID", "Comptes visés", "Diversité des noms d'utilisateur testés.", "#fbbf24");
  tryAdd("ftp_events", ftpEvents, "FT", "Activité FTP", "Activité de transfert de fichiers.", "#34d399");
  tryAdd("kernel_errors", kernelErrors, "SY", "Stabilité système", "Erreurs internes détectées.", "#c084fc");

  if (signals.length > 0 || !forecastContext?.evidence?.length) {
    const sorted = signals.sort((a, b) => b.intensity - a.intensity);
    if (sorted.length > 0) return sorted;
  }

  if (forecastContext?.evidence?.length) {
    return forecastContext.evidence
      .filter((e) => e.label && (e.weight ?? 0) > 0)
      .slice(0, 4)
      .map((e, index) => {
        const styleKey = pickFallbackStyleKey(e.source, e.tone, index);
        const style = SIGNAL_STYLES[styleKey];
        const weight = Math.max(0, Math.min(100, Number(e.weight ?? 50)));
        return {
          key: `evidence-${index}`,
          styleKey,
          icon: style.icon,
          title: e.label ?? "Signal",
          narrative: e.detail ?? e.value ?? "Donnée disponible.",
          deltaLabel: e.value ?? "—",
          trend: 1 + weight / 100,
          burst: 1 + weight / 200,
          last: Math.round(weight),
          color: style.color,
          tone: e.tone === "risk" ? "À SURVEILLER" : e.tone === "support" ? "STABLE" : "INFO",
          intensity: Math.max(0.15, Math.min(1, weight / 100)),
        };
      });
  }

  if (!forecastContext?.engine_contributions?.length) return [];

  return forecastContext.engine_contributions.slice(0, 4).map((engine, index) => {
    const engineName = String(engine.engine ?? "").toUpperCase();
    const styleKey: SignalKey =
      engineName.includes("SSH") || engineName.includes("AUTH") ? "failures"
      : engineName.includes("FTP") ? "ftp_events"
      : engineName.includes("WEB") ? "unique_ips"
      : engineName.includes("KERNEL") || engineName.includes("SYSTEM") ? "kernel_errors"
      : "usernames";
    const style = SIGNAL_STYLES[styleKey];
    const weight = Math.max(0, Math.min(100, Number(engine.alarms ?? 0) * 12));
    const primary = Math.max(1, 1 + weight / 100);
    return {
      key: `${engineName}-${index}`,
      styleKey,
      icon: style.icon,
      title: `${engineName} surveillé`,
      narrative:
        engine.status === "ALARM"
          ? `${engine.alarms} alerte(s) active(s) sur ${engineName}.`
          : `${engine.alarms} alerte(s) détectée(s) sur ${engineName}.`,
      deltaLabel: `${engine.alarms}`,
      trend: primary,
      burst: primary,
      last: Math.max(1, Number(engine.alarms ?? 0)),
      color: style.color,
      tone: engine.status === "ALARM" ? "FORTE HAUSSE" : "À SURVEILLER",
      intensity: Math.max(0.15, Math.min(1, weight / 100 || 0.2)),
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
      : "Lecture en cours";
  const summary =
    explanations.length > 0
      ? humanizeBackendExplanation(explanations[0])
      : predictionMessage?.trim() || "Données insuffisantes pour le moment.";
  const outlook =
    preventionSuggestions[0]?.trim() ||
    (explanations.length > 1 ? humanizeBackendExplanation(explanations[1]) : "") ||
    "Rien de plus à signaler pour l'instant.";
  return { title, summary, outlook };
};

/* =========================================================================
   ===== BUILD SCENARIO CARDS – ALWAYS MATCH THE STRONGEST SIGNAL ==========
   ========================================================================= */
const buildScenarioCards = (
  predictedEvents: string[],
  explanations: string[],
  riskLabel: string,
  riskColor: string,
  modeLabel: string,
  confidenceLevel: string,
  flags: string[],
  score: number,
  riskLevel: string,
  concernSignals: ConcernSignal[],      // ← highest‑intensity signals from diagnostic
): ScenarioCard[] => {
  // 1. Extract unique IP count from concernSignals
  const uniqueIpSignal = concernSignals.find(s => s.styleKey === "unique_ips");
  const uniqueIpCount = uniqueIpSignal?.last ?? undefined;

  // 2. Build set of allowed event types based on detected signal keys
  const detectedKeys = new Set(concernSignals.map(s => s.styleKey));
  const allowedEventsSet = new Set<string>();

  if (detectedKeys.has("ftp_events")) allowedEventsSet.add("DATA_THEFT_IN_PROGRESS");
  if (detectedKeys.has("failures") || detectedKeys.has("usernames")) allowedEventsSet.add("BRUTE_FORCE_INCOMING");
  if (detectedKeys.has("unique_ips") && (detectedKeys.has("failures") || detectedKeys.has("usernames"))) allowedEventsSet.add("DISTRIBUTED_ATTACK_IMMINENT");
  if (detectedKeys.has("kernel_errors")) allowedEventsSet.add("SYSTEM_FAILURE_IMMINENT");
  // WEB attack is only allowed if a dedicated web signal is present – none here, so no WEB_ATTACK.

  // 3. Determine primary event from top signal (only if allowed)
  let primaryEvent = "";
  if (concernSignals.length > 0) {
    const topSignal = concernSignals[0];
    const signalKey = topSignal.styleKey;
    if (signalKey === "ftp_events" && allowedEventsSet.has("DATA_THEFT_IN_PROGRESS")) primaryEvent = "DATA_THEFT_IN_PROGRESS";
    else if (signalKey === "failures" && allowedEventsSet.has("BRUTE_FORCE_INCOMING")) primaryEvent = "BRUTE_FORCE_INCOMING";
    else if (signalKey === "unique_ips" && allowedEventsSet.has("DISTRIBUTED_ATTACK_IMMINENT")) primaryEvent = "DISTRIBUTED_ATTACK_IMMINENT";
    else if (signalKey === "kernel_errors" && allowedEventsSet.has("SYSTEM_FAILURE_IMMINENT")) primaryEvent = "SYSTEM_FAILURE_IMMINENT";
    else if (signalKey === "usernames" && allowedEventsSet.has("BRUTE_FORCE_INCOMING")) primaryEvent = "BRUTE_FORCE_INCOMING";
  }

  // 4. Build candidate events from backend predictions that are allowed
  let eventsToUse = predictedEvents.filter(event =>
    allowedEventsSet.has(event.toUpperCase()) ||
    Array.from(allowedEventsSet).some(allowed => event.toUpperCase().includes(allowed))
  );

  // 5. Add primaryEvent if not already present and allowed
  if (primaryEvent && !eventsToUse.some(e => e.toUpperCase() === primaryEvent)) {
    eventsToUse.unshift(primaryEvent);
  }

  // 6. If still empty, fallback to the most relevant allowed event
  if (eventsToUse.length === 0 && concernSignals.length > 0) {
    const topSignal = concernSignals[0];
    const signalKey = topSignal.styleKey;
    if (signalKey === "ftp_events") eventsToUse = ["DATA_THEFT_IN_PROGRESS"];
    else if (signalKey === "failures") eventsToUse = ["BRUTE_FORCE_INCOMING"];
    else if (signalKey === "unique_ips") eventsToUse = ["DISTRIBUTED_ATTACK_IMMINENT"];
    else if (signalKey === "kernel_errors") eventsToUse = ["SYSTEM_FAILURE_IMMINENT"];
    else if (signalKey === "usernames") eventsToUse = ["SPRAY_PHASE"];
    else eventsToUse = ["PRIMARY_SIGNAL_DETECTED"];
  }

  // 7. Final safety net
  if (eventsToUse.length === 0) {
    eventsToUse = ["PRIMARY_SIGNAL_DETECTED"];
  }

  // 8. Deduplicate and limit to 3
  const uniqueEvents = [...new Set(eventsToUse)].slice(0, 3);
  
  return uniqueEvents.map((event) => ({
    title: getEventTitle(event),
    summary: getEnhancedEventDescription(event, flags, score, riskLevel, uniqueIpCount),
    riskLabel,
    riskColor,
    horizon: modeLabel,
    confidence: confidenceLevel,
  }));
};

const buildConfidenceCard = (trust: TrustData | null | undefined): ConfidenceCard => {
  if (!trust?.available || trust.confidence_in_metrics == null)
    return { level: "Indisponible", color: "#94a3b8", summary: "Confiance non disponible.", scoreText: "-" };
  const confidence = trust.confidence_in_metrics;
  if (confidence >= 0.8)
    return {
      level: "Élevée",
      color: "#22c55e",
      summary:
        trust.model_agreement != null && trust.model_agreement >= 0.75
          ? "Les signaux sont cohérents."
          : "Les signaux vont dans le même sens.",
      scoreText: `${Math.round(confidence * 100)}%`,
    };
  if (confidence >= 0.55)
    return {
      level: "Moyenne",
      color: "#f59e0b",
      summary: trust.drift_flagged
        ? "Le contexte évolue vite. À confirmer."
        : "Les indices vont dans le même sens.",
      scoreText: `${Math.round(confidence * 100)}%`,
    };
  return {
    level: "Faible",
    color: "#fb7185",
    summary:
      trust.false_positive_rate != null && trust.false_positive_rate > 0.35
        ? "Les alertes sont encore dispersées."
        : "Il manque encore quelques données.",
    scoreText: `${Math.round(confidence * 100)}%`,
  };
};

const buildConfidenceCardResolved = (trust: TrustData | null | undefined, forecastContext?: ForecastContext | null): ConfidenceCard => {
  const contextTrust = forecastContext?.model_context;
  const confidence =
    trust?.available && trust.confidence_in_metrics != null ? trust.confidence_in_metrics : contextTrust?.trust_score;
  if (confidence == null)
    return { level: "Indisponible", color: "#94a3b8", summary: "Confiance non disponible.", scoreText: "-" };
  if (confidence >= 0.8)
    return {
      level: "Élevée",
      color: "#22c55e",
      summary:
        (trust?.model_agreement != null && trust.model_agreement >= 0.75) || (contextTrust?.agreement != null && contextTrust.agreement >= 0.75)
          ? "Les signaux sont cohérents."
          : "Les signaux vont dans le même sens.",
      scoreText: `${Math.round(confidence * 100)}%`,
    };
  if (confidence >= 0.55)
    return {
      level: "Moyenne",
      color: "#f59e0b",
      summary:
        trust?.drift_flagged || String(contextTrust?.drift_label ?? "").toUpperCase().includes("DRIFT")
          ? "Le contexte évolue vite. À confirmer."
          : "Les indices vont dans le même sens.",
      scoreText: `${Math.round(confidence * 100)}%`,
    };
  return {
    level: "Faible",
    color: "#fb7185",
    summary:
      trust?.false_positive_rate != null && trust.false_positive_rate > 0.35
        ? "Les alertes sont encore dispersées."
        : "Il manque encore quelques données.",
    scoreText: `${Math.round(confidence * 100)}%`,
  };
};

void buildConfidenceCard;
void FLAG_DESCRIPTIONS;
void getCurrentPhase;

/* =========================================================================
   ===== INLINE STYLE TOKENS (Aurora Noir) =================================
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
            fontSize: 13,
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
      <h2 style={{ fontSize: 26, fontWeight: 700, color: C.text, margin: 0, letterSpacing: "-0.01em" }}>{title}</h2>
      {subtitle && (
        <p style={{ marginTop: 10, color: C.sub, fontSize: 16, maxWidth: 640, marginInline: "auto", lineHeight: 1.55 }}>
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
          fontSize: 12,
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
          fontSize: 36,
          fontWeight: 700,
          color,
          marginTop: 12,
          lineHeight: 1,
          fontFeatureSettings: "'tnum'",
        }}
      >
        {value}
      </div>
      {hint && <div style={{ marginTop: 10, fontSize: 13, color: C.sub }}>{hint}</div>}
      <div
        className="fp-shimmer"
        style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.4 }}
      />
    </div>
  );
}

function Sparkline({ data, width = 220, height = 44, color = C.cyan }: { data: number[]; width?: number; height?: number; color?: string }) {
  if (!data.length) return <span style={{ color: C.dim, fontSize: 14 }}>Pas encore de tendance</span>;
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
  topAlarm?: any;
}

export const ForecastPanel = ({ dataset = "", trust = null, topAlarm = null }: Props) => {
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

  if (loading)
    return (
      <div style={{ fontFamily: C.font, color: C.sub, padding: 48, textAlign: "center" }}>Chargement de la prévision...</div>
    );

  if (isFusionView)
    return (
      <div style={{ fontFamily: C.font, padding: 32 }}>
        <SectionHeader kicker="Prévision" title="Prévision" subtitle="Lecture par source." />
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
          La prévision se lit source par source. Choisissez un serveur local pour voir le scénario, l'évolution du risque
          et l'historique.
        </div>
      </div>
    );

  const forecastContext = pred?.forecast_context ?? null;
  const hasForecastEvidence = Boolean(
    forecastContext?.presentation_ready ||
      forecastContext?.evidence?.length ||
      forecastContext?.engine_contributions?.length ||
      forecastContext?.fallback_events?.length ||
      forecastContext?.fallback_flags?.length ||
      forecastContext?.summary,
  );

  if (!pred?.available && !hasForecastEvidence)
    return (
      <div style={{ fontFamily: C.font, padding: 32 }}>
        <SectionHeader kicker="Prévision" title="Prévision" subtitle="En attente des données." />
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
          Aucune donnée de prévision pour le moment.
        </div>
      </div>
    );

  /* --------- Données dérivées --------- */
  const currentPred: PredictionData = pred ?? {
    available: false,
    prediction_score: 0,
    flags: [],
    predicted_events: [],
    risk_evolution: [],
    prevention_suggestions: [],
    risk_level: "LOW",
  };
  const { prediction_score, flags, predicted_events, signal_analysis, prevention_suggestions } = currentPred;
  const displayedPredictionScore = currentPred.available ? prediction_score : forecastContext?.prediction_context?.score ?? prediction_score;
  const displayedRiskLevel = currentPred.available ? currentPred.risk_level : forecastContext?.prediction_context?.risk_level ?? currentPred.risk_level;
  const effectiveFlags: string[] = flags.length ? flags : forecastContext?.fallback_flags ?? [];
  const effectivePredictedEvents: string[] = predicted_events.length ? predicted_events : forecastContext?.fallback_events ?? [];
  const predictionExplanations: string[] = Array.isArray(currentPred.explanations) ? currentPred.explanations : [];
  const backendExplanations: string[] = predictionExplanations.length > 0 ? predictionExplanations : forecastContext?.fallback_explanations ?? [];
  const effectiveSuggestions: string[] = prevention_suggestions.length ? prevention_suggestions : forecastContext?.fallback_suggestions ?? [];
  const threat = getThreatLevel(displayedPredictionScore, displayedRiskLevel);
  const historyPoints = (Array.isArray(currentPred.history) ? currentPred.history : []).slice(-20);
  const historyScores = historyPoints.map((p) => p.score);
  const momentum = buildMomentumFromHistory(historyPoints);
  const concernSignals = buildConcernSignals(signal_analysis, effectiveFlags, forecastContext);
  const trendSummary = getTrendSummary(historyPoints, momentum);
  const modeLabel = getModeLabel(currentPred.analysis_mode, currentPred.timeline_characteristics?.mode_reason);
  const scenario = buildScenarioNarrative(
    effectiveFlags,
    effectivePredictedEvents,
    currentPred.message || forecastContext?.summary,
    backendExplanations,
    effectiveSuggestions,
  );
  const confidenceCard = buildConfidenceCardResolved(trust, forecastContext);

  // Build scenario cards using the concern signals (so they match the diagnostic panel)
  const scenarioCards = buildScenarioCards(
    effectivePredictedEvents,
    backendExplanations,
    threat.level,
    threat.color,
    modeLabel,
    confidenceCard.level,
    effectiveFlags,
    displayedPredictionScore,
    displayedRiskLevel,
    concernSignals,   // ← pass the highest‑intensity signals
  );

  const contextualActions = buildContextualGuidanceItems(
    effectiveFlags,
    effectivePredictedEvents,
    displayedPredictionScore,
    displayedRiskLevel,
    effectiveSuggestions,
  );

  const momentumLabel =
    momentum.label === "ACCELERATING"
      ? "↑ En hausse"
      : momentum.label === "DECREASING"
      ? "↓ En baisse"
      : "→ Stable";

  const momentumHint =
    historyPoints.length < 2
      ? "Premières données"
      : trendSummary;

  return (
    <div style={{ fontFamily: C.font, color: C.text, padding: "8px 4px 32px" }}>
      <SectionHeader
        kicker={`Source · ${datasetLabel}`}
        title="Prévision"
        subtitle="Résumé simple."
      />

      {/* ============== SECTION 1 — 3 CARTES (histoire en 3 secondes) ============== */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 16,
          marginBottom: 44,
        }}
      >
        <StatCard
          label="Niveau de Risque"
          value={displayedPredictionScore}
          color={threat.color}
          hint={threat.level}
          delay={0}
        />
        <StatCard
          label="Évolution"
          value={<span style={{ fontSize: 22 }}>{momentumLabel}</span>}
          color={momentum.color}
          hint={momentumHint}
          delay={80}
        />
        <StatCard
          label="Fiabilité de l'Analyse"
          value={confidenceCard.scoreText}
          color={confidenceCard.color}
          hint={confidenceCard.level}
          delay={160}
        />
      </div>

      {/* ============== SECTION 2 — DIAGNOSTIC (signals) ============== */}
      <section style={{ marginBottom: 56 }} className="fp-fade-up">
        <SectionHeader
          kicker="Diagnostic"
          title="Pourquoi"
          subtitle="Signaux qui montent."
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
            Aucun signal ne monte vraiment pour le moment. Le système reste calme.
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
                    fontSize: 14,
                    letterSpacing: "0.05em",
                  }}
                >
                  {s.icon}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                    <strong style={{ color: C.text, fontSize: 16 }}>{s.title}</strong>
                    <span
                      style={{
                        fontSize: 12,
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
                  <div style={{ color: C.sub, fontSize: 14.5, lineHeight: 1.5, marginBottom: 10 }}>{s.narrative}</div>
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
                  <div style={{ fontSize: 24, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.deltaLabel}</div>
                  <div style={{ fontSize: 12, color: C.dim, marginTop: 4, letterSpacing: "0.1em" }}>
                    NIVEAU {s.last}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ============== SECTION 3 — SCENARIO CARDS (now aligned with the strongest signal) ============== */}
      {scenarioCards.length > 0 && (
        <section style={{ marginBottom: 56 }} className="fp-fade-up">
          <SectionHeader
            kicker="Suite"
            title="Ce qui peut venir"
          />
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
                      fontSize: 12,
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
                  <span style={{ fontSize: 13, color: C.dim, letterSpacing: "0.1em" }}>{card.horizon}</span>
                </div>
                <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 10, letterSpacing: "0.01em" }}>
                  {card.title}
                </div>
                <p style={{ color: C.sub, fontSize: 15, lineHeight: 1.65, margin: "0 0 18px" }}>{card.summary}</p>
                <div
                  style={{
                    paddingTop: 14,
                    borderTop: `1px solid ${C.border}`,
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 13,
                    color: C.dim,
                  }}
                >
                  <span style={{ letterSpacing: "0.12em" }}>NIVEAU DE CONFIANCE</span>
                  <strong style={{ color: C.text }}>{card.confidence}</strong>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ============== SECTION 4 — GUIDANCE (actions) ============== */}
      <section style={{ marginBottom: 24 }} className="fp-fade-up">
        <SectionHeader
          title="À faire"
          subtitle="Actions ciblées selon les anomalies détectées."
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 16,
          }}
        >
          {contextualActions.map((item, idx) => (
            <div
              key={`action-${idx}`}
              className="fp-card fp-fade-up"
              style={{
                position: "relative",
                background: C.panel,
                border: `1px solid ${C.border}`,
                borderRadius: 16,
                padding: "22px 22px 22px 64px",
                color: C.text,
                fontSize: 15,
                lineHeight: 1.65,
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
                  fontSize: 16,
                }}
              >
                {idx + 1}
              </div>
              {item}
            </div>
          ))}
        </div>
      </section>

      <div style={{ textAlign: "center", fontSize: 13, color: C.dim, letterSpacing: "0.12em", marginTop: 12 }}>
        MISE À JOUR AUTOMATIQUE · ANALYSE LOCALE · {datasetLabel.toUpperCase()}
      </div>
    </div>
  );
};

export default ForecastPanel;