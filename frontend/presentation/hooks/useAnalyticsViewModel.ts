// presentation/hooks/useAnalyticsViewModel.ts
import { useState, useEffect, useCallback } from "react";
import {
  fetchEntropyHistory, fetchAttackHeatmap, fetchRadarEngines,
  fetchThresholdHistory, fetchRiskMinimization, fetchPipelineMetrics,
  fetchConfusionMetrics,
  mockEntropyHistory, mockHeatmap, mockRadarEngines,
  mockThresholds, mockRiskMinimization, mockPipelineStages, mockConfusionMetrics,
} from "../../infrastructure/api/analyticsApi";
import type {
  EntropyPoint, AttackHeatmapCell, RadarEngineData,
  ThresholdSnapshot, RiskMinimizationPoint, PipelineStage, ConfusionMetrics,
} from "../../shared/types/analytics";

const REFRESH_MS = 8000;

export interface AnalyticsViewModel {
  entropy: EntropyPoint[];
  heatmap: AttackHeatmapCell[];
  radars: RadarEngineData[];
  thresholds: ThresholdSnapshot[];
  riskCurve: RiskMinimizationPoint[];
  pipeline: PipelineStage[];
  confusion: ConfusionMetrics | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useAnalyticsViewModel(token?: string): AnalyticsViewModel {
  const [entropy, setEntropy] = useState<EntropyPoint[]>(mockEntropyHistory());
  const [heatmap, setHeatmap] = useState<AttackHeatmapCell[]>(mockHeatmap());
  const [radars, setRadars] = useState<RadarEngineData[]>(mockRadarEngines());
  const [thresholds, setThresholds] = useState<ThresholdSnapshot[]>(mockThresholds());
  const [riskCurve, setRiskCurve] = useState<RiskMinimizationPoint[]>(mockRiskMinimization());
  const [pipeline, setPipeline] = useState<PipelineStage[]>(mockPipelineStages());
  const [confusion, setConfusion] = useState<ConfusionMetrics | null>(mockConfusionMetrics());
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [e, h, r, t, rm, p, c] = await Promise.all([
      fetchEntropyHistory(token),
      fetchAttackHeatmap(token),
      fetchRadarEngines(token),
      fetchThresholdHistory(token),
      fetchRiskMinimization(token),
      fetchPipelineMetrics(token),
      fetchConfusionMetrics(token),
    ]);
    if (e) setEntropy(e);
    if (h) setHeatmap(h);
    if (r) setRadars(r);
    if (t) setThresholds(t);
    if (rm) setRiskCurve(rm);
    if (p) setPipeline(p);
    if (c) setConfusion(c);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { entropy, heatmap, radars, thresholds, riskCurve, pipeline, confusion, loading, refresh };
}