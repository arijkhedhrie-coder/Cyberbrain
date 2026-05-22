import { useState, useEffect, useCallback, useMemo } from "react";
import type { FC } from "react";
import type {
  AlarmItem,
  CorrectiveSuggestion,
  WorkflowActivity,
} from "../../../shared/types/idps";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

interface AgentMode {
  mode: string;
  confidence_threshold: number;
  phase_description: string;
  pending_count: number;
}

interface SessionStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  modified: number;
  avg_confidence: number;
}

interface Stats extends SessionStats {
  session: SessionStats;
  memory?: Record<string, unknown>;
}

interface Props {
  suggestions: CorrectiveSuggestion[];
  activities: WorkflowActivity[];
  alarms: AlarmItem[];
  wsConnected: boolean;
  selectedDataset: string;
}

interface TraceStep {
  key: string;
  label: string;
  detail: string;
  timestamp?: string;
  state: "done" | "active" | "waiting" | "skipped";
}

interface TraceItem {
  suggestion: CorrectiveSuggestion;
  steps: TraceStep[];
}

const normalizeStats = (stats: Stats): Stats => ({
  ...stats,
  ...stats.session,
});

const PHASE_COLORS: Record<string, { bg: string; border: string; badge: string }> = {
  TRAINING: { bg: "#0d1f2d", border: "#1e4d6b", badge: "#1a6fa8" },
  SUGGESTION: { bg: "#1a1a0d", border: "#4d4a1e", badge: "#8a7a1a" },
  AUTO: { bg: "#0d1f0d", border: "#1e4d1e", badge: "#2a8a2a" },
};

const PHASE_ICONS: Record<string, string> = {
  TRAINING: "TRAIN",
  SUGGESTION: "SUGG",
  AUTO: "AUTO",
};

const STATUS_STYLES: Record<string, { bg: string; border: string; color: string }> = {
  PENDING: { bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.3)", color: "#f59e0b" },
  APPROVED: { bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.3)", color: "#22c55e" },
  REJECTED: { bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.3)", color: "#ef4444" },
  MODIFIED: { bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.3)", color: "#60a5fa" },
};

const TRACE_STATE_STYLES: Record<TraceStep["state"], { dot: string; line: string; text: string }> = {
  done: { dot: "#22c55e", line: "rgba(34,197,94,0.4)", text: "#e2e8f0" },
  active: { dot: "#f59e0b", line: "rgba(245,158,11,0.35)", text: "#f8fafc" },
  waiting: { dot: "#475569", line: "rgba(71,85,105,0.5)", text: "#94a3b8" },
  skipped: { dot: "#64748b", line: "rgba(100,116,139,0.35)", text: "#64748b" },
};

const CONFIDENCE_COLOR = (c: number): string => {
  if (c >= 0.85) return "#22c55e";
  if (c >= 0.65) return "#f59e0b";
  return "#ef4444";
};

const SEVERITY_COLOR = (s: string): string => {
  if (s === "CRITICAL" || s === "CRITIQUE") return "#ef4444";
  if (s === "HIGH") return "#f97316";
  return "#f59e0b";
};

const sortSuggestions = (items: CorrectiveSuggestion[]): CorrectiveSuggestion[] =>
  items.slice().sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

const formatTime = (value?: string): string => {
  if (!value) return "Pending";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const formatDateTime = (value?: string): string => {
  if (!value) return "Pending";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString([], {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
};

const statusLabel = (status: CorrectiveSuggestion["status"]): string => ({
  PENDING: "Awaiting review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  MODIFIED: "Modified + executed",
}[status]);

const matchesAlarmToSuggestion = (alarm: AlarmItem, suggestion: CorrectiveSuggestion): boolean => {
  const sameIp = String(alarm.source_ip ?? "").trim() === String(suggestion.ip ?? "").trim();
  if (!sameIp) return false;

  const alarmType = String(alarm.type ?? "").toUpperCase();
  const anomalyType = String(suggestion.anomaly_type ?? "").toUpperCase();
  return !anomalyType || alarmType.includes(anomalyType) || anomalyType.includes(alarmType);
};

const buildLifecycleTrace = (
  suggestion: CorrectiveSuggestion,
  activities: WorkflowActivity[],
  alarms: AlarmItem[],
): TraceItem => {
  const relatedActivities = activities
    .filter(activity => String(activity.meta?.suggestion_id ?? "") === suggestion.suggestion_id)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const suggestionActivity = relatedActivities.find(activity =>
    String(activity.title ?? "").toLowerCase().includes("queued")
  );
  const decisionActivity = relatedActivities.find(activity => {
    const title = String(activity.title ?? "").toLowerCase();
    return title.includes("approved") || title.includes("rejected") || title.includes("modified");
  });
  const learningActivity = relatedActivities.find(activity =>
    String(activity.title ?? "").toLowerCase().includes("learning updated")
  );

  const detectionAlarm = alarms
    .filter(alarm => matchesAlarmToSuggestion(alarm, suggestion))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

  const reviewDetail = suggestion.status === "PENDING"
    ? "Waiting for an administrator decision."
    : suggestion.status === "APPROVED"
      ? "Administrator approved the proposed remediation."
      : suggestion.status === "REJECTED"
        ? "Administrator rejected the proposed remediation."
        : "Administrator adjusted the command before execution.";

  const executeDetail = suggestion.status === "APPROVED" || suggestion.status === "MODIFIED"
    ? decisionActivity?.detail || `Command executed: ${suggestion.command ?? "n/a"}`
    : suggestion.status === "REJECTED"
      ? "Execution skipped because the suggestion was rejected."
      : "Execution will occur only after approval.";

  return {
    suggestion,
    steps: [
      {
        key: "detect",
        label: "Detect",
        state: "done",
        timestamp: detectionAlarm?.timestamp || suggestion.timestamp,
        detail: detectionAlarm?.message || `Anomaly ${suggestion.anomaly_type} observed on ${suggestion.ip}.`,
      },
      {
        key: "suggest",
        label: "Suggest",
        state: "done",
        timestamp: suggestionActivity?.timestamp || suggestion.timestamp,
        detail: `${suggestion.action_type} proposed at ${(suggestion.confidence * 100).toFixed(0)}% confidence.`,
      },
      {
        key: "review",
        label: "Review",
        state: suggestion.status === "PENDING" ? "active" : "done",
        timestamp: decisionActivity?.timestamp,
        detail: reviewDetail,
      },
      {
        key: "execute",
        label: "Execute",
        state:
          suggestion.status === "APPROVED" || suggestion.status === "MODIFIED"
            ? "done"
            : suggestion.status === "REJECTED"
              ? "skipped"
              : "waiting",
        timestamp:
          suggestion.status === "APPROVED" || suggestion.status === "MODIFIED"
            ? decisionActivity?.timestamp
            : undefined,
        detail: executeDetail,
      },
      {
        key: "learn",
        label: "Learn",
        state:
          learningActivity
            ? "done"
            : suggestion.status === "PENDING"
              ? "waiting"
              : "active",
        timestamp: learningActivity?.timestamp,
        detail:
          learningActivity?.detail ||
          (suggestion.status === "PENDING"
            ? "Learning is recorded after a decision is made."
            : "Feedback captured and waiting to appear in corrective memory trace."),
      },
    ],
  };
};

export const CorrectiveAgentPanel: FC<Props> = ({
  suggestions,
  activities,
  alarms,
  wsConnected,
  selectedDataset,
}) => {
  const [agentMode, setAgentMode] = useState<AgentMode | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modifiedCmd, setModifiedCmd] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [newMode, setNewMode] = useState("");
  const [newThreshold, setNewThreshold] = useState("");
  const [localStats, setLocalStats] = useState<Stats | null>(null);
  const [suggestionOverrides, setSuggestionOverrides] = useState<Record<string, Partial<CorrectiveSuggestion>>>({});

  const token = localStorage.getItem("access_token") || localStorage.getItem("token") || "";
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const fetchMeta = useCallback(async () => {
    try {
      const statsQuery = selectedDataset ? `?dataset=${encodeURIComponent(selectedDataset)}` : "";
      const [modeRes, statRes] = await Promise.all([
        fetch(`${API_BASE}/api/corrective/mode`, { headers }),
        fetch(`${API_BASE}/api/corrective/stats${statsQuery}`, { headers }),
      ]);
      if (modeRes.ok) {
        setAgentMode(await modeRes.json());
      }
      if (statRes.ok) {
        const statData = await statRes.json();
        setStats(normalizeStats(statData));
      }
    } catch (err) {
      console.error("[CorrectiveAgentPanel] fetch error:", err);
    }
  }, [selectedDataset, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchMeta();
    const id = setInterval(fetchMeta, 15_000);
    return () => clearInterval(id);
  }, [fetchMeta]);

  useEffect(() => {
    if (stats) setLocalStats(stats);
  }, [stats]);

  useEffect(() => {
    setSelectedId(null);
    setModifiedCmd("");
    setAdminNote("");
    setSuggestionOverrides({});
  }, [selectedDataset]);

  useEffect(() => {
    setSuggestionOverrides(prev => {
      const next = { ...prev };
      let changed = false;

      for (const suggestion of suggestions) {
        const override = next[suggestion.suggestion_id];
        if (!override) continue;

        const sameStatus = !override.status || override.status === suggestion.status;
        const sameCommand = !override.command || override.command === suggestion.command;
        const sameNote = !override.admin_note || override.admin_note === suggestion.admin_note;

        if (sameStatus && sameCommand && sameNote) {
          delete next[suggestion.suggestion_id];
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [suggestions]);

  const suggestionHistory = useMemo(() => {
    const merged = suggestions.map(suggestion => ({
      ...suggestion,
      ...(suggestionOverrides[suggestion.suggestion_id] ?? {}),
    }));
    return sortSuggestions(merged);
  }, [suggestions, suggestionOverrides]);

  const pending = useMemo(
    () => suggestionHistory.filter(suggestion => suggestion.status === "PENDING"),
    [suggestionHistory],
  );

  const completedSuggestions = useMemo(
    () => suggestionHistory.filter(suggestion => suggestion.status !== "PENDING"),
    [suggestionHistory],
  );

  const selectedSuggestion = suggestionHistory.find(suggestion => suggestion.suggestion_id === selectedId) ?? null;
  const selectedPendingSuggestion = selectedSuggestion?.status === "PENDING" ? selectedSuggestion : null;

  const lifecycleSourceSuggestions = useMemo(() => {
    if (selectedPendingSuggestion) {
      return [selectedPendingSuggestion];
    }
    return pending.slice(0, 6);
  }, [pending, selectedPendingSuggestion]);

  const lifecycleTraces = useMemo(
    () => lifecycleSourceSuggestions.map(suggestion => buildLifecycleTrace(suggestion, activities, alarms)),
    [activities, alarms, lifecycleSourceSuggestions],
  );

  useEffect(() => {
    if (!selectedPendingSuggestion) {
      setSelectedId(null);
      setModifiedCmd("");
      setAdminNote("");
    }
  }, [selectedPendingSuggestion]);

  const validate = async (decision: "APPROVE" | "REJECT" | "MODIFY") => {
    if (!selectedPendingSuggestion) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/corrective/validate`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          suggestion_id: selectedPendingSuggestion.suggestion_id,
          decision,
          modified_command: decision === "MODIFY" ? modifiedCmd : undefined,
          admin_note: adminNote || undefined,
        }),
      });
      const data = await res.json();

      const optimisticStatus: CorrectiveSuggestion["status"] =
        decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "MODIFIED";

      setSuggestionOverrides(prev => ({
        ...prev,
        [selectedPendingSuggestion.suggestion_id]: {
          status: optimisticStatus,
          command: decision === "MODIFY" ? modifiedCmd : selectedPendingSuggestion.command,
          admin_note: adminNote || undefined,
        },
      }));

      setFeedback(`${data.status} - ${data.message}`);
      setLocalStats(prev => {
        if (!prev) return prev;

        const delta = {
          APPROVE: { approved: 1, pending: -1, rejected: 0, modified: 0 },
          REJECT: { approved: 0, pending: -1, rejected: 1, modified: 0 },
          MODIFY: { approved: 0, pending: -1, rejected: 0, modified: 1 },
        }[decision];

        return {
          ...prev,
          pending: prev.pending + delta.pending,
          approved: prev.approved + delta.approved,
          rejected: prev.rejected + delta.rejected,
          modified: prev.modified + delta.modified,
          session: {
            ...prev.session,
            pending: prev.session.pending + delta.pending,
            approved: prev.session.approved + delta.approved,
            rejected: prev.session.rejected + delta.rejected,
            modified: prev.session.modified + delta.modified,
          },
        };
      });

      setSelectedId(null);
      setModifiedCmd("");
      setAdminNote("");
      fetchMeta();
    } catch {
      setFeedback("Erreur reseau - verifiez le backend.");
    } finally {
      setLoading(false);
      setTimeout(() => setFeedback(null), 5000);
    }
  };

  const changeMode = async () => {
    if (!newMode) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/corrective/mode`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          new_mode: newMode,
          new_threshold: newThreshold ? parseFloat(newThreshold) : undefined,
        }),
      });
      const data = await res.json();
      setFeedback(`Mode change -> ${data.new_mode}`);
      fetchMeta();
    } catch {
      setFeedback("Erreur changement de mode.");
    } finally {
      setLoading(false);
      setTimeout(() => setFeedback(null), 5000);
    }
  };

  const triggerDemo = async () => {
    if (!selectedDataset) {
      setFeedback("Selectionnez un dataset avant de lancer la demo.");
      setTimeout(() => setFeedback(null), 5000);
      return;
    }

    setLoading(true);
    try {
      let switchedToSuggestion = false;

      if (agentMode?.mode !== "SUGGESTION") {
        const modeRes = await fetch(`${API_BASE}/api/corrective/mode`, {
          method: "POST",
          headers,
          body: JSON.stringify({ new_mode: "SUGGESTION" }),
        });
        const modeData = await modeRes.json().catch(() => ({}));
        if (!modeRes.ok) {
          throw new Error(modeData?.detail || modeData?.message || "Impossible d'activer le mode SUGGESTION.");
        }
        switchedToSuggestion = true;
      }

      const res = await fetch(`${API_BASE}/api/corrective/demo-trigger`, {
        method: "POST",
        headers,
        body: JSON.stringify({ dataset_id: selectedDataset }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || "Erreur pendant le declenchement de la demo.");
      }

      setFeedback(
        switchedToSuggestion
          ? "Demo injectee - le mode SUGGESTION a ete active pour afficher une recommandation visible."
          : "Demo injectee - l'alarme et la suggestion vont apparaitre dans le dashboard.",
      );
      fetchMeta();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Erreur pendant le declenchement de la demo.");
    } finally {
      setLoading(false);
      setTimeout(() => setFeedback(null), 5000);
    }
  };

  const colors = PHASE_COLORS[agentMode?.mode ?? "SUGGESTION"];
  const modeKey = agentMode?.mode ?? "SUGGESTION";

  return (
    <div
      style={{
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        background: "#0a0e1a",
        color: "#c9d1e0",
        padding: "20px",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: modeKey === "AUTO" ? "#22c55e" : modeKey === "SUGGESTION" ? "#f59e0b" : "#3b82f6",
            boxShadow: `0 0 8px ${modeKey === "AUTO" ? "#22c55e" : "#f59e0b"}`,
            animation: "pulse 2s infinite",
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 2, color: "#e2e8f0" }}>
          CORRECTIVE AGENT
        </span>

        <span
          style={{
            fontSize: 9,
            padding: "2px 7px",
            borderRadius: 20,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: wsConnected ? "rgba(29,158,117,0.1)" : "rgba(226,75,74,0.1)",
            color: wsConnected ? "#1D9E75" : "#E24B4A",
            border: `1px solid ${wsConnected ? "rgba(29,158,117,0.25)" : "rgba(226,75,74,0.25)"}`,
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: wsConnected ? "#1D9E75" : "#E24B4A",
              animation: wsConnected ? "ws-pulse 2s infinite" : "none",
            }}
          />
          {wsConnected ? "WS active" : "WS offline"}
        </span>

        <span
          style={{
            marginLeft: "auto",
            padding: "3px 10px",
            borderRadius: 4,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 1.5,
            background: colors?.badge ?? "#1a6fa8",
            color: "#fff",
          }}
        >
          {PHASE_ICONS[modeKey]} {modeKey}
        </span>
      </div>

      {feedback && (
        <div
          style={{
            padding: "10px 16px",
            borderRadius: 6,
            marginBottom: 14,
            background:
              feedback.includes("EXECUTED") ||
              feedback.includes("Mode change") ||
              feedback.includes("Demo injectee")
                ? "#14532d"
                : "#450a0a",
            border: `1px solid ${
              feedback.includes("EXECUTED") ||
              feedback.includes("Mode change") ||
              feedback.includes("Demo injectee")
                ? "#22c55e"
                : "#ef4444"
            }`,
            fontSize: 12,
            color: "#e2e8f0",
          }}
        >
          {feedback}
        </div>
      )}

      {agentMode && (
        <div
          style={{
            padding: "14px 18px",
            borderRadius: 8,
            marginBottom: 16,
            background: colors?.bg ?? "#0d1f2d",
            border: `1px solid ${colors?.border ?? "#1e4d6b"}`,
          }}
        >
          <div style={{ fontSize: 10, color: "#64748b", letterSpacing: 1.5, marginBottom: 6 }}>
            PHASE ACTIVE
          </div>
          <div style={{ fontSize: 12, color: "#e2e8f0", marginBottom: 10 }}>{agentMode.phase_description}</div>
          <div style={{ display: "flex", gap: 20, fontSize: 11, color: "#94a3b8" }}>
            <span>
              Auto threshold: <strong style={{ color: "#e2e8f0" }}>{(agentMode.confidence_threshold * 100).toFixed(0)}%</strong>
            </span>
            <span>
              Pending: <strong style={{ color: pending.length > 0 ? "#f59e0b" : "#22c55e" }}>{pending.length}</strong>
            </span>
          </div>
        </div>
      )}

      {localStats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 16 }}>
          {([
            { label: "TOTAL", value: localStats.session.total, color: "#64748b" },
            { label: "PENDING", value: localStats.session.pending, color: "#f59e0b" },
            { label: "APPROVED", value: localStats.session.approved, color: "#22c55e" },
            { label: "REJECTED", value: localStats.session.rejected, color: "#ef4444" },
            {
              label: "AVG CONF",
              value: `${((isFinite(localStats.session.avg_confidence) ? localStats.session.avg_confidence : 0) * 100).toFixed(0)}%`,
              color: CONFIDENCE_COLOR(isFinite(localStats.session.avg_confidence) ? localStats.session.avg_confidence : 0),
            },
          ] as { label: string; value: string | number; color: string }[]).map(({ label, value, color }) => (
            <div
              key={label}
              style={{
                padding: "10px 8px",
                borderRadius: 6,
                background: "#0f1623",
                border: "1px solid #1e293b",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
              <div style={{ fontSize: 8, letterSpacing: 1.5, color: "#475569", marginTop: 3 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          padding: "14px 18px",
          borderRadius: 8,
          marginBottom: 16,
          background: "#0f1623",
          border: "1px solid #1e293b",
        }}
      >
        <div style={{ fontSize: 10, color: "#64748b", letterSpacing: 1.5, marginBottom: 10 }}>CHANGER LE MODE</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {(["TRAINING", "SUGGESTION", "AUTO"] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setNewMode(mode)}
              style={{
                padding: "5px 12px",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 11,
                fontFamily: "inherit",
                fontWeight: 700,
                letterSpacing: 1,
                background: newMode === mode ? PHASE_COLORS[mode].badge : "#1e293b",
                color: newMode === mode ? "#fff" : "#64748b",
                border: `1px solid ${newMode === mode ? PHASE_COLORS[mode].badge : "#334155"}`,
                transition: "all .15s",
              }}
            >
              {PHASE_ICONS[mode]} {mode}
            </button>
          ))}
          <input
            placeholder="Threshold (0.85)"
            value={newThreshold}
            onChange={event => setNewThreshold(event.target.value)}
            style={{
              padding: "5px 10px",
              borderRadius: 4,
              background: "#1e293b",
              border: "1px solid #334155",
              color: "#e2e8f0",
              fontSize: 11,
              fontFamily: "inherit",
              outline: "none",
              width: 130,
            }}
          />
          <button
            onClick={changeMode}
            disabled={!newMode || loading}
            style={{
              padding: "5px 14px",
              borderRadius: 4,
              cursor: newMode ? "pointer" : "default",
              background: newMode ? "#2563eb" : "#1e293b",
              color: newMode ? "#fff" : "#475569",
              border: "none",
              fontSize: 11,
              fontFamily: "inherit",
              fontWeight: 700,
            }}
          >
            Apply
          </button>
        </div>
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: "1px solid #1e293b",
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <button
            onClick={triggerDemo}
            disabled={loading || !selectedDataset}
            style={{
              padding: "6px 14px",
              borderRadius: 4,
              cursor: loading || !selectedDataset ? "default" : "pointer",
              background: loading || !selectedDataset ? "#1e293b" : "#7c3aed",
              color: loading || !selectedDataset ? "#64748b" : "#f8fafc",
              border: "none",
              fontSize: 11,
              fontFamily: "inherit",
              fontWeight: 700,
              letterSpacing: 0.8,
            }}
          >
            Lancer une demo visible
          </button>
          <span style={{ fontSize: 10, color: "#64748b" }}>
            Injects a synthetic anomaly into the existing pipeline and lets the system produce a real corrective suggestion.
          </span>
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 10, color: "#64748b", letterSpacing: 1.5, marginBottom: 10 }}>
          SUGGESTIONS EN ATTENTE ({pending.length})
        </div>

        {pending.length === 0 ? (
          <div
            style={{
              padding: "24px",
              textAlign: "center",
              color: "#475569",
              fontSize: 12,
              background: "#0f1623",
              borderRadius: 8,
              border: "1px solid #1e293b",
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 10 }}>OK</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 6 }}>
              No pending suggestion
            </div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>
              {agentMode?.mode === "AUTO"
                ? "AUTO mode handles eligible anomalies automatically. Use the trace below to inspect completed actions."
                : agentMode?.mode === "TRAINING"
                  ? "TRAINING mode records examples without opening manual suggestions."
                  : "The panel is ready. Critical anomalies will appear here with a corrective review flow."}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {pending.map(suggestion => (
              <div
                key={suggestion.suggestion_id}
                onClick={() => {
                  setSelectedId(suggestion.suggestion_id);
                  setModifiedCmd(suggestion.command ?? "");
                  setAdminNote("");
                }}
                style={{
                  padding: "12px 16px",
                  borderRadius: 8,
                  cursor: "pointer",
                  background: selectedPendingSuggestion?.suggestion_id === suggestion.suggestion_id ? "#1e293b" : "#0f1623",
                  border: `1px solid ${
                    selectedPendingSuggestion?.suggestion_id === suggestion.suggestion_id ? "#3b82f6" : "#1e293b"
                  }`,
                  transition: "all .15s",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 14,
                }}
              >
                <div style={{ width: 38, textAlign: "center", flexShrink: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: CONFIDENCE_COLOR(suggestion.confidence) }}>
                    {(suggestion.confidence * 100).toFixed(0)}%
                  </div>
                  <div style={{ fontSize: 8, color: "#475569", letterSpacing: 1 }}>CONF.</div>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                    <span
                      style={{
                        fontSize: 9,
                        padding: "2px 6px",
                        borderRadius: 3,
                        background: `${SEVERITY_COLOR(suggestion.severity)}22`,
                        color: SEVERITY_COLOR(suggestion.severity),
                        border: `1px solid ${SEVERITY_COLOR(suggestion.severity)}44`,
                        fontWeight: 700,
                        letterSpacing: 0.5,
                      }}
                    >
                      {suggestion.severity}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>{suggestion.action_type}</span>
                    <span style={{ fontSize: 10, color: "#64748b" }}>IP: {suggestion.ip}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{suggestion.description}</div>
                  {suggestion.command && (
                    <div
                      style={{
                        fontSize: 10,
                        color: "#60a5fa",
                        fontFamily: "monospace",
                        background: "#0a0e1a",
                        padding: "3px 8px",
                        borderRadius: 3,
                        display: "inline-block",
                        maxWidth: "100%",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      $ {suggestion.command}
                    </div>
                  )}
                </div>

                <div style={{ fontSize: 9, color: "#475569", whiteSpace: "nowrap", flexShrink: 0 }}>
                  {formatTime(suggestion.timestamp)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedPendingSuggestion && (
        <div
          style={{
            padding: "18px",
            borderRadius: 8,
            background: "#0d1f0d",
            border: "1px solid #1e4d1e",
            marginBottom: 18,
          }}
        >
          <div style={{ fontSize: 10, color: "#64748b", letterSpacing: 1.5, marginBottom: 12 }}>
            VALIDATION - <span style={{ color: "#94a3b8" }}>{selectedPendingSuggestion.suggestion_id}</span>
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: "#64748b", marginBottom: 5 }}>COMMANDE (modifiable):</div>
            <input
              value={modifiedCmd}
              onChange={event => setModifiedCmd(event.target.value)}
              style={{
                width: "100%",
                padding: "7px 10px",
                borderRadius: 4,
                background: "#0f2010",
                border: "1px solid #1e4d1e",
                color: "#86efac",
                fontSize: 12,
                fontFamily: "monospace",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: "#64748b", marginBottom: 5 }}>NOTE ADMIN (optionnel):</div>
            <input
              value={adminNote}
              onChange={event => setAdminNote(event.target.value)}
              placeholder="Reason for the decision..."
              style={{
                width: "100%",
                padding: "7px 10px",
                borderRadius: 4,
                background: "#1e293b",
                border: "1px solid #334155",
                color: "#e2e8f0",
                fontSize: 11,
                fontFamily: "inherit",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => validate("APPROVE")}
              disabled={loading}
              style={{
                flex: 1,
                padding: "9px",
                borderRadius: 4,
                cursor: "pointer",
                background: "#166534",
                border: "1px solid #22c55e",
                color: "#86efac",
                fontSize: 12,
                fontFamily: "inherit",
                fontWeight: 700,
              }}
            >
              APPROUVER
            </button>
            <button
              onClick={() => validate("MODIFY")}
              disabled={loading || !modifiedCmd}
              style={{
                flex: 1,
                padding: "9px",
                borderRadius: 4,
                cursor: loading || !modifiedCmd ? "default" : "pointer",
                background: "#1e3a5f",
                border: "1px solid #3b82f6",
                color: "#93c5fd",
                fontSize: 12,
                fontFamily: "inherit",
                fontWeight: 700,
                opacity: !modifiedCmd ? 0.5 : 1,
              }}
            >
              MODIFIER & EXE.
            </button>
            <button
              onClick={() => validate("REJECT")}
              disabled={loading}
              style={{
                flex: 1,
                padding: "9px",
                borderRadius: 4,
                cursor: "pointer",
                background: "#450a0a",
                border: "1px solid #ef4444",
                color: "#fca5a5",
                fontSize: 12,
                fontFamily: "inherit",
                fontWeight: 700,
              }}
            >
              REJETER
            </button>
            <button
              onClick={() => setSelectedId(null)}
              style={{
                padding: "9px 14px",
                borderRadius: 4,
                cursor: "pointer",
                background: "#1e293b",
                border: "1px solid #334155",
                color: "#64748b",
                fontSize: 12,
                fontFamily: "inherit",
              }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 10, color: "#64748b", letterSpacing: 1.5, marginBottom: 10 }}>
          TRACE CORRECTIVE ({lifecycleTraces.length})
        </div>

        {lifecycleTraces.length === 0 ? (
          <div
            style={{
              padding: "20px",
              borderRadius: 8,
              background: "#0f1623",
              border: "1px solid #1e293b",
              color: "#64748b",
              fontSize: 12,
            }}
          >
            No active corrective review in progress. Completed suggestions remain visible in the history section below.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {lifecycleTraces.map(trace => {
              const statusStyle = STATUS_STYLES[trace.suggestion.status];

              return (
                <div
                  key={trace.suggestion.suggestion_id}
                  style={{
                    padding: "14px 16px",
                    borderRadius: 10,
                    background: "#0f1623",
                    border: "1px solid #1e293b",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      flexWrap: "wrap",
                      marginBottom: 12,
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 5 }}>
                        <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 700 }}>{trace.suggestion.action_type}</span>
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: 0.6,
                            padding: "2px 7px",
                            borderRadius: 999,
                            background: statusStyle.bg,
                            color: statusStyle.color,
                            border: `1px solid ${statusStyle.border}`,
                          }}
                        >
                          {statusLabel(trace.suggestion.status)}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>
                        {trace.suggestion.anomaly_type} on {trace.suggestion.ip}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: CONFIDENCE_COLOR(trace.suggestion.confidence) }}>
                        {(trace.suggestion.confidence * 100).toFixed(0)}%
                      </div>
                      <div style={{ fontSize: 9, color: "#64748b" }}>{formatDateTime(trace.suggestion.timestamp)}</div>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                    {trace.steps.map((step, index) => {
                      const stepStyle = TRACE_STATE_STYLES[step.state];
                      const isLast = index === trace.steps.length - 1;

                      return (
                        <div
                          key={step.key}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "20px 88px 1fr auto",
                            gap: 12,
                            alignItems: "start",
                            minHeight: 52,
                          }}
                        >
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", height: "100%" }}>
                            <span
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: "50%",
                                background: stepStyle.dot,
                                marginTop: 4,
                                boxShadow: `0 0 10px ${stepStyle.line}`,
                              }}
                            />
                            {!isLast && (
                              <span
                                style={{
                                  width: 1,
                                  flex: 1,
                                  background: stepStyle.line,
                                  marginTop: 6,
                                }}
                              />
                            )}
                          </div>
                          <div style={{ fontSize: 10, color: "#64748b", letterSpacing: 1.1, paddingTop: 1 }}>{step.label.toUpperCase()}</div>
                          <div>
                            <div style={{ fontSize: 11, color: stepStyle.text, marginBottom: 3 }}>{step.detail}</div>
                          </div>
                          <div style={{ fontSize: 9, color: "#64748b", whiteSpace: "nowrap", paddingTop: 1 }}>
                            {formatTime(step.timestamp)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 10, color: "#64748b", letterSpacing: 1.5, marginBottom: 10 }}>
          HISTORIQUE RECENT ({completedSuggestions.length})
        </div>

        {completedSuggestions.length === 0 ? (
          <div
            style={{
              padding: "18px",
              borderRadius: 8,
              background: "#0f1623",
              border: "1px solid #1e293b",
              color: "#64748b",
              fontSize: 12,
            }}
          >
            Completed suggestions will stay visible here for demo traceability.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {completedSuggestions.slice(0, 12).map(suggestion => {
              const statusStyle = STATUS_STYLES[suggestion.status];
              return (
                <div
                  key={suggestion.suggestion_id}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 8,
                    background: "#0f1623",
                    border: "1px solid #1e293b",
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                  }}
                >
                  <div style={{ width: 38, textAlign: "center", flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: CONFIDENCE_COLOR(suggestion.confidence) }}>
                      {(suggestion.confidence * 100).toFixed(0)}%
                    </div>
                    <div style={{ fontSize: 8, color: "#475569", letterSpacing: 1 }}>CONF.</div>
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 700 }}>{suggestion.action_type}</span>
                      <span
                        style={{
                          fontSize: 9,
                          padding: "2px 7px",
                          borderRadius: 999,
                          background: statusStyle.bg,
                          color: statusStyle.color,
                          border: `1px solid ${statusStyle.border}`,
                          fontWeight: 700,
                        }}
                      >
                        {statusLabel(suggestion.status)}
                      </span>
                      <span style={{ fontSize: 10, color: "#64748b" }}>{suggestion.ip}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{suggestion.description}</div>
                    {suggestion.command && (
                      <div style={{ fontSize: 10, color: "#60a5fa", fontFamily: "monospace" }}>$ {suggestion.command}</div>
                    )}
                  </div>

                  <div style={{ fontSize: 9, color: "#64748b", whiteSpace: "nowrap" }}>{formatDateTime(suggestion.timestamp)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        @keyframes ws-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </div>
  );
};

export default CorrectiveAgentPanel;
