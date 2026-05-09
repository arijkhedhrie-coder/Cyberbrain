// shared/types/analyticsProps.ts
// ═══════════════════════════════════════════════════════════════════
// Interfaces des props pour TOUS les nouveaux composants analytiques.
// Chaque interface correspond exactement aux données envoyées par
// DashboardPage depuis useIdpsDashboard.
// ═══════════════════════════════════════════════════════════════════

import type {
  AlarmItem,
  EngineScore,
  AgentDecision,
  SessionSummary,
  TrustData,
  KpiData,
} from "./idps";

import type { CorrectiveSuggestion } from "./idps";
import type { EntropyPoint }         from "./analytics";

// ─────────────────────────────────────────────────────────────────
// EntropyChart
// Reçoit : entropyHistory accumulé dans DashboardPage
// Affiché: courbe ip_entropy dans le temps + seuil DDoS
// ─────────────────────────────────────────────────────────────────
export interface EntropyChartProps {
  data: EntropyPoint[];
}

// ─────────────────────────────────────────────────────────────────
// AttackHeatmap
// Reçoit : alarms[] depuis /api/alarms + WebSocket
// Calcule: intensité par heure × engine en interne
// ─────────────────────────────────────────────────────────────────
export interface AttackHeatmapProps {
  alarms: AlarmItem[];
}

// ─────────────────────────────────────────────────────────────────
// RadarEngineChart
// Reçoit : engines[] depuis /api/engine-scores
// Affiche: radar par moteur (SSH/WEB/FTP/KERNEL)
// ─────────────────────────────────────────────────────────────────
export interface RadarEngineChartProps {
  engines: EngineScore[];
}

// ─────────────────────────────────────────────────────────────────
// StreamingPipeline
// Reçoit : logs (WebSocket "log") + sessions[] (/api/sessions)
// Affiche: étapes du pipeline avec débit et statut
// ─────────────────────────────────────────────────────────────────
export interface StreamingPipelineProps {
  logs:     string[];
  sessions: SessionSummary[];
}

// ─────────────────────────────────────────────────────────────────
// AdaptiveThresholdPanel
// Reçoit : sessions[] + engines[] → reconstruit l'évolution
// Affiche: seuil fixe vs adaptatif vs activité réelle
// ─────────────────────────────────────────────────────────────────
export interface AdaptiveThresholdPanelProps {
  sessions: SessionSummary[];
  engines:  EngineScore[];
}

// ─────────────────────────────────────────────────────────────────
// ExplainabilityPanel
// Reçoit : decisions + suggestions + trust + kpis + topAlarm
// Affiche: "Pourquoi cette alarme ?" avec features réelles
// ─────────────────────────────────────────────────────────────────
export interface ExplainabilityPanelProps {
  decisions:   AgentDecision[];
  suggestions: CorrectiveSuggestion[];
  trust:       TrustData;
  topAlarm:    AlarmItem | null;
  kpis:        KpiData | null;
  engines:     EngineScore[];
}

// ─────────────────────────────────────────────────────────────────
// AttackTimelinePanel
// Reçoit : alarms[] + sessions[]
// Affiche: reconstruction chronologique d'une attaque
// ─────────────────────────────────────────────────────────────────
export interface AttackTimelinePanelProps {
  alarms:   AlarmItem[];
  sessions: SessionSummary[];
}

// ─────────────────────────────────────────────────────────────────
// ConfusionMatrix
// Reçoit : decisions[] + alarms[]
// Calcule: TP/FP/TN/FN + Precision/Recall/F1 en interne
// ─────────────────────────────────────────────────────────────────
export interface ConfusionMatrixProps {
  decisions: AgentDecision[];
  alarms:    AlarmItem[];
}