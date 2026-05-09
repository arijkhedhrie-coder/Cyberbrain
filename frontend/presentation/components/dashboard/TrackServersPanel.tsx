// src/components/dashboard/TrackServersPanel.tsx


import { useState, useEffect, type FC } from "react";
import type { KpiData, AlarmItem } from "../../../shared/types/idps";

import "../../../shared/style/Trackserverspanel.css";

import { useServers } from "../../../application/services/useServers";
import type { ServerInfo } from "../../../application/services/useServers";

// ── Couleurs dynamiques ───────────────────────────────────────────────────────

const SERVER_COLORS = [
  "#1D9E75", "#378ADD", "#EF9F27", "#E24B4A",
  "#a78bfa", "#00b4d8", "#ff9f43", "#534AB7",
  "#f472b6", "#34d399", "#fb7185", "#60a5fa",
];

// ── Icônes par label métier ───────────────────────────────────────────────────

const LABEL_ICON: Record<string, string> = {
  auth:   "🔐",
  web:    "🌐",
  ftp:    "📁",
  kernel: "⚙️",
};

const LABEL_DESC: Record<string, string> = {
  auth:   "auth.log · sshd.log",
  web:    "access.log · error.log",
  ftp:    "vsftpd.log · xferlog",
  kernel: "syslog · kern.log",
};

// ── Mapping engine → label métier (pour filtrer alarmes côté frontend) ────────

const ENGINE_TO_LABEL: Record<string, string> = {
  SSH:        "auth",
  WEB:        "web",
  FTP:        "ftp",
  KERNEL:     "kernel",
  SESSION:    "kernel",
  PREDICTION: "kernel",
  CORRELATION:"auth",  // correlation souvent liée à SSH
};

// ── Couleurs sévérité / action ────────────────────────────────────────────────

const SEV_COLOR: Record<string, { bg: string; text: string; dot: string }> = {
  CRITICAL: { bg: "rgba(226,75,74,0.12)",  text: "#E24B4A", dot: "#E24B4A" },
  HIGH:     { bg: "rgba(239,159,39,0.12)", text: "#EF9F27", dot: "#EF9F27" },
  MED:      { bg: "rgba(55,138,221,0.12)", text: "#378ADD", dot: "#378ADD" },
  LOW:      { bg: "rgba(136,135,128,0.1)", text: "#888780", dot: "#888780" },
  INFO:     { bg: "rgba(136,135,128,0.1)", text: "#888780", dot: "#888780" },
};

const ACTION_COLOR: Record<string, string> = {
  BLOCK_NOW:  "#E24B4A",
  WATCHLIST:  "#EF9F27",
  ESCALATE:   "#a78bfa",
  MONITOR:    "#378ADD",
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  kpis:            KpiData | null;
  alarms:          AlarmItem[];
  loading:         boolean;
  wsConnected:     boolean;
  // ✅ [FIX-4] onServersChange reçoit les LABELS (auth/web/...) pas les IDs S3
  onServersChange: (servers: string[]) => void;
}

// ── Badge sévérité ────────────────────────────────────────────────────────────

const SevBadge: FC<{ sev: string }> = ({ sev }) => {
  const c = SEV_COLOR[sev] ?? SEV_COLOR.LOW;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 7px", borderRadius: 20,
      background: c.bg, color: c.text,
      fontSize: 10, fontWeight: 600, fontFamily: "monospace", whiteSpace: "nowrap",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: c.dot, flexShrink: 0 }} />
      {sev}
    </span>
  );
};

// ── Composant principal ───────────────────────────────────────────────────────

