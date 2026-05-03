// src/components/dashboard/TrackServersPanel.tsx

import { useState, useEffect, type FC } from "react";
import type { KpiData, AlarmItem } from "../../types/idps";
import "../../style/Trackserverspanel.css";
import { useServers } from "../../hooks/useServers";

// ── Couleurs dynamiques pour N serveurs ──────────────────────
const SERVER_COLORS = [
  "#1D9E75", "#378ADD", "#EF9F27", "#E24B4A",
  "#a78bfa", "#00b4d8", "#ff9f43", "#534AB7",
  "#f472b6", "#34d399", "#fb7185", "#60a5fa",
];

// ── Définitions serveurs ──────────────────────────────────────────────────────

interface ServerDef {
  id:          string;   // ✅ string (ex: "server_auth") — plus number
  name:        string;
  label:       string;
  files:       string[];
  strokeColor: string;
}

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

const ENGINE_COLOR: Record<string, string> = {
  SSH:         "#1D9E75",
  WEB:         "#378ADD",
  FTP:         "#EF9F27",
  SESSION:     "#a78bfa",
  KERNEL:      "#E24B4A",
  PREDICTION:  "#534AB7",
  CORRELATION: "#00b4d8",
  CHAIN:       "#ff9f43",
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  kpis:            KpiData | null;
  alarms:          AlarmItem[];
  loading:         boolean;
  wsConnected:     boolean;
  onServersChange: (servers: string[]) => void;
}

// ── Composant badge sévérité ──────────────────────────────────────────────────

const SevBadge: FC<{ sev: string }> = ({ sev }) => {
  const c = SEV_COLOR[sev] ?? SEV_COLOR.LOW;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 7px", borderRadius: 20,
      background: c.bg, color: c.text,
      fontSize: 10, fontWeight: 600, fontFamily: "monospace",
      whiteSpace: "nowrap",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: c.dot, flexShrink: 0 }}/>
      {sev}
    </span>
  );
};

// ── Composant principal ───────────────────────────────────────────────────────

