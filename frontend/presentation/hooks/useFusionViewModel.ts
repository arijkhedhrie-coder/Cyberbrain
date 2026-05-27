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

function deriveSummaryFromRealData(
  timeline: FusionTimelineEntry[],
  attackers: FusionAttacker[],
  riskPoints: FusionRiskPoint[],
): FusionSummary {
  const latestRisk = riskPoints[riskPoints.length - 1]?.risk_score ?? 0;
  const peakRisk = riskPoints.reduce((max, point) => Math.max(max, point.risk_score), 0);
  const averageRisk =
    riskPoints.length > 0
      ? Number(
          (riskPoints.reduce((sum, point) => sum + point.risk_score, 0) / riskPoints.length).toFixed(2),
        )
      : 0;

  return {
    ...EMPTY_SUMMARY,
    available: timeline.length > 0 || attackers.length > 0 || riskPoints.length > 0,
    generated_from: "event_store",
    attacker_count: attackers.length,
    correlated_attacker_count: attackers.filter((attacker) => attacker.correlated_event_count > 0).length,
    recurrent_attacker_count: attackers.filter((attacker) => attacker.recurrence_count > 0).length,
    cluster_count: timeline.length,
    current_risk_score: latestRisk,
    peak_risk_score: peakRisk,
    average_risk_score: averageRisk,
    top_attackers: attackers.slice(0, 5),
  };
}

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

    const nextTimeline = timelineRes?.timeline ?? [];
    const nextAttackers = attackersRes?.attackers ?? [];
    const nextRiskPoints = riskRes?.points ?? [];
    const nextSummary =
      summaryRes ??
      deriveSummaryFromRealData(nextTimeline, nextAttackers, nextRiskPoints);

    setSummary(nextSummary);
    setTimeline(nextTimeline);
    setAttackers(nextAttackers);
    setRiskPoints(nextRiskPoints);
    setError(summaryRes ? null : "Fusion summary reconstructed from real event endpoints.");
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