export const TrackServersPanel: FC<Props> = ({
  kpis, alarms, loading, wsConnected, onServersChange,
}) => {
  // ✅ [FIX-4] servers = ServerInfo[] avec id, label, display
  const { servers, serverLabels, isEmpty, loading: serversLoading, error } = useServers();

  // ✅ [FIX-1] Initialisé vide — sélection dynamique depuis le backend
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  const [sevFilter,      setSevFilter]      = useState<string>("ALL");
  const [searchIp,       setSearchIp]       = useState<string>("");
  const [sortField,      setSortField]      = useState<keyof AlarmItem>("timestamp");
  const [sortAsc,        setSortAsc]        = useState(false);

  // ✅ Sélectionne tout au premier chargement
  useEffect(() => {
    if (serverLabels.length > 0 && selectedLabels.size === 0) {
      const allLabels = new Set(serverLabels);
      setSelectedLabels(allLabels);
      onServersChange(serverLabels);  // ✅ passe les labels, pas les IDs S3
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverLabels.join(",")]);

  // ── Toggle sélection ─────────────────────────────────────────────────────
  const toggle = (label: string) => {
    setSelectedLabels(prev => {
      const n = new Set(prev);
      n.has(label) ? n.delete(label) : n.add(label);
      onServersChange(Array.from(n));  // ✅ labels uniquement
      return n;
    });
  };

  const selectAll  = () => {
    const s = new Set(serverLabels);
    setSelectedLabels(s);
    onServersChange(serverLabels);
  };
  const selectNone = () => {
    setSelectedLabels(new Set());
    onServersChange([]);
  };

  // ✅ [FIX-4] Filtre alarmes par engine → label OU server_id partiel
  const alarmsForLabel = (label: string): AlarmItem[] =>
    alarms.filter(a => {
      // Correspondance engine → label métier
      const engineLabel = ENGINE_TO_LABEL[a.engine?.toUpperCase() ?? ""] ?? "";
      if (engineLabel === label) return true;
      // Correspondance server_id partiel (si présent)
      if (a.server_id) {
        const sid = a.server_id.toLowerCase();
        if (sid.includes(label)) return true;
        // Correspondance via _s3_id_to_label simplifié
        if (label === "auth"   && (sid.includes("auth") || sid.includes("ssh") || sid.includes("sshd"))) return true;
        if (label === "web"    && (sid.includes("web") || sid.includes("access") || sid.includes("nginx"))) return true;
        if (label === "ftp"    && (sid.includes("ftp") || sid.includes("vsftpd"))) return true;
        if (label === "kernel" && (sid.includes("kernel") || sid.includes("syslog") || sid.includes("kern"))) return true;
      }
      return false;
    });

  // ── Alarmes des labels sélectionnés ──────────────────────────────────────
  const selectedArray  = Array.from(selectedLabels);
  const selectedAlarms = selectedLabels.size === 0
    ? alarms
    : alarms.filter(a => selectedArray.some(label => alarmsForLabel(label).some(x => x.id === a.id)));

  // ── Filtrage + tri ────────────────────────────────────────────────────────
  const filtered = selectedAlarms
    .filter(a => sevFilter === "ALL" || a.severity === sevFilter)
    .filter(a =>
      searchIp === "" ||
      a.source_ip.toLowerCase().includes(searchIp.toLowerCase())
    )
    .sort((a, b) => {
      const va = String(a[sortField] ?? "");
      const vb = String(b[sortField] ?? "");
      return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    });

  const handleSort = (field: keyof AlarmItem) => {
    if (sortField === field) setSortAsc(v => !v);
    else { setSortField(field); setSortAsc(false); }
  };

  const sevCounts = alarms.reduce<Record<string, number>>((acc, a) => {
    acc[a.severity] = (acc[a.severity] ?? 0) + 1;
    return acc;
  }, {});

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 4 }}>

      {/* ── Cartes serveurs ── */}
      {serversLoading ? (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          height: 120, fontSize: 12, color: "var(--muted, #6b7280)",
        }}>
          Chargement des serveurs depuis le backend…
        </div>
      ) : isEmpty ? (
        // ✅ [FIX-1] Message clair quand le backend retourne []
        <div style={{
          padding: "24px", textAlign: "center",
          background: "var(--card, #fff)", borderRadius: 8,
          border: "0.5px solid var(--border, #e5e7eb)",
        }}>
          <div style={{ fontSize: 24, marginBottom: 10 }}>⚠️</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
            Aucun serveur disponible
          </div>
          <div style={{ fontSize: 11, color: "var(--muted, #6b7280)", marginBottom: 12 }}>
            Lancez le pipeline pour charger les fichiers logs et détecter les serveurs.
          </div>
          {error && (
            <div style={{
              fontSize: 10, padding: "6px 12px", borderRadius: 6,
              background: "rgba(226,75,74,0.1)", color: "#E24B4A",
              fontFamily: "monospace",
            }}>
              {error}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* ── Header sélection ── */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            flexWrap: "wrap", gap: 8,
          }}>
            <div style={{ fontSize: 11, color: "var(--muted, #6b7280)" }}>
              <b style={{ color: "var(--text)" }}>{selectedLabels.size}</b> / {servers.length} serveur{servers.length > 1 ? "s" : ""} sélectionné{selectedLabels.size > 1 ? "s" : ""}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={selectAll} style={{
                fontSize: 10, padding: "3px 10px", borderRadius: 20,
                border: "0.5px solid var(--border, #e5e7eb)",
                cursor: "pointer", background: "transparent",
                color: "var(--muted, #6b7280)", fontFamily: "inherit",
              }}>
                Tout sélectionner
              </button>
              <button onClick={selectNone} style={{
                fontSize: 10, padding: "3px 10px", borderRadius: 20,
                border: "0.5px solid var(--border, #e5e7eb)",
                cursor: "pointer", background: "transparent",
                color: "var(--muted, #6b7280)", fontFamily: "inherit",
              }}>
                Désélectionner
              </button>
            </div>
          </div>

          {/* ── Grille de cartes ── */}
          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(servers.length, 4)}, 1fr)`,
            gap: 10,
          }}>
            {servers.map((srv: ServerInfo, i: number) => {
              const isSelected   = selectedLabels.has(srv.label);
              const color        = SERVER_COLORS[i % SERVER_COLORS.length];
              const icon         = LABEL_ICON[srv.label]  ?? "🖥️";
              const desc         = LABEL_DESC[srv.label]  ?? srv.id;
              const serverAlarms = alarmsForLabel(srv.label);
              const critCount    = serverAlarms.filter(a => a.severity === "CRITICAL").length;
              const hasAlarm     = critCount > 0;

              return (
                <div
                  key={srv.label}
                  onClick={() => toggle(srv.label)}
                  style={{
                    padding: "14px 16px", borderRadius: 10, cursor: "pointer",
                    background: "var(--card, #fff)",
                    border:     `1.5px solid ${isSelected ? color : "var(--border, #e5e7eb)"}`,
                    boxShadow:  isSelected ? `0 0 0 3px ${color}22` : "none",
                    transition: "all .18s", position: "relative", overflow: "hidden",
                  }}
                >
                  {/* Barre couleur haut */}
                  <div style={{
                    position: "absolute", top: 0, left: 0, right: 0, height: 3,
                    background: isSelected ? color : "transparent",
                    transition: "background .18s",
                  }} />

                  {/* Checkmark */}
                  <div style={{
                    position: "absolute", top: 10, right: 10,
                    width: 18, height: 18, borderRadius: "50%",
                    background: isSelected ? color : "transparent",
                    border:     `1.5px solid ${isSelected ? color : "var(--border, #e5e7eb)"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, color: "#fff", fontWeight: 700,
                    transition: "all .18s",
                  }}>
                    {isSelected ? "✓" : ""}
                  </div>

                  {/* Icône + titre */}
                  <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>
                    {/* ✅ [FIX-4] Affiche display ("SSH Auth") pas l'ID S3 */}
                    {srv.display}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted, #6b7280)", marginBottom: 8, fontFamily: "monospace" }}>
                    {desc}
                  </div>

                  {/* Stats alarmes */}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: 10, padding: "2px 7px", borderRadius: 20, fontFamily: "monospace",
                      background: hasAlarm ? "rgba(226,75,74,0.12)" : "rgba(29,158,117,0.1)",
                      color:      hasAlarm ? "#E24B4A" : "#1D9E75",
                      fontWeight: 600,
                    }}>
                      {serverAlarms.length} alarme{serverAlarms.length !== 1 ? "s" : ""}
                    </span>
                    {critCount > 0 && (
                      <span style={{
                        fontSize: 10, padding: "2px 7px", borderRadius: 20, fontFamily: "monospace",
                        background: "rgba(226,75,74,0.18)", color: "#E24B4A", fontWeight: 700,
                      }}>
                        {critCount} CRITIQUE{critCount > 1 ? "S" : ""}
                      </span>
                    )}
                    {serverAlarms.length === 0 && (
                      <span style={{
                        fontSize: 10, padding: "2px 7px", borderRadius: 20,
                        background: "rgba(29,158,117,0.1)", color: "#1D9E75", fontFamily: "monospace",
                      }}>
                        ✓ OK
                      </span>
                    )}
                  </div>

                  {/* Label métier + ID source (petit) */}
                  <div style={{ marginTop: 8, fontSize: 9, color: "var(--muted, #6b7280)", opacity: 0.65 }}>
                    <span style={{ fontFamily: "monospace" }}>label:</span> {srv.label}
                    {" · "}
                    <span style={{ fontFamily: "monospace" }}>src:</span> {srv.sources.length} fichier{srv.sources.length > 1 ? "s" : ""}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Résumé global ── */}
      {!isEmpty && (
        <div style={{
          background: "var(--card, #fff)",
          border: "0.5px solid var(--border, #e5e7eb)",
          borderRadius: 8, padding: "12px 16px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", flex: 1 }}>
              {selectedArray.length === 0
                ? "Aucun serveur sélectionné"
                : selectedArray
                    .map(label => servers.find(s => s.label === label)?.display ?? label)
                    .join(" + ")}
            </div>
            <span style={{
              fontSize: 10, padding: "2px 8px", borderRadius: 20, fontFamily: "monospace",
              background: wsConnected ? "rgba(29,158,117,0.1)" : "rgba(226,75,74,0.1)",
              color: wsConnected ? "#1D9E75" : "#E24B4A",
              display: "flex", alignItems: "center", gap: 4,
            }}>
              <span style={{
                width: 5, height: 5, borderRadius: "50%",
                background: wsConnected ? "#1D9E75" : "#E24B4A",
                animation: wsConnected ? "ws-pulse 2s infinite" : "none",
              }} />
              {wsConnected ? "WS LIVE" : "WS hors ligne"}
              <style>{`@keyframes ws-pulse{0%,100%{opacity:1}50%{opacity:.35}}`}</style>
            </span>
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11, color: "var(--muted, #6b7280)" }}>
            <span>Lignes : <b style={{ color: "var(--text)", fontFamily: "monospace" }}>{(kpis?.row_count ?? 0).toLocaleString()}</b></span>
            <span>Dédup : <b style={{ color: "var(--text)", fontFamily: "monospace" }}>{(kpis?.deduped_count ?? 0).toLocaleString()}</b></span>
            <span>Bruit : <b style={{ color: "var(--text)", fontFamily: "monospace" }}>{kpis?.noise_ratio != null ? `${(kpis.noise_ratio * 100).toFixed(1)}%` : "—"}</b></span>
            <span>Qualité : <b style={{ color: "var(--text)", fontFamily: "monospace" }}>{kpis?.data_quality ?? "—"}</b></span>
            {(["CRITICAL", "HIGH", "MED"] as const).map(sev => (
              <span key={sev}>
                {sev} : <b style={{ color: SEV_COLOR[sev].text, fontFamily: "monospace" }}>{sevCounts[sev] ?? 0}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Table dynamique alarmes ── */}
      <div style={{
        background: "var(--card, #fff)",
        border: "0.5px solid var(--border, #e5e7eb)",
        borderRadius: 8, overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 14px", borderBottom: "0.5px solid var(--border, #e5e7eb)",
          flexWrap: "wrap", gap: 8,
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>
            Table dynamique — Alarmes réelles
            <span style={{
              marginLeft: 8, fontSize: 10, padding: "1px 7px", borderRadius: 20,
              background: filtered.length > 0 ? "rgba(226,75,74,0.12)" : "rgba(29,158,117,0.1)",
              color: filtered.length > 0 ? "#E24B4A" : "#1D9E75",
              fontFamily: "monospace", fontWeight: 600,
            }}>
              {filtered.length} / {alarms.length}
            </span>
          </span>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input
              value={searchIp}
              onChange={e => setSearchIp(e.target.value)}
              placeholder="Filtrer IP…"
              style={{
                padding: "4px 10px", borderRadius: 6, fontSize: 11, fontFamily: "monospace",
                background: "var(--color-background-secondary, #f3f4f6)",
                border: "0.5px solid var(--border, #e5e7eb)",
                color: "var(--text)", outline: "none", width: 120,
              }}
            />
            {(["ALL", "CRITICAL", "HIGH", "MED", "LOW"] as const).map(f => (
              <button
                key={f}
                onClick={() => setSevFilter(f)}
                style={{
                  fontSize: 9, padding: "3px 9px", borderRadius: 20, cursor: "pointer",
                  fontFamily: "monospace", fontWeight: 600,
                  background:  sevFilter === f ? (SEV_COLOR[f]?.bg ?? "rgba(29,158,117,0.1)") : "transparent",
                  color:       sevFilter === f ? (SEV_COLOR[f]?.text ?? "#1D9E75") : "var(--muted, #6b7280)",
                  border:      `0.5px solid ${sevFilter === f ? (SEV_COLOR[f]?.dot ?? "#1D9E75") : "var(--border, #e5e7eb)"}`,
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Contenu table */}
        <div style={{ overflowX: "auto", maxHeight: 340, overflowY: "auto" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center", color: "var(--muted, #6b7280)", fontSize: 12 }}>
              {loading ? "Chargement…"
                : selectedLabels.size === 0 ? "Sélectionnez au moins un serveur pour voir les alarmes."
                : "✅ Aucune alarme pour les serveurs sélectionnés"}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ background: "var(--color-background-secondary, #f3f4f6)" }}>
                  {([
                    ["timestamp", "Timestamp"],
                    ["source_ip", "IP Source"],
                    ["engine",    "Engine"],
                    ["severity",  "Sévérité"],
                    ["score",     "Score"],
                    ["action",    "Action"],
                    ["type",      "Type"],
                    ["failures",  "Failures"],
                    ["message",   "Message"],
                  ] as [keyof AlarmItem, string][]).map(([field, label]) => (
                    <th
                      key={field}
                      onClick={() => handleSort(field)}
                      style={{
                        padding: "6px 10px", textAlign: "left", fontSize: 10,
                        color: "var(--muted, #6b7280)", fontWeight: 600,
                        cursor: "pointer", whiteSpace: "nowrap",
                        borderBottom: "0.5px solid var(--border, #e5e7eb)",
                        userSelect: "none",
                      }}
                    >
                      {label}
                      <span style={{ marginLeft: 3, opacity: sortField === field ? 1 : 0.3, fontSize: 8 }}>
                        {sortField === field ? (sortAsc ? "▲" : "▼") : "▼"}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 200).map((row, i) => (
                  <tr
                    key={row.id ?? i}
                    style={{ background: i % 2 === 0 ? "transparent" : "var(--color-background-secondary, #f3f4f6)" }}
                  >
                    <td style={{ padding: "6px 10px", fontFamily: "monospace", fontSize: 10, whiteSpace: "nowrap", color: "var(--muted, #6b7280)" }}>{row.timestamp}</td>
                    <td style={{ padding: "6px 10px", fontFamily: "monospace", fontSize: 10, whiteSpace: "nowrap", color: "var(--text)" }}>{row.source_ip}</td>
                    <td style={{ padding: "6px 10px" }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text)" }}>{row.engine}</span>
                    </td>
                    <td style={{ padding: "6px 10px" }}><SevBadge sev={row.severity} /></td>
                    <td style={{ padding: "6px 10px", fontFamily: "monospace", fontSize: 11, fontWeight: 600, textAlign: "right", color: (row.score ?? 0) > 70 ? "#E24B4A" : "var(--text)" }}>
                      {row.score?.toFixed(1) ?? "—"}
                    </td>
                    <td style={{ padding: "6px 10px" }}>
                      <span style={{ fontSize: 10, fontWeight: 600, fontFamily: "monospace", color: ACTION_COLOR[row.action] ?? "var(--text)" }}>{row.action ?? "—"}</span>
                    </td>
                    <td style={{ padding: "6px 10px", color: "var(--text)", fontSize: 10, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.type ?? "—"}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: "monospace", color: (row.failures ?? 0) > 50 ? "#E24B4A" : "var(--text)" }}>{row.failures ?? 0}</td>
                    <td style={{ padding: "6px 10px", color: "var(--muted, #6b7280)", fontSize: 10, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.message}>
                      {row.message || row.human_insight || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {filtered.length > 0 && (
          <div style={{
            padding: "6px 14px", borderTop: "0.5px solid var(--border, #e5e7eb)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            fontSize: 10, color: "var(--muted, #6b7280)",
          }}>
            <span>{filtered.length} ligne{filtered.length !== 1 ? "s" : ""} affichée{filtered.length !== 1 ? "s" : ""}</span>
            <span>timestamp · IP_Source · engine · severity · score · action · type · failures · message</span>
          </div>
        )}
      </div>
    </div>
  );
};