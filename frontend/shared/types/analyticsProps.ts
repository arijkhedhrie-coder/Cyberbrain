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
  ThresholdHistoryEntry,
  ExplainabilityData,
} from "./idps";

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
  embedded?: boolean;
  days?: number;
}

// ─────────────────────────────────────────────────────────────────
// RadarEngineChart
// Reçoit : engines[] depuis /api/engine-scores
// Affiche: radar par moteur (SSH/WEB/FTP/KERNEL)
// ─────────────────────────────────────────────────────────────────
export interface RadarEngineChartProps {
  engines: EngineScore[];
  compact?: boolean;
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
  thresholdHistory: ThresholdHistoryEntry[];
  engines: EngineScore[];
}

// ─────────────────────────────────────────────────────────────────
// ExplainabilityPanel
// Reçoit : decisions + suggestions + trust + kpis + topAlarm
// Affiche: "Pourquoi cette alarme ?" avec features réelles
// ─────────────────────────────────────────────────────────────────
export interface ExplainabilityPanelProps {
  data: ExplainabilityData | null;
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
