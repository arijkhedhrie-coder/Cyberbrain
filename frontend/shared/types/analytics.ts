// shared/types/analytics.ts

export interface EntropyPoint {
  time: string;
  entropy: number;
  threshold: number;
  ipCount: number;
}

export interface AttackHeatmapCell {
  hour: number;
  attackType: string;
  intensity: number; // 0–100
}

export interface RadarEngineData {
  engine: "SSH" | "WEB" | "FTP" | "KERNEL";
  metrics: {
    frequency: number;
    burst: number;
    confidence: number;
    anomaly: number;
    entropy: number;
    risk: number;
  };
}

export interface AttackTimelineEvent {
  id: string;
  timestamp: string;
  phase: string;
  type: string;
  ip: string;
  detail: string;
  severity: "critical" | "warning" | "info";
  engineScore?: number;
}

export interface CorrelationNode {
  id: string;
  label: string;
  type: "ip" | "service" | "alarm" | "action";
  risk: number;
}

export interface CorrelationEdge {
  source: string;
  target: string;
  weight: number;
}

export interface ExplainFeature {
  name: string;
  contribution: number; // positif = hausse du score
  value: string;
}

export interface ExplainabilityResult {
  alarmType: string;
  confidence: number;
  decision: string;
  features: ExplainFeature[];
  engineContributions: Record<string, number>;
}

export interface ThresholdSnapshot {
  time: string;
  fixedThreshold: number;
  adaptiveThreshold: number;
  actualActivity: number;
}

export interface RiskMinimizationPoint {
  time: string;
  riskBefore: number;
  riskAfter: number;
  alarmCount: number;
  healthScore: number;
}

export interface PipelineStage {
  name: string;
  latencyMs: number;
  throughput: number;
  status: "ok" | "warn" | "error";
}

export interface ConfusionMetrics {
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  precision: number;
  recall: number;
  f1: number;
  fpr: number;
}