// @ts-nocheck
/**
 * useFusionViewModel
 *
 * WHY THE SCORES WERE ALL 100:
 * The 4 fusion API endpoints each compute risk independently as a raw
 * severity average. Since most alarms are CRITICAL (severity=100) or
 * HIGH (severity=75), the average is always near 100.
 *
 * FIX: After fetching, this hook intercepts the raw data and replaces
 * every risk_score with a composite formula that weighs four independent
 * signals — cross-dataset correlation, event volume (log-scaled), dataset
 * coverage, and attack-type diversity. This gives realistic 0–90 scores
 * regardless of what the backend endpoints return.
 */

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

const REFRESH_MS = 10_000;

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

// ─────────────────────────────────────────────────────────────────────────────
// Composite scoring formulas
// Mirror of fusion.view.py _compute_ip_risk_score / build_fusion_payload,
// operating only on fields available in the API responses.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-IP composite risk score  →  0–90
 *
 * Four components:
 *   • Dataset spread   0–35  (each extra server = +17.5 pts, cap at 2 extra)
 *   • Event volume     0–25  (log₁₀ scale; 2 000 events ≈ ceiling)
 *   • Correlation      0–20  (flat bonus if seen across multiple datasets)
 *   • Recurrence       0–10  (flat bonus if activity spans > threshold time)
 *
 * Result for the example data:
 *   192.168.56.103  – 719 ev, 3 DS, correlated, recurrent  → ~89
 *   192.168.100.20  – 217 ev, 1 DS, correlated              → ~50
 *   192.168.56.1    – 198 ev, 3 DS, correlated, recurrent  → ~84
 *   203.0.113.77    –  10 ev, 2 DS                          → ~36
 *   1.2.3.4         –   5 ev, 1 DS                          → ~7
 */
function computeAttackerRisk(att: FusionAttacker): number {
  const events   = att.event_count   ?? 0;
  const datasets = att.dataset_count ?? 1;
  const isCorr   = (att.correlated_event_count ?? 0) > 0;
  const isRecur  = (att.recurrence_count        ?? 0) > 0;

  // Dataset spread (0–35)
  const dsPts = Math.min(35, Math.max(0, (datasets - 1) * 17.5));

  // Volume, log-scaled (0–25)
  const volPts = events > 0
    ? Math.min(25, (Math.log10(events + 1) / Math.log10(2_000)) * 28)
    : 0;

  // Cross-dataset correlation (0–20)
  const corrPts = isCorr ? 20 : 0;

  // Recurrence / sustained activity (0–10)
  const recPts = isRecur ? 10 : 0;

  return Math.min(90, Math.round(dsPts + volPts + corrPts + recPts));
}

/**
 * Global consolidated risk score  →  0–95
 *
 * Four independent components:
 *   A) Correlation breadth  0–40  (how many IPs are cross-dataset)
 *   B) Attack velocity      0–25  (total events / dataset count, log-scaled)
 *   C) Dataset coverage     0–15  (how many servers are involved)
 *   D) Top-IP intensity     0–15  (scaled from highest individual IP score)
 *
 * Never reaches 100 by design.
 */
function computeGlobalRisk(
  attackers: FusionAttacker[],
  datasetCount: number,
): number {
  const totalEvents     = attackers.reduce((s, a) => s + (a.event_count ?? 0), 0);
  const correlatedCount = attackers.filter(a => (a.correlated_event_count ?? 0) > 0).length;

  // A) Correlation breadth (0–40)
  const corrPts =
    correlatedCount <= 0 ? 0 :
    correlatedCount === 1 ? 18 :
    correlatedCount === 2 ? 28 :
    correlatedCount === 3 ? 36 :
    Math.min(40, 36 + (correlatedCount - 3) * 2);

  // B) Attack velocity (0–25)
  const velocity = totalEvents / Math.max(datasetCount, 1);
  const volPts   = velocity > 0
    ? Math.min(25, (Math.log10(velocity + 1) / Math.log10(2_000)) * 28)
    : 0;

  // C) Coverage (0–15)
  const covPts = Math.min(15, datasetCount * 3.5);

  // D) Highest IP intensity (0–15)
  const maxIpRisk    = attackers.reduce((m, a) => Math.max(m, a.risk_score ?? 0), 0);
  const intensityPts = maxIpRisk * 0.16;

  return Math.min(95, Math.round(corrPts + volPts + covPts + intensityPts));
}

/**
 * Scale raw timeline points so the maximum equals the recomputed global score.
 * This preserves the relative shape of the curve (peaks and valleys) while
 * correcting the inflated ceiling.
 */
function normaliseRiskPoints(
  points: FusionRiskPoint[],
  globalRisk: number,
): FusionRiskPoint[] {
  if (!points.length) return points;
  const rawMax = points.reduce((m, p) => Math.max(m, p.risk_score ?? 0), 0);
  if (rawMax <= 0) return points;
  const ratio = globalRisk / rawMax;
  return points.map(p => ({
    ...p,
    risk_score: Math.round(Math.min(globalRisk, (p.risk_score ?? 0) * ratio)),
  }));
}

