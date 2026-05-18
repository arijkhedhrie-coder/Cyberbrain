// presentation/components/charts/StreamingPipeline.tsx
import type { StreamingPipelineProps } from "../../../shared/types/analyticsProps";

export function StreamingPipeline({ logs, sessions }: StreamingPipelineProps) {
  const isLive = logs.length > 0;
  const last = sessions[0] ?? sessions[sessions.length - 1];
  const normalizedLogs = logs.map((line) => line.toLowerCase());
  const stageNames = [
    "Log Ingestion",
    "Normalization",
    "Feature Extraction",
    "SSH Engine",
    "WEB Engine",
    "FTP Engine",
    "Kernel Engine",
    "Correlation",
    "Prediction",
    "Trust Gate",
    "Corrective Agent",
  ] as const;
  type StageName = (typeof stageNames)[number];
  const stageKeywords: Record<StageName, string[]> = {
    "Log Ingestion": ["collect", "ingest", "log"],
    Normalization: ["normal", "transform"],
    "Feature Extraction": ["feature", "metrics"],
    "SSH Engine": ["ssh"],
    "WEB Engine": ["web", "http"],
    "FTP Engine": ["ftp"],
    "Kernel Engine": ["kernel"],
    Correlation: ["correlation", "chain"],
    Prediction: ["predict"],
    "Trust Gate": ["trust"],
    "Corrective Agent": ["agent", "suggestion", "corrective"],
  };

  const alarmCount = last?.nb_alarms_final;
  const lastSessionDate = last?.date
    ? new Date(last.date).toLocaleString("fr-FR")
    : null;

  return (
    <div className="chart-card pipeline-card">
      <div className="chart-header">
        <span className="chart-title">Live Streaming Pipeline</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {isLive && <span className="live-dot" />}
          <span className={isLive ? "badge-ok" : "badge-warn"}>
            {isLive ? "ACTIF" : "EN ATTENTE"}
          </span>
          {last && (
            <span className="stat-mini">
              Session #{sessions.length}
              {alarmCount !== undefined && ` · ${alarmCount} alarmes`}
            </span>
          )}
        </div>
      </div>

      {/* Pipeline stages – conceptual, no fake latencies */}
      <div className="pipeline-stages">
        {stageNames.map((name, i, arr) => {
          const isStageActive = normalizedLogs.some((line) =>
            stageKeywords[name].some((keyword) => line.includes(keyword)),
          );

          return (
          <div key={name} className="pipeline-stage">
            <div
              className="stage-node"
              style={{
                borderColor: isStageActive ? "var(--accent-green)" : "var(--text-muted)",
              }}
            >
              <div
                className="stage-dot"
                style={{
                  background: isStageActive ? "var(--accent-green)" : "var(--text-muted)",
                }}
              />
              <span className="stage-name">{name}</span>
              <span className="stage-throughput">
                {isStageActive ? "●" : "—"}
              </span>
            </div>
            {i < arr.length - 1 && (
              <div className="pipeline-arrow">
                <div className="arrow-line" />
                <div
                  className="arrow-head"
                  style={{ animationPlayState: isLive ? "running" : "paused" }}
                >
                  ▶
                </div>
              </div>
            )}
          </div>
        )})}
      </div>

      <div className="chart-footer">
        <span className="stat-mini">{logs.length} lignes logs reçues</span>
        <span className="stat-mini">{sessions.length} sessions terminées</span>
        {alarmCount !== undefined && (
          <span className="stat-mini">Derniere session: {alarmCount} alarmes finales</span>
        )}
        {lastSessionDate && (
          <span className="stat-mini">Maj session: {lastSessionDate}</span>
        )}
      </div>
    </div>
  );
}
