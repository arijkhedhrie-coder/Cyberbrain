import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useFusionViewModel } from "../../hooks/useFusionViewModel";

const getRiskState = (score: number) => {
  if (score >= 70) return { label: "CRITICAL", color: "#ff5d73", glow: "rgba(255,93,115,0.24)" };
  if (score >= 40) return { label: "ELEVATED", color: "#f6c445", glow: "rgba(246,196,69,0.22)" };
  return { label: "STABLE", color: "#4ade80", glow: "rgba(74,222,128,0.22)" };
};

const timeLabel = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
};

interface Props {
  dataset?: string;
  isFusionView: boolean;
}

export function FusionPanel({ dataset = "", isFusionView }: Props) {
  const { summary, attackers, timeline, riskPoints, loading, error } = useFusionViewModel(dataset);
  const riskState = getRiskState(summary.current_risk_score);
  const totalAttackerRisk = attackers.reduce((sum, attacker) => sum + attacker.risk_score, 0) || 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          borderRadius: 16,
          padding: "18px 20px",
          border: `1px solid ${isFusionView ? "rgba(56,189,248,0.3)" : "rgba(148,163,184,0.2)"}`,
          background: isFusionView
            ? "linear-gradient(135deg, rgba(7,89,133,0.38), rgba(15,23,42,0.88))"
            : "linear-gradient(135deg, rgba(30,41,59,0.72), rgba(15,23,42,0.88))",
          color: "#dbeafe",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
            padding: "4px 10px",
            borderRadius: 999,
            border: `1px solid ${isFusionView ? "rgba(125,211,252,0.3)" : "rgba(148,163,184,0.25)"}`,
            background: isFusionView ? "rgba(125,211,252,0.12)" : "rgba(148,163,184,0.08)",
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: "0.12em",
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          FUSION SIGNAL LAB
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          {isFusionView
            ? "Cross-dataset replay mode is active. This view is reading only stored events and surfacing correlation, recurrence, clustering, and risk evolution across the fusion overlay."
            : "This Fusion section is active, but the selected dataset is local. Switch the selector to fusion to see the cross-dataset overlay in action, or stay here to inspect replay-based fusion analytics for the current dataset only."}
        </div>
      </div>

      <div className="grid-3" style={{ gap: 16 }}>
        <div
          style={{
            background: "radial-gradient(circle at top right, rgba(34,211,238,0.12), transparent 42%), linear-gradient(160deg, #09101d 0%, #101827 100%)",
            border: `1px solid ${riskState.glow}`,
            borderRadius: 18,
            padding: 20,
            boxShadow: `0 18px 40px ${riskState.glow}`,
            minHeight: 220,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
            <div>
              <div style={{ color: "#7dd3fc", fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", fontFamily: "'JetBrains Mono', monospace" }}>
                LIVE FUSION RISK SCORE
              </div>
              <div style={{ color: "#64748b", fontSize: 12, marginTop: 6 }}>
                Replay-based aggregate risk from event clusters
              </div>
            </div>
            <div
              style={{
                color: riskState.color,
                background: `${riskState.color}22`,
                border: `1px solid ${riskState.color}44`,
                borderRadius: 999,
                padding: "5px 10px",
                fontSize: 11,
                fontWeight: 800,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {riskState.label}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <div style={{ fontSize: 72, lineHeight: 0.95, fontWeight: 900, color: riskState.color, fontFamily: "'JetBrains Mono', monospace" }}>
              {Math.round(summary.current_risk_score)}
            </div>
            <div style={{ color: "#475569", fontSize: 14, fontWeight: 700 }}>/100</div>
          </div>

          <div
            style={{
              height: 10,
              borderRadius: 999,
              background: "rgba(148,163,184,0.12)",
              overflow: "hidden",
              marginTop: 18,
              marginBottom: 18,
            }}
          >
            <div
              style={{
                width: `${Math.max(0, Math.min(100, summary.current_risk_score))}%`,
                height: "100%",
                borderRadius: 999,
                background: `linear-gradient(90deg, ${riskState.color}, #38bdf8)`,
                boxShadow: `0 0 20px ${riskState.glow}`,
              }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {[
              ["Peak", Math.round(summary.peak_risk_score)],
              ["Average", Math.round(summary.average_risk_score)],
              ["Clusters", summary.cluster_count],
            ].map(([label, value]) => (
              <div
                key={label}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  background: "rgba(15,23,42,0.7)",
                  border: "1px solid rgba(125,211,252,0.12)",
                }}
              >
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.12em" }}>{label}</div>
                <div style={{ marginTop: 6, fontSize: 22, fontWeight: 800, color: "#e2e8f0", fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            background: "linear-gradient(180deg, #0b1120 0%, #101827 100%)",
            border: "1px solid rgba(125,211,252,0.12)",
            borderRadius: 18,
            padding: 18,
            minHeight: 220,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.14em", color: "#7dd3fc", fontFamily: "'JetBrains Mono', monospace" }}>
              FUSION SNAPSHOT
            </div>
            <div style={{ fontSize: 10, color: "#64748b" }}>
              {summary.generated_from || "event_store"}
            </div>
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {[
              ["Attackers", summary.attacker_count],
              ["Correlated", summary.correlated_attacker_count],
              ["Recurrent", summary.recurrent_attacker_count],
              ["Deduped Alerts", summary.source_events.deduped_alert_event_count],
              ["Duplicates Removed", summary.source_events.deduped_duplicate_alerts],
              ["Support Events", summary.source_events.support_event_count],
            ].map(([label, value]) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 12px",
                  borderRadius: 12,
                  background: "rgba(15,23,42,0.64)",
                  border: "1px solid rgba(51,65,85,0.6)",
                }}
              >
                <span style={{ fontSize: 12, color: "#94a3b8" }}>{label}</span>
                <span style={{ fontSize: 18, color: "#e2e8f0", fontWeight: 800, fontFamily: "'JetBrains Mono', monospace" }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            background: "linear-gradient(180deg, #09101d 0%, #111827 100%)",
            border: "1px solid rgba(125,211,252,0.12)",
            borderRadius: 18,
            padding: 18,
            minHeight: 220,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.14em", color: "#7dd3fc", fontFamily: "'JetBrains Mono', monospace", marginBottom: 12 }}>
            TIMELINE HEALTH
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {[
              ["Range Start", summary.time_range.start ? timeLabel(summary.time_range.start) : "—"],
              ["Range End", summary.time_range.end ? timeLabel(summary.time_range.end) : "—"],
              ["Replayed Events", summary.source_events.replayed_event_count],
              ["Fusion Categories", summary.replayed_categories.join(", ") || "—"],
            ].map(([label, value]) => (
              <div key={label} style={{ paddingBottom: 10, borderBottom: "1px solid rgba(51,65,85,0.4)" }}>
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.12em" }}>{label}</div>
                <div style={{ marginTop: 6, color: "#e2e8f0", fontSize: 13, fontFamily: label === "Fusion Categories" ? "'JetBrains Mono', monospace" : undefined }}>
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ gap: 16 }}>
        <section
          style={{
            background: "linear-gradient(180deg, #08111f 0%, #101827 100%)",
            border: "1px solid rgba(56,189,248,0.14)",
            borderRadius: 18,
            padding: 18,
            minHeight: 420,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.15em", color: "#7dd3fc", fontFamily: "'JetBrains Mono', monospace" }}>
                TOP ATTACKERS
              </div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
                Ranked by replay-derived fusion risk contribution
              </div>
            </div>
            <div className={isFusionView ? "badge-ok" : "badge-warn"}>
              {isFusionView ? "FUSION MODE" : "LOCAL SCOPE"}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {attackers.slice(0, 8).map((attacker, index) => {
              const contribution = Math.round((attacker.risk_score / totalAttackerRisk) * 100);
              const state = getRiskState(attacker.risk_score);
              return (
                <div
                  key={`${attacker.ip}-${index}`}
                  style={{
                    padding: "14px 16px",
                    borderRadius: 14,
                    background: "rgba(15,23,42,0.72)",
                    border: "1px solid rgba(51,65,85,0.8)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 10,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "rgba(56,189,248,0.12)",
                          color: "#7dd3fc",
                          fontSize: 12,
                          fontWeight: 900,
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                      >
                        {index + 1}
                      </div>
                      <div>
                        <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace" }}>
                          {attacker.ip}
                        </div>
                        <div style={{ color: "#64748b", fontSize: 11 }}>
                          {attacker.dataset_count} dataset(s) · {attacker.event_count} event(s) · {attacker.behavior_count} behavior(s)
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        color: state.color,
                        background: `${state.color}20`,
                        border: `1px solid ${state.color}40`,
                        borderRadius: 999,
                        padding: "4px 10px",
                        fontSize: 11,
                        fontWeight: 800,
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      {Math.round(attacker.risk_score)}
                    </div>
                  </div>

                  <div
                    style={{
                      height: 8,
                      borderRadius: 999,
                      background: "rgba(148,163,184,0.12)",
                      overflow: "hidden",
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.max(6, contribution)}%`,
                        height: "100%",
                        borderRadius: 999,
                        background: `linear-gradient(90deg, ${state.color}, #38bdf8)`,
                      }}
                    />
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 11 }}>
                    <span style={{ color: "#94a3b8" }}>{contribution}% contribution</span>
                    <span style={{ color: "#94a3b8" }}>correlated {attacker.correlated_event_count}</span>
                    <span style={{ color: "#94a3b8" }}>recurrence {attacker.recurrence_count}</span>
                    <span style={{ color: "#94a3b8" }}>engines {attacker.engines.join(", ") || "—"}</span>
                  </div>
                </div>
              );
            })}

            {!loading && attackers.length === 0 && (
              <div style={{ color: "#64748b", textAlign: "center", padding: "24px 0" }}>
                No attacker correlations available yet for this replay scope.
              </div>
            )}
          </div>
        </section>

        <section
          style={{
            background: "linear-gradient(180deg, #08111f 0%, #101827 100%)",
            border: "1px solid rgba(56,189,248,0.14)",
            borderRadius: 18,
            padding: 18,
            minHeight: 420,
          }}
        >
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.15em", color: "#7dd3fc", fontFamily: "'JetBrains Mono', monospace" }}>
              FUSION TIMELINE PULSE
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
              Cluster volume bars with risk-trace overlay from event_store replay
            </div>
          </div>

          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={riskPoints} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
              <defs>
                <linearGradient id="fusionRiskLine" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#7dd3fc" />
                  <stop offset="100%" stopColor="#f472b6" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 6" stroke="rgba(148,163,184,0.12)" vertical={false} />
              <XAxis
                dataKey="timestamp"
                tickFormatter={timeLabel}
                tick={{ fill: "#64748b", fontSize: 10 }}
                axisLine={{ stroke: "rgba(148,163,184,0.15)" }}
                tickLine={false}
              />
              <YAxis
                yAxisId="risk"
                domain={[0, 100]}
                tick={{ fill: "#64748b", fontSize: 10 }}
                axisLine={{ stroke: "rgba(148,163,184,0.15)" }}
                tickLine={false}
              />
              <YAxis
                yAxisId="events"
                orientation="right"
                tick={{ fill: "#475569", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: "#0b1120",
                  border: "1px solid rgba(125,211,252,0.2)",
                  borderRadius: 12,
                }}
                labelFormatter={(label) => `Window end: ${timeLabel(String(label))}`}
              />
              <Bar yAxisId="events" dataKey="event_count" radius={[8, 8, 0, 0]}>
                {riskPoints.map((point, index) => {
                  const state = getRiskState(point.risk_score);
                  return <Cell key={`${point.timestamp}-${index}`} fill={state.color} fillOpacity={0.28} stroke={state.color} />;
                })}
              </Bar>
              <Line
                yAxisId="risk"
                type="monotone"
                dataKey="risk_score"
                stroke="url(#fusionRiskLine)"
                strokeWidth={3}
                dot={{ r: 3, fill: "#e879f9" }}
                activeDot={{ r: 5, fill: "#7dd3fc" }}
              />
            </ComposedChart>
          </ResponsiveContainer>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 12 }}>
            {timeline.slice(0, 3).map((entry) => (
              <div
                key={entry.cluster_id}
                style={{
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: "rgba(15,23,42,0.72)",
                  border: "1px solid rgba(51,65,85,0.8)",
                }}
              >
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.12em" }}>
                  {entry.cluster_id}
                </div>
                <div style={{ marginTop: 6, color: "#e2e8f0", fontSize: 18, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace" }}>
                  {Math.round(entry.risk_score)}
                </div>
                <div style={{ marginTop: 4, color: "#94a3b8", fontSize: 11 }}>
                  {entry.event_count} events · {entry.attacker_count} attackers
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {error && (
        <div style={{ color: "#94a3b8", fontSize: 12, textAlign: "right" }}>
          Fusion data fallback: {error}
        </div>
      )}
      {loading && (
        <div style={{ color: "#64748b", fontSize: 12, textAlign: "right" }}>
          Loading fusion replay overlays…
        </div>
      )}
    </div>
  );
}
