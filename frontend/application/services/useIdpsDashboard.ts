import { useState, useEffect, useCallback, useRef } from "react";
import type {
  KpiData,
  AlarmItem,
  EngineScore,
  AgentDecision,
  SessionSummary,
  ThresholdHistoryEntry,
  ExplainabilityData,
  LiveAlarmsResponse,
  TrustData,
  PipelineLatest,
  HealthCheck,
  WsIncomingMessage,
  CorrectiveSuggestion,
  WorkflowActivity,
} from "../../shared/types/idps";
import { isActivityHistoryMsg, isActivityMsg, isHistoryMsg } from "../../shared/types/idps";

const API     = import.meta.env.VITE_API_URL || "http://localhost:8000";
const WS_URL  = import.meta.env.VITE_WS_URL  || "ws://localhost:8000/ws/logs";
const POLL_MS = 10_000;
const FUSION_DATASET_IDS = new Set(["fusion", "__fusion__", "merged", "__merged__"]);

const isFusionDataset = (dataset?: string): boolean =>
  FUSION_DATASET_IDS.has(String(dataset ?? "").trim().toLowerCase());

// ─── Normalisation d'une alarme brute (backend → AlarmItem) ──────────────────
const normalizeAlarm = (a: any): AlarmItem => ({
  id:
    a.id ??
    `${a.timestamp}-${a.ip}-${a.type}`,

  timestamp:
    a.timestamp ?? new Date().toISOString(),

  type:
    a.type ?? "UNKNOWN",

  source_ip:
    a.source_ip ??
    a.ip ??
    "unknown",

  severity:
    a.severity === "CRITICAL"
      ? "CRITICAL"
      : a.severite === "CRITIQUE"
      ? "CRITICAL"
      : a.severite === "AVERTISSEMENT"
      ? "HIGH"
      : "MED",

  engine:
    a.engine ??
    a.domain ??
    "UNKNOWN",

  score:
    Number(a.score ?? 0),

  message:
    a.message ?? "",

  human_insight:
    a.human_insight ??
    a.message ??
    "",

  action:
    a.action === "BLOCK_24H" ||
    a.action === "PREEMPTIVE_BLOCK"
      ? "BLOCK_NOW"
      : a.action === "WATCHLIST_30MIN"
      ? "WATCHLIST"
      : "MONITOR",

  country:
    a.country ?? "Unknown",

  failures:
    Number(a.failures ?? 0),

  server_id:
    a.server_id,

  dataset_id:
    a.dataset_id,

  stage:
    a.stage,
});

// ─── Déduplication O(n) par id ────────────────────────────────────────────────
const uniqueById = (arr: AlarmItem[]): AlarmItem[] => {
  const map = new Map<string, AlarmItem>();
  for (const item of arr) map.set(item.id, item);
  return Array.from(map.values());
};

// ─── Tri décroissant par timestamp ───────────────────────────────────────────
const sortByTs = (arr: AlarmItem[]): AlarmItem[] =>
  arr.slice().sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

const sortSuggestions = (arr: CorrectiveSuggestion[]): CorrectiveSuggestion[] =>
  arr.slice().sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

const normalizeSuggestionPart = (value: unknown): string =>
  String(value ?? "").trim().toLowerCase();

const suggestionFingerprint = (suggestion: CorrectiveSuggestion): string =>
  [
    normalizeSuggestionPart(suggestion.dataset_id),
    normalizeSuggestionPart(suggestion.anomaly_type),
    normalizeSuggestionPart(suggestion.ip),
    normalizeSuggestionPart(suggestion.action_type),
    normalizeSuggestionPart(suggestion.command),
  ].join("|");

const suggestionStatusRank = (status: CorrectiveSuggestion["status"]): number => {
  if (status === "PENDING") return 0;
  return 1;
};

const shouldReplaceSuggestion = (
  current: CorrectiveSuggestion,
  incoming: CorrectiveSuggestion,
): boolean => {
  const currentTs = new Date(current.timestamp).getTime();
  const incomingTs = new Date(incoming.timestamp).getTime();

  if (incomingTs !== currentTs) {
    return incomingTs > currentTs;
  }

  const currentRank = suggestionStatusRank(current.status);
  const incomingRank = suggestionStatusRank(incoming.status);
  if (incomingRank !== currentRank) {
    return incomingRank > currentRank;
  }

  return incoming.suggestion_id >= current.suggestion_id;
};