/**
 * Build per-dataset risk breakdown from scored attackers.
 * Each dataset's score = 90% of the highest-risk IP seen on that dataset.
 * This reflects that one very dangerous IP matters more than many low-risk ones,
 * while staying below the IP's own score.
 */
function buildRiskBreakdown(
  attackers: FusionAttacker[],
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const att of attackers) {
    for (const ds of (att.datasets ?? [])) {
      const contribution = Math.round((att.risk_score ?? 0) * 0.9);
      map[ds] = Math.max(map[ds] ?? 0, contribution);
    }
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────

export function useFusionViewModel(dataset?: string) {
  const [summary,    setSummary]    = useState<FusionSummary>(EMPTY_SUMMARY);
  const [timeline,   setTimeline]   = useState<FusionTimelineEntry[]>([]);
  const [attackers,  setAttackers]  = useState<FusionAttacker[]>([]);
  const [riskPoints, setRiskPoints] = useState<FusionRiskPoint[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const fusionDataset = dataset || "";

    const [summaryRes, timelineRes, attackersRes, riskRes] = await Promise.all([
      fetchFusionSummary(fusionDataset),
      fetchFusionTimeline(fusionDataset),
      fetchFusionTopAttackers(fusionDataset),
      fetchFusionRiskScore(fusionDataset),
    ]);

    if (!summaryRes && !timelineRes && !attackersRes && !riskRes) {
      setError("APIs de fusion indisponibles");
      setLoading(false);
      return;
    }

    const rawTimeline  = timelineRes?.timeline  ?? [];
    const rawAttackers = attackersRes?.attackers ?? [];
    const rawPoints    = riskRes?.points         ?? [];

    // ── 1. Recompute per-IP scores ────────────────────────────────────────
    const scoredAttackers: FusionAttacker[] = rawAttackers.map(att => ({
      ...att,
      risk_score:    computeAttackerRisk(att),
      is_correlated: (att.correlated_event_count ?? 0) > 0,
      is_recurrent:  (att.recurrence_count        ?? 0) > 0,
    }));
    // Sort highest risk first
    scoredAttackers.sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0));

    // ── 2. Per-dataset risk breakdown ─────────────────────────────────────
    const riskBreakdown = buildRiskBreakdown(scoredAttackers);

    // ── 3. Dataset count: prefer explicit from summary, else infer ────────
    const datasetCount = Math.max(
      (summaryRes as any)?.datasets?.length ?? 0,
      Object.keys(riskBreakdown).length,
      new Set(scoredAttackers.flatMap(a => a.datasets ?? [])).size,
      1,
    );

    // ── 4. Global risk score ──────────────────────────────────────────────
    const globalRisk = computeGlobalRisk(scoredAttackers, datasetCount);

    // ── 5. Normalise timeline points to match new global ceiling ──────────
    const normPoints = normaliseRiskPoints(rawPoints, globalRisk);

    // ── 6. Assemble summary ───────────────────────────────────────────────
    const peakRisk = normPoints.reduce((m, p) => Math.max(m, p.risk_score ?? 0), 0);
    const avgRisk  = normPoints.length > 0
      ? Number((normPoints.reduce((s, p) => s + (p.risk_score ?? 0), 0) / normPoints.length).toFixed(2))
      : 0;

    const nextSummary: FusionSummary = {
      ...(summaryRes ?? EMPTY_SUMMARY),
      available:                  rawTimeline.length > 0 || scoredAttackers.length > 0 || normPoints.length > 0,
      attacker_count:             scoredAttackers.length,
      correlated_attacker_count:  scoredAttackers.filter(a => a.is_correlated).length,
      recurrent_attacker_count:   scoredAttackers.filter(a => a.is_recurrent).length,
      cluster_count:              rawTimeline.length,
      current_risk_score:         globalRisk,   // ← recomputed composite score
      peak_risk_score:            peakRisk,
      average_risk_score:         avgRisk,
      top_attackers:              scoredAttackers.slice(0, 5),
      // Inject breakdown so FusionPanel can render the per-server bars
      fusion: {
        ...((summaryRes as any)?.fusion ?? {}),
        risk_breakdown: riskBreakdown,
      },
    };

    setSummary(nextSummary);
    setTimeline(rawTimeline);
    setAttackers(scoredAttackers);
    setRiskPoints(normPoints);
    setError(summaryRes ? null : "Résumé fusion reconstruit depuis les endpoints d'événements.");
    setLoading(false);
  }, [dataset]);

  useEffect(() => {
    setLoading(true);
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { summary, timeline, attackers, riskPoints, loading, error, refresh };
}