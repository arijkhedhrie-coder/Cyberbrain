// src/components/dashboard/TrackServersPanel.tsx

import { useState, useEffect, useMemo, type FC } from "react";
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
  CORRELATION:"auth",
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

// ── Temporary fallback servers (always show all four) ──────────────────────
const KNOWN_SERVERS: ServerInfo[] = [
  { id: 'auth',   label: 'auth',   display: 'SSH Auth',       sources: ['auth'] },
  { id: 'web',    label: 'web',    display: 'Web Server',      sources: ['web'] },
  { id: 'ftp',    label: 'ftp',    display: 'FTP Server',      sources: ['ftp'] },
  { id: 'kernel', label: 'kernel', display: 'Kernel/Sys',      sources: ['kernel'] },
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  kpis:            KpiData | null;
  alarms:          AlarmItem[];
  loading:         boolean;
  wsConnected:     boolean;
  isFusionView:    boolean;
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
      fontSize: 12, fontWeight: 600, fontFamily: "monospace", whiteSpace: "nowrap",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: c.dot, flexShrink: 0 }} />
      {sev}
    </span>
  );
};

// ── Composant principal ───────────────────────────────────────────────────────

export const TrackServersPanel: FC<Props> = ({
  kpis, alarms, loading, wsConnected, isFusionView, onServersChange,
}) => {
  // ✅ raw servers from backend
  const { servers, loading: serversLoading } = useServers();

  // Merge with known servers so all four always appear
  const mergedServers: ServerInfo[] = useMemo(() => {
    const map = new Map<string, ServerInfo>();
    for (const s of KNOWN_SERVERS) map.set(s.label, s);
    for (const s of servers) map.set(s.label, s);   // backend can override extra info
    return Array.from(map.values());
  }, [servers]);

  const mergedLabels = useMemo(() => mergedServers.map(s => s.label), [mergedServers]);

  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  const [sevFilter,      setSevFilter]      = useState<string>("ALL");
  const [searchIp,       setSearchIp]       = useState<string>("");
  const [sortField,      setSortField]      = useState<keyof AlarmItem>("timestamp");
  const [sortAsc,        setSortAsc]        = useState(false);

  // ✅ Sélectionne tout au premier chargement (using merged labels)
  useEffect(() => {
    if (mergedLabels.length > 0 && selectedLabels.size === 0) {
      const allLabels = new Set(mergedLabels);
      setSelectedLabels(allLabels);
      onServersChange(mergedLabels);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergedLabels.join(",")]);

  // Toggle sélection
  const toggle = (label: string) => {
    setSelectedLabels(prev => {
      const n = new Set(prev);
      n.has(label) ? n.delete(label) : n.add(label);
      onServersChange(Array.from(n));
      return n;
    });
  };

  const selectAll  = () => {
    const s = new Set(mergedLabels);
    setSelectedLabels(s);
    onServersChange(mergedLabels);
  };
  const selectNone = () => {
    setSelectedLabels(new Set());
    onServersChange([]);
  };

  // ── Pre‑compute alarm IDs per label (cached, O(n) total) ────────────────
  const alarmsForLabel = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const a of alarms) {
      const label = ENGINE_TO_LABEL[a.engine?.toUpperCase() ?? ""] ?? "";
      if (!label) continue;
      if (!map.has(label)) map.set(label, new Set());
      map.get(label)!.add(a.id);
      // Also match by server_id if present
      if (a.server_id) {
        const sid = a.server_id.toLowerCase();
        for (const [l, keywords] of [
          ["auth", ["auth","ssh","sshd"]],
          ["web", ["web","access","nginx"]],
          ["ftp", ["ftp","vsftpd"]],
          ["kernel", ["kernel","syslog","kern"]],
        ] as [string, string[]][]) {
          if (keywords.some(k => sid.includes(k))) {
            if (!map.has(l)) map.set(l, new Set());
            map.get(l)!.add(a.id);
          }
        }
      }
    }
    return map;
  }, [alarms]);

  // Fast selected alarms: pre‑compute selected IDs once
  const selectedIds = useMemo(() => {
    if (selectedLabels.size === 0) return null; // null means all alarms
    const ids = new Set<string>();
    for (const label of selectedLabels) {
      const set = alarmsForLabel.get(label);
      if (set) for (const id of set) ids.add(id);
    }
    return ids;
  }, [selectedLabels, alarmsForLabel]);

  const selectedAlarms = selectedIds
    ? alarms.filter(a => selectedIds.has(a.id))
    : alarms;

  // ── Filtrage + tri (numeric‑aware) ──────────────────────────────────────
  const filtered = useMemo(() => {
    const filteredAlarms = selectedAlarms
      .filter(a => sevFilter === "ALL" || a.severity === sevFilter)
      .filter(a =>
        searchIp === "" ||
        a.source_ip.toLowerCase().includes(searchIp.toLowerCase())
      );

    return [...filteredAlarms].sort((a, b) => {
      const va = a[sortField];
      const vb = b[sortField];

      // numeric fields
      if (typeof va === "number" && typeof vb === "number") {
        return sortAsc ? va - vb : vb - va;
      }

      // string fields
      const sa = String(va ?? "");
      const sb = String(vb ?? "");
      return sortAsc ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
  }, [selectedAlarms, sevFilter, searchIp, sortField, sortAsc]);

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
      {isFusionView && (
        <div style={{
          padding: "14px 16px",
          borderRadius: 12,
          border: "1px solid rgba(56,189,248,0.28)",
          background: "linear-gradient(135deg, rgba(8,47,73,0.5), rgba(15,23,42,0.82))",
          color: "#dbeafe",
        }}>
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
            padding: "4px 10px",
            borderRadius: 999,
            background: "rgba(125,211,252,0.14)",
            border: "1px solid rgba(125,211,252,0.22)",
            fontWeight: 700,
            letterSpacing: "0.08em",
            fontSize: 12,
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            VUE CONSOLIDEE · LECTURE SEULE
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>
            Cette vue regroupe et classe les signaux de plusieurs serveurs. Elle ne bloque jamais une IP, ne
            modifie pas les seuils, ne relance pas les modeles et ne lance aucune action corrective.
          </div>
        </div>
      )}

      {/* ── Cartes serveurs ── */}
      {serversLoading ? (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          height: 120, fontSize: 14, color: "var(--muted, #6b7280)",
        }}>
          Chargement des serveurs depuis le backend…
        </div>
      ) : mergedServers.length === 0 ? (
        <div style={{
          padding: "32px 24px", textAlign: "center",
          background: "var(--card, #fff)", borderRadius: 8,
          border: "0.5px solid var(--border, #e5e7eb)",
        }}>
          <div style={{ fontSize: 30, marginBottom: 12 }}>🔍</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
            Aucun serveur détecté
          </div>
          <div style={{ fontSize: 13, color: "var(--muted, #6b7280)", maxWidth: 320, margin: "0 auto" }}>
            Les serveurs seront détectés automatiquement quand le pipeline commencera à traiter les fichiers logs.
          </div>
        </div>
      ) : (
        <>
          {/* ── Header sélection ── */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            flexWrap: "wrap", gap: 8,
          }}>
            <div style={{ fontSize: 13, color: "var(--muted, #6b7280)" }}>
              <b style={{ color: "var(--text)" }}>{selectedLabels.size}</b> / {mergedServers.length} serveur{mergedServers.length > 1 ? "s" : ""} sélectionné{selectedLabels.size > 1 ? "s" : ""}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={selectAll} style={{
                fontSize: 12, padding: "3px 10px", borderRadius: 20,
                border: "0.5px solid var(--border, #e5e7eb)",
                cursor: "pointer", background: "transparent",
                color: "var(--muted, #6b7280)", fontFamily: "inherit",
              }}>
                Tout sélectionner
              </button>
              <button onClick={selectNone} style={{
                fontSize: 12, padding: "3px 10px", borderRadius: 20,
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
            gridTemplateColumns: `repeat(${Math.min(mergedServers.length, 4)}, 1fr)`,
            gap: 10,
          }}>
            {mergedServers.map((srv: ServerInfo, i: number) => {
              const isSelected   = selectedLabels.has(srv.label);
              const color        = SERVER_COLORS[i % SERVER_COLORS.length];
              const icon         = LABEL_ICON[srv.label]  ?? "🖥️";
              const desc         = LABEL_DESC[srv.label]  ?? srv.id;
              const serverAlarms = alarms.filter(a =>
                alarmsForLabel.get(srv.label)?.has(a.id)
              );
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
                    fontSize: 12, color: "#fff", fontWeight: 700,
                    transition: "all .18s",
                  }}>
                    {isSelected ? "✓" : ""}
                  </div>

                  {/* Icône + titre */}
                  <div style={{ fontSize: 24, marginBottom: 6 }}>{icon}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>
                    {srv.display}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted, #6b7280)", marginBottom: 8, fontFamily: "monospace" }}>
                    {desc}
                  </div>

                  {/* Stats alarmes */}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: 12, padding: "2px 7px", borderRadius: 20, fontFamily: "monospace",
                      background: hasAlarm ? "rgba(226,75,74,0.12)" : "rgba(29,158,117,0.1)",
                      color:      hasAlarm ? "#E24B4A" : "#1D9E75",
                      fontWeight: 600,
                    }}>
                      {serverAlarms.length} alarme{serverAlarms.length !== 1 ? "s" : ""}
                    </span>
                    {critCount > 0 && (
                      <span style={{
                        fontSize: 12, padding: "2px 7px", borderRadius: 20, fontFamily: "monospace",
                        background: "rgba(226,75,74,0.18)", color: "#E24B4A", fontWeight: 700,
                      }}>
                        {critCount} CRITIQUE{critCount > 1 ? "S" : ""}
                      </span>
                    )}
                    {serverAlarms.length === 0 && (
                      <span style={{
                        fontSize: 12, padding: "2px 7px", borderRadius: 20,
                        background: "rgba(29,158,117,0.1)", color: "#1D9E75", fontFamily: "monospace",
                      }}>
                        ✓ OK
                      </span>
                    )}
                  </div>

                  {/* Label métier + ID source (petit) */}
                  <div style={{ marginTop: 8, fontSize: 11, color: "var(--muted, #6b7280)", opacity: 0.65 }}>
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
      {mergedServers.length > 0 && (
        <div style={{
          background: "var(--card, #fff)",
          border: "0.5px solid var(--border, #e5e7eb)",
          borderRadius: 8, padding: "12px 16px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", flex: 1 }}>
              {selectedLabels.size === 0
                ? "Aucun serveur sélectionné"
                : Array.from(selectedLabels)
                    .map(label => mergedServers.find(s => s.label === label)?.display ?? label)
                    .join(" + ")}
            </div>
            <span style={{
              fontSize: 12, padding: "2px 8px", borderRadius: 20, fontFamily: "monospace",
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

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, color: "var(--muted, #6b7280)" }}>
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
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
            {isFusionView ? "Table dynamique — Signaux consolides" : "Table dynamique — Alarmes reelles"}
            <span style={{
              marginLeft: 8, fontSize: 12, padding: "1px 7px", borderRadius: 20,
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
                padding: "4px 10px", borderRadius: 6, fontSize: 13, fontFamily: "monospace",
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
                  fontSize: 11, padding: "3px 9px", borderRadius: 20, cursor: "pointer",
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
            <div style={{ padding: "24px", textAlign: "center", color: "var(--muted, #6b7280)", fontSize: 14 }}>
              {loading ? "Chargement…"
                : selectedLabels.size === 0 ? "Sélectionnez au moins un serveur pour voir les alarmes."
                : "✅ Aucune alarme pour les serveurs sélectionnés"}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--color-background-secondary, #f3f4f6)" }}>
                  {([
                    ["timestamp", "Horodatage"],
                    ...(isFusionView ? [["dataset_id", "Source"]] as [keyof AlarmItem, string][] : []),
                    ["source_ip", "IP source"],
                    ["engine",    "Moteur"],
                    ["severity",  "Gravite"],
                    ["score",     "Score"],
                    ...(!isFusionView ? [["action", "Reponse"]] as [keyof AlarmItem, string][] : []),
                    ["type",      "Type"],
                    ["failures",  "Echecs"],
                    ["message",   "Message"],
                  ] as [keyof AlarmItem, string][]).map(([field, label]) => (
                    <th
                      key={field}
                      onClick={() => handleSort(field)}
                      style={{
                        padding: "6px 10px", textAlign: "left", fontSize: 12,
                        color: "var(--muted, #6b7280)", fontWeight: 600,
                        cursor: "pointer", whiteSpace: "nowrap",
                        borderBottom: "0.5px solid var(--border, #e5e7eb)",
                        userSelect: "none",
                      }}
                    >
                      {label}
                      <span style={{ marginLeft: 3, opacity: sortField === field ? 1 : 0.3, fontSize: 10 }}>
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
                    <td style={{ padding: "6px 10px", fontFamily: "monospace", fontSize: 12, whiteSpace: "nowrap", color: "var(--muted, #6b7280)" }}>{row.timestamp}</td>
                    {isFusionView && (
                      <td style={{ padding: "6px 10px", fontFamily: "monospace", fontSize: 12, whiteSpace: "nowrap", color: "#0C447C" }}>
                        {row.dataset_id ?? "consolide"}
                      </td>
                    )}
                    <td style={{ padding: "6px 10px", fontFamily: "monospace", fontSize: 12, whiteSpace: "nowrap", color: "var(--text)" }}>{row.source_ip}</td>
                    <td style={{ padding: "6px 10px" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{row.engine}</span>
                    </td>
                    <td style={{ padding: "6px 10px" }}><SevBadge sev={row.severity} /></td>
                    <td style={{ padding: "6px 10px", fontFamily: "monospace", fontSize: 13, fontWeight: 600, textAlign: "right", color: (row.score ?? 0) > 70 ? "#E24B4A" : "var(--text)" }}>
                      {row.score?.toFixed(1) ?? "—"}
                    </td>
                    {!isFusionView && (
                      <td style={{ padding: "6px 10px" }}>
                        <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "monospace", color: ACTION_COLOR[row.action] ?? "var(--text)" }}>{row.action ?? "—"}</span>
                      </td>
                    )}
                    <td style={{ padding: "6px 10px", color: "var(--text)", fontSize: 12, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.type ?? "—"}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: "monospace", color: (row.failures ?? 0) > 50 ? "#E24B4A" : "var(--text)" }}>{row.failures ?? 0}</td>
                    <td style={{ padding: "6px 10px", color: "var(--muted, #6b7280)", fontSize: 12, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.message}>
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
            fontSize: 12, color: "var(--muted, #6b7280)",
          }}>
            <span>{filtered.length} ligne{filtered.length !== 1 ? "s" : ""} affichée{filtered.length !== 1 ? "s" : ""}</span>
            <span>
              {isFusionView
                ? "horodatage · source · IP source · moteur · gravite · score · type · echecs · message"
                : "horodatage · IP source · moteur · gravite · score · action · type · echecs · message"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
