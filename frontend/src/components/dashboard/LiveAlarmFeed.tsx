// src/components/dashboard/LiveAlarmFeed.tsx
// CORRIGÉ :
//   - Utilise AlarmItem (anglais) au lieu de Alert (français)
//   - Badge WebSocket dynamique (vert/rouge) selon wsConnected
//   - Affiche human_insight, country, failures

import type { FC } from "react";
import type { AlarmItem } from "../../types/idps";

interface Props {
  alerts:      AlarmItem[];
  wsConnected: boolean;   // contrôle la couleur du badge
}

// Couleurs par severity anglaise (alignées avec AlarmItem)
const SEV_COLOR: Record<AlarmItem["severity"], string> = {
  CRITICAL: "#E24B4A",
  HIGH:     "#EF9F27",
  MED:      "#378ADD",
  LOW:      "#888780",
  INFO:     "#888780",
};

const actionStyle = (action: string): React.CSSProperties => {
  if (action.includes("BLOCK"))   return { background: "#FCEBEB", color: "#A32D2D" };
  if (action.includes("WATCH"))   return { background: "#FAEEDA", color: "#633806" };
  if (action.includes("ESCALATE")) return { background: "#E6F1FB", color: "#0C447C" };
  return { background: "var(--color-background-secondary, #f3f4f6)", color: "var(--muted, #6b7280)" };
};

export const LiveAlarmFeed: FC<Props> = ({ alerts, wsConnected }) => (
  <div style={{
    background: "var(--card, #fff)",
    border: "0.5px solid var(--border, #e5e7eb)",
    borderRadius: 8, padding: 12,
  }}>
    {/* Header avec badge WS dynamique */}
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
      <span style={{ fontSize: 11, fontWeight: 500 }}>Live Alarm Feed</span>
      <span style={{
        fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 500,
        display: "flex", alignItems: "center", gap: 4,
        background: wsConnected ? "#E1F5EE" : "#FCEBEB",
        color:      wsConnected ? "#085041" : "#A32D2D",
      }}>
        <span style={{
          width: 5, height: 5, borderRadius: "50%", display: "inline-block",
          background: wsConnected ? "#1D9E75" : "#E24B4A",
          animation: wsConnected ? "ws-pulse 2s infinite" : "none",
        }}/>
        {wsConnected ? "WebSocket actif" : "WebSocket hors ligne"}
      </span>
      <style>{`@keyframes ws-pulse{0%,100%{opacity:1}50%{opacity:.35}}`}</style>
    </div>

    {/* Liste alarmes */}
    {alerts.length === 0 ? (
      <div style={{ fontSize: 11, color: "var(--muted, #6b7280)", padding: "12px 0", textAlign: "center" }}>
        {wsConnected ? "Aucune alarme — système clean ✓" : "En attente du pipeline…"}
      </div>
    ) : (
      alerts.slice(0, 8).map((a, i) => (
        <div
          key={a.id}
          style={{
            display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 0",
            borderBottom: i < Math.min(alerts.length, 8) - 1
              ? "0.5px solid var(--border, #e5e7eb)" : "none",
          }}
        >
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: SEV_COLOR[a.severity],
            marginTop: 4, flexShrink: 0,
          }}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {a.type.replace(/_/g, " ")} — {a.severity}
            </div>
            <div style={{ fontSize: 10, color: "var(--muted, #6b7280)", fontFamily: "monospace" }}>
              {a.source_ip} · score {a.score} · {a.engine}
            </div>
            {a.human_insight && (
              <div style={{
                fontSize: 10, color: "var(--muted, #6b7280)", marginTop: 2,
                fontStyle: "italic", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }} title={a.human_insight}>
                {a.human_insight.slice(0, 65)}{a.human_insight.length > 65 ? "…" : ""}
              </div>
            )}
          </div>
          <div style={{ fontSize: 10, color: "var(--muted, #6b7280)", flexShrink: 0 }}>
            {a.timestamp}
          </div>
          <span style={{
            fontSize: 10, padding: "2px 6px", borderRadius: 3,
            fontWeight: 500, flexShrink: 0, ...actionStyle(a.action),
          }}>
            {a.action.split("_")[0]}
          </span>
        </div>
      ))
    )}

    {alerts.length > 8 && (
      <div style={{
        fontSize: 10, color: "var(--muted, #6b7280)", textAlign: "center",
        marginTop: 8, paddingTop: 6, borderTop: "0.5px solid var(--border, #e5e7eb)",
      }}>
        +{alerts.length - 8} alarmes supplémentaires
      </div>
    )}
  </div>
);