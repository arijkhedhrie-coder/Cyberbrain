// CorrectiveAgentPanel.tsx
// Panneau dashboard pour l'agent correcteur semi-automatique
// À intégrer dans ton dashboard existant

import { useState, useEffect, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Suggestion {
  suggestion_id: string;
  anomaly_type:  string;
  ip:            string;
  severity:      string;
  action_type:   string;
  command:       string;
  description:   string;
  confidence:    number;
  mode:          string;
  timestamp:     string;
  status:        string;
}

interface AgentMode {
  mode:                 string;
  confidence_threshold: number;
  phase_description:    string;
  pending_count:        number;
}

interface Stats {
  total:          number;
  pending:        number;
  approved:       number;
  rejected:       number;
  modified:       number;
  avg_confidence: number;
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

const CONFIDENCE_COLOR = (c: number) => {
  if (c >= 0.85) return "#22c55e";
  if (c >= 0.65) return "#f59e0b";
  return "#ef4444";
};

const SEVERITY_COLOR = (s: string) => {
  if (s === "CRITICAL" || s === "CRITIQUE") return "#ef4444";
  if (s === "HIGH")     return "#f97316";
  return "#f59e0b";
};

// ── Composant principal ───────────────────────────────────────────────────────

export default function CorrectiveAgentPanel() {
  const [agentMode,    setAgentMode]    = useState<AgentMode | null>(null);
  const [suggestions,  setSuggestions]  = useState<Suggestion[]>([]);
  const [stats,        setStats]        = useState<Stats | null>(null);
  const [selected,     setSelected]     = useState<Suggestion | null>(null);
  const [modifiedCmd,  setModifiedCmd]  = useState("");
  const [adminNote,    setAdminNote]    = useState("");
  const [loading,      setLoading]      = useState(false);
  const [feedback,     setFeedback]     = useState<string | null>(null);
  const [newMode,      setNewMode]      = useState("");
  const [newThreshold, setNewThreshold] = useState("");

  const token = localStorage.getItem("access_token") || "";
  const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${token}` };

  // ── Fetch data ──────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    try {
      const [modeRes, sugRes, statRes] = await Promise.all([
        fetch(`${API_BASE}/api/corrective/mode`,        { headers }),
        fetch(`${API_BASE}/api/corrective/suggestions`, { headers }),
        fetch(`${API_BASE}/api/corrective/stats`,       { headers }),
      ]);
      if (modeRes.ok)  setAgentMode(await modeRes.json());
      if (sugRes.ok)   setSuggestions((await sugRes.json()).suggestions || []);
      if (statRes.ok)  setStats(await statRes.json());
    } catch { /* backend absent */ }
  }, []);

  useEffect(() => { fetchAll(); const id = setInterval(fetchAll, 8000); return () => clearInterval(id); }, [fetchAll]);

  // ── Actions ──────────────────────────────────────────────────────────────────
  const validate = async (decision: "APPROVE" | "REJECT" | "MODIFY") => {
    if (!selected) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/corrective/validate`, {
        method: "POST", headers,
        body: JSON.stringify({
          suggestion_id:    selected.suggestion_id,
          decision,
          modified_command: decision === "MODIFY" ? modifiedCmd : undefined,
          admin_note:       adminNote || undefined,
        }),
      });
      const data = await res.json();
      setFeedback(`${data.status} — ${data.message}`);
      setSelected(null);
      setModifiedCmd("");
      setAdminNote("");
      fetchAll();
    } catch (e) {
      setFeedback("Erreur réseau — vérifiez le backend.");
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
        method: "POST", headers,
        body: JSON.stringify({
          new_mode:      newMode,
          new_threshold: newThreshold ? parseFloat(newThreshold) : undefined,
        }),
      });
      const data = await res.json();
      setFeedback(`Mode changé → ${data.new_mode}`);
      fetchAll();
    } catch { setFeedback("Erreur changement de mode."); }
    finally { setLoading(false); setTimeout(() => setFeedback(null), 5000); }
  };

  const pending = suggestions.filter(s => s.status === "PENDING");
  const colors  = PHASE_COLORS[agentMode?.mode || "SUGGESTION"];

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      background: "#0a0e1a",
      color: "#c9d1e0",
      minHeight: "100vh",
      padding: "24px",
    }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <div style={{
          width: 10, height: 10, borderRadius: "50%",
          background: agentMode?.mode === "AUTO" ? "#22c55e" : agentMode?.mode === "SUGGESTION" ? "#f59e0b" : "#3b82f6",
          boxShadow: `0 0 8px ${agentMode?.mode === "AUTO" ? "#22c55e" : "#f59e0b"}`,
          animation: "pulse 2s infinite",
        }} />
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: 2, color: "#e2e8f0" }}>
          CORRECTIVE AGENT
        </h1>
        <span style={{
          marginLeft: "auto",
          padding: "3px 10px",
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 1.5,
          background: colors?.badge || "#1a6fa8",
          color: "#fff",
        }}>
          {PHASE_ICONS[agentMode?.mode || "SUGGESTION"]} {agentMode?.mode || "—"}
        </span>
      </div>

      {/* Feedback banner */}
      {feedback && (
        <div style={{
          padding: "10px 16px", borderRadius: 6, marginBottom: 16,
          background: feedback.includes("EXECUTED") || feedback.includes("changé") ? "#14532d" : "#450a0a",
          border: `1px solid ${feedback.includes("EXECUTED") || feedback.includes("changé") ? "#22c55e" : "#ef4444"}`,
          fontSize: 13,
        }}>
          {feedback}
        </div>
      )}

      {/* Mode card */}
      {agentMode && (
        <div style={{
          padding: "16px 20px", borderRadius: 8, marginBottom: 20,
          background: colors?.bg || "#0d1f2d",
          border: `1px solid ${colors?.border || "#1e4d6b"}`,
        }}>
          <div style={{ fontSize: 11, color: "#64748b", letterSpacing: 1.5, marginBottom: 8 }}>PHASE ACTIVE</div>
          <div style={{ fontSize: 13, color: "#e2e8f0", marginBottom: 12 }}>{agentMode.phase_description}</div>
          <div style={{ display: "flex", gap: 24, fontSize: 12, color: "#94a3b8" }}>
            <span>Seuil confiance AUTO : <strong style={{ color: "#e2e8f0" }}>{(agentMode.confidence_threshold * 100).toFixed(0)}%</strong></span>
            <span>En attente : <strong style={{ color: pending.length > 0 ? "#f59e0b" : "#22c55e" }}>{agentMode.pending_count}</strong></span>
          </div>
        </div>
      )}

      {/* Stats bar */}
      {stats && (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 20,
        }}>
          {[
            { label: "TOTAL", value: stats.total, color: "#64748b" },
            { label: "EN ATTENTE", value: stats.pending, color: "#f59e0b" },
            { label: "APPROUVÉS", value: stats.approved, color: "#22c55e" },
            { label: "REJETÉS", value: stats.rejected, color: "#ef4444" },
            { label: "CONFIANCE MOY.", value: `${(stats.avg_confidence * 100).toFixed(0)}%`, color: CONFIDENCE_COLOR(stats.avg_confidence) },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              padding: "12px", borderRadius: 6, background: "#0f1623", border: "1px solid #1e293b",
              textAlign: "center",
            }}>
              <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
              <div style={{ fontSize: 9, letterSpacing: 1.5, color: "#475569", marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Change mode section */}
      <div style={{
        padding: "16px 20px", borderRadius: 8, marginBottom: 20,
        background: "#0f1623", border: "1px solid #1e293b",
      }}>
        <div style={{ fontSize: 11, color: "#64748b", letterSpacing: 1.5, marginBottom: 12 }}>CHANGER LE MODE</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {["TRAINING", "SUGGESTION", "AUTO"].map(m => (
            <button
              key={m}
              onClick={() => setNewMode(m)}
              style={{
                padding: "6px 14px", borderRadius: 4, cursor: "pointer", fontSize: 12,
                fontFamily: "inherit", fontWeight: 700, letterSpacing: 1,
                background: newMode === m ? PHASE_COLORS[m].badge : "#1e293b",
                color: newMode === m ? "#fff" : "#64748b",
                border: `1px solid ${newMode === m ? PHASE_COLORS[m].badge : "#334155"}`,
                transition: "all .15s",
              }}
            >
              {PHASE_ICONS[m]} {m}
            </button>
          ))}
          <input
            placeholder="Seuil confiance (ex: 0.85)"
            value={newThreshold}
            onChange={e => setNewThreshold(e.target.value)}
            style={{
              padding: "6px 12px", borderRadius: 4, background: "#1e293b",
              border: "1px solid #334155", color: "#e2e8f0", fontSize: 12,
              fontFamily: "inherit", outline: "none", width: 180,
            }}
          />
          <button
            onClick={changeMode}
            disabled={!newMode || loading}
            style={{
              padding: "6px 18px", borderRadius: 4, cursor: "pointer",
              background: newMode ? "#2563eb" : "#1e293b",
              color: newMode ? "#fff" : "#475569",
              border: "none", fontSize: 12, fontFamily: "inherit", fontWeight: 700,
            }}
          >
            Appliquer
          </button>
        </div>
      </div>

      {/* Suggestions list */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: "#64748b", letterSpacing: 1.5, marginBottom: 12 }}>
          SUGGESTIONS EN ATTENTE ({pending.length})
        </div>
        {pending.length === 0 ? (
          <div style={{
            padding: 24, textAlign: "center", color: "#475569", fontSize: 13,
            background: "#0f1623", borderRadius: 8, border: "1px solid #1e293b",
          }}>
            ✅ Aucune suggestion en attente de validation.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pending.map(sug => (
              <div
                key={sug.suggestion_id}
                onClick={() => { setSelected(sug); setModifiedCmd(sug.command || ""); }}
                style={{
                  padding: "14px 18px", borderRadius: 8, cursor: "pointer",
                  background: selected?.suggestion_id === sug.suggestion_id ? "#1e293b" : "#0f1623",
                  border: `1px solid ${selected?.suggestion_id === sug.suggestion_id ? "#3b82f6" : "#1e293b"}`,
                  transition: "all .15s",
                  display: "flex", alignItems: "center", gap: 16,
                }}
              >
                {/* Confidence bar */}
                <div style={{ width: 40, textAlign: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: CONFIDENCE_COLOR(sug.confidence) }}>
                    {(sug.confidence * 100).toFixed(0)}%
                  </div>
                  <div style={{ fontSize: 9, color: "#475569" }}>CONF.</div>
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{
                      fontSize: 10, padding: "2px 6px", borderRadius: 3,
                      background: SEVERITY_COLOR(sug.severity) + "22",
                      color: SEVERITY_COLOR(sug.severity),
                      border: `1px solid ${SEVERITY_COLOR(sug.severity)}44`,
                    }}>
                      {sug.severity}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>{sug.action_type}</span>
                    <span style={{ fontSize: 11, color: "#64748b" }}>IP: {sug.ip}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>{sug.description}</div>
                  {sug.command && (
                    <div style={{
                      fontSize: 11, marginTop: 4, color: "#60a5fa",
                      fontFamily: "monospace", background: "#0a0e1a",
                      padding: "3px 8px", borderRadius: 3, display: "inline-block",
                    }}>
                      $ {sug.command}
                    </div>
                  )}
                </div>

                <div style={{ fontSize: 10, color: "#475569", whiteSpace: "nowrap" }}>
                  {new Date(sug.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Validation panel */}
      {selected && (
        <div style={{
          padding: "20px", borderRadius: 8, marginTop: 16,
          background: "#0d1f0d", border: "1px solid #1e4d1e",
        }}>
          <div style={{ fontSize: 11, color: "#64748b", letterSpacing: 1.5, marginBottom: 14 }}>
            VALIDATION — {selected.suggestion_id}
          </div>

          {/* Command editor */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>COMMANDE (modifiable) :</div>
            <input
              value={modifiedCmd}
              onChange={e => setModifiedCmd(e.target.value)}
              style={{
                width: "100%", padding: "8px 12px", borderRadius: 4,
                background: "#0f2010", border: "1px solid #1e4d1e",
                color: "#86efac", fontSize: 13, fontFamily: "monospace",
                outline: "none", boxSizing: "border-box",
              }}
            />
          </div>

          {/* Admin note */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>NOTE ADMIN (optionnel) :</div>
            <input
              value={adminNote}
              onChange={e => setAdminNote(e.target.value)}
              placeholder="Raison de la décision..."
              style={{
                width: "100%", padding: "8px 12px", borderRadius: 4,
                background: "#1e293b", border: "1px solid #334155",
                color: "#e2e8f0", fontSize: 12, fontFamily: "inherit",
                outline: "none", boxSizing: "border-box",
              }}
            />
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => validate("APPROVE")}
              disabled={loading}
              style={{
                flex: 1, padding: "10px", borderRadius: 4, cursor: "pointer",
                background: "#166534", border: "1px solid #22c55e",
                color: "#86efac", fontSize: 13, fontFamily: "inherit", fontWeight: 700,
              }}
            >
              ✅ APPROUVER
            </button>
            <button
              onClick={() => validate("MODIFY")}
              disabled={loading || !modifiedCmd}
              style={{
                flex: 1, padding: "10px", borderRadius: 4, cursor: "pointer",
                background: "#1e3a5f", border: "1px solid #3b82f6",
                color: "#93c5fd", fontSize: 13, fontFamily: "inherit", fontWeight: 700,
              }}
            >
              ✏️ MODIFIER & EXÉCUTER
            </button>
            <button
              onClick={() => validate("REJECT")}
              disabled={loading}
              style={{
                flex: 1, padding: "10px", borderRadius: 4, cursor: "pointer",
                background: "#450a0a", border: "1px solid #ef4444",
                color: "#fca5a5", fontSize: 13, fontFamily: "inherit", fontWeight: 700,
              }}
            >
              ❌ REJETER
            </button>
            <button
              onClick={() => setSelected(null)}
              style={{
                padding: "10px 16px", borderRadius: 4, cursor: "pointer",
                background: "#1e293b", border: "1px solid #334155",
                color: "#64748b", fontSize: 13, fontFamily: "inherit",
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
          50%       { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
