// src/hooks/useIdpsDashboard.ts
// ─────────────────────────────────────────────────────────────────────────────
// Hook principal — architecture hybride REST (10s) + WebSocket temps réel.
// TOUS les types viennent de src/types/idps — source unique.
//
// CORRECTION : /api/engine-scores reçoit maintenant selectedServers
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  KpiData,
  AlarmItem,
  EngineScore,
  AgentDecision,
  SessionSummary,
  TrustData,
  PipelineLatest,
  HealthCheck,
  WsIncomingMessage,
} from "../types/idps";

const API     = import.meta.env.VITE_API_URL || "http://localhost:8000";
const WS_URL  = import.meta.env.VITE_WS_URL  || "ws://localhost:8000/ws/logs";
const POLL_MS = 10_000;

// ─── Déduplication O(n) par id ────────────────────────────────────────────────
const uniqueById = (arr: AlarmItem[]): AlarmItem[] => {
  const map = new Map<string, AlarmItem>();
  for (const item of arr) map.set(item.id, item);
  return Array.from(map.values());
};

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
}

const EMPTY: IdpsDashboardState = {
  apiReady: false, loading: true, lastUpdate: null,
  kpis: null, alarms: [], engines: [], decisions: [],
  sessions: [], logLines: [], trust: null,
  sessionCount: 0, logsAnalysed: 0, threatLevel: "NORMAL",
  wsConnected: false, isLive: false,
};

// ─── Hook principal ───────────────────────────────────────────────────────────
export const useIdpsDashboard = (selectedServers: string[] = []): IdpsDashboardState => {
  const [state, setState]  = useState<IdpsDashboardState>(EMPTY);
  const timerRef           = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef              = useRef<WebSocket | null>(null);
  const isFirstLoad        = useRef(true);
  const filterVersion      = useRef(0);
  const logBuffer          = useRef<string[]>([]);

  // serversKey change → refresh() se recrée → polling repart avec le nouveau filtre
  const serversKey = selectedServers.slice().sort().join(",");

  // ── REST fetch ─────────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    try {
      const health = await get<HealthCheck>("/health");
      if (health.status !== "ok") {
        setState(s => ({ ...s, loading: false, apiReady: false }));
        return;
      }

      const [kpis, alarms, engines, decisions, sessions, pipeline, trust] =
        await Promise.allSettled([
          get<KpiData>("/api/kpis",           selectedServers),  // ✅ filtré
          get<AlarmItem[]>("/api/alarms",     selectedServers),  // ✅ filtré
          get<EngineScore[]>("/api/engine-scores", selectedServers), // ✅ CORRIGÉ — était sans filtre
          get<AgentDecision[]>("/api/decisions"),   // global (pas de filtre serveur)
          get<SessionSummary[]>("/api/sessions"),   // global
          get<PipelineLatest>("/api/pipeline/latest"), // global
          get<TrustData>("/api/trust"),             // global
        ]);

      const kpisVal    = kpis.status      === "fulfilled" ? kpis.value      : null;
      const alarmsVal  = alarms.status    === "fulfilled" ? alarms.value    : [];
      const engVal     = engines.status   === "fulfilled" ? engines.value   : [];
      const decVal     = decisions.status === "fulfilled" ? decisions.value : [];
      const sessVal    = sessions.status  === "fulfilled" ? sessions.value  : [];
      const pipeVal    = pipeline.status  === "fulfilled" ? pipeline.value  : null;
      const trustVal   = trust.status     === "fulfilled" ? trust.value     : null;
      const logLines   = pipeVal?.log_lines ?? [];
      const latestSess = sessVal[0];

      setState(prev => ({
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
        // Fusion WS (prioritaire) + REST (complément)
        alarms: (() => {
          const map = new Map<string, AlarmItem>();
          const latestTs = prev.alarms.length > 0
            ? Math.max(...prev.alarms.map(a => new Date(a.timestamp).getTime()))
            : 0;
          for (const a of alarmsVal) {
            if (new Date(a.timestamp).getTime() >= latestTs) map.set(a.id, a);
          }
          for (const a of prev.alarms) map.set(a.id, a);
          return Array.from(map.values())
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, 100);
        })(),
        logLines: prev.logLines.length > 0 ? prev.logLines : logLines.slice(-60),
      }));

      isFirstLoad.current = false;
    } catch {
      setState(s => ({ ...s, loading: false, apiReady: false }));
    }
  // serversKey dans les deps → refresh se recrée dès que la sélection change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serversKey]);

  // ── REST polling — redémarre quand refresh change (= quand serversKey change) ─
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

      ws.onopen = () => {
        setState(prev => ({ ...prev, wsConnected: true }));
        ws.send(JSON.stringify({ type: "filter", servers: selectedServers, version: filterVersion.current }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as WsIncomingMessage;

          if (data.type === "filter_ack") {
            setState(prev => ({ ...prev, alarms: [], logLines: [] }));
            return;
          }

          if (data.type === "alarm") {
            const msgVersion = (data as { version?: number }).version;
            if (msgVersion !== undefined && msgVersion !== filterVersion.current) return;
            setState(prev => ({
              ...prev,
              lastUpdate: new Date(),
              isLive:     true,
              alarms:     uniqueById([data.alarm, ...prev.alarms]).slice(0, 50),
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
          }
        } catch {
          // message non-JSON → ignoré
        }
      };

      ws.onclose = () => {
        setState(prev => ({ ...prev, wsConnected: false }));
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
      clearInterval(logFlush);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // connexion unique au montage

  // ── Filtre dynamique WebSocket — se déclenche quand la sélection change ────
  useEffect(() => {
    filterVersion.current += 1;
    const version = filterVersion.current;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "filter", servers: selectedServers, version }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serversKey]);

  return state;
};