const mergeSuggestions = (...groups: CorrectiveSuggestion[][]): CorrectiveSuggestion[] => {
  const map = new Map<string, CorrectiveSuggestion>();
  for (const group of groups) {
    for (const suggestion of group) {
      const key = suggestionFingerprint(suggestion);
      const existing = map.get(key);
      if (!existing || shouldReplaceSuggestion(existing, suggestion)) {
        map.set(key, suggestion);
      }
    }
  }
  return sortSuggestions(Array.from(map.values())).slice(0, 200);
};

const normalizeActivity = (activity: any): WorkflowActivity => ({
  id:
    activity?.id ??
    `${activity?.event_type ?? activity?.stage ?? "activity"}-${activity?.timestamp ?? Date.now()}`,
  timestamp: activity?.timestamp ?? new Date().toISOString(),
  session_id: activity?.session_id,
  dataset_id: activity?.dataset_id,
  event_type: activity?.event_type,
  stage: activity?.stage ?? "session",
  actor: activity?.actor ?? "System",
  title: activity?.title ?? activity?.event_type ?? "Activity",
  detail: activity?.detail ?? "",
  status: activity?.status ?? "info",
  severity: activity?.severity ?? "INFO",
  progress:
    typeof activity?.progress === "number"
      ? activity.progress
      : null,
  meta:
    activity?.meta && typeof activity.meta === "object"
      ? activity.meta as Record<string, unknown>
      : {},
});

const uniqueActivities = (arr: WorkflowActivity[]): WorkflowActivity[] => {
  const map = new Map<string, WorkflowActivity>();
  for (const item of arr) {
    map.set(item.id, item);
  }
  return Array.from(map.values());
};

const sortActivities = (arr: WorkflowActivity[]): WorkflowActivity[] =>
  arr.slice().sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

const matchesSuggestionDataset = (suggestion: CorrectiveSuggestion, dataset: string): boolean => {
  if (!dataset) return true;
  const suggestionDataset = String(suggestion.dataset_id ?? "").trim().toLowerCase();
  return suggestionDataset === dataset.trim().toLowerCase();
};

const mapLegacyEventToActivity = (event: Record<string, any>): WorkflowActivity | null => {
  const timestamp = String(event.timestamp ?? new Date().toISOString());
  const base = {
    id: `${event.session_id ?? "session"}:${event.event_type ?? "event"}:${timestamp}`,
    timestamp,
    session_id: event.session_id,
    event_type: event.event_type,
    meta: {},
  };

  switch (event.event_type) {
    case "PIPELINE_START":
      return normalizeActivity({
        ...base,
        stage: "ingestion",
        actor: "Collecteur",
        title: "Log ingestion completed",
        detail: `${event.row_count ?? 0} raw lines from ${event.server_count ?? 0} server(s).`,
        status: "completed",
        severity: "INFO",
        progress: 12,
      });
    case "METRICS_COMPUTED":
      return normalizeActivity({
        ...base,
        stage: "metrics",
        actor: "Analyste",
        title: "Security metrics computed",
        detail: `Health ${event.health_score ?? "?"}% | pattern ${event.attack_pattern ?? "UNKNOWN"}.`,
        status: "completed",
        severity: "INFO",
        progress: 28,
      });
    case "PASS1_COMPLETE":
      return normalizeActivity({
        ...base,
        stage: "pass1",
        actor: "Détecteur",
        title: "Pass 1 detection completed",
        detail: `${event.alarm_count ?? 0} alarm(s) detected.`,
        status: "completed",
        severity: (event.alarm_count ?? 0) > 0 ? "HIGH" : "INFO",
        progress: 42,
      });
    case "TRUST_COMPUTED":
      return normalizeActivity({
        ...base,
        stage: "trust",
        actor: "Trust Gate",
        title: "Trust score computed",
        detail: `Confidence ${event.confidence_in_metrics ?? "?"} (${event.confidence_label ?? "UNKNOWN"}).`,
        status: "completed",
        severity: event.drift_flagged ? "HIGH" : "INFO",
        progress: 50,
      });
    case "DYNAMIC_CONFIG_ISSUED":
      return normalizeActivity({
        ...base,
        stage: "orchestrator",
        actor: "Orchestrateur",
        title: "Pass 2 escalation issued",
        detail: event.reasoning_excerpt ?? "Dynamic configuration issued.",
        status: "completed",
        severity: event.threat_level === "CRITICAL" ? "CRITICAL" : event.threat_level === "ELEVATED" ? "HIGH" : "INFO",
        progress: 60,
      });
    case "DYNAMIC_CONFIG_DEFAULT":
      return normalizeActivity({
        ...base,
        stage: "orchestrator",
        actor: "Orchestrateur",
        title: "Pass 2 skipped",
        detail: event.note ?? "No threshold override was required.",
        status: "completed",
        severity: "INFO",
        progress: 60,
      });
    case "PASS2_COMPLETE":
      return normalizeActivity({
        ...base,
        stage: "pass2",
        actor: "Détecteur",
        title: "Pass 2 analysis completed",
        detail: `${event.alarm_count ?? 0} final alarm(s), delta ${event.alarm_delta ?? 0}.`,
        status: "completed",
        severity: "INFO",
        progress: 68,
      });
    case "AGENTS_COMPLETE":
      return normalizeActivity({
        ...base,
        stage: "reporting",
        actor: "Rapporteur",
        title: "Agent coordination finished",
        detail: String(event.result_excerpt ?? ""),
        status: "completed",
        severity: "INFO",
        progress: 97,
      });
    case "SESSION_SUMMARY":
      return normalizeActivity({
        ...base,
        stage: "session",
        actor: "Pipeline",
        title: "Pipeline run completed",
        detail: `${event.alarm_count ?? 0} final alarm(s) | elapsed ${event.elapsed_seconds ?? "?"}s.`,
        status: "completed",
        severity: event.agent_threat_level === "CRITICAL" ? "CRITICAL" : event.agent_threat_level === "ELEVATED" ? "HIGH" : "INFO",
        progress: 100,
      });
    case "WARNING":
      return normalizeActivity({
        ...base,
        stage: "session",
        actor: event.source ?? "System",
        title: `Warning from ${event.source ?? "system"}`,
        detail: String(event.message ?? ""),
        status: "warning",
        severity: "HIGH",
      });
    case "ERROR":
      return normalizeActivity({
        ...base,
        stage: "session",
        actor: event.source ?? "System",
        title: `Error in ${event.source ?? "system"}`,
        detail: String(event.error ?? ""),
        status: "error",
        severity: "CRITICAL",
      });
    default:
      return null;
  }
};

const extractActivitiesFromEvents = (events: Record<string, unknown>[]): WorkflowActivity[] => {
  const raw = events
    .map((event) => {
      const record = event as Record<string, any>;
      if (record.dashboard_activity) {
        return normalizeActivity(record.dashboard_activity);
      }
      return mapLegacyEventToActivity(record);
    })
    .filter((activity): activity is WorkflowActivity => activity !== null);

  return sortActivities(uniqueActivities(raw));
};

// ─── Helper fetch authentifié ─────────────────────────────────────────────────
async function get<T>(path: string, dataset = "", servers: string[] = []): Promise<T> {
  const params = new URLSearchParams();
  if (dataset) params.set("dataset", dataset);
  for (const server of servers) params.append("servers", server);
  const query = params.toString();
  const res = await fetch(`${API}${path}${query ? `?${query}` : ""}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` },
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json() as Promise<T>;
}

// ─── State shape ──────────────────────────────────────────────────────────────
export interface IdpsDashboardState {
  apiReady:     boolean;
  loading:      boolean;
  lastUpdate:   Date | null;
  kpis:         KpiData | null;
  alarms:       AlarmItem[];
  engines:      EngineScore[];
  decisions:    AgentDecision[];
  sessions:     SessionSummary[];
  thresholdHistory: ThresholdHistoryEntry[];
  explainability: ExplainabilityData | null;
  pipeline:     PipelineLatest | null;
  logLines:     string[];
  trust:        TrustData | null;
  activities:   WorkflowActivity[];
  sessionCount: number;
  logsAnalysed: number;
  threatLevel:  string;
  wsConnected:  boolean;
  isLive:       boolean;
  suggestions:  CorrectiveSuggestion[];
}

const EMPTY: IdpsDashboardState = {
  apiReady:     false,
  loading:      true,
  lastUpdate:   null,
  kpis:         null,
  alarms:       [],
  engines:      [],
  decisions:    [],
  sessions:     [],
  thresholdHistory: [],
  explainability: null,
  pipeline:     null,
  logLines:     [],
  trust:        null,
  activities:   [],
  sessionCount: 0,
  logsAnalysed: 0,
  threatLevel:  "NORMAL",
  wsConnected:  false,
  isLive:       false,
  suggestions:  [],
};

// ─── Hook principal ───────────────────────────────────────────────────────────
export const useIdpsDashboard = (selectedDataset = ""): IdpsDashboardState => {
  const [state, setState]  = useState<IdpsDashboardState>(EMPTY);
  const wsRef              = useRef<WebSocket | null>(null);
  const isFirstLoad        = useRef(true);
  const filterVersion      = useRef(0);
  const logBuffer          = useRef<string[]>([]);

  const datasetKey = selectedDataset;

  const datasetRef = useRef(selectedDataset);
  useEffect(() => { datasetRef.current = selectedDataset; }, [selectedDataset]);

  const refresh = useCallback(async () => {
    try {
      const dataset = datasetRef.current;
      const fusionView = isFusionDataset(dataset);
      const health = await get<HealthCheck>("/health");
      if (health.status !== "ok") {
        setState(s => ({ ...s, loading: false, apiReady: false }));
        return;
      }

      const [kpis, alarms, engines, decisions, live, suggestions, sessions, thresholdHistory, explainability, pipeline, trust] =
        await Promise.allSettled([
          get<KpiData>("/api/kpis", dataset),
          get<AlarmItem[]>("/api/alarms", dataset),
          get<EngineScore[]>("/api/engine-scores", dataset),
          get<AgentDecision[]>("/api/decisions", dataset),
          get<LiveAlarmsResponse>("/api/alarms/live", fusionView ? "" : dataset),
          fusionView
            ? Promise.resolve({ count: 0, suggestions: [] })
            : get<{ count: number; suggestions: CorrectiveSuggestion[] }>(
                `/api/corrective/suggestions${dataset ? `?dataset=${encodeURIComponent(dataset)}` : ""}`
              ),
          get<SessionSummary[]>("/api/sessions", dataset),
          get<ThresholdHistoryEntry[]>("/api/threshold-history", dataset),
          get<ExplainabilityData>("/api/explainability", dataset),
          get<PipelineLatest>("/api/pipeline/latest", dataset),
          get<TrustData>("/api/trust", dataset),
        ]);

      const kpisVal        = kpis.status        === "fulfilled" ? kpis.value                    : null;
      const alarmsVal      = alarms.status      === "fulfilled"
        ? (alarms.value as any[]).map(normalizeAlarm)
        : [];
      const engVal         = engines.status      === "fulfilled" ? engines.value                 : [];
      const decVal = decisions.status === "fulfilled"
        ? (decisions.value as any[]).map((d: any) => ({
            ...d,
            confidence: d.confidence ?? d.conf ?? 1,   // ✅ fixed 10000% bug
            severity:   d.severity ?? (d.event_type === "AGENTS_COMPLETE" ? "NORMAL" : "INFO"),
            note:       d.note ?? d.result_excerpt?.slice(0, 200) ?? "No details",
          }))
        : [];
      const liveVal        = live.status         === "fulfilled"
        ? (live.value.alarms as any[]).map(normalizeAlarm)
        : [];
      const suggestionsVal = suggestions.status  === "fulfilled" ? suggestions.value.suggestions : [];
      const sessVal        = sessions.status     === "fulfilled" ? sessions.value                : [];
      const thresholdHistoryVal = thresholdHistory.status === "fulfilled" ? thresholdHistory.value : [];
      const explainabilityVal = explainability.status === "fulfilled" ? explainability.value : null;
      const pipeVal        = pipeline.status     === "fulfilled" ? pipeline.value                : null;
      const trustVal       = trust.status        === "fulfilled" ? trust.value                   : null;

      console.log("[useIdpsDashboard] fetch results:", {
        kpis: kpisVal, alarms: alarmsVal.length, engines: engVal.length,
        suggestions: suggestionsVal.length, sessions: sessVal.length,
      });
      const logLines = pipeVal?.log_lines ?? [];
      const historicalActivities = pipeVal?.events
        ? extractActivitiesFromEvents(pipeVal.events)
        : [];
      const latestSess = sessVal[0];

      const events = pipeVal?.events ?? [];

      const metricsEvent = events.find((e: any) => e.event_type === "METRICS_COMPUTED");
      const pipelineStart = events.find((e: any) => e.event_type === "PIPELINE_START");
      // const trustEvent = events.find((e: any) => e.event_type === "TRUST_COMPUTED");

      setState(prev => {
        // ✅ Correct merge order: prev state -> REST -> live (prev gets overwritten by fresher REST)
        const mergedAlarms = (() => {
          const map = new Map<string, AlarmItem>();
          for (const a of prev.alarms) map.set(a.id, a);   // 1. previous state
          for (const a of alarmsVal)   map.set(a.id, a);   // 2. REST (fresher)
          for (const a of liveVal)     map.set(a.id, a);   // 3. live (most authoritative)
          return sortByTs(Array.from(map.values())).slice(0, 100);
        })();

        localStorage.setItem(`alarms_sync:${datasetRef.current || "default"}`, JSON.stringify(mergedAlarms));

        const mergedSuggestions = mergeSuggestions(prev.suggestions, suggestionsVal);

        const normalizedKpis: KpiData | null = kpisVal
          ? {
              ...kpisVal,
              ip_entropy:
                (metricsEvent?.ip_entropy ??
                  kpisVal.ip_entropy ??
                  (kpisVal as any).entropy ??
                  null) as number | null,
              unique_attacking_ips:
                (metricsEvent?.unique_attacking_ips ??
                  kpisVal.unique_attacking_ips ??
                  0) as number,
              attack_velocity:
                (metricsEvent?.attack_velocity ??
                  kpisVal.attack_velocity ??
                  0) as number,
              deduped_count:
                (pipelineStart?.deduped_count ??
                  kpisVal.deduped_count ??
                  (kpisVal as any).dedup_count ??
                  0) as number,
              noise_ratio:
                (pipelineStart?.noise_ratio ??
                  kpisVal.noise_ratio ??
                  null) as number | null,
              data_quality:
                (pipelineStart?.data_quality ??
                  kpisVal.data_quality ??
                  "UNKNOWN") as string,
              row_count:
                (pipelineStart?.row_count ??
                  kpisVal.row_count ??
                  (kpisVal as any).lines_analyzed ??
                  0) as number,
            }
          : null;

        const normalizedTrust: TrustData | null = trustVal
          ? {
              available:
                ((trustVal as any).available ?? true) as boolean,
              model_agreement:
                (trustVal.model_agreement ??
                  (trustVal as any).agreement ??
                  null) as number | null,
              false_positive_rate:
                (trustVal.false_positive_rate ??
                  (trustVal as any).fp_rate ??
                  null) as number | null,
              drift_score:
                (trustVal.drift_score ??
                  (trustVal as any).drift ??
                  null) as number | null,
              drift_label:
                (trustVal.drift_label ?? (trustVal as any).drift_label ?? "UNKNOWN") as string,
              drift_flagged:
                (trustVal.drift_flagged ?? false) as boolean,
              stability:
                (trustVal.stability ?? "UNKNOWN") as string,
              confidence_in_metrics:
                (trustVal.confidence_in_metrics ??
                  (trustVal as any).confidence ??
                  null) as number | null,
              confidence_label:
                (trustVal.confidence_label ??
                  (trustVal as any).label ??
                  "UNKNOWN") as string,
              signals_summary:
                (trustVal.signals_summary ?? "") as string,
            }
          : null;

        return {
          ...prev,
          apiReady:     true,
          loading:      false,
          lastUpdate:   new Date(),
          kpis:         normalizedKpis,
          trust:        normalizedTrust,
          activities:   sortActivities(uniqueActivities([...prev.activities, ...historicalActivities])).slice(0, 150),
          engines:      engVal,
          decisions:    decVal,
          sessions:     sessVal,
          thresholdHistory: thresholdHistoryVal,
          explainability: explainabilityVal,
          pipeline:     pipeVal,
          sessionCount: sessVal.length,
          logsAnalysed: normalizedKpis?.row_count ?? 0,
          threatLevel:  latestSess?.threat_level ?? "NORMAL",
          alarms:       mergedAlarms,
          suggestions:  mergedSuggestions,
          logLines:     prev.logLines.length > 0 ? prev.logLines : logLines.slice(-60),
        };
      });

      isFirstLoad.current = false;
    } catch {
      setState(s => ({ ...s, loading: false, apiReady: false }));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stable polling (runs once, uses ref for fresh callback) ────────────
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    if (isFirstLoad.current) setState(s => ({ ...s, loading: true }));
    refreshRef.current();
    const id = setInterval(() => refreshRef.current(), POLL_MS);
    return () => clearInterval(id);
  }, []); // ← runs only on mount/unmount

  // ── WebSocket (with destroyed flag to prevent zombie reconnects) ───────
  useEffect(() => {
    let destroyed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (destroyed || wsRef.current?.readyState === WebSocket.OPEN) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (destroyed) return;
        setState(prev => ({ ...prev, wsConnected: true }));
        refreshRef.current();
        // send current filter using the ref to avoid stale data
        ws.send(JSON.stringify({
          type: "filter",
          servers: [],
          dataset: isFusionDataset(datasetRef.current) ? "" : datasetRef.current,
          version: filterVersion.current,
        }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as WsIncomingMessage;

          if (data.type === "filter_ack") {
            setState(prev => ({
              ...prev,
              alarms: [],
              activities: [],
              logLines: [],
              suggestions: [],
            }));
            return;
          }

          if (isActivityHistoryMsg(data)) {
            const history = Array.isArray(data.activities)
              ? data.activities.map(normalizeActivity)
              : [];
            if (history.length > 0) {
              setState(prev => ({
                ...prev,
                activities: sortActivities(
                  uniqueActivities([...history, ...prev.activities])
                ).slice(0, 150),
              }));
            }
            return;
          }

          if (isHistoryMsg(data)) {
            const histAlarms = Array.isArray(data.alarms) ? data.alarms : []; // ✅ safe guard
            if (histAlarms.length > 0) {
              setState(prev => ({
                ...prev,
                alarms: sortByTs(
                  uniqueById([...histAlarms.map(normalizeAlarm), ...prev.alarms])
                ).slice(0, 100),
              }));
            }
            return;
          }

          if (isActivityMsg(data)) {
            const activity = normalizeActivity(data.activity);
            setState(prev => ({
              ...prev,
              lastUpdate: new Date(),
              isLive: true,
              activities: sortActivities(
                uniqueActivities([activity, ...prev.activities])
              ).slice(0, 150),
            }));
            return;
          }

          if (data.type === "alarm") {
            const msgVersion = (data as { version?: number }).version;
            if (msgVersion !== undefined && msgVersion !== filterVersion.current) return;
            const normalizedAlarm = normalizeAlarm(data.alarm);
            setState(prev => ({
              ...prev,
              lastUpdate: new Date(),
              isLive:     true,
              alarms:     uniqueById([normalizedAlarm, ...prev.alarms]).slice(0, 100),
            }));
            return;
          }

          if (data.type === "suggestion") {
            const incoming = (data as {
              type: "suggestion";
              suggestion: CorrectiveSuggestion;
            }).suggestion;
            const activeDataset = String(datasetRef.current ?? "");
            if (!activeDataset || isFusionDataset(activeDataset) || !matchesSuggestionDataset(incoming, activeDataset)) {
              return;
            }
            setState(prev => ({
              ...prev,
              suggestions: mergeSuggestions(prev.suggestions, [incoming]),
            }));
            return;
          }

          if (data.type === "log") {
            if (logBuffer.current.length < 500) {
              logBuffer.current.push(data.line);
            }
            return;
          }

          if (data.type === "metrics") {
            setState(prev => ({
              ...prev,
              kpis: prev.kpis
                ? { ...prev.kpis, ...data.data }
                : (data.data as KpiData),
            }));
            return;
          }
        } catch {
          // ignore non-JSON messages
        }
      };

      ws.onclose = () => {
        if (destroyed) return;
        setState(prev => ({ ...prev, wsConnected: false, isLive: false }));
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    const logFlush = setInterval(() => {
      if (logBuffer.current.length === 0) return;
      const lines = logBuffer.current.splice(0);
      setState(prev => ({
        ...prev,
        logLines: [...prev.logLines, ...lines].slice(-60),
      }));
    }, 500);

    return () => {
      destroyed = true;
      clearInterval(logFlush);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── WebSocket filter update when dataset changes ──────────────────────
  useEffect(() => {
    filterVersion.current += 1;
    const version = filterVersion.current;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "filter",
        servers: [],
        dataset: isFusionDataset(datasetRef.current) ? "" : datasetRef.current,
        version,
      }));
    }
    setState(prev => ({ ...prev, loading: true, alarms: [], activities: [], logLines: [] }));
    refreshRef.current();
  }, [datasetKey]);

  // ── Sync multi-tabs via localStorage ─────────────────────────────────
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === `alarms_sync:${datasetRef.current || "default"}` && e.newValue) {
        try {
          const parsed: AlarmItem[] = JSON.parse(e.newValue);
          setState(prev => ({
            ...prev,
            alarms: sortByTs(
              uniqueById([...parsed, ...prev.alarms])
            ).slice(0, 100),
          }));
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  return state;
};
