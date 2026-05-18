import type { FC } from "react";
import type { AgentDecision, WorkflowActivity } from "../../../shared/types/idps";

type Props = {
  activities: WorkflowActivity[];
  decisions: AgentDecision[];
  wsConnected: boolean;
  isLive: boolean;
};

const STAGES = [
  { key: "ingestion", label: "Ingestion" },
  { key: "metrics", label: "Metrics" },
  { key: "pass1", label: "Pass 1" },
  { key: "trust", label: "Trust" },
  { key: "orchestrator", label: "Orchestrator" },
  { key: "pass2", label: "Pass 2" },
  { key: "analysis", label: "CrewAI" },
  { key: "corrective", label: "Corrective" },
  { key: "reporting", label: "Report" },
  { key: "session", label: "Done" },
] as const;

const STATUS_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  started: { bg: "rgba(56,189,248,0.12)", fg: "#38bdf8", border: "rgba(56,189,248,0.24)" },
  running: { bg: "rgba(59,130,246,0.12)", fg: "#3b82f6", border: "rgba(59,130,246,0.24)" },
  completed: { bg: "rgba(34,197,94,0.12)", fg: "#22c55e", border: "rgba(34,197,94,0.24)" },
  pending: { bg: "rgba(245,158,11,0.12)", fg: "#f59e0b", border: "rgba(245,158,11,0.24)" },
  executed: { bg: "rgba(16,185,129,0.12)", fg: "#10b981", border: "rgba(16,185,129,0.24)" },
  warning: { bg: "rgba(249,115,22,0.12)", fg: "#f97316", border: "rgba(249,115,22,0.24)" },
  blocked: { bg: "rgba(245,158,11,0.12)", fg: "#f59e0b", border: "rgba(245,158,11,0.24)" },
  error: { bg: "rgba(239,68,68,0.12)", fg: "#ef4444", border: "rgba(239,68,68,0.24)" },
  info: { bg: "rgba(100,116,139,0.12)", fg: "#94a3b8", border: "rgba(100,116,139,0.24)" },
};

const STAGE_COLORS: Record<string, string> = {
  ingestion: "#38bdf8",
  metrics: "#0ea5e9",
  pass1: "#f59e0b",
  trust: "#8b5cf6",
  orchestrator: "#f97316",
  pass2: "#ef4444",
  analysis: "#22c55e",
  corrective: "#14b8a6",
  reporting: "#6366f1",
  session: "#94a3b8",
};

const severityColor = (severity: string): string => {
  if (severity === "CRITICAL") return "#ef4444";
  if (severity === "HIGH") return "#f97316";
  return "#94a3b8";
};

const formatMetaValue = (value: unknown): string | null => {
  if (value == null) return null;
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : null;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return keys.length > 0 ? keys.slice(0, 3).join(", ") : null;
  }
  return String(value);
};

