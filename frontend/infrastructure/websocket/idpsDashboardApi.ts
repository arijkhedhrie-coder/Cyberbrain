// src/api/idpsDashboardApi.ts
// ─────────────────────────────────────────────────────────────────────────────
// WebSocket temps réel — FastAPI (port 8000)
// Endpoint : ws://localhost:8000/ws/logs
//
// Ce fichier gère UNIQUEMENT la connexion WebSocket.
// Les appels REST (kpis, alarms, etc.) sont dans dashboardApi.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { API_BASE } from "../api/authApi";
import axios from "axios";

// ── Types des messages WebSocket ─────────────────────────────────────────────

export type WsAlarmMessage = {
  type: "alarm";
  alarm: {
    id: string;
    timestamp: string;
    type: string;
    source_ip: string;
    severity: "CRITICAL" | "HIGH" | "MED" | "LOW" | "INFO";
    engine: string;
    score: number;
    message: string;
    human_insight: string;
    action: "BLOCK_NOW" | "WATCHLIST" | "ESCALATE" | "MONITOR";
    country: string;
    failures: number;
  };
};

export type WsLogMessage = {
  type: "log";
  line: string;
};

export type WsMetricsMessage = {
  type: "metrics";
  data: Record<string, unknown>;
};

export type WsPingMessage  = { type: "ping" };
export type WsPongMessage  = { type: "pong" };
export type WsHeartbeat    = { type: "heartbeat" };

export type WsIncomingMessage =
  | WsAlarmMessage
  | WsLogMessage
  | WsMetricsMessage
  | WsPongMessage
  | WsHeartbeat;

// ── Callbacks du hook consommateur ────────────────────────────────────────────

export interface IdpsWsCallbacks {
  onAlarm?:      (alarm: WsAlarmMessage["alarm"]) => void;
  onLog?:        (line: string) => void;
  onMetrics?:    (data: Record<string, unknown>) => void;
  onConnect?:    () => void;
  onDisconnect?: () => void;
}

// ── Constructeur de l'URL WebSocket ──────────────────────────────────────────

/**
 * Convertit l'URL HTTP base en URL WebSocket.
 * http://localhost:8000  →  ws://localhost:8000/ws/logs
 * https://mon-idps.io   →  wss://mon-idps.io/ws/logs
 */
export const buildWsUrl = (): string => {
  const base = API_BASE.replace(/^http/, "ws");
  return `${base}/ws/logs`;
};

// ── Classe de connexion WebSocket ─────────────────────────────────────────────

export class IdpsWebSocket {
  private ws: WebSocket | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  private callbacks: IdpsWsCallbacks;

constructor(callbacks: IdpsWsCallbacks) {
  this.callbacks = callbacks;
} 

  /** Ouvre la connexion (appelé par le hook au mount). */
  connect(): void {
    if (this.destroyed) return;
    const url = buildWsUrl();

    try {
      this.ws = new WebSocket(url);
    } catch {
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.callbacks.onConnect?.();
      // Ping toutes les 20s pour maintenir la connexion vivante
      this.pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 20_000);
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: WsIncomingMessage = JSON.parse(event.data);
        switch (msg.type) {
          case "alarm":
            this.callbacks.onAlarm?.(msg.alarm);
            break;
          case "log":
            this.callbacks.onLog?.(msg.line);
            break;
          case "metrics":
            this.callbacks.onMetrics?.(msg.data);
            break;
          // pong / heartbeat → ignorés, connexion confirmée
        }
      } catch {
        // Message non-JSON ignoré
      }
    };

    this.ws.onclose = () => {
      this._cleanup();
      this.callbacks.onDisconnect?.();
      this._scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose sera appelé juste après, qui gère la reconnexion
    };
  }

  /** Ferme proprement la connexion (appelé par le hook au unmount). */
  disconnect(): void {
    this.destroyed = true;
    this._cleanup();
    this.ws?.close();
    this.ws = null;
  }

  private _cleanup(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private _scheduleReconnect(): void {
    if (this.destroyed) return;
    this.reconnectTimeout = setTimeout(() => {
      if (!this.destroyed) this.connect();
    }, 5_000); // réessaie toutes les 5s
  }
}
const FLASK_BASE = "http://localhost:5000";
export const restartPipeline = async (): Promise<{ status: string; message: string }> => {
  const res = await axios.post(`${FLASK_BASE}/api/pipeline/restart`);
  return res.data;
};