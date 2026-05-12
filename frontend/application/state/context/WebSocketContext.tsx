// frontend/application/context/WebSocketContext.tsx
import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { IdpsWebSocket } from "../../../infrastructure/websocket/idpsDashboardApi";
import type { AlarmItem } from "../../../shared/types/idps";

// ── Empty safe structures ──────────────────────────────────────────────────
const EMPTY_METRICS = {
  current_alarms: 0,
  risk: 0,
  breakdown: { critical: 0, high: 0, medium: 0, low: 0 },
};

interface WebSocketContextValue {
  connected: boolean;
  alarms: AlarmItem[];
  logs: string[];
  metrics: typeof EMPTY_METRICS;
  sendFilter: (servers: string[]) => void;
}

const WebSocketContext = createContext<WebSocketContextValue | undefined>(undefined);

export const useWebSocketContext = () => {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error("useWebSocketContext must be used inside WebSocketProvider");
  return ctx;
};

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [connected, setConnected] = useState(false);
  const [alarms, setAlarms] = useState<AlarmItem[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [metrics, setMetrics] = useState(EMPTY_METRICS);

  const wsRef = useRef<IdpsWebSocket | null>(null);
  const filterVersion = useRef(0);

  // Helper to update filter on the *existing* socket
  const sendFilter = useCallback((servers: string[]) => {
    if (!wsRef.current) return;
    filterVersion.current += 1;
    // Assuming your IdpsWebSocket class has a method to send raw messages
    // If not, we can store the raw WebSocket instance.
    // For simplicity, we'll extend IdpsWebSocket later or just store the raw WS.
    // --- Quick workaround: store raw WS reference ---
    // (You can modify IdpsWebSocket to expose ws.send)
    const rawWs = (wsRef.current as any).ws;
    if (rawWs?.readyState === WebSocket.OPEN) {
      rawWs.send(JSON.stringify({ type: "filter", servers, version: filterVersion.current }));
    }
  }, []);

  useEffect(() => {
    // Callbacks for the IdpsWebSocket instance
    const callbacks = {
      onConnect: () => setConnected(true),
      onDisconnect: () => setConnected(false),
      onAlarm: (alarm: AlarmItem) =>
        setAlarms(prev => [alarm, ...prev].slice(0, 100)),
      onLog: (line: string) =>
        setLogs(prev => [line, ...prev].slice(0, 200)),
      onMetrics: (data: Record<string, unknown>) =>
        setMetrics(prev => ({ ...prev, ...data }) as typeof EMPTY_METRICS),
    };

    const ws = new IdpsWebSocket(callbacks);
    wsRef.current = ws;
    ws.connect();

    return () => {
      ws.disconnect();
      wsRef.current = null;
    };
  }, []);

  return (
    <WebSocketContext.Provider value={{ connected, alarms, logs, metrics, sendFilter }}>
      {children}
    </WebSocketContext.Provider>
  );
};