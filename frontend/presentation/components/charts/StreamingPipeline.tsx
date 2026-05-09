
// ────────────────────────────────────────────────────────────────
// presentation/components/charts/StreamingPipeline.tsx
// Source : logs[] (WebSocket) + sessions[] (/api/sessions)
// ────────────────────────────────────────────────────────────────
import type { StreamingPipelineProps } from "../../../shared/types/analyticsProps";

const PIPELINE_STAGES = [
  { name: "Log Ingestion",    latency: 12  },
  { name: "Normalization",    latency: 8   },
  { name: "Feature Extract",  latency: 45  },
  { name: "SSH Engine",       latency: 23  },
  { name: "WEB Engine",       latency: 19  },
  { name: "FTP Engine",       latency: 11  },
  { name: "Correlation",      latency: 67  },
  { name: "Prediction",       latency: 120 },
  { name: "Trust Gate",       latency: 15  },
  { name: "Corrective Agent", latency: 340 },
];

const STATUS_COLOR: Record<string, string> = {
  ok:   "var(--accent-green)",
  warn: "var(--accent-amber)",
  idle: "var(--text-muted)",
};

export function StreamingPipeline({ logs, sessions }: StreamingPipelineProps) {
  const isActive   = logs.length > 0;
  const lastSession = sessions[sessions.length - 1];
  // Throughput = nb logs traités (logs.length = proxy du débit réel)
  const throughput = logs.length;

  return (
    <div className="chart-card pipeline-card">
      <div className="chart-header">
        <span className="chart-title">Live Streaming Pipeline</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {isActive && <span className="live-dot" />}
          <span className={isActive ? "badge-ok" : "badge-warn"}>
            {isActive ? "ACTIF" : "EN ATTENTE"}
          </span>
          {lastSession && (
            <span className="stat-mini">
              Session #{sessions.length} · {lastSession.nb_alarms_final} alarmes
            </span>
          )}
        </div>
      </div>

      <div className="pipeline-stages">
        {PIPELINE_STAGES.map((stage, i) => {
          // Statut basé sur les logs réels
          const status = !isActive ? "idle"
            : i < Math.min(PIPELINE_STAGES.length, Math.ceil(throughput / 10)) ? "ok"
            : "warn";

          return (
            <div key={stage.name} className="pipeline-stage">
              <div
                className="stage-node"
                style={{ borderColor: STATUS_COLOR[status] }}
              >
                <div className="stage-dot" style={{ background: STATUS_COLOR[status] }} />
                <span className="stage-name">{stage.name}</span>
                <span className="stage-latency">~{stage.latency}ms</span>
                <span className="stage-throughput">
                  {isActive ? `${Math.max(1, throughput - i * 2)}/s` : "—"}
                </span>
              </div>
              {i < PIPELINE_STAGES.length - 1 && (
                <div className="pipeline-arrow">
                  <div className="arrow-line" />
                  <div
                    className="arrow-head"
                    style={{ animationPlayState: isActive ? "running" : "paused" }}
                  >▶</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="chart-footer">
        <span className="stat-mini">{logs.length} lignes logs traitées</span>
        <span className="stat-mini">{sessions.length} sessions analysées</span>
      </div>
    </div>
  );
}
