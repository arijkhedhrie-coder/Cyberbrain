// infrastructure/api/analyticsApi.ts
import axios from "axios";
import type {
  EntropyPoint, AttackHeatmapCell, RadarEngineData,
  AttackTimelineEvent, CorrelationNode, CorrelationEdge,
  ThresholdSnapshot, RiskMinimizationPoint, PipelineStage,
  ConfusionMetrics,
} from "../../shared/types/analytics";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

const get = async <T>(path: string, token?: string): Promise<T | null> => {
  try {
    const res = await axios.get<T>(`${API_BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 4000,
    });
    return res.data;
  } catch {
    return null;
  }
};

// ── Entropy ─────────────────────────────────────────────────────────────────
export const fetchEntropyHistory = (token?: string) =>
  get<EntropyPoint[]>("/api/analytics/entropy", token);

// ── Heatmap ──────────────────────────────────────────────────────────────────
export const fetchAttackHeatmap = (token?: string) =>
  get<AttackHeatmapCell[]>("/api/analytics/heatmap", token);

// ── Radar par moteur ─────────────────────────────────────────────────────────
export const fetchRadarEngines = (token?: string) =>
  get<RadarEngineData[]>("/api/analytics/engines/radar", token);

// ── Timeline d'attaque ───────────────────────────────────────────────────────
export const fetchAttackTimeline = (token?: string) =>
  get<AttackTimelineEvent[]>("/api/analytics/timeline", token);

// ── Corrélation ──────────────────────────────────────────────────────────────
export const fetchCorrelationGraph = (token?: string) =>
  get<{ nodes: CorrelationNode[]; edges: CorrelationEdge[] }>(
    "/api/analytics/correlation", token
  );

// ── Seuils adaptatifs ────────────────────────────────────────────────────────
export const fetchThresholdHistory = (token?: string) =>
  get<ThresholdSnapshot[]>("/api/analytics/thresholds", token);

// ── Minimisation du risque ───────────────────────────────────────────────────
export const fetchRiskMinimization = (token?: string) =>
  get<RiskMinimizationPoint[]>("/api/analytics/risk-minimization", token);

// ── Pipeline ──────────────────────────────────────────────────────────────────
export const fetchPipelineMetrics = (token?: string) =>
  get<PipelineStage[]>("/api/analytics/pipeline", token);

// ── Confusion Matrix ─────────────────────────────────────────────────────────
export const fetchConfusionMetrics = (token?: string) =>
  get<ConfusionMetrics>("/api/analytics/confusion", token);

// ── MOCK FALLBACKS ───────────────────────────────────────────────────────────

export const mockEntropyHistory = (): EntropyPoint[] =>
  Array.from({ length: 30 }, (_, i) => ({
    time: `${String(Math.floor(i / 2)).padStart(2,"0")}:${i % 2 === 0 ? "00" : "30"}`,
    entropy: 2.1 + Math.random() * 2.8 + (i > 20 ? 1.5 : 0),
    threshold: 3.8,
    ipCount: 5 + Math.floor(Math.random() * 25) + (i > 20 ? 15 : 0),
  }));

export const mockHeatmap = (): AttackHeatmapCell[] => {
  const types = ["SSH_BRUTE", "WEB_ATTACK", "FTP_SCAN", "PORT_SCAN", "PRIVESC"];
  return types.flatMap((attackType, ti) =>
    Array.from({ length: 24 }, (_, hour) => ({
      hour,
      attackType,
      intensity: Math.max(0, Math.floor(Math.random() * 100) - 20 +
        (hour >= 10 && hour <= 14 ? 30 : 0) +
        (ti === 0 && hour === 12 ? 40 : 0)),
    }))
  );
};

export const mockRadarEngines = (): RadarEngineData[] => [
  { engine: "SSH", metrics: { frequency: 88, burst: 92, confidence: 85, anomaly: 76, entropy: 70, risk: 90 } },
  { engine: "WEB", metrics: { frequency: 65, burst: 58, confidence: 72, anomaly: 80, entropy: 55, risk: 68 } },
  { engine: "FTP", metrics: { frequency: 40, burst: 35, confidence: 60, anomaly: 45, entropy: 38, risk: 42 } },
  { engine: "KERNEL", metrics: { frequency: 30, burst: 28, confidence: 55, anomaly: 62, entropy: 44, risk: 50 } },
];

export const mockAttackTimeline = (): AttackTimelineEvent[] => [
  { id: "1", timestamp: "12:01:10", phase: "RECONNAISSANCE", type: "PORT_SCAN", ip: "192.168.56.103", detail: "SYN scan sur 1024 ports", severity: "warning", engineScore: 34 },
  { id: "2", timestamp: "12:02:44", phase: "ENUMERATION", type: "SSH_ENUM", ip: "192.168.56.103", detail: "Tentatives users: root, admin, user", severity: "warning", engineScore: 51 },
  { id: "3", timestamp: "12:04:05", phase: "BRUTE_FORCE", type: "SSH_BRUTE", ip: "192.168.56.103", detail: "148 tentatives en 80s — burst détecté", severity: "critical", engineScore: 88 },
  { id: "4", timestamp: "12:05:22", phase: "WEB_ATTACK", type: "HTTP_EXPLOIT", ip: "192.168.56.103", detail: "GET /admin 404×32 — injection tentée", severity: "critical", engineScore: 91 },
  { id: "5", timestamp: "12:06:01", phase: "CORRELATION", type: "MULTI_SOURCE", ip: "192.168.56.103", detail: "SSH + HTTP + FTP corrélés → même IP", severity: "critical", engineScore: 95 },
  { id: "6", timestamp: "12:06:15", phase: "DETECTION", type: "AI_DECISION", ip: "192.168.56.103", detail: "Score global: 95.2 — BLOCK_NOW déclenché", severity: "critical", engineScore: 95 },
  { id: "7", timestamp: "12:06:18", phase: "MITIGATION", type: "BLOCK_ACTION", ip: "192.168.56.103", detail: "iptables DROP + AWS SG rule appliqués", severity: "info", engineScore: 0 },
];

export const mockCorrelationGraph = () => ({
  nodes: [
    { id: "ip1", label: "192.168.56.103", type: "ip" as const, risk: 95 },
    { id: "svc_ssh", label: "SSH:22", type: "service" as const, risk: 90 },
    { id: "svc_http", label: "HTTP:80", type: "service" as const, risk: 75 },
    { id: "svc_ftp", label: "FTP:21", type: "service" as const, risk: 45 },
    { id: "alm1", label: "SSH_BRUTE", type: "alarm" as const, risk: 88 },
    { id: "alm2", label: "WEB_ATTACK", type: "alarm" as const, risk: 91 },
    { id: "act1", label: "BLOCK_NOW", type: "action" as const, risk: 0 },
  ],
  edges: [
    { source: "ip1", target: "svc_ssh", weight: 148 },
    { source: "ip1", target: "svc_http", weight: 32 },
    { source: "ip1", target: "svc_ftp", weight: 12 },
    { source: "svc_ssh", target: "alm1", weight: 88 },
    { source: "svc_http", target: "alm2", weight: 91 },
    { source: "alm1", target: "act1", weight: 1 },
    { source: "alm2", target: "act1", weight: 1 },
  ],
});

export const mockThresholds = (): ThresholdSnapshot[] =>
  Array.from({ length: 20 }, (_, i) => ({
    time: `12:${String(i * 3).padStart(2,"0")}`,
    fixedThreshold: 50,
    adaptiveThreshold: 50 + Math.sin(i * 0.4) * 12 + (i > 14 ? -8 : 0),
    actualActivity: 20 + Math.random() * 60 + (i > 12 && i < 17 ? 50 : 0),
  }));

export const mockRiskMinimization = (): RiskMinimizationPoint[] =>
  Array.from({ length: 15 }, (_, i) => ({
    time: `12:${String(i * 4).padStart(2,"0")}`,
    riskBefore: Math.max(10, 90 - i * 5 + Math.random() * 10),
    riskAfter: Math.max(5, 75 - i * 6 + Math.random() * 8),
    alarmCount: Math.max(0, 12 - i),
    healthScore: Math.min(100, 40 + i * 4 + Math.random() * 8),
  }));

export const mockPipelineStages = (): PipelineStage[] => [
  { name: "Log Ingestion", latencyMs: 12, throughput: 1840, status: "ok" },
  { name: "Normalization", latencyMs: 8, throughput: 1835, status: "ok" },
  { name: "Feature Extract", latencyMs: 45, throughput: 1820, status: "ok" },
  { name: "SSH Engine", latencyMs: 23, throughput: 890, status: "ok" },
  { name: "WEB Engine", latencyMs: 19, throughput: 620, status: "warn" },
  { name: "FTP Engine", latencyMs: 11, throughput: 310, status: "ok" },
  { name: "Correlation", latencyMs: 67, throughput: 1820, status: "ok" },
  { name: "Prediction", latencyMs: 120, throughput: 1818, status: "warn" },
  { name: "Trust Gate", latencyMs: 15, throughput: 1815, status: "ok" },
  { name: "Corrective Agent", latencyMs: 340, throughput: 24, status: "ok" },
];

export const mockConfusionMetrics = (): ConfusionMetrics => ({
  truePositive: 847, falsePositive: 23,
  trueNegative: 2840, falseNegative: 41,
  precision: 0.974, recall: 0.954,
  f1: 0.964, fpr: 0.008,
});