import type {
  FusionRiskResponse,
  FusionSummary,
  FusionTimelineResponse,
  FusionTopAttackersResponse,
} from "../../shared/types/fusion";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

const buildQuery = (dataset?: string) =>
  dataset ? `?dataset=${encodeURIComponent(dataset)}` : "";

const get = async <T>(path: string): Promise<T | null> => {
  try {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

export const fetchFusionSummary = async (dataset?: string): Promise<FusionSummary | null> =>
  get<FusionSummary>(`/api/events/fusion/summary${buildQuery(dataset)}`);

export const fetchFusionTimeline = async (dataset?: string): Promise<FusionTimelineResponse | null> =>
  get<FusionTimelineResponse>(`/api/events/fusion/timeline${buildQuery(dataset)}`);

export const fetchFusionTopAttackers = async (dataset?: string): Promise<FusionTopAttackersResponse | null> =>
  get<FusionTopAttackersResponse>(`/api/events/fusion/top-attackers${buildQuery(dataset)}`);

export const fetchFusionRiskScore = async (dataset?: string): Promise<FusionRiskResponse | null> =>
  get<FusionRiskResponse>(`/api/events/fusion/risk-score${buildQuery(dataset)}`);
