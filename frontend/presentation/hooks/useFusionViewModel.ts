import { useCallback, useEffect, useState } from "react";
import {
  fetchFusionRiskScore,
  fetchFusionSummary,
  fetchFusionTimeline,
  fetchFusionTopAttackers,
} from "../../infrastructure/api/fusionApi";
import type {
  FusionRiskPoint,
  FusionSummary,
  FusionTimelineEntry,
  FusionAttacker,
} from "../../shared/types/fusion";

const REFRESH_MS = 10000;

const EMPTY_SUMMARY: FusionSummary = {
  available: false,
  generated_from: "event_store",
  replayed_categories: [],
  time_range: { start: null, end: null },
  source_events: {
    replayed_event_count: 0,
    deduped_duplicate_alerts: 0,
    deduped_alert_event_count: 0,
    support_event_count: 0,
  },
  categories: {},
  attacker_count: 0,
  correlated_attacker_count: 0,
  recurrent_attacker_count: 0,
  cluster_count: 0,
  current_risk_score: 0,
  peak_risk_score: 0,
  average_risk_score: 0,
  top_attackers: [],
};

export function useFusionViewModel(dataset?: string) {
  const [summary, setSummary] = useState<FusionSummary>(EMPTY_SUMMARY);
  const [timeline, setTimeline] = useState<FusionTimelineEntry[]>([]);
  const [attackers, setAttackers] = useState<FusionAttacker[]>([]);
  const [riskPoints, setRiskPoints] = useState<FusionRiskPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const fusionDataset = dataset || "";
    const [summaryRes, timelineRes, attackersRes, riskRes] = await Promise.all([
      fetchFusionSummary(fusionDataset),
      fetchFusionTimeline(fusionDataset),
      fetchFusionTopAttackers(fusionDataset),
      fetchFusionRiskScore(fusionDataset),
    ]);

    if (!summaryRes && !timelineRes && !attackersRes && !riskRes) {
      setError("Fusion APIs unavailable");
      setLoading(false);
      return;
    }

    setSummary(summaryRes ?? EMPTY_SUMMARY);
    setTimeline(timelineRes?.timeline ?? []);
    setAttackers(attackersRes?.attackers ?? []);
    setRiskPoints(riskRes?.points ?? []);
    setError(null);
    setLoading(false);
  }, [dataset]);

  useEffect(() => {
    setLoading(true);
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return {
    summary,
    timeline,
    attackers,
    riskPoints,
    loading,
    error,
    refresh,
  };
}
