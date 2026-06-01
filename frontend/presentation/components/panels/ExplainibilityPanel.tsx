import type { ExplainabilityPanelProps } from "../../../shared/types/analyticsProps";
import { getEngineTooltip, getMetricTooltip } from "../../../shared/constants/dashboardTooltips";
import { TooltipLabel } from "../common/TooltipLabel";

const formatTime = (value?: string | null): string => {
  if (!value) return "N/D";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatPct = (value?: number | null): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/D";
  return `${Math.round(value * 100)}%`;
};

const severityPalette = (severity?: string) => {
  const key = String(severity ?? "INFO").toUpperCase();
  if (key === "CRITICAL") {
    return { bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.24)", color: "#fca5a5" };
  }
  if (key === "HIGH") {
    return { bg: "rgba(249,115,22,0.12)", border: "rgba(249,115,22,0.24)", color: "#fdba74" };
  }
  return { bg: "rgba(56,189,248,0.12)", border: "rgba(56,189,248,0.24)", color: "#7dd3fc" };
};

export function ExplainabilityPanel({ data }: ExplainabilityPanelProps) {
  if (!data?.available) {
    return (
      <div className="chart-card" style={{ padding: 18 }}>
        <div className="chart-header">
          <span className="chart-title">Pourquoi cette decision</span>
        </div>
        <div style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.7 }}>
          Aucune explication detaillee n'est encore disponible pour cette source.
        </div>
      </div>
    );
  }

  const topAlarm = data.top_alarm;
  const agreement = data.model_context.agreement ?? data.model_context.trust_score ?? 0;
  const agreementPct = Math.max(0, Math.min(100, Math.round(agreement * 100)));
  const severity = severityPalette(topAlarm?.severity);
  const evidence = data.evidence.slice(0, 4);
  const activeEngines = data.engine_contributions.filter((engine) => engine.alarms > 0).slice(0, 4);

  return (
    <div
      className="chart-card"
      style={{
        padding: 20,
        background: "linear-gradient(160deg, rgba(8,15,28,0.96), rgba(15,23,42,0.9))",
        border: "1px solid rgba(148,163,184,0.12)",
        borderRadius: 18,
      }}
    >
      <div className="chart-header" style={{ alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
        <div style={{ display: "grid", gap: 8 }}>
          <span className="chart-title">Pourquoi cette decision</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 700,
                background: severity.bg,
                color: severity.color,
                border: `1px solid ${severity.border}`,
              }}
            >
              {topAlarm?.type ?? "AUCUNE ALERTE"}
            </span>
            <span
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 700,
                background: "rgba(125,211,252,0.1)",
                color: "#7dd3fc",
                border: "1px solid rgba(125,211,252,0.2)",
              }}
            >
              {data.generated_from}
            </span>
          </div>
        </div>

        <div
          style={{
            marginLeft: "auto",
            minWidth: 120,
            padding: "12px 14px",
            borderRadius: 14,
            background: "rgba(15,23,42,0.62)",
            border: "1px solid rgba(148,163,184,0.12)",
            textAlign: "right",
          }}
        >
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>ACCORD ENTRE MODELES</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#e2e8f0" }}>{agreementPct}%</div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 0.8fr",
          gap: 16,
          marginBottom: 18,
        }}
      >
        <div
          style={{
            padding: "16px 18px",
            borderRadius: 14,
            background: "rgba(15,23,42,0.52)",
            border: "1px solid rgba(148,163,184,0.12)",
          }}
        >
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>RESUME</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>
            {topAlarm ? `${topAlarm.action} sur ${topAlarm.source_ip}` : "Aucune alerte selectionnee"}
          </div>
          <div style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.75 }}>{data.summary}</div>
          {topAlarm && (
            <div style={{ marginTop: 10, fontSize: 13, color: "#64748b", lineHeight: 1.6 }}>
              Moteur{" "}
              <span title={getEngineTooltip(topAlarm.engine)} style={{ cursor: "help" }}>
                {topAlarm.engine}
              </span>
              · Score {topAlarm.score.toFixed(1)} · {formatTime(topAlarm.timestamp)}
            </div>
          )}
        </div>

        <div
          style={{
            padding: "16px 18px",
            borderRadius: 14,
            background: "rgba(15,23,42,0.52)",
            border: "1px solid rgba(148,163,184,0.12)",
            display: "grid",
            gap: 10,
          }}
        >
          {[
            ["Confiance", data.model_context.trust_label, getMetricTooltip("confidence")],
            ["Ecart", data.model_context.drift_label, getMetricTooltip("drift")],
            ["Stabilite", data.model_context.stability, getMetricTooltip("stability")],
            ["Portee", data.dataset_scope.toUpperCase(), null],
          ].map(([label, value, tooltip]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
              <span style={{ color: "#64748b" }}>
                {tooltip ? <TooltipLabel tooltip={tooltip} style={{ gap: 4 }}>{label}</TooltipLabel> : label}
              </span>
              <span style={{ color: "#e2e8f0", fontWeight: 700, textAlign: "right" }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {evidence.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", color: "#64748b", marginBottom: 10 }}>
            SIGNAUX CLES
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {evidence.map((item) => (
              <div
                key={`${item.source}:${item.label}`}
                style={{
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: "rgba(15,23,42,0.42)",
                  border: "1px solid rgba(148,163,184,0.12)",
                  display: "grid",
                  gridTemplateColumns: "140px 1fr 60px",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 700 }}>{item.label}</div>
                <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>{item.detail}</div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 14, color: "#7dd3fc", fontWeight: 700 }}>{item.value}</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>{item.weight.toFixed(0)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
        <div
          style={{
            padding: "14px 16px",
            borderRadius: 12,
            background: "rgba(15,23,42,0.42)",
            border: "1px solid rgba(148,163,184,0.12)",
          }}
        >
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>CONTEXTE DES SEUILS</div>
          {data.threshold_context ? (
            <>
              <div style={{ fontSize: 15, color: "#e2e8f0", fontWeight: 700, marginBottom: 6 }}>
                <span title={getEngineTooltip(data.threshold_context.engine)} style={{ cursor: "help" }}>
                  {data.threshold_context.engine}
                </span>{" "}
                {data.threshold_context.pass1 !== undefined && data.threshold_context.pass2 !== undefined
                  ? `${data.threshold_context.pass1} -> ${data.threshold_context.pass2}`
                  : "seuil enregistre"}
              </div>
              <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
                Validation {data.threshold_context.gate_mode ?? "N/D"} · acceptee{" "}
                {data.threshold_context.gate_accepted ? "oui" : "non"}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
              Aucun contexte de seuil n'a ete lie a cette explication.
            </div>
          )}
        </div>

        <div
          style={{
            padding: "14px 16px",
            borderRadius: 12,
            background: "rgba(15,23,42,0.42)",
            border: "1px solid rgba(148,163,184,0.12)",
          }}
        >
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>MOTEURS ACTIFS</div>
          {activeEngines.length > 0 ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {activeEngines.map((engine) => (
                <span
                  key={engine.engine}
                  title={getEngineTooltip(engine.engine)}
                  style={{
                    padding: "5px 10px",
                    borderRadius: 999,
                    background: "rgba(125,211,252,0.08)",
                    border: "1px solid rgba(125,211,252,0.16)",
                    fontSize: 13,
                    color: "#e2e8f0",
                    cursor: "help",
                  }}
                >
                  {engine.engine} · {engine.alarms}
                </span>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
              Aucun moteur actif n'a ete lie a cette explication.
            </div>
          )}
        </div>
      </div>

      {data.latest_decision && (
        <div style={{ marginTop: 16, fontSize: 13, color: "#94a3b8", lineHeight: 1.7 }}>
          Derniere decision du systeme : <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{data.latest_decision.agent}</span>
          {" · "}
          {data.latest_decision.action}
          {" · "}
          confiance {formatPct(data.latest_decision.confidence)}
        </div>
      )}
    </div>
  );
}