export const TrackServersPanel: FC<Props> = ({
  kpis,
  alarms,
  loading,
  wsConnected,
  onServersChange,
}) => {
  // ✅ Récupère la liste dynamique des serveurs depuis le backend
  const { servers: serverIds } = useServers();

  // ✅ Construit SERVERS dynamiquement — s'adapte à n'importe quel nombre
  const SERVERS: ServerDef[] = serverIds.map((id, i) => ({
    id,
    name:        `Server — ${id}`,
    label:       id,
    files:       [],
    strokeColor: SERVER_COLORS[i % SERVER_COLORS.length],
  }));

  // ✅ Set<string> — plus Set<number>
  const [selected,  setSelected]  = useState<Set<string>>(new Set());
  const [sevFilter, setSevFilter] = useState<string>("ALL");
  const [searchIp,  setSearchIp]  = useState<string>("");
  const [sortField, setSortField] = useState<keyof AlarmItem>("timestamp");
  const [sortAsc,   setSortAsc]   = useState(false);

  // ✅ Sélectionne tous les serveurs au premier chargement
  useEffect(() => {
    if (serverIds.length > 0 && selected.size === 0) {
      const allIds = new Set(serverIds);
      setSelected(allIds);
      onServersChange(serverIds);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverIds]);

  // ── Sélection serveur ────────────────────────────────────────────────────
  const toggle = (id: string) => {   // ✅ string
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      onServersChange(Array.from(n)); // ✅ directement les IDs
      return n;
    });
  };

  const selectedNames = SERVERS.filter(s => selected.has(s.id)).map(s => s.name);

  // ── Filtrage + tri des alarmes ───────────────────────────────────────────
  const filtered = alarms
    .filter(a => sevFilter === "ALL" || a.severity === sevFilter)
    .filter(a =>
      searchIp === "" ||
      a.source_ip.toLowerCase().includes(searchIp.toLowerCase()),
    )
    .sort((a, b) => {
      const va = String(a[sortField] ?? "");
      const vb = String(b[sortField] ?? "");
      return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    });

  // ── Toggle tri colonne ───────────────────────────────────────────────────
  const handleSort = (field: keyof AlarmItem) => {
    if (sortField === field) setSortAsc(v => !v);
    else { setSortField(field); setSortAsc(false); }
  };

  const SortIcon: FC<{ field: keyof AlarmItem }> = ({ field }) => (
    <span style={{ marginLeft: 3, opacity: sortField === field ? 1 : 0.3, fontSize: 9 }}>
      {sortField === field ? (sortAsc ? "▲" : "▼") : "▼"}
    </span>
  );

  // ── Résumé sévérités ─────────────────────────────────────────────────────
  const sevCounts = alarms.reduce<Record<string, number>>((acc, a) => {
    acc[a.severity] = (acc[a.severity] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* ── Grille sélection serveurs ─────────────────────────────────── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${Math.min(SERVERS.length, 4)}, 1fr)`,
        gap: 10,
      }}>
        {SERVERS.map(srv => {
          const isOn = selected.has(srv.id);

          // Compte les alarmes live pour ce serveur via server_id
          const liveCount = alarms.filter(a =>
            (a as AlarmItem & { server_id?: string }).server_id === srv.id
          ).length;

          // SSH failures — uniquement si c'est un serveur auth/SSH
          const isAuth     = srv.label.toLowerCase().includes("auth") ||
                             srv.label.toLowerCase().includes("ssh");
          const alarmCount = isAuth ? (kpis?.ssh_failures ?? null) : null;

          return (
            <div
              key={srv.id}
              onClick={() => toggle(srv.id)}
              style={{
                background:   "var(--card, #fff)",
                border:       isOn
                  ? `1.5px solid ${srv.strokeColor}`
                  : "0.5px solid var(--border, #e5e7eb)",
                borderRadius: 8, padding: 12, cursor: "pointer",
                transition:   "border-color .15s", position: "relative",
              }}
            >
              {/* Checkbox */}
              <div style={{
                position: "absolute", top: 10, right: 10,
                width: 14, height: 14, borderRadius: "50%",
                border: `1.5px solid ${isOn ? srv.strokeColor : "var(--border, #e5e7eb)"}`,
                background: isOn ? srv.strokeColor : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {isOn && (
                  <svg width="8" height="8" viewBox="0 0 8 8">
                    <polyline points="1,4 3,6.5 7,1.5" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>

              {/* Icône serveur */}
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: "var(--color-background-secondary, #f3f4f6)",
                display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8,
              }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"
                  stroke={srv.strokeColor} strokeWidth="1.5" strokeLinecap="round">
                  <rect x="1" y="3" width="16" height="5" rx="1.5"/>
                  <rect x="1" y="10" width="16" height="5" rx="1.5"/>
                </svg>
              </div>

              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text)", marginBottom: 2 }}>
                {srv.name}
              </div>
              <div style={{ fontSize: 10, color: "var(--muted, #6b7280)", fontFamily: "monospace", marginBottom: 8 }}>
                {srv.id}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted, #6b7280)", marginBottom: 2 }}>
                <span>Lignes</span>
                <span style={{ fontWeight: 500, color: "var(--text)" }}>
                  {isAuth && kpis?.row_count ? kpis.row_count.toLocaleString() : "—"}
                </span>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted, #6b7280)", marginBottom: 2 }}>
                <span>SSH Alarms</span>
                <span style={{ fontWeight: 500, color: (alarmCount ?? 0) > 0 ? "#A32D2D" : "#0F6E56" }}>
                  {alarmCount != null ? (alarmCount > 0 ? `${alarmCount}` : "0 CLEAR") : "—"}
                </span>
              </div>

              {isOn && (
                <div style={{
                  display: "flex", justifyContent: "space-between",
                  fontSize: 10, color: "var(--muted, #6b7280)",
                  paddingTop: 4, borderTop: `0.5px solid ${srv.strokeColor}44`, marginTop: 4,
                }}>
                  <span>Live alarmes</span>
                  <span style={{ fontWeight: 600, color: liveCount > 0 ? srv.strokeColor : "#0F6E56" }}>
                    {liveCount > 0 ? liveCount : "0 OK"}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── KPI résumé ────────────────────────────────────────────────── */}
      <div style={{
        background: "var(--card, #fff)", border: "0.5px solid var(--border, #e5e7eb)",
        borderRadius: 8, padding: "10px 14px",
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 4 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: "#E1F5EE", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="14" height="14" viewBox="0 0 18 18" fill="none"
              stroke="#0F6E56" strokeWidth="1.5" strokeLinecap="round">
              <rect x="1" y="3" width="16" height="5" rx="1.5"/>
              <rect x="1" y="10" width="16" height="5" rx="1.5"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
              {selectedNames.length === 0 ? "Aucun serveur" : selectedNames.join(" + ")}
            </div>
            <div style={{ fontSize: 10, color: "var(--muted, #6b7280)" }}>
              {alarms.length} alarme{alarms.length !== 1 ? "s" : ""} chargée{alarms.length !== 1 ? "s" : ""}
            </div>
          </div>
        </div>

        <div style={{ width: 1, height: 32, background: "var(--border, #e5e7eb)", flexShrink: 0 }}/>

        {([
          ["Lignes",   kpis?.row_count?.toLocaleString() ?? "—"],
          ["Dédup.",   kpis?.deduped_count?.toLocaleString() ?? "—"],
          ["Bruit",    kpis?.noise_ratio != null ? `${(kpis.noise_ratio * 100).toFixed(1)}%` : "—"],
          ["Qualité",  kpis?.data_quality ?? "—"],
          ["CRITICAL", String(sevCounts.CRITICAL ?? 0)],
          ["HIGH",     String(sevCounts.HIGH ?? 0)],
          ["MED",      String(sevCounts.MED ?? 0)],
        ] as [string, string][]).map(([l, v]) => (
          <div key={l} style={{ textAlign: "center", minWidth: 52 }}>
            <div style={{ fontSize: 9, color: "var(--muted, #6b7280)", textTransform: "uppercase", letterSpacing: ".05em" }}>{l}</div>
            <div style={{
              fontSize: 14, fontWeight: 600,
              color: l === "CRITICAL" && Number(v) > 0 ? "#E24B4A"
                   : l === "HIGH"     && Number(v) > 0 ? "#EF9F27"
                   : "var(--text)",
            }}>{v}</div>
          </div>
        ))}

        <div style={{ marginLeft: "auto" }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 600,
            background: wsConnected ? "rgba(29,158,117,0.1)" : "rgba(226,75,74,0.1)",
            border: `1px solid ${wsConnected ? "rgba(29,158,117,0.25)" : "rgba(226,75,74,0.25)"}`,
            color: wsConnected ? "#1D9E75" : "#E24B4A",
          }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", flexShrink: 0, background: wsConnected ? "#1D9E75" : "#E24B4A" }}/>
            {wsConnected ? "WS LIVE" : "WS OFF"}
          </span>
        </div>
      </div>

      {/* ── TABLE DYNAMIQUE ───────────────────────────────────────────── */}
      <div style={{
        background: "var(--card, #fff)", border: "0.5px solid var(--border, #e5e7eb)",
        borderRadius: 8, overflow: "hidden",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 14px", borderBottom: "0.5px solid var(--border, #e5e7eb)",
          gap: 10, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
              Table dynamique — Alarmes réelles
            </span>
            {loading && (
              <span style={{ fontSize: 10, color: "var(--muted, #6b7280)", animation: "pulse 1.5s ease-in-out infinite" }}>
                Chargement…
              </span>
            )}
            {!loading && (
              <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 20, background: "var(--color-background-secondary, #f3f4f6)", color: "var(--muted, #6b7280)" }}>
                {filtered.length} / {alarms.length}
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              value={searchIp}
              onChange={e => setSearchIp(e.target.value)}
              placeholder="Filtrer IP…"
              style={{
                padding: "4px 10px", borderRadius: 6, fontSize: 11,
                border: "0.5px solid var(--border, #e5e7eb)",
                background: "var(--color-background-secondary, #f3f4f6)",
                color: "var(--text)", outline: "none", width: 120,
              }}
            />
            {(["ALL","CRITICAL","HIGH","MED","LOW"] as const).map(s => (
              <button key={s} onClick={() => setSevFilter(s)} style={{
                padding: "3px 9px", borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: "pointer",
                border: `1px solid ${sevFilter === s ? (SEV_COLOR[s]?.dot ?? "var(--border, #e5e7eb)") : "var(--border, #e5e7eb)"}`,
                background: sevFilter === s ? (SEV_COLOR[s]?.bg ?? "var(--color-background-secondary, #f3f4f6)") : "transparent",
                color: sevFilter === s ? (SEV_COLOR[s]?.text ?? "var(--text)") : "var(--muted, #6b7280)",
                transition: "all .15s",
              }}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <div style={{ overflowX: "auto", maxHeight: 480, overflowY: "auto" }}>
          {alarms.length === 0 && !loading ? (
            <div style={{ padding: "40px 0", textAlign: "center", fontSize: 12, color: "var(--muted, #6b7280)" }}>
              {selectedNames.length === 0
                ? "👆 Sélectionnez au moins un serveur pour charger les alarmes"
                : "✅ Aucune alarme pour les serveurs sélectionnés"}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ position: "sticky", top: 0, background: "var(--card, #fff)", zIndex: 1 }}>
                  {([ ["timestamp","Timestamp"], ["source_ip","IP Source"], ["engine","Moteur"],
                      ["severity","Sévérité"], ["score","Score"], ["action","Action"],
                      ["type","Type"], ["failures","Failures"],
                  ] as [keyof AlarmItem, string][]).map(([field, label]) => (
                    <th key={field} onClick={() => handleSort(field)} style={{
                      padding: "7px 10px", borderBottom: "0.5px solid var(--border, #e5e7eb)",
                      color: "var(--muted, #6b7280)", fontWeight: 500, textAlign: "left",
                      fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em",
                      cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
                    }}>
                      {label}<SortIcon field={field}/>
                    </th>
                  ))}
                  <th style={{ padding: "7px 10px", borderBottom: "0.5px solid var(--border, #e5e7eb)", color: "var(--muted, #6b7280)", fontWeight: 500, textAlign: "left", fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em" }}>
                    Message
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ padding: "24px 0", textAlign: "center", fontSize: 11, color: "var(--muted, #6b7280)" }}>
                      Aucune alarme ne correspond aux filtres actifs
                    </td>
                  </tr>
                ) : filtered.map((row, i) => {
                  const engineColor = ENGINE_COLOR[row.engine?.toUpperCase() ?? ""] ?? "#888780";
                  return (
                    <tr key={row.id ?? i}
                      style={{ background: i % 2 === 0 ? "transparent" : "var(--color-background-secondary, rgba(0,0,0,0.02))", transition: "background .1s" }}
                      onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background = "var(--bg-hover, rgba(0,0,0,0.04))"}
                      onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background = i % 2 === 0 ? "transparent" : "var(--color-background-secondary, rgba(0,0,0,0.02))"}
                    >
                      <td style={{ padding: "6px 10px", borderBottom: "0.5px solid var(--border, #e5e7eb)", color: "var(--muted, #6b7280)", fontFamily: "monospace", whiteSpace: "nowrap" }}>{row.timestamp}</td>
                      <td style={{ padding: "6px 10px", borderBottom: "0.5px solid var(--border, #e5e7eb)", fontFamily: "monospace", fontWeight: 500, color: "var(--text)" }}>{row.source_ip}</td>
                      <td style={{ padding: "6px 10px", borderBottom: "0.5px solid var(--border, #e5e7eb)" }}>
                        <span style={{ display: "inline-block", padding: "1px 7px", borderRadius: 4, background: `${engineColor}18`, color: engineColor, fontSize: 10, fontWeight: 600, fontFamily: "monospace" }}>
                          {row.engine ?? "—"}
                        </span>
                      </td>
                      <td style={{ padding: "6px 10px", borderBottom: "0.5px solid var(--border, #e5e7eb)" }}><SevBadge sev={row.severity}/></td>
                      <td style={{ padding: "6px 10px", borderBottom: "0.5px solid var(--border, #e5e7eb)", textAlign: "right", fontFamily: "monospace", color: row.score >= 75 ? "#E24B4A" : row.score >= 50 ? "#EF9F27" : "var(--text)", fontWeight: 600 }}>
                        {row.score?.toFixed(1) ?? "—"}
                      </td>
                      <td style={{ padding: "6px 10px", borderBottom: "0.5px solid var(--border, #e5e7eb)" }}>
                        <span style={{ fontSize: 10, fontWeight: 600, fontFamily: "monospace", color: ACTION_COLOR[row.action] ?? "var(--text)" }}>{row.action ?? "—"}</span>
                      </td>
                      <td style={{ padding: "6px 10px", borderBottom: "0.5px solid var(--border, #e5e7eb)", color: "var(--text)", fontSize: 10, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.type ?? "—"}</td>
                      <td style={{ padding: "6px 10px", borderBottom: "0.5px solid var(--border, #e5e7eb)", textAlign: "right", fontFamily: "monospace", color: (row.failures ?? 0) > 50 ? "#E24B4A" : "var(--text)" }}>{row.failures ?? 0}</td>
                      <td style={{ padding: "6px 10px", borderBottom: "0.5px solid var(--border, #e5e7eb)", color: "var(--muted, #6b7280)", fontSize: 10, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.message}>
                        {row.message || row.human_insight || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {filtered.length > 0 && (
          <div style={{ padding: "6px 14px", borderTop: "0.5px solid var(--border, #e5e7eb)", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 10, color: "var(--muted, #6b7280)" }}>
            <span>{filtered.length} ligne{filtered.length !== 1 ? "s" : ""} affichée{filtered.length !== 1 ? "s" : ""}</span>
            <span>timestamp · IP_Source · engine · severity · score · action · type · failures · message</span>
          </div>
        )}
      </div>
    </div>
  );
};