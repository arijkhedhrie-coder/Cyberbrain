// Panneau agent correcteur semi-automatique.
//
// ÉTAPE 6 — suggestions reçues en prop depuis le hook (useIdpsDashboard)
// au lieu d'être fetchées localement.
//
// Ce composant garde son propre fetch uniquement pour :
//   - agentMode  (mode + phase description)
//   - stats      (totaux approuvés/rejetés)
//   - validate() (POST /api/corrective/validate)
//   - changeMode() (POST /api/corrective/mode)
//
// Les suggestions (liste) viennent du hook parent via prop → plus de polling
// redondant, état centralisé dans useIdpsDashboard.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from "react";
import type { FC } from "react";
import type { CorrectiveSuggestion } from "../../../shared/types/idps";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

// ── Types locaux ──────────────────────────────────────────────────────────────

interface AgentMode {
  mode:                 string;
  confidence_threshold: number;
  phase_description:    string;
  pending_count:        number;
}

interface SessionStats {
  total:          number;
  pending:        number;
  approved:       number;
  rejected:       number;
  modified:       number;
  avg_confidence: number;
}

interface Stats extends SessionStats {
  session: SessionStats;
  memory?: Record<string, unknown>;
}

const normalizeStats = (stats: Stats): Stats => ({
  ...stats,
  ...stats.session,
});

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  suggestions:  CorrectiveSuggestion[];   // ← vient du hook useIdpsDashboard
  wsConnected:  boolean;
}

// ── Utilitaires UI ────────────────────────────────────────────────────────────

const PHASE_COLORS: Record<string, { bg: string; border: string; badge: string }> = {
  TRAINING:   { bg: "#0d1f2d", border: "#1e4d6b", badge: "#1a6fa8" },
  SUGGESTION: { bg: "#1a1a0d", border: "#4d4a1e", badge: "#8a7a1a" },
  AUTO:       { bg: "#0d1f0d", border: "#1e4d1e", badge: "#2a8a2a" },
};

const PHASE_ICONS: Record<string, string> = {
  TRAINING:   "🧠",
  SUGGESTION: "💡",
  AUTO:       "⚡",
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

// ── Composant ─────────────────────────────────────────────────────────────────

export const CorrectiveAgentPanel: FC<Props> = ({ suggestions, wsConnected }) => {
  const [agentMode,    setAgentMode]    = useState<AgentMode | null>(null);
  const [stats,        setStats]        = useState<Stats | null>(null);
  const [selected,     setSelected]     = useState<CorrectiveSuggestion | null>(null);
  const [modifiedCmd,  setModifiedCmd]  = useState("");
  const [adminNote,    setAdminNote]    = useState("");
  const [loading,      setLoading]      = useState(false);
  const [feedback,     setFeedback]     = useState<string | null>(null);
  const [newMode,      setNewMode]      = useState("");
  const [newThreshold, setNewThreshold] = useState("");

  // ⬇️ ÉTATS LOCAUX POUR MISE À JOUR INSTANTANÉE
  const [localSuggestions, setLocalSuggestions] = useState<CorrectiveSuggestion[]>(suggestions);
  const [localStats, setLocalStats] = useState<Stats | null>(null);

  // Synchronisation avec la prop suggestions (polling parent)
  useEffect(() => {
    setLocalSuggestions(suggestions);
  }, [suggestions]);

  // Synchronisation avec stats venant du fetchMeta
  useEffect(() => {
    if (stats) setLocalStats(stats);
  }, [stats]);

  const token   = localStorage.getItem("access_token") || localStorage.getItem("token") || "";
  const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${token}` };

  // ── Fetch mode + stats uniquement (pas les suggestions — elles viennent du hook) ──
  const fetchMeta = useCallback(async () => {
    try {
      const [modeRes, statRes] = await Promise.all([
        fetch(`${API_BASE}/api/corrective/mode`,  { headers }),
        fetch(`${API_BASE}/api/corrective/stats`, { headers }),
      ]);
      if (modeRes.ok) {
        const modeData = await modeRes.json();
        setAgentMode(modeData);
        console.log("[CorrectiveAgentPanel] agentMode fetched:", modeData);
      }
      if (statRes.ok) {
        const statData = await statRes.json();
        const normalizedStats = normalizeStats(statData);
        setStats(normalizedStats);
        console.log("[CorrectiveAgentPanel] stats fetched:", normalizedStats);
      }
    } catch (err) {
      console.error("[CorrectiveAgentPanel] fetch error:", err);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchMeta();
    const id = setInterval(fetchMeta, 15_000);
    return () => clearInterval(id);
  }, [fetchMeta]);

  // ── Validation ────────────────────────────────────────────────────────────
  const validate = async (decision: "APPROVE" | "REJECT" | "MODIFY") => {
    if (!selected) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/corrective/validate`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          suggestion_id:    selected.suggestion_id,
          decision,
          modified_command: decision === "MODIFY" ? modifiedCmd : undefined,
          admin_note:       adminNote || undefined,
        }),
      });
      const data = await res.json();
      setFeedback(`${data.status} — ${data.message}`);
      
      // ⬇️ MISE À JOUR IMMÉDIATE DE L'INTERFACE
      // 1. Supprimer la suggestion de la liste locale
      setLocalSuggestions(prev => prev.filter(s => s.suggestion_id !== selected.suggestion_id));
      // 2. Mettre à jour les stats locales
      setLocalStats(prev => {
        if (!prev) return prev;
        const delta = {
          APPROVE: { approved: 1, pending: -1, rejected: 0, modified: 0 },
          REJECT:  { approved: 0, pending: -1, rejected: 1, modified: 0 },
          MODIFY:  { approved: 0, pending: -1, rejected: 0, modified: 1 },
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
            // avg_confidence: on ne recalcule pas ici, le polling le fera
          },
        };
      });
      
      setSelected(null);
      setModifiedCmd("");
      setAdminNote("");
      // Refresh meta (stats) après validation (en arrière-plan)
      fetchMeta();
    } catch {
      setFeedback("Erreur réseau — vérifiez le backend.");
    } finally {
      setLoading(false);
      setTimeout(() => setFeedback(null), 5000);
    }
  };

  // ── Changement de mode ────────────────────────────────────────────────────
  const changeMode = async () => {
    if (!newMode) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/corrective/mode`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          new_mode:      newMode,
          new_threshold: newThreshold ? parseFloat(newThreshold) : undefined,
        }),
      });
      const data = await res.json();
      setFeedback(`Mode changé → ${data.new_mode}`);
      fetchMeta();
    } catch {
      setFeedback("Erreur changement de mode.");
    } finally {
      setLoading(false);
      setTimeout(() => setFeedback(null), 5000);
    }
  };

  // ── Données dérivées (utilise les états locaux) ────────────────────────────
  const pending = localSuggestions.filter(s => s.status === "PENDING");
  const colors  = PHASE_COLORS[agentMode?.mode ?? "SUGGESTION"];
  const modeKey = agentMode?.mode ?? "SUGGESTION";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      background: "#0a0e1a",
      color: "#c9d1e0",
      padding: "20px",
      borderRadius: 10,
      border: "1px solid rgba(255,255,255,0.07)",
    }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div style={{
          width: 9, height: 9, borderRadius: "50%",
          background: modeKey === "AUTO" ? "#22c55e" : modeKey === "SUGGESTION" ? "#f59e0b" : "#3b82f6",
          boxShadow: `0 0 8px ${modeKey === "AUTO" ? "#22c55e" : "#f59e0b"}`,
          animation: "pulse 2s infinite",
          flexShrink: 0,
        }} />
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 2, color: "#e2e8f0" }}>
          CORRECTIVE AGENT
        </span>

        {/* Badge WS */}
        <span style={{
          fontSize: 9, padding: "2px 7px", borderRadius: 20, fontWeight: 600,
          display: "flex", alignItems: "center", gap: 4,
          background: wsConnected ? "rgba(29,158,117,0.1)" : "rgba(226,75,74,0.1)",
          color:      wsConnected ? "#1D9E75" : "#E24B4A",
          border:     `1px solid ${wsConnected ? "rgba(29,158,117,0.25)" : "rgba(226,75,74,0.25)"}`,
        }}>
          <span style={{
            width: 5, height: 5, borderRadius: "50%",
            background: wsConnected ? "#1D9E75" : "#E24B4A",
            animation: wsConnected ? "ws-pulse 2s infinite" : "none",
          }} />
          {wsConnected ? "WS actif" : "WS hors ligne"}
        </span>

        <span style={{
          marginLeft: "auto",
          padding: "3px 10px",
          borderRadius: 4,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 1.5,
          background: colors?.badge ?? "#1a6fa8",
          color: "#fff",
        }}>
          {PHASE_ICONS[modeKey]} {modeKey}
        </span>
      </div>

      {/* ── Feedback banner ── */}
      {feedback && (
        <div style={{
          padding: "10px 16px", borderRadius: 6, marginBottom: 14,
          background: feedback.includes("EXECUTED") || feedback.includes("changé")
            ? "#14532d" : "#450a0a",
          border: `1px solid ${feedback.includes("EXECUTED") || feedback.includes("changé")
            ? "#22c55e" : "#ef4444"}`,
          fontSize: 12,
          color: "#e2e8f0",
        }}>
          {feedback}
        </div>
      )}

      {/* ── Phase active ── */}
      {agentMode && (
        <div style={{
          padding: "14px 18px", borderRadius: 8, marginBottom: 16,
          background: colors?.bg ?? "#0d1f2d",
          border: `1px solid ${colors?.border ?? "#1e4d6b"}`,
        }}>
          <div style={{ fontSize: 10, color: "#64748b", letterSpacing: 1.5, marginBottom: 6 }}>
            PHASE ACTIVE
          </div>
          <div style={{ fontSize: 12, color: "#e2e8f0", marginBottom: 10 }}>
            {agentMode.phase_description}
          </div>
          <div style={{ display: "flex", gap: 20, fontSize: 11, color: "#94a3b8" }}>
            <span>
              Seuil AUTO :{" "}
              <strong style={{ color: "#e2e8f0" }}>
                {(agentMode.confidence_threshold * 100).toFixed(0)}%
              </strong>
            </span>
            <span>
              En attente :{" "}
              <strong style={{ color: pending.length > 0 ? "#f59e0b" : "#22c55e" }}>
                {pending.length}
              </strong>
            </span>
          </div>
        </div>
      )}

      {/* ── Stats bar (utilise localStats) ── */}
      {localStats && (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 16,
        }}>
          {([
            { label: "TOTAL", value: localStats.session.total, color: "#64748b" },
            { label: "EN ATTENTE", value: localStats.session.pending, color: "#f59e0b" },
            { label: "APPROUVÉS", value: localStats.session.approved, color: "#22c55e" },
            { label: "REJETÉS", value: localStats.session.rejected, color: "#ef4444" },
            {
              label: "CONF. MOY.",
              value: `${((isFinite(localStats.session.avg_confidence) ? localStats.session.avg_confidence : 0) * 100).toFixed(0)}%`,
              color: CONFIDENCE_COLOR(isFinite(localStats.session.avg_confidence) ? localStats.session.avg_confidence : 0),
            },
          ] as { label: string; value: string | number; color: string }[]).map(({ label, value, color }) => (
            <div key={label} style={{
              padding: "10px 8px", borderRadius: 6,
              background: "#0f1623", border: "1px solid #1e293b",
              textAlign: "center",
            }}>
              <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
              <div style={{ fontSize: 8, letterSpacing: 1.5, color: "#475569", marginTop: 3 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Changer le mode ── */}
      <div style={{
        padding: "14px 18px", borderRadius: 8, marginBottom: 16,
        background: "#0f1623", border: "1px solid #1e293b",
      }}>
        <div style={{ fontSize: 10, color: "#64748b", letterSpacing: 1.5, marginBottom: 10 }}>
          CHANGER LE MODE
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {(["TRAINING", "SUGGESTION", "AUTO"] as const).map(m => (
            <button
              key={m}
              onClick={() => setNewMode(m)}
              style={{
                padding: "5px 12px", borderRadius: 4, cursor: "pointer", fontSize: 11,
                fontFamily: "inherit", fontWeight: 700, letterSpacing: 1,
                background: newMode === m ? PHASE_COLORS[m].badge : "#1e293b",
                color:      newMode === m ? "#fff" : "#64748b",
                border:     `1px solid ${newMode === m ? PHASE_COLORS[m].badge : "#334155"}`,
                transition: "all .15s",
              }}
            >
              {PHASE_ICONS[m]} {m}
            </button>
          ))}
          <input
            placeholder="Seuil (ex: 0.85)"
            value={newThreshold}
            onChange={e => setNewThreshold(e.target.value)}
            style={{
              padding: "5px 10px", borderRadius: 4, background: "#1e293b",
              border: "1px solid #334155", color: "#e2e8f0", fontSize: 11,
              fontFamily: "inherit", outline: "none", width: 130,
            }}
          />
          <button
            onClick={changeMode}
            disabled={!newMode || loading}
            style={{
              padding: "5px 14px", borderRadius: 4, cursor: newMode ? "pointer" : "default",
              background: newMode ? "#2563eb" : "#1e293b",
              color: newMode ? "#fff" : "#475569",
              border: "none", fontSize: 11, fontFamily: "inherit", fontWeight: 700,
            }}
          >
            Appliquer
          </button>
        </div>
      </div>

      {/* ── Liste suggestions PENDING (utilise localSuggestions) ── */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: "#64748b", letterSpacing: 1.5, marginBottom: 10 }}>
          SUGGESTIONS EN ATTENTE ({pending.length})
        </div>

        {pending.length === 0 ? (
          <div style={{
            padding: "24px", textAlign: "center", color: "#475569", fontSize: 12,
            background: "#0f1623", borderRadius: 8, border: "1px solid #1e293b",
          }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>✅</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 6 }}>
              Aucune suggestion en attente
            </div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>
              {agentMode?.mode === "AUTO" 
                ? "Le mode AUTO traite les alarmes automatiquement — vérifiez les statistiques pour les actions exécutées."
                : agentMode?.mode === "TRAINING"
                ? "Agent en mode TRAINING — il collecte des exemples pour améliorer ses décisions."
                : "Prêt à recevoir des suggestions du système. Les alarmes critiques déclencheront des suggestions."}
            </div>
            {localStats && localStats.session.approved > 0 && (
              <div style={{
                fontSize: 10, padding: "8px 12px", borderRadius: 6,
                background: "rgba(29,158,117,0.1)", color: "#1D9E75",
                fontFamily: "monospace", marginTop: 8, display: "inline-block",
                border: "1px solid rgba(29,158,117,0.2)",
              }}>
                📊 {localStats.approved} suggestion{localStats.approved > 1 ? "s" : ""} approuvée{localStats.approved > 1 ? "s" : ""} • {localStats.rejected} rejetée{localStats.rejected > 1 ? "s" : ""}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {pending.map(sug => (
              <div
                key={sug.suggestion_id}
                onClick={() => {
                  setSelected(sug);
                  setModifiedCmd(sug.command ?? "");
                }}
                style={{
                  padding: "12px 16px", borderRadius: 8, cursor: "pointer",
                  background: selected?.suggestion_id === sug.suggestion_id ? "#1e293b" : "#0f1623",
                  border: `1px solid ${selected?.suggestion_id === sug.suggestion_id
                    ? "#3b82f6" : "#1e293b"}`,
                  transition: "all .15s",
                  display: "flex", alignItems: "flex-start", gap: 14,
                }}
              >
                {/* Confidence */}
                <div style={{ width: 38, textAlign: "center", flexShrink: 0 }}>
                  <div style={{
                    fontSize: 14, fontWeight: 700,
                    color: CONFIDENCE_COLOR(sug.confidence),
                  }}>
                    {(sug.confidence * 100).toFixed(0)}%
                  </div>
                  <div style={{ fontSize: 8, color: "#475569", letterSpacing: 1 }}>CONF.</div>
                </div>

                {/* Corps */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: 9, padding: "2px 6px", borderRadius: 3,
                      background: `${SEVERITY_COLOR(sug.severity)}22`,
                      color:      SEVERITY_COLOR(sug.severity),
                      border:     `1px solid ${SEVERITY_COLOR(sug.severity)}44`,
                      fontWeight: 700, letterSpacing: .5,
                    }}>
                      {sug.severity}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>
                      {sug.action_type}
                    </span>
                    <span style={{ fontSize: 10, color: "#64748b" }}>
                      IP: {sug.ip}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>
                    {sug.description}
                  </div>
                  {sug.command && (
                    <div style={{
                      fontSize: 10, color: "#60a5fa",
                      fontFamily: "monospace", background: "#0a0e1a",
                      padding: "3px 8px", borderRadius: 3, display: "inline-block",
                      maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      $ {sug.command}
                    </div>
                  )}
                </div>

                {/* Timestamp */}
                <div style={{ fontSize: 9, color: "#475569", whiteSpace: "nowrap", flexShrink: 0 }}>
                  {new Date(sug.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Panneau de validation ── */}
      {selected && (
        <div style={{
          padding: "18px", borderRadius: 8,
          background: "#0d1f0d", border: "1px solid #1e4d1e",
        }}>
          <div style={{ fontSize: 10, color: "#64748b", letterSpacing: 1.5, marginBottom: 12 }}>
            VALIDATION — <span style={{ color: "#94a3b8" }}>{selected.suggestion_id}</span>
          </div>

          {/* Commande modifiable */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: "#64748b", marginBottom: 5 }}>
              COMMANDE (modifiable) :
            </div>
            <input
              value={modifiedCmd}
              onChange={e => setModifiedCmd(e.target.value)}
              style={{
                width: "100%", padding: "7px 10px", borderRadius: 4,
                background: "#0f2010", border: "1px solid #1e4d1e",
                color: "#86efac", fontSize: 12, fontFamily: "monospace",
                outline: "none", boxSizing: "border-box",
              }}
            />
          </div>

          {/* Note admin */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: "#64748b", marginBottom: 5 }}>
              NOTE ADMIN (optionnel) :
            </div>
            <input
              value={adminNote}
              onChange={e => setAdminNote(e.target.value)}
              placeholder="Raison de la décision..."
              style={{
                width: "100%", padding: "7px 10px", borderRadius: 4,
                background: "#1e293b", border: "1px solid #334155",
                color: "#e2e8f0", fontSize: 11, fontFamily: "inherit",
                outline: "none", boxSizing: "border-box",
              }}
            />
          </div>

          {/* Boutons */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => validate("APPROVE")}
              disabled={loading}
              style={{
                flex: 1, padding: "9px", borderRadius: 4, cursor: "pointer",
                background: "#166534", border: "1px solid #22c55e",
                color: "#86efac", fontSize: 12, fontFamily: "inherit", fontWeight: 700,
              }}
            >
              ✅ APPROUVER
            </button>
            <button
              onClick={() => validate("MODIFY")}
              disabled={loading || !modifiedCmd}
              style={{
                flex: 1, padding: "9px", borderRadius: 4,
                cursor: loading || !modifiedCmd ? "default" : "pointer",
                background: "#1e3a5f", border: "1px solid #3b82f6",
                color: "#93c5fd", fontSize: 12, fontFamily: "inherit", fontWeight: 700,
                opacity: !modifiedCmd ? 0.5 : 1,
              }}
            >
              ✏️ MODIFIER & EXÉ.
            </button>
            <button
              onClick={() => validate("REJECT")}
              disabled={loading}
              style={{
                flex: 1, padding: "9px", borderRadius: 4, cursor: "pointer",
                background: "#450a0a", border: "1px solid #ef4444",
                color: "#fca5a5", fontSize: 12, fontFamily: "inherit", fontWeight: 700,
              }}
            >
              ❌ REJETER
            </button>
            <button
              onClick={() => setSelected(null)}
              style={{
                padding: "9px 14px", borderRadius: 4, cursor: "pointer",
                background: "#1e293b", border: "1px solid #334155",
                color: "#64748b", fontSize: 12, fontFamily: "inherit",
              }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.35; }
        }
        @keyframes ws-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.35; }
        }
      `}</style>
    </div>
  );
};
export default CorrectiveAgentPanel;
