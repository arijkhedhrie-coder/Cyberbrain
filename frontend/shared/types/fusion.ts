export type FusionSummary = {
  available: boolean;
  generated_from: string;
  dataset_id?: string | null;
  replayed_categories: string[];
  time_range: {
    start: string | null;
    end: string | null;
  };
  source_events: {
    replayed_event_count: number;
    deduped_duplicate_alerts: number;
    deduped_alert_event_count: number;
    support_event_count: number;
    ignored_alerts_without_ip?: number;
  };
  categories: Record<string, number>;
  attacker_count: number;
  correlated_attacker_count: number;
  recurrent_attacker_count: number;
  cluster_count: number;
  current_risk_score: number;
  peak_risk_score: number;
  average_risk_score: number;
  top_attackers: FusionAttacker[];
};

export type FusionAttacker = {
  ip: string;
  event_count: number;
  dataset_count: number;
  datasets: string[];
  engines: string[];
  behavior_count: number;
  behaviors: string[];
  correlated_event_count: number;
  correlated_behaviors: Array<{
    behavior: string;
    event_count: number;
    episode_count: number;
    datasets: string[];
  }>;
  recurrence_count: number;
  first_seen: string;
  last_seen: string;
  max_severity: string;
  avg_score: number;
  risk_score: number;
  evidence_event_ids: string[];
};

export type FusionTimelineEntry = {
  cluster_id: string;
  window_start: string;
  window_end: string;
  event_count: number;
  attacker_count: number;
  dataset_count: number;
  attackers: string[];
  dominant_behaviors: Array<{
    behavior: string;
    event_count: number;
  }>;
  risk_score: number;
  supporting_event_counts: Record<string, number>;
  evidence_event_ids: string[];
};

export type FusionTimelineResponse = {
  available: boolean;
  count: number;
  timeline: FusionTimelineEntry[];
  generated_from: string;
  dataset_id?: string | null;
};

export type FusionTopAttackersResponse = {
  available: boolean;
  count: number;
  attackers: FusionAttacker[];
  generated_from: string;
  dataset_id?: string | null;
};

export type FusionRiskPoint = {
  timestamp: string;
  window_start: string;
  window_end: string;
  risk_score: number;
  event_count: number;
  attacker_count: number;
  dataset_count: number;
};

export type FusionRiskResponse = {
  available: boolean;
  count: number;
  points: FusionRiskPoint[];
  generated_from: string;
  dataset_id?: string | null;
};
