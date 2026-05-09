
// ────────────────────────────────────────────────────────────────
// presentation/components/panels/AttackTimelinePanel.tsx
// Source : alarms[] + sessions[] — reconstruction chronologique
// ────────────────────────────────────────────────────────────────
import type { AttackTimelinePanelProps } from "../../../shared/types/analyticsProps";
import type { AlarmItem } from "../../../shared/types/idps";

const PHASE_MAP: Record<string, string> = {
  SSH:         "BRUTE_FORCE",
  WEB:         "WEB_ATTACK",
  FTP:         "ENUMERATION",
  SESSION:     "RECONNAISSANCE",
  KERNEL:      "PRIVILEGE_ESCALATION",
  PREDICTION:  "DETECTION",
  CORRELATION: "CORRELATION",
  CHAIN:       "MULTI_STAGE",
};

const PHASE_COLOR: Record<string, string> = {
  BRUTE_FORCE:         "#ff3b5c",
  WEB_ATTACK:          "#ff6400",
  ENUMERATION:         "#00d4ff",
  RECONNAISSANCE:      "#3b82f6",
  PRIVILEGE_ESCALATION:"#a855f7",
  DETECTION:           "#ffb800",
  CORRELATION:         "#00d4ff",
  MULTI_STAGE:         "#ff3b5c",
};

export function AttackTimelinePanel({ alarms, sessions }: AttackTimelinePanelProps) {
  // Trier les alarmes chronologiquement et prendre les 10 plus récentes
  const sorted = [...alarms]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-10)
    .reverse();

  return (
    <div className="chart-card timeline-card">
      <div className="chart-header">
        <span className="chart-title">Attack Reconstruction Timeline</span>
        <span className={
          sorted.some(a => a.severity === "CRITICAL") ? "badge-crit" : "badge-warn"
        }>
          {sorted.filter(a => a.severity === "CRITICAL").length} critical
        </span>
      </div>

      {sorted.length === 0 ? (
        <div className="chart-empty">Aucune alarme — système clean ✓</div>
      ) : (
        <div className="timeline-container">
          {sorted.map((alarm, i) => {
            const phase = PHASE_MAP[alarm.engine] ?? "DETECTION";
            const color = PHASE_COLOR[phase] ?? "#8ba5c0";
            return (
              <div key={alarm.id} className="timeline-item">
                {i < sorted.length - 1 && (
                  <div className="timeline-connector" style={{ borderColor: color }} />
                )}
                <div
                  className="timeline-node"
                  style={{ borderColor: color, boxShadow: `0 0 8px ${color}66` }}
                >
                  <div className="timeline-dot" style={{ background: color }} />
                </div>
                <div className="timeline-content">
                  <div className="timeline-meta">
                    <span className="timeline-phase" style={{ color }}>{phase}</span>
                    <span className="timeline-time">{alarm.timestamp}</span>
                    <span
                      className="timeline-score"
                      style={{
                        color: alarm.score > 80 ? "#ff3b5c"
                             : alarm.score > 50 ? "#ffb800"
                             :                    "#00d4ff",
                      }}
                    >
                      score: {alarm.score.toFixed(0)}
                    </span>
                  </div>
                  <div className="timeline-type">{alarm.type.replace(/_/g, " ")}</div>
                  <div className="timeline-detail">
                    {alarm.human_insight || alarm.message}
                  </div>
                  <div className="timeline-ip">
                    {alarm.source_ip} · {alarm.engine} · {alarm.action}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="chart-footer">
        <span className="stat-mini">{alarms.length} alarmes totales</span>
        <span className="stat-mini">{sessions.length} sessions</span>
      </div>
    </div>
  );
}

