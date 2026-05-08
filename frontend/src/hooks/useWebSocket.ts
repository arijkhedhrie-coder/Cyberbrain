// src/hooks/useWebSocket.ts


import { useEffect, useRef, useState, useCallback } from "react";
import type { AlarmItem } from "../types/idps";   // ← source unique des types

const WS_URL_DEFAULT =
  import.meta.env.VITE_WS_URL ?? "ws://localhost:8000/ws/logs";

// ── Déduplication par id ───────────────────────────────────────────────────
const uniqueById = (arr: AlarmItem[]): AlarmItem[] => {
  const seen = new Map<string, AlarmItem>();
  for (const a of arr) seen.set(a.id, a);
  return Array.from(seen.values());
};

// ── Hook ───────────────────────────────────────────────────────────────────
export function useWebSocket(
  url: string = WS_URL_DEFAULT,
  selectedServers: string[] = [],        // ← NOUVEAU paramètre
) {
  const [logs,      setLogs]      = useState<string[]>([]);
  const [alarms,    setAlarms]    = useState<AlarmItem[]>([]);
  const [connected, setConnected] = useState(false);

  const wsRef          = useRef<WebSocket | null>(null);
  const reconnectRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const destroyedRef   = useRef(false);
  const filterVersion  = useRef(0);

  // Clé stable pour détecter les changements de sélection
  const serversKey = selectedServers.slice().sort().join(",");

  // ── Envoi du filtre serveurs au backend ─────────────────────────────────
  const sendFilter = useCallback((ws: WebSocket, servers: string[]) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    filterVersion.current += 1;
    ws.send(JSON.stringify({
      type:    "filter",
      servers: servers,
      version: filterVersion.current,
    }));
  }, []);

  // ── Connexion WebSocket ──────────────────────────────────────────────────
  const connect = useCallback(() => {
    if (destroyedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      reconnectRef.current = setTimeout(connect, 3000);
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // ✅ Envoyer le filtre dès l'ouverture
      sendFilter(ws, selectedServers);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);

        // ── filter_ack → vider les données du filtre précédent ──────────
        if (data.type === "filter_ack") {
          setAlarms([]);
          setLogs([]);
          return;
        }

        // ── alarm ────────────────────────────────────────────────────────
        if (data.type === "alarm") {
          // Ignorer les alarmes d'une version de filtre obsolète
          if (
            data.version !== undefined &&
            data.version !== filterVersion.current
          ) return;

          const alarm = data.alarm as AlarmItem;
          setAlarms(prev =>
            uniqueById([alarm, ...prev]).slice(0, 100),
          );
          return;
        }

        // ── log ──────────────────────────────────────────────────────────
        if (data.type === "log") {
          setLogs(prev => [data.line as string, ...prev].slice(0, 200));
          return;
        }

        // ── pong / heartbeat → ignorés (connexion confirmée) ─────────────
      } catch {
        // message non-JSON → ignoré
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (!destroyedRef.current) {
        reconnectRef.current = setTimeout(connect, 3000);
      }
    };

    ws.onerror = () => ws.close();

  // NOTE : on ne met PAS selectedServers dans les deps — la connexion est
  // unique ; le filtre est envoyé via l'effet séparé ci-dessous.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, sendFilter]);

  // ── Montage / démontage ──────────────────────────────────────────────────
  useEffect(() => {
    destroyedRef.current = false;
    connect();
    return () => {
      destroyedRef.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // ── Mise à jour du filtre quand selectedServers change ───────────────────
  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      sendFilter(wsRef.current, selectedServers);
    }
  // serversKey est la dép stable — pas le tableau (référence instable)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serversKey, sendFilter]);

  return { logs, alarms, connected };
}