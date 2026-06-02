import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, FC, ReactNode } from "react";

import type { CorrectiveSuggestion, WorkflowActivity } from "../../../shared/types/idps";

type ModeName = "TRAINING" | "SUGGESTION" | "AUTO";
type Decision = "APPROVE" | "REJECT" | "MODIFY";

type CorrectiveAgentPanelProps = {
  suggestions: CorrectiveSuggestion[];
  activities: WorkflowActivity[];
  alarms: Array<{ source_ip?: string; type?: string; timestamp?: string }>;
  wsConnected: boolean;
  selectedDataset: string;
};

type ModeResponse = {
  mode: ModeName;
  confidence_threshold: number;
  phase_description: string;
  pending_count: number;
};

type SessionStats = {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  modified: number;
  avg_confidence: number;
};

type MemoryStats = {
  corrections_apprises?: number;
  bonnes_actions?: number;
  faux_positifs?: number;
  success_rates?: Record<string, number>;
  dataset_id?: string;
  analysis_only?: boolean;
  reason?: string;
  error?: string;
};

type StatsResponse = {
  session: SessionStats;
  memory: MemoryStats;
};

type SuggestionOverride = Partial<Pick<CorrectiveSuggestion, "status" | "command" | "admin_note">>;
type Status = CorrectiveSuggestion["status"];

type TraceStep = {
  key: string;
  label: string;
  detail: string;
  timestamp?: string;
  state: "done" | "active" | "waiting" | "skipped";
};

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

const EMPTY_MODE: ModeResponse = {
  mode: "SUGGESTION",
  confidence_threshold: 0.85,
  phase_description:
    "Les actions a haute confiance sont proposees pour validation humaine. L'agent apprend de chaque decision.",
  pending_count: 0,
};

const EMPTY_STATS: StatsResponse = {
  session: {
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    modified: 0,
    avg_confidence: 0,
  },
  memory: {},
};

const pageShell: CSSProperties = {
  minHeight: "100vh",
  background: "linear-gradient(135deg, rgba(2,6,23,0.98), rgba(15,23,42,0.98) 55%, rgba(2,6,23,0.98))",
  color: "#f8fafc",
  borderRadius: 24,
};

const pageInner: CSSProperties = {
  maxWidth: 1280,
  margin: "0 auto",
  padding: 24,
  display: "grid",
  gap: 24,
};

const cardStyle: CSSProperties = {
  border: "1px solid rgba(51,65,85,0.92)",
  background: "rgba(15,23,42,0.40)",
  backdropFilter: "blur(14px)",
  borderRadius: 18,
  boxShadow: "0 18px 44px rgba(0,0,0,0.24)",
};

const headerTitle: CSSProperties = {
  fontSize: 30,
  fontWeight: 600,
  letterSpacing: "-0.02em",
  color: "#f8fafc",
};

// FIX 3 — muted text color was previously "#94a3b8" (too dark/invisible on
// dark bg). Changed to a lighter, clearly legible secondary tone.
const mutedText: CSSProperties = {
  color: "#cbd5e1",
  fontSize: 14,
};

const separatorStyle: CSSProperties = {
  height: 1,
  background: "rgba(51,65,85,0.9)",
};

const authHeaders = (): Record<string, string> => {
  const token = localStorage.getItem("token") ?? "";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
};

const withDatasetQuery = (path: string, dataset: string): string => {
  if (!dataset) return path;
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}dataset=${encodeURIComponent(dataset)}`;
};

const formatPercent = (value: number | null | undefined): string => {
  if (value == null || Number.isNaN(value)) return "--";
  return `${Math.round(value * 100)}%`;
};

const formatClock = (iso?: string): string =>
  iso
    ? new Date(iso).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "--";

const formatRelative = (iso?: string): string => {
  if (!iso) return "--";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `il y a ${Math.round(diff)}s`;
  if (diff < 3600) return `il y a ${Math.round(diff / 60)}m`;
  return `il y a ${Math.round(diff / 3600)}h`;
};

const normalizeSeverity = (value?: string): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" => {
  const severity = String(value ?? "").toUpperCase();
  if (severity === "CRITICAL") return "CRITICAL";
  if (severity === "HIGH") return "HIGH";
  if (severity === "LOW") return "LOW";
  return "MEDIUM";
};

const severityTone = (severity?: string): { border: string; background: string; color: string } => {
  switch (normalizeSeverity(severity)) {
    case "CRITICAL":
      return { border: "rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.1)", color: "#fca5a5" };
    case "HIGH":
      return { border: "rgba(249,115,22,0.4)", background: "rgba(249,115,22,0.1)", color: "#fdba74" };
    case "LOW":
      return { border: "rgba(56,189,248,0.4)", background: "rgba(56,189,248,0.1)", color: "#7dd3fc" };
    default:
      return { border: "rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.1)", color: "#fcd34d" };
  }
};

const statusLabel = (status: Status): string => {
  if (status === "APPROVED") return "Approuvee";
  if (status === "REJECTED") return "Rejetee";
  if (status === "MODIFIED") return "Modifiee";
  return "En attente";
};

const statusTone = (status: Status): { border: string; background: string; color: string } => {
  if (status === "APPROVED") {
    return { border: "rgba(16,185,129,0.4)", background: "rgba(16,185,129,0.1)", color: "#86efac" };
  }
  if (status === "REJECTED") {
    return { border: "rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.1)", color: "#fca5a5" };
  }
  if (status === "MODIFIED") {
    return { border: "rgba(14,165,233,0.4)", background: "rgba(14,165,233,0.1)", color: "#7dd3fc" };
  }
  return { border: "rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.1)", color: "#fcd34d" };
};

const confidenceColor = (value: number): string => {
  if (value >= 0.85) return "#4ade80";
  if (value >= 0.65) return "#fcd34d";
  return "#f87171";
};

const modeMeta: Record<ModeName, { label: string; glyph: string; tint: string }> = {
  TRAINING: { label: "Apprentissage", glyph: "B", tint: "#7dd3fc" },
  SUGGESTION: { label: "Suggestion", glyph: "S", tint: "#fcd34d" },
  AUTO: { label: "Automatique", glyph: "A", tint: "#86efac" },
};

const isCorrectiveActivity = (activity: WorkflowActivity): boolean =>
  String(activity.stage ?? "").toLowerCase() === "corrective" ||
  String(activity.event_type ?? "").toLowerCase().includes("corrective");

const matchingActivityCount = (activities: WorkflowActivity[], suggestion: CorrectiveSuggestion): number =>
  activities.filter((activity) => {
    const meta = activity.meta ?? {};
    return (
      meta.suggestion_id === suggestion.suggestion_id ||
      meta.ip === suggestion.ip ||
      meta.action_type === suggestion.action_type
    );
  }).length;

// FIX 4 — Check whether the AI is actually learning.
// The backend stores every admin decision in long_term_memory.json via
// enregistrer_stat_action() (called from corrective_api.py on each validate).
// "Learning" means the memory file has at least one recorded decision
// (approved + rejected + modified > 0). We derive this from the stats the
// backend already returns.
const computeLearningStatus = (
  memory: MemoryStats,
  session: SessionStats,
): { isLearning: boolean; label: string; color: string } => {
  const total =
    (memory.bonnes_actions ?? 0) +
    (memory.faux_positifs ?? 0) +
    (memory.corrections_apprises ?? 0);

  if (memory.analysis_only) {
    return { isLearning: false, label: "Mode lecture seule", color: "#94a3b8" };
  }
  if (total > 0) {
    return { isLearning: true, label: "Apprentissage actif", color: "#4ade80" };
  }
  if (session.approved > 0 || session.rejected > 0 || session.modified > 0) {
    // Decisions recorded this session but not yet flushed to long-term memory
    return { isLearning: true, label: "Apprentissage en cours", color: "#fcd34d" };
  }
  return { isLearning: false, label: "En attente de décisions", color: "#94a3b8" };
};

// FIX 2 — Short, human-readable lifecycle step details.
const buildSteps = (
  suggestion: CorrectiveSuggestion,
  activities: WorkflowActivity[],
  memory: MemoryStats,
): TraceStep[] => {
  const decided = suggestion.status !== "PENDING";
  const relatedActivities = matchingActivityCount(activities, suggestion);
  const totalDecisions =
    (memory.bonnes_actions ?? 0) +
    (memory.faux_positifs ?? 0) +
    (memory.corrections_apprises ?? 0);

  return [
    {
      key: "detect",
      label: "Détection",
      state: "done",
      timestamp: suggestion.timestamp,
      // Keep it to the essential fact — type + IP.
      detail: `${suggestion.anomaly_type} sur ${suggestion.ip}.`,
    },
    {
      key: "suggest",
      label: "Suggestion",
      state: "done",
      timestamp: suggestion.timestamp,
      // One line: what action, how confident.
      detail: `${suggestion.action_type} — confiance ${formatPercent(suggestion.confidence)}.`,
    },
    {
      key: "review",
      label: "Validation",
      state: decided ? "done" : "active",
      detail: decided
        ? `Décision : ${statusLabel(suggestion.status)}.`
        : "En attente de votre décision.",
    },
    {
      key: "execute",
      label: "Exécution",
      state:
        suggestion.status === "APPROVED" || suggestion.status === "MODIFIED"
          ? "done"
          : suggestion.status === "REJECTED"
            ? "skipped"
            : "waiting",
      detail:
        suggestion.status === "APPROVED" || suggestion.status === "MODIFIED"
          ? "Action exécutée."
          : suggestion.status === "REJECTED"
            ? "Annulée."
            : "Démarrera après approbation.",
    },
    {
      key: "learn",
      label: "Apprentissage",
      state: decided ? "done" : "waiting",
      // Show concrete learning progress if available; fall back to a simple message.
      detail: decided
        ? totalDecisions > 0
          ? `${totalDecisions} décision${totalDecisions > 1 ? "s" : ""} mémorisée${totalDecisions > 1 ? "s" : ""}.`
          : relatedActivities > 0
            ? `${relatedActivities} trace${relatedActivities > 1 ? "s" : ""} enregistrée${relatedActivities > 1 ? "s" : ""}.`
            : "Feedback enregistré."
        : "Mis à jour après décision.",
    },
  ];
};

const applyOverrides = (
  suggestions: CorrectiveSuggestion[],
  overrides: Record<string, SuggestionOverride>,
): CorrectiveSuggestion[] =>
  suggestions.map((suggestion) => ({
    ...suggestion,
    ...overrides[suggestion.suggestion_id],
  }));

export const CorrectiveAgentPanel: FC<CorrectiveAgentPanelProps> = ({
  suggestions,
  activities,
  alarms,
  wsConnected,
  selectedDataset,
}) => {
  const [mode, setMode] = useState<ModeResponse>(EMPTY_MODE);
  const [stats, setStats] = useState<StatsResponse>(EMPTY_STATS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modifiedCmd, setModifiedCmd] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<"ok" | "warn">("ok");
  const [newMode, setNewMode] = useState<ModeName>("SUGGESTION");
  const [newThreshold, setNewThreshold] = useState("0.85");
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [savingMode, setSavingMode] = useState(false);
  const [savingDecision, setSavingDecision] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, SuggestionOverride>>({});
  const [refreshToken, setRefreshToken] = useState(0);

  const correctiveActivities = useMemo(
    () => activities.filter(isCorrectiveActivity),
    [activities],
  );

  const mergedSuggestions = useMemo(
    () =>
      applyOverrides(
        suggestions.slice().sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
        overrides,
      ),
    [overrides, suggestions],
  );

  const pending = useMemo(
    () => mergedSuggestions.filter((suggestion) => suggestion.status === "PENDING"),
    [mergedSuggestions],
  );

  const completed = useMemo(
    () => mergedSuggestions.filter((suggestion) => suggestion.status !== "PENDING"),
    [mergedSuggestions],
  );

  const selected = useMemo(
    () => mergedSuggestions.find((suggestion) => suggestion.suggestion_id === selectedId) ?? null,
    [mergedSuggestions, selectedId],
  );

  const selectedPending = selected && selected.status === "PENDING" ? selected : null;

  const displayedStats = useMemo(() => {
    if (stats.session.total > 0 || mergedSuggestions.length === 0) return stats.session;

    const approved = mergedSuggestions.filter((suggestion) => suggestion.status === "APPROVED").length;
    const rejected = mergedSuggestions.filter((suggestion) => suggestion.status === "REJECTED").length;
    const modified = mergedSuggestions.filter((suggestion) => suggestion.status === "MODIFIED").length;
    const avg = mergedSuggestions.reduce((sum, suggestion) => sum + (suggestion.confidence ?? 0), 0) / Math.max(mergedSuggestions.length, 1);

    return {
      total: mergedSuggestions.length,
      pending: pending.length,
      approved,
      rejected,
      modified,
      avg_confidence: avg,
    };
  }, [mergedSuggestions, pending.length, stats.session]);

  // FIX 4 — compute real learning status from backend memory data
  const learningStatus = useMemo(
    () => computeLearningStatus(stats.memory, displayedStats),
    [stats.memory, displayedStats],
  );

  const lifecycleSource = selectedPending ?? pending[0] ?? completed[0] ?? null;
  const lifecycleSteps = useMemo(
    () => (lifecycleSource ? buildSteps(lifecycleSource, correctiveActivities, stats.memory) : []),
    [correctiveActivities, lifecycleSource, stats.memory],
  );

  const refreshStats = async (): Promise<void> => {
    try {
      const response = await fetch(withDatasetQuery(`${API_BASE}/api/corrective/stats`, selectedDataset), {
        headers: authHeaders(),
      });
      if (!response.ok) throw new Error(`stats ${response.status}`);
      const payload = (await response.json()) as StatsResponse;
      setStats(payload);
    } catch (error) {
      console.error("[CorrectiveAgentPanel] stats refresh failed", error);
    }
  };

  const showFeedback = (message: string, tone: "ok" | "warn") => {
    setFeedback(message);
    setFeedbackTone(tone);
    window.setTimeout(() => {
      setFeedback((current) => (current === message ? null : current));
    }, 3500);
  };

  useEffect(() => {
    setOverrides({});
    setSelectedId(null);
    setAdminNote("");
    setFeedback(null);
  }, [selectedDataset]);

  useEffect(() => {
    if (selected) return;
    const next = pending[0] ?? mergedSuggestions[0] ?? null;
    setSelectedId(next?.suggestion_id ?? null);
    setModifiedCmd(next?.command ?? "");
  }, [mergedSuggestions, pending, selected]);

  useEffect(() => {
    if (!selected) {
      setModifiedCmd("");
      setAdminNote("");
      return;
    }
    setModifiedCmd(selected.command ?? "");
  }, [selected]);

  useEffect(() => {
    let mounted = true;

    const loadMeta = async () => {
      setLoadingMeta(true);
      setMetaError(null);
      try {
        const [modeRes, statsRes] = await Promise.all([
          fetch(`${API_BASE}/api/corrective/mode`, { headers: authHeaders() }),
          fetch(withDatasetQuery(`${API_BASE}/api/corrective/stats`, selectedDataset), {
            headers: authHeaders(),
          }),
        ]);

        if (!modeRes.ok) throw new Error(`mode ${modeRes.status}`);
        if (!statsRes.ok) throw new Error(`stats ${statsRes.status}`);

        const [modeJson, statsJson] = await Promise.all([
          modeRes.json() as Promise<ModeResponse>,
          statsRes.json() as Promise<StatsResponse>,
        ]);

        if (!mounted) return;
        setMode(modeJson);
        setStats(statsJson);
        setNewMode(modeJson.mode);
        setNewThreshold(String(modeJson.confidence_threshold ?? 0.85));
      } catch (error) {
        if (!mounted) return;
        console.error("[CorrectiveAgentPanel] metadata load failed", error);
        setMetaError("Impossible de charger les metadonnees correctives pour le moment.");
      } finally {
        if (mounted) setLoadingMeta(false);
      }
    };

    void loadMeta();
    return () => {
      mounted = false;
    };
  }, [refreshToken, selectedDataset]);

  const applyMode = async () => {
    setSavingMode(true);
    try {
      const threshold = Number(newThreshold);
      const payload = {
        new_mode: newMode,
        new_threshold: Number.isFinite(threshold) ? threshold : mode.confidence_threshold,
      };

      const response = await fetch(`${API_BASE}/api/corrective/mode`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(String(data?.detail ?? data?.message ?? response.status));
      }

      setMode((current) => ({
        ...current,
        mode: newMode,
        confidence_threshold: payload.new_threshold,
      }));
      showFeedback(String(data?.message ?? "Mode change enregistre."), "ok");
      await refreshStats();
    } catch (error) {
      console.error("[CorrectiveAgentPanel] mode update failed", error);
      showFeedback("Impossible de modifier le mode correctif.", "warn");
    } finally {
      setSavingMode(false);
    }
  };

  const decide = async (decision: Decision) => {
    if (!selectedPending) return;

    setSavingDecision(true);
    try {
      const payload: Record<string, unknown> = {
        suggestion_id: selectedPending.suggestion_id,
        decision,
      };
      if (adminNote.trim()) payload.admin_note = adminNote.trim();
      if (decision === "MODIFY") payload.modified_command = modifiedCmd.trim();

      const response = await fetch(`${API_BASE}/api/corrective/validate`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(String(data?.detail ?? data?.message ?? response.status));
      }

      setOverrides((current) => ({
        ...current,
        [selectedPending.suggestion_id]: {
          status: decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "MODIFIED",
          command: decision === "MODIFY" ? modifiedCmd.trim() : selectedPending.command,
          admin_note: adminNote.trim() || selectedPending.admin_note,
        },
      }));

      setSelectedId(null);
      setAdminNote("");
      showFeedback(String(data?.message ?? "Decision enregistree."), "ok");
      await refreshStats();
    } catch (error) {
      console.error("[CorrectiveAgentPanel] validation failed", error);
      showFeedback("Impossible de valider cette suggestion.", "warn");
    } finally {
      setSavingDecision(false);
    }
  };

  return (
    <div style={pageShell}>
      <div style={pageInner}>
        <header style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              display: "flex",
              flexDirection: window.innerWidth >= 1024 ? "row" : "column",
              alignItems: window.innerWidth >= 1024 ? "center" : "flex-start",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div
                style={{
                  position: "relative",
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  display: "grid",
                  placeItems: "center",
                  background: "linear-gradient(135deg, rgba(99,102,241,0.22), rgba(16,185,129,0.18))",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "#c7d2fe",
                  fontWeight: 700,
                  fontSize: 18,
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
                }}
              >
                AI
              </div>
              <div>
                <h1 style={headerTitle}>Corrective Agent</h1>
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <Badge
                tone={wsConnected ? "ok" : "warn"}
                label={wsConnected ? "Flux temps reel" : "Hors ligne"}
                prefix={<LiveDot active={wsConnected} />}
              />
              <Badge
                tone="neutral"
                label={`Mode ${modeMeta[mode.mode].label}`}
                prefix={<GlyphPill glyph={modeMeta[mode.mode].glyph} color={modeMeta[mode.mode].tint} />}
              />
              {/* FIX 4 — Learning status badge derived from real backend memory */}
              <Badge
                tone={learningStatus.isLearning ? "ok" : "neutral"}
                label={learningStatus.label}
                prefix={
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: learningStatus.color,
                      boxShadow: learningStatus.isLearning
                        ? `0 0 0 4px ${learningStatus.color}22`
                        : "none",
                      display: "inline-block",
                      flexShrink: 0,
                    }}
                  />
                }
              />
              <button
                type="button"
                onClick={() => setRefreshToken((current) => current + 1)}
                style={{
                  border: "none",
                  borderRadius: 12,
                  padding: "10px 14px",
                  background: "linear-gradient(135deg, rgba(99,102,241,0.9), rgba(129,140,248,0.92))",
                  color: "#eef2ff",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Actualiser
              </button>
            </div>
          </div>
        </header>

        {feedback && (
          <div
            style={{
              ...cardStyle,
              padding: "12px 16px",
              color: feedbackTone === "ok" ? "#bbf7d0" : "#fde68a",
              borderColor: feedbackTone === "ok" ? "rgba(16,185,129,0.28)" : "rgba(245,158,11,0.28)",
              background: feedbackTone === "ok" ? "rgba(16,185,129,0.10)" : "rgba(245,158,11,0.10)",
              fontSize: 16,
            }}
          >
            {feedback}
          </div>
        )}

        {metaError && (
          <div
            style={{
              ...cardStyle,
              padding: "12px 16px",
              color: "#fecdd3",
              borderColor: "rgba(239,68,68,0.28)",
              background: "rgba(239,68,68,0.08)",
              fontSize: 16,
            }}
          >
            {metaError}
          </div>
        )}

        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}>
          <ResponsiveGrid columns="1fr 2fr">
            <Card>
              <CardHeader>
                <CardDescription>Phase active</CardDescription>
                <CardTitle>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <GlyphPill glyph={modeMeta[mode.mode].glyph} color={modeMeta[mode.mode].tint} />
                    {modeMeta[mode.mode].label}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div style={{ color: "#94a3b8", fontSize: 15, lineHeight: 1.65 }}>
                  {loadingMeta ? "Chargement du contexte correctif..." : mode.phase_description}
                </div>
                <div style={{ marginTop: 16, ...separatorStyle }} />
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "#94a3b8" }}>
                    <span>Seuil de confiance automatique</span>
                    <span style={{ fontFamily: "var(--font-mono)", color: "#e2e8f0" }}>
                      {formatPercent(mode.confidence_threshold)}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      height: 6,
                      borderRadius: 999,
                      background: "rgba(51,65,85,0.92)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.max(0, Math.min(100, (mode.confidence_threshold ?? 0) * 100))}%`,
                        height: "100%",
                        background: "linear-gradient(90deg, rgba(125,211,252,0.95), rgba(99,102,241,0.95))",
                      }}
                    />
                  </div>
                  {/* FIX 1 — "Memoire: 0 corrections apprises · 0 bonnes actions · 0 faux positifs"
                      REMOVED. The information is surfaced in a better way via the
                      learning status badge in the header (FIX 4). Showing raw zeros
                      when no decisions have been made yet adds noise without value. */}
                </div>
              </CardContent>
            </Card>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <KpiCard label="Total" value={String(displayedStats.total)} tint="#cbd5e1" />
              <KpiCard label="En attente" value={String(displayedStats.pending)} tint="#fcd34d" />
              <KpiCard label="Approuvees" value={String(displayedStats.approved)} tint="#86efac" />
              <KpiCard
                label="Confiance moy."
                value={formatPercent(displayedStats.avg_confidence)}
                tint={confidenceColor(displayedStats.avg_confidence)}
              />
            </div>
          </ResponsiveGrid>

          <Card>
            <CardHeader compact>
              <CardTitle>Configuration du mode</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "flex-end",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {(["TRAINING", "SUGGESTION", "AUTO"] as ModeName[]).map((value) => {
                    const active = newMode === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setNewMode(value)}
                        style={{
                          border: active ? "1px solid rgba(125,211,252,0.35)" : "1px solid rgba(51,65,85,0.92)",
                          background: active ? "rgba(30,41,59,0.92)" : "rgba(15,23,42,0.62)",
                          color: active ? "#e2e8f0" : "#cbd5e1",
                          borderRadius: 12,
                          padding: "10px 12px",
                          fontSize: 14,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        <span style={{ color: modeMeta[value].tint, marginRight: 8 }}>{modeMeta[value].glyph}</span>
                        {modeMeta[value].label}
                      </button>
                    );
                  })}
                </div>

                <div style={{ flex: "1 1 180px", minWidth: 180 }}>
                  <label style={{ display: "block", fontSize: 14, color: "#94a3b8", marginBottom: 6 }}>Seuil (0 - 1)</label>
                  <input
                    value={newThreshold}
                    onChange={(event) => setNewThreshold(event.target.value)}
                    placeholder="0.85"
                    style={{
                      width: "100%",
                      height: 40,
                      borderRadius: 12,
                      border: "1px solid rgba(51,65,85,0.92)",
                      background: "rgba(2,6,23,0.55)",
                      color: "#e2e8f0",
                      padding: "0 12px",
                    }}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => void applyMode()}
                  disabled={savingMode}
                  style={{
                    border: "none",
                    borderRadius: 12,
                    padding: "10px 16px",
                    background: "#f8fafc",
                    color: "#0f172a",
                    fontWeight: 700,
                    cursor: savingMode ? "wait" : "pointer",
                    opacity: savingMode ? 0.7 : 1,
                  }}
                >
                  {savingMode ? "Application..." : "Appliquer"}
                </button>
              </div>
            </CardContent>
          </Card>

          <ResponsiveGrid columns="3fr 2fr">
            <Card>
              <CardHeader row>
                <div>
                  <CardTitle>
                    <span style={{ color: "#fcd34d", marginRight: 8 }}>!</span>
                    Suggestions en attente
                    <InlineCount>{pending.length}</InlineCount>
                  </CardTitle>
                </div>
                {/* FIX 3 — use the updated mutedText style so this is visible */}
                <span style={mutedText}>Cliquez pour decider</span>
              </CardHeader>
              <div style={{ padding: "0 0 16px" }}>
                <ScrollArea height={420}>
                  <div style={{ display: "grid", gap: 8, padding: "0 16px 0" }}>
                    {pending.length === 0 ? (
                      <EmptyState title="Aucune suggestion en attente" hint="Les nouvelles propositions de l'agent apparaitront ici en temps reel." />
                    ) : (
                      pending.map((suggestion) => (
                        <SuggestionRow
                          key={suggestion.suggestion_id}
                          suggestion={suggestion}
                          active={selectedId === suggestion.suggestion_id}
                          onClick={() => {
                            setSelectedId(suggestion.suggestion_id);
                            setModifiedCmd(suggestion.command ?? "");
                            setAdminNote("");
                          }}
                        />
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <span style={{ color: "#a5b4fc", marginRight: 8 }}>~</span>
                  Validation administrateur
                </CardTitle>
                <CardDescription>
                  {selectedPending
                    ? `Decision pour ${selectedPending.suggestion_id}`
                    : selected
                      ? `Suggestion ${selected.suggestion_id} deja traitee`
                      : "Selectionnez une suggestion pour ouvrir le panneau."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {selected ? (
                  <div style={{ display: "grid", gap: 16 }}>
                    <div>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#94a3b8", marginBottom: 6 }}>
                        <span style={{ color: "#86efac" }}>{">_"}</span> Commande (modifiable)
                      </label>
                      <textarea
                        value={modifiedCmd}
                        onChange={(event) => setModifiedCmd(event.target.value)}
                        rows={2}
                        disabled={!selectedPending}
                        style={{
                          width: "100%",
                          borderRadius: 12,
                          border: "1px solid rgba(6,95,70,0.55)",
                          background: "rgba(6,78,59,0.22)",
                          color: "#a7f3d0",
                          fontFamily: "var(--font-mono)",
                          fontSize: 14,
                          lineHeight: 1.6,
                          padding: 12,
                          opacity: selectedPending ? 1 : 0.7,
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 14, color: "#94a3b8", marginBottom: 6 }}>
                        Note admin (optionnel)
                      </label>
                      <input
                        value={adminNote}
                        onChange={(event) => setAdminNote(event.target.value)}
                        placeholder="Raison de la decision..."
                        disabled={!selectedPending}
                        style={{
                          width: "100%",
                          height: 40,
                          borderRadius: 12,
                          border: "1px solid rgba(51,65,85,0.92)",
                          background: "rgba(2,6,23,0.55)",
                          color: "#e2e8f0",
                          padding: "0 12px",
                          opacity: selectedPending ? 1 : 0.7,
                        }}
                      />
                    </div>

                    {selectedPending ? (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                        <ActionButton
                          label={savingDecision ? "En cours..." : "Approuver"}
                          background="rgba(16,185,129,0.9)"
                          color="#ecfdf5"
                          disabled={savingDecision}
                          onClick={() => void decide("APPROVE")}
                        />
                        <ActionButton
                          label="Modifier"
                          background="rgba(14,165,233,0.9)"
                          color="#eff6ff"
                          disabled={savingDecision || !modifiedCmd.trim()}
                          onClick={() => void decide("MODIFY")}
                        />
                        <ActionButton
                          label="Rejeter"
                          background="rgba(239,68,68,0.92)"
                          color="#fff1f2"
                          disabled={savingDecision}
                          onClick={() => void decide("REJECT")}
                        />
                      </div>
                    ) : (
                      <EmptyState title="Aucune decision en cours" hint="Choisissez une suggestion a gauche pour approuver, modifier ou rejeter." />
                    )}

                    {selected && (
                      <button
                        type="button"
                        onClick={() => setSelectedId(null)}
                        style={{
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          color: "#94a3b8",
                          fontSize: 14,
                          textAlign: "left",
                          cursor: "pointer",
                        }}
                      >
                        Annuler la selection
                      </button>
                    )}
                  </div>
                ) : (
                  <EmptyState title="Aucune decision en cours" hint="Choisissez une suggestion a gauche pour approuver, modifier ou rejeter." />
                )}
              </CardContent>
            </Card>
          </ResponsiveGrid>

          <Card>
            <CardHeader>
              <CardTitle>
                <span style={{ color: "#a5b4fc", marginRight: 8 }}>#</span>
                Cycle correctif
                {lifecycleSource && <InlineCount>{lifecycleSource.suggestion_id}</InlineCount>}
              </CardTitle>
              {/* FIX 3 — CardDescription uses mutedText-level color internally; already legible */}
              <CardDescription>Suivi des étapes de détection à l'apprentissage.</CardDescription>
            </CardHeader>
            <CardContent>
              {lifecycleSource ? (
                <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
                  {lifecycleSteps.map((step, index) => (
                    <LifecycleStep key={step.key} step={step} index={index} total={lifecycleSteps.length} />
                  ))}
                </div>
              ) : (
                <div style={{ color: "#94a3b8", fontSize: 16 }}>Aucun cycle a afficher.</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <span style={{ color: "#94a3b8", marginRight: 8 }}>H</span>
                Historique recent
                <InlineCount>{completed.length}</InlineCount>
              </CardTitle>
            </CardHeader>
            <div style={{ padding: 0 }}>
              {completed.length === 0 ? (
                <div style={{ padding: 24 }}>
                  <EmptyState title="Pas encore d'historique" hint="Les decisions traitees resteront visibles ici." />
                </div>
              ) : (
                completed.slice(0, 12).map((suggestion) => (
                  <HistoryRow key={suggestion.suggestion_id} suggestion={suggestion} />
                ))
              )}
            </div>
          </Card>

          {/* FIX 3 — footer muted text now uses #cbd5e1 (clearly visible on dark bg) */}
        </div>
      </div>
    </div>
  );
};

const ResponsiveGrid: FC<{ columns: string; children: ReactNode }> = ({ columns, children }) => (
  <div
    style={{
      display: "grid",
      gap: 16,
      gridTemplateColumns: columns,
    }}
  >
    {children}
  </div>
);

const Card: FC<{ children: ReactNode }> = ({ children }) => <section style={cardStyle}>{children}</section>;

const CardHeader: FC<{ children: ReactNode; compact?: boolean; row?: boolean }> = ({ children, compact, row }) => (
  <div
    style={{
      padding: compact ? "16px 20px 12px" : "20px 20px 12px",
      display: "flex",
      flexDirection: row ? "row" : "column",
      alignItems: row ? "center" : "stretch",
      justifyContent: row ? "space-between" : "flex-start",
      gap: 8,
    }}
  >
    {children}
  </div>
);

const CardTitle: FC<{ children: ReactNode }> = ({ children }) => (
  <div style={{ color: "#e2e8f0", fontSize: 16, fontWeight: 600 }}>{children}</div>
);

// FIX 3 — CardDescription color brightened from #94a3b8 to #a8bdd1 so it
// reads clearly against the dark card background without competing with titles.
const CardDescription: FC<{ children: ReactNode }> = ({ children }) => (
  <div style={{ color: "#a8bdd1", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em" }}>{children}</div>
);

const CardContent: FC<{ children: ReactNode }> = ({ children }) => <div style={{ padding: "0 20px 20px" }}>{children}</div>;

const InlineCount: FC<{ children: ReactNode }> = ({ children }) => (
  <span
    style={{
      marginLeft: 8,
      display: "inline-flex",
      alignItems: "center",
      padding: "2px 8px",
      borderRadius: 999,
      border: "1px solid rgba(51,65,85,0.92)",
      background: "rgba(15,23,42,0.62)",
      color: "#cbd5e1",
      fontSize: 13,
      fontWeight: 600,
    }}
  >
    {children}
  </span>
);

const Badge: FC<{ label: string; prefix?: ReactNode; tone: "ok" | "warn" | "neutral" }> = ({ label, prefix, tone }) => {
  const color = tone === "ok" ? "#86efac" : tone === "warn" ? "#fcd34d" : "#cbd5e1";
  const border = tone === "ok" ? "rgba(16,185,129,0.28)" : tone === "warn" ? "rgba(245,158,11,0.28)" : "rgba(51,65,85,0.92)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 10px",
        borderRadius: 999,
        border: `1px solid ${border}`,
        background: "rgba(15,23,42,0.62)",
        color,
        fontSize: 14,
        fontWeight: 600,
      }}
    >
      {prefix}
      {label}
    </span>
  );
};

const LiveDot: FC<{ active: boolean }> = ({ active }) => (
  <span
    style={{
      width: 8,
      height: 8,
      borderRadius: "50%",
      background: active ? "#10b981" : "#f59e0b",
      boxShadow: active ? "0 0 0 5px rgba(16,185,129,0.08)" : "0 0 0 5px rgba(245,158,11,0.08)",
      display: "inline-block",
    }}
  />
);

const GlyphPill: FC<{ glyph: string; color: string }> = ({ glyph, color }) => (
  <span
    style={{
      width: 18,
      height: 18,
      borderRadius: "50%",
      display: "inline-grid",
      placeItems: "center",
      fontSize: 12,
      fontWeight: 700,
      background: "rgba(15,23,42,0.72)",
      border: "1px solid rgba(51,65,85,0.92)",
      color,
      flexShrink: 0,
    }}
  >
    {glyph}
  </span>
);

const KpiCard: FC<{
  label: string;
  value: string | number;
  tint: string;
}> = ({ label, value, tint }) => (
  <Card>
    <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: "#7dd3fc" }}>
          {label}
        </div>
      </div>
      <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em", color: tint, lineHeight: 1, textAlign: "right" }}>
        {value}
      </div>
    </div>
  </Card>
);

const ScrollArea: FC<{ children: ReactNode; height: number }> = ({ children, height }) => (
  <div style={{ maxHeight: height, overflowY: "auto" }}>{children}</div>
);

const ActionButton: FC<{
  label: string;
  background: string;
  color: string;
  disabled?: boolean;
  onClick: () => void;
}> = ({ label, background, color, disabled, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    style={{
      border: "none",
      borderRadius: 12,
      height: 42,
      background,
      color,
      fontWeight: 700,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.55 : 1,
    }}
  >
    {label}
  </button>
);

const SuggestionRow: FC<{
  suggestion: CorrectiveSuggestion;
  active: boolean;
  onClick: () => void;
}> = ({ suggestion, active, onClick }) => {
  const sev = severityTone(suggestion.severity);
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 16,
        width: "100%",
        textAlign: "left",
        borderRadius: 16,
        border: active ? "1px solid rgba(99,102,241,0.58)" : "1px solid rgba(51,65,85,0.92)",
        background: active ? "rgba(15,23,42,0.82)" : "rgba(2,6,23,0.42)",
        padding: 16,
        cursor: "pointer",
        boxShadow: active ? "0 0 0 1px rgba(99,102,241,0.22) inset" : "none",
      }}
    >
      <div
        style={{
          minWidth: 76,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 12,
          background: "rgba(15,23,42,0.82)",
          border: "1px solid rgba(51,65,85,0.92)",
          padding: "10px 8px",
        }}
      >
        <span style={{ fontSize: 24, fontWeight: 600, color: confidenceColor(suggestion.confidence) }}>
          {formatPercent(suggestion.confidence)}
        </span>
        <span style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "#64748b" }}>Conf.</span>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 8px",
              borderRadius: 999,
              border: `1px solid ${sev.border}`,
              background: sev.background,
              color: sev.color,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            !
            {normalizeSeverity(suggestion.severity)}
          </span>
          <span style={{ fontSize: 16, fontWeight: 600, color: "#f8fafc" }}>{suggestion.action_type}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "#64748b" }}>{suggestion.ip}</span>
        </div>
        <div style={{ marginTop: 6, fontSize: 14, lineHeight: 1.6, color: "#94a3b8" }}>{suggestion.description}</div>
        {suggestion.command && (
          <div
            title={suggestion.command}
            style={{
              marginTop: 10,
              display: "flex",
              alignItems: "center",
              gap: 8,
              overflow: "hidden",
              borderRadius: 10,
              border: "1px solid rgba(6,95,70,0.42)",
              background: "rgba(6,78,59,0.22)",
              padding: "7px 10px",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              color: "#6ee7b7",
            }}
          >
            <span>{">_"}</span>
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{suggestion.command}</span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "space-between", fontSize: 13, color: "#64748b" }}>
        <span>{formatClock(suggestion.timestamp)}</span>
        <span style={{ color: active ? "#a5b4fc" : "#475569" }}>{">"}</span>
      </div>
    </button>
  );
};

// FIX 2 — LifecycleStep: detail text is now short, plain French (set in buildSteps).
// The "Etape N" label above the step title was also removed — it was redundant
// since the visual connector already conveys ordering.
const LifecycleStep: FC<{ step: TraceStep; index: number; total: number }> = ({ step, index, total }) => {
  const tone =
    step.state === "done"
      ? { border: "rgba(16,185,129,0.4)", background: "rgba(16,185,129,0.1)", color: "#86efac", glyph: "V" }
      : step.state === "active"
        ? { border: "rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.1)", color: "#fcd34d", glyph: "O" }
        : step.state === "skipped"
          ? { border: "rgba(51,65,85,0.92)", background: "rgba(30,41,59,0.62)", color: "#64748b", glyph: "X" }
          : { border: "rgba(51,65,85,0.92)", background: "rgba(30,41,59,0.42)", color: "#94a3b8", glyph: "C" };

  return (
    <div style={{ position: "relative" }}>
      {index < total - 1 && (
        <div
          style={{
            position: "absolute",
            left: 36,
            top: 16,
            width: "calc(100% - 32px)",
            height: 1,
            background: tone.background,
          }}
        />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            position: "relative",
            zIndex: 1,
            width: 32,
            height: 32,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            border: `1px solid ${tone.border}`,
            background: tone.background,
            color: tone.color,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {tone.glyph}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#f8fafc" }}>{step.label}</div>
        </div>
      </div>
    </div>
  );
};

const HistoryRow: FC<{ suggestion: CorrectiveSuggestion }> = ({ suggestion }) => {
  const tone = statusTone(suggestion.status);
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 16,
        padding: "14px 20px",
        borderTop: "1px solid rgba(51,65,85,0.92)",
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          display: "grid",
          placeItems: "center",
          border: `1px solid ${tone.border}`,
          background: tone.background,
          color: tone.color,
          fontWeight: 700,
        }}
      >
        {suggestion.status === "APPROVED" ? "V" : suggestion.status === "REJECTED" ? "X" : suggestion.status === "MODIFIED" ? "~" : "C"}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 16 }}>
          <span style={{ fontWeight: 600, color: "#f8fafc" }}>{suggestion.action_type}</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "3px 8px",
              borderRadius: 999,
              border: `1px solid ${tone.border}`,
              background: tone.background,
              color: tone.color,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {statusLabel(suggestion.status)}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "#64748b" }}>{suggestion.ip}</span>
        </div>
        <div style={{ marginTop: 4, fontSize: 14, color: "#94a3b8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {suggestion.description}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", fontSize: 14 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: confidenceColor(suggestion.confidence) }}>
          {formatPercent(suggestion.confidence)}
        </span>
        <span style={{ color: "#64748b" }}>{formatRelative(suggestion.timestamp)}</span>
      </div>
    </div>
  );
};

const EmptyState: FC<{ title: string; hint: string }> = ({ title, hint }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderRadius: 16,
      border: "1px dashed rgba(51,65,85,0.92)",
      background: "rgba(2,6,23,0.42)",
      padding: 32,
      textAlign: "center",
    }}
  >
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        background: "rgba(30,41,59,0.65)",
        color: "#94a3b8",
        fontWeight: 700,
      }}
    >
      O
    </div>
    <div style={{ fontSize: 16, fontWeight: 600, color: "#e2e8f0" }}>{title}</div>
    <div style={{ maxWidth: 320, fontSize: 14, color: "#64748b", lineHeight: 1.6 }}>{hint}</div>
  </div>
);

export default CorrectiveAgentPanel;