export const AgentActivityFlow: FC<Props> = ({
  activities,
  decisions,
  wsConnected,
  isLive,
}) => {
  const safeActivities = Array.isArray(activities) ? activities : [];
  const latest = safeActivities[0] ?? null;
  const progress = latest?.progress ?? 0;
  const completedStageCount = STAGES.filter((stage) =>
    safeActivities.some((activity) => activity.stage === stage.key)
  ).length;
  const pendingCount = safeActivities.filter((activity) => activity.status === "pending").length;
  const executedCount = safeActivities.filter((activity) => activity.status === "executed").length;
  const warningCount = safeActivities.filter((activity) =>
    activity.status === "warning" || activity.status === "error"
  ).length;
  const stageSummary = STAGES.map((stage) => {
    const activity = safeActivities.find((item) => item.stage === stage.key);
    return { ...stage, activity };
  });

  if (safeActivities.length === 0) {
    return (
      <div style={{ fontSize: 11, color: "var(--muted,#6b7280)", padding: "12px 0" }}>
        {wsConnected
          ? "Le pipeline n'a pas encore émis d'activité structurée."
          : "En attente du flux d'activité pipeline…"}
      </div>
    );
  }

  const latestStatusStyle = STATUS_COLORS[latest?.status ?? "info"] ?? STATUS_COLORS.info;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{
        padding: 12,
        borderRadius: 8,
        background: "linear-gradient(135deg, rgba(15,23,42,0.96), rgba(30,41,59,0.86))",
        border: "1px solid rgba(71,85,105,0.4)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
              <span style={{
                fontSize: 10,
                padding: "3px 8px",
                borderRadius: 999,
                background: isLive ? "rgba(239,68,68,0.18)" : "rgba(148,163,184,0.16)",
                color: isLive ? "#fda4af" : "#cbd5e1",
                fontWeight: 700,
                letterSpacing: 0.6,
              }}>
                {isLive ? "LIVE FLOW" : "LAST RUN"}
              </span>
              <span style={{
                fontSize: 10,
                padding: "3px 8px",
                borderRadius: 999,
                background: latestStatusStyle.bg,
                color: latestStatusStyle.fg,
                border: `1px solid ${latestStatusStyle.border}`,
                fontWeight: 700,
                textTransform: "uppercase",
              }}>
                {latest?.status}
              </span>
              <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: "monospace" }}>
                {latest?.timestamp}
              </span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", marginBottom: 3 }}>
              {latest?.title}
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
              {latest?.detail}
            </div>
          </div>

          <div style={{ minWidth: 160, display: "grid", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#94a3b8" }}>
              <span>Pipeline progress</span>
              <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{progress}%</span>
            </div>
            <div style={{
              height: 8,
              borderRadius: 999,
              background: "rgba(148,163,184,0.16)",
              overflow: "hidden",
            }}>
              <div style={{
                width: `${Math.max(6, progress)}%`,
                height: "100%",
                borderRadius: 999,
                background: "linear-gradient(90deg, #22c55e, #38bdf8)",
                transition: "width .4s ease",
              }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#94a3b8" }}>
              <span>{completedStageCount}/{STAGES.length} stages seen</span>
              <span>{decisions.length} decisions</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
        gap: 8,
      }}>
        {([
          { label: "Pending", value: pendingCount, color: "#f59e0b" },
          { label: "Executed", value: executedCount, color: "#22c55e" },
          { label: "Warnings", value: warningCount, color: "#f97316" },
          { label: "Stages", value: completedStageCount, color: "#38bdf8" },
          { label: "Decisions", value: decisions.length, color: "#a78bfa" },
        ]).map((item) => (
          <div
            key={item.label}
            style={{
              padding: "10px 8px",
              borderRadius: 8,
              border: "1px solid rgba(226,232,240,0.08)",
              background: "#0f172a",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 800, color: item.color }}>{item.value}</div>
            <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>
              {item.label}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8 }}>
        {stageSummary.map((stage) => {
          const activity = stage.activity;
          const active = Boolean(activity);
          const color = STAGE_COLORS[stage.key] ?? "#94a3b8";

          return (
            <div
              key={stage.key}
              style={{
                padding: "10px 8px",
                borderRadius: 8,
                border: `1px solid ${active ? `${color}44` : "rgba(148,163,184,0.12)"}`,
                background: active ? `${color}14` : "rgba(15,23,42,0.7)",
                minHeight: 72,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: active ? color : "#475569",
                  boxShadow: active ? `0 0 0 4px ${color}22` : "none",
                }} />
                <span style={{ fontSize: 10, color: active ? "#e2e8f0" : "#94a3b8", fontWeight: 700 }}>
                  {stage.label}
                </span>
              </div>
              <div style={{ fontSize: 10, color: active ? "#cbd5e1" : "#64748b", lineHeight: 1.4 }}>
                {activity?.title ?? "Waiting"}
              </div>
              {typeof activity?.progress === "number" && (
                <div style={{ fontSize: 9, color: color, marginTop: 5, fontFamily: "monospace" }}>
                  {activity.progress}%
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxHeight: 340,
        overflowY: "auto",
        paddingRight: 4,
      }}>
        {safeActivities.slice(0, 14).map((activity) => {
          const statusStyle = STATUS_COLORS[activity.status] ?? STATUS_COLORS.info;
          const metaEntries = Object.entries(activity.meta ?? {})
            .map(([key, value]) => ({ key, value: formatMetaValue(value) }))
            .filter((entry) => entry.value)
            .slice(0, 4);

          return (
            <div
              key={activity.id}
              style={{
                display: "flex",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid rgba(226,232,240,0.08)",
                background: "rgba(15,23,42,0.75)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <div style={{
                  width: 30,
                  height: 30,
                  borderRadius: 10,
                  background: `${STAGE_COLORS[activity.stage] ?? "#64748b"}22`,
                  color: STAGE_COLORS[activity.stage] ?? "#cbd5e1",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: 800,
                }}>
                  {activity.actor.slice(0, 2).toUpperCase()}
                </div>
                <div style={{
                  width: 2,
                  flex: 1,
                  minHeight: 26,
                  background: "linear-gradient(180deg, rgba(148,163,184,0.5), rgba(148,163,184,0.05))",
                }} />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>
                    {activity.title}
                  </span>
                  <span style={{
                    fontSize: 9,
                    padding: "2px 7px",
                    borderRadius: 999,
                    background: statusStyle.bg,
                    color: statusStyle.fg,
                    border: `1px solid ${statusStyle.border}`,
                    fontWeight: 700,
                    textTransform: "uppercase",
                  }}>
                    {activity.status}
                  </span>
                  <span style={{ fontSize: 10, color: severityColor(activity.severity), fontWeight: 700 }}>
                    {activity.severity}
                  </span>
                  {typeof activity.progress === "number" && (
                    <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: "monospace" }}>
                      {activity.progress}%
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 10, color: "#94a3b8", marginBottom: 4 }}>
                  <span>{activity.actor}</span>
                  <span>{activity.stage}</span>
                  <span style={{ fontFamily: "monospace" }}>{activity.timestamp}</span>
                </div>

                <div style={{ fontSize: 11, color: "#cbd5e1", lineHeight: 1.55 }}>
                  {activity.detail}
                </div>

                {metaEntries.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
                    {metaEntries.map((entry) => (
                      <span
                        key={`${activity.id}-${entry.key}`}
                        style={{
                          fontSize: 9,
                          padding: "3px 7px",
                          borderRadius: 999,
                          background: "rgba(148,163,184,0.12)",
                          color: "#cbd5e1",
                          border: "1px solid rgba(148,163,184,0.12)",
                        }}
                      >
                        {entry.key}: {entry.value}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
