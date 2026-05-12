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

export const fetchEntropyHistory = async (token?: string): Promise<EntropyPoint[]> => {
  const data = await get<EntropyPoint[]>('/api/analytics/entropy', token);
  return data ?? [];
};

export const fetchAttackHeatmap = async (token?: string): Promise<AttackHeatmapCell[]> => {
  const data = await get<AttackHeatmapCell[]>('/api/analytics/heatmap', token);
  return data ?? [];
};

export const fetchRadarEngines = async (token?: string): Promise<RadarEngineData[]> => {
  const data = await get<RadarEngineData[]>('/api/analytics/engines/radar', token);
  return data ?? [];
};

export const fetchAttackTimeline = async (token?: string): Promise<AttackTimelineEvent[]> => {
  const data = await get<AttackTimelineEvent[]>('/api/analytics/timeline', token);
  return data ?? [];
};

export const fetchCorrelationGraph = async (token?: string): Promise<{ nodes: CorrelationNode[]; edges: CorrelationEdge[] }> => {
  const data = await get<{ nodes: CorrelationNode[]; edges: CorrelationEdge[] }>(
    '/api/analytics/correlation', token
  );
  return data ?? { nodes: [], edges: [] };
};

export const fetchThresholdHistory = async (token?: string): Promise<ThresholdSnapshot[]> => {
  const data = await get<ThresholdSnapshot[]>('/api/analytics/thresholds', token);
  return data ?? [];
};

export const fetchRiskMinimization = async (token?: string): Promise<RiskMinimizationPoint[]> => {
  const data = await get<RiskMinimizationPoint[]>('/api/analytics/risk-minimization', token);
  return data ?? [];
};

export const fetchPipelineMetrics = async (token?: string): Promise<PipelineStage[]> => {
  const data = await get<PipelineStage[]>('/api/analytics/pipeline', token);
  return data ?? [];
};

export const fetchConfusionMetrics = async (token?: string): Promise<ConfusionMetrics> => {
  const data = await get<ConfusionMetrics>('/api/analytics/confusion', token);
  return data ?? {
    truePositive: 0,
    falsePositive: 0,
    trueNegative: 0,
    falseNegative: 0,
    precision: 0,
    recall: 0,
    f1: 0,
    fpr: 0,
  };
};