// src/hooks/useIdpsDashboard.ts
// ─────────────────────────────────────────────────────────────────────────────
// Hook principal — architecture hybride REST (10s) + WebSocket temps réel.
// TOUS les types viennent de src/types/idps — source unique.
//
// FIXES appliqués dans cette version :
//   ✅ suggestions[] ajouté au state + polling REST + handler WS
//   ✅ ws.onopen propre : uniquement setState + refresh() + ws.send()
//   ✅ ws.onmessage : tous les handlers dans le try/catch, ordre correct
//   ✅ filter_ack : efface seulement logLines (pas les alarmes)
//   ✅ history  : dédup + merge correct via isHistoryMsg()
//   ✅ suggestion : handler propre avec dédup par suggestion_id
//   ✅ Sync multi-tabs via localStorage
//   ✅ /api/alarms/live + /api/corrective/suggestions dans refresh()
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  KpiData,
  AlarmItem,
  EngineScore,
  AgentDecision,
  SessionSummary,
  LiveAlarmsResponse,
  TrustData,
  PipelineLatest,
  HealthCheck,
  WsIncomingMessage,
  CorrectiveSuggestion,
} from "../types/idps";
import { isHistoryMsg } from "../types/idps";

const API     = import.meta.env.VITE_API_URL || "http://localhost:8000";
const WS_URL  = import.meta.env.VITE_WS_URL  || "ws://localhost:8000/ws/logs";
const POLL_MS = 10_000;

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

// ─── Helper fetch authentifié ─────────────────────────────────────────────────
async function get<T>(path: string, servers: string[] = []): Promise<T> {
  const params = servers.length > 0
    ? "?" + servers.map(s => `servers=${encodeURIComponent(s)}`).join("&")
    : "";
  const res = await fetch(`${API}${path}${params}`, {
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
  logLines:     string[];
  trust:        TrustData | null;
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
  logLines:     [],
  trust:        null,
  sessionCount: 0,
  logsAnalysed: 0,
  threatLevel:  "NORMAL",
  wsConnected:  false,
  isLive:       false,
  suggestions:  [],
};

// ─── Hook principal ───────────────────────────────────────────────────────────
export const useIdpsDashboard = (selectedServers: string[] = []): IdpsDashboardState => {
  const [state, setState]  = useState<IdpsDashboardState>(EMPTY);
  const timerRef           = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef              = useRef<WebSocket | null>(null);
  const isFirstLoad        = useRef(true);
  const filterVersion      = useRef(0);
  const logBuffer          = useRef<string[]>([]);

  const serversKey = selectedServers.slice().sort().join(",");

  // ── REST fetch ─────────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    try {
      const health = await get<HealthCheck>("/health");
      if (health.status !== "ok") {
        setState(s => ({ ...s, loading: false, apiReady: false }));
        return;
      }

      const [kpis, alarms, engines, decisions, live, suggestions, sessions, pipeline, trust] =
        await Promise.allSettled([
          get<KpiData>("/api/kpis",              selectedServers),
          get<AlarmItem[]>("/api/alarms",        selectedServers),
          get<EngineScore[]>("/api/engine-scores", selectedServers),
          get<AgentDecision[]>("/api/decisions"),
          get<LiveAlarmsResponse>("/api/alarms/live"),
          get<{ count: number; suggestions: CorrectiveSuggestion[] }>(
            "/api/corrective/suggestions?status=PENDING"
          ),
          get<SessionSummary[]>("/api/sessions"),
          get<PipelineLatest>("/api/pipeline/latest"),
          get<TrustData>("/api/trust"),
        ]);

      const kpisVal        = kpis.status        === "fulfilled" ? kpis.value                    : null;
      const alarmsVal      = alarms.status       === "fulfilled" ? alarms.value                  : [];
      const engVal         = engines.status      === "fulfilled" ? engines.value                 : [];
      const decVal         = decisions.status    === "fulfilled" ? decisions.value               : [];
      const liveVal        = live.status         === "fulfilled" ? live.value.alarms             : [];
      const suggestionsVal = suggestions.status  === "fulfilled" ? suggestions.value.suggestions : [];
      const sessVal        = sessions.status     === "fulfilled" ? sessions.value                : [];
      const pipeVal        = pipeline.status     === "fulfilled" ? pipeline.value                : null;
      const trustVal       = trust.status        === "fulfilled" ? trust.value                   : null;
      const logLines       = pipeVal?.log_lines ?? [];
      const latestSess     = sessVal[0];

      setState(prev => {
        // Fusion alarmes : REST < état WS < live (priorité max = ALARMS_STORE)
        const mergedAlarms = (() => {
          const map = new Map<string, AlarmItem>();
          for (const a of alarmsVal)   map.set(a.id, a);
          for (const a of prev.alarms) map.set(a.id, a);
          for (const a of liveVal)     map.set(a.id, a);
          return sortByTs(Array.from(map.values())).slice(0, 100);
        })();

        // Sync multi-tabs : notifie les autres onglets
        localStorage.setItem("alarms_sync", JSON.stringify(mergedAlarms));

        // Fusion suggestions : REST < état WS précédent
        const mergedSuggestions = (() => {
          const map = new Map<string, CorrectiveSuggestion>();
          for (const s of suggestionsVal)   map.set(s.suggestion_id, s);
          for (const s of prev.suggestions) map.set(s.suggestion_id, s);
          return Array.from(map.values()).slice(0, 50);
        })();

        return {
          ...prev,
          apiReady:     true,
          loading:      false,
          lastUpdate:   new Date(),
          kpis:         kpisVal,
          engines:      engVal,
          decisions:    decVal,
          sessions:     sessVal,
          trust:        trustVal,
          sessionCount: sessVal.length,
          logsAnalysed: kpisVal?.row_count ?? 0,
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serversKey]);

  // ── REST polling ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (isFirstLoad.current) setState(s => ({ ...s, loading: true }));
    refresh();
    timerRef.current = setInterval(refresh, POLL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [refresh]);

  // ── WebSocket temps réel ───────────────────────────────────────────────────
  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      // ✅ ws.onopen — 3 responsabilités : connecté + recharge données + filtre
      ws.onopen = () => {
        setState(prev => ({ ...prev, wsConnected: true }));
        refresh();
        ws.send(JSON.stringify({
          type:    "filter",
          servers: selectedServers,
          version: filterVersion.current,
        }));
      };

      // ✅ ws.onmessage — tous les handlers dans le try/catch, ordre correct
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as WsIncomingMessage;

          // ── filter_ack : efface uniquement les logs, PAS les alarmes ────────
          if (data.type === "filter_ack") {
            setState(prev => ({ ...prev, logLines: [] }));
            return;
          }

          // ── history : historique ALARMS_STORE envoyé au connect ──────────────
          if (isHistoryMsg(data)) {
            const histAlarms = data.alarms ?? [];
            if (histAlarms.length > 0) {
              setState(prev => ({
                ...prev,
                alarms: sortByTs(
                  uniqueById([...histAlarms, ...prev.alarms])
                ).slice(0, 100),
              }));
            }
            return;
          }

          // ── alarm : alarme individuelle temps réel ───────────────────────────
          if (data.type === "alarm") {
            const msgVersion = (data as { version?: number }).version;
            if (msgVersion !== undefined && msgVersion !== filterVersion.current) return;
            setState(prev => ({
              ...prev,
              lastUpdate: new Date(),
              isLive:     true,
              alarms:     uniqueById([data.alarm, ...prev.alarms]).slice(0, 100),
            }));
            return;
          }

          // ── suggestion : action corrective en attente de validation ──────────
          if (data.type === "suggestion") {
            const incoming = (data as {
              type: "suggestion";
              suggestion: CorrectiveSuggestion;
            }).suggestion;
            setState(prev => ({
              ...prev,
              suggestions: [
                incoming,
                ...prev.suggestions.filter(
                  s => s.suggestion_id !== incoming.suggestion_id
                ),
              ].slice(0, 50),
            }));
            return;
          }

          // ── log : ligne terminal pipeline ────────────────────────────────────
          if (data.type === "log") {
            if (logBuffer.current.length < 500) {
              logBuffer.current.push(data.line);
            }
            return;
          }

          // ── metrics : mise à jour KPIs temps réel ────────────────────────────
          if (data.type === "metrics") {
            setState(prev => ({
              ...prev,
              kpis: prev.kpis
                ? { ...prev.kpis, ...data.data }
                : (data.data as KpiData),
            }));
            return;
          }

          // pong / heartbeat → silencieux

        } catch {
          // message non-JSON → ignoré
        }
      };

      ws.onclose = () => {
        setState(prev => ({ ...prev, wsConnected: false, isLive: false }));
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    // Flush buffer logs toutes les 500ms
    const logFlush = setInterval(() => {
      if (logBuffer.current.length === 0) return;
      const lines = logBuffer.current.splice(0);
      setState(prev => ({
        ...prev,
        logLines: [...prev.logLines, ...lines].slice(-60),
      }));
    }, 500);

    return () => {
      clearInterval(logFlush);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  // connexion unique au montage
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Filtre dynamique WebSocket — se déclenche quand la sélection change ────
  useEffect(() => {
    filterVersion.current += 1;
    const version = filterVersion.current;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type:    "filter",
        servers: selectedServers,
        version,
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serversKey]);

  // ── Sync multi-tabs via localStorage ─────────────────────────────────────
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === "alarms_sync" && e.newValue) {
        try {
          const parsed: AlarmItem[] = JSON.parse(e.newValue);
          setState(prev => ({
            ...prev,
            alarms: sortByTs(
              uniqueById([...parsed, ...prev.alarms])
            ).slice(0, 100),
          }));
        } catch {
       
        }
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  return state;
};