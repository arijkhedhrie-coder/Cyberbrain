import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface MinimizationPoint {
  timestamp: string;
  alarmes: number;
  risque: number;
}

interface MinimizationEnvelope {
  series?: MinimizationPoint[];
  source?: "realtime" | "memory";
}

type MinimizationResponse = MinimizationEnvelope | MinimizationPoint[];

interface Props {
  dataset?: string;
  embedded?: boolean;
  showMetricTiles?: boolean;
  showFooterNotes?: boolean;
  chartHeight?: number;
  onSeriesChange?: (series: MinimizationPoint[], source: "realtime" | "memory" | null) => void;
}

const FLASK_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

const isMinPoint = (value: unknown): value is MinimizationPoint => {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;

  return (
    typeof point.timestamp === "string" &&
    typeof point.alarmes === "number" &&
    typeof point.risque === "number"
  );
};

const normalizeMinimizationResponse = (
  data: MinimizationResponse,
): { series: MinimizationPoint[]; source: "realtime" | "memory" } | null => {
  if (Array.isArray(data)) {
    const series = data.filter(isMinPoint);
    return series.length > 0 ? { series, source: "memory" } : null;
  }

  const series = Array.isArray(data.series) ? data.series.filter(isMinPoint) : [];
  if (series.length === 0) return null;

  return {
    series,
    source: data.source ?? "memory",
  };
};

const formatSourceLabel = (source: "realtime" | "memory") => {
  if (source === "realtime") {
    return { label: "TEMPS REEL", color: "#34d399", bg: "rgba(52,211,153,0.12)" };
  }
  return { label: "HISTORIQUE", color: "#7dd3fc", bg: "rgba(125,211,252,0.12)" };
};

const getTrend = (series: MinimizationPoint[]) => {
  if (series.length < 2) return null;

  const delta = series[series.length - 1].alarmes - series[0].alarmes;
  if (delta < -2) return { label: "Pression en baisse", color: "#34d399" };
  if (delta > 2) return { label: "Pression en hausse", color: "#fb7185" };
  return { label: "Situation stable", color: "#fbbf24" };
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;

  const alarms = payload.find((item: any) => item.dataKey === "alarmes")?.value;
  const risk = payload.find((item: any) => item.dataKey === "risque")?.value;

  return (
    <div
      style={{
        background: "#101826",
        border: "1px solid rgba(148,163,184,0.18)",
        borderRadius: 12,
        padding: "10px 12px",
        boxShadow: "0 18px 40px rgba(2,6,23,0.34)",
      }}
    >
      <div style={{ color: "#cbd5e1", fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ color: "#fda4af", fontSize: 14, marginBottom: 4 }}>Alertes finales : {alarms ?? 0}</div>
      <div style={{ color: "#6ee7b7", fontSize: 14 }}>Risque restant : {risk ?? 0}%</div>
    </div>
  );
};

const metricTileStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid rgba(148,163,184,0.12)",
  background: "linear-gradient(180deg, rgba(15,23,42,0.74), rgba(15,23,42,0.4))",
};

const panelText = "#ffffff";

export default function MinimizationChart({
  dataset = "",
  embedded = false,
  showMetricTiles = true,
  showFooterNotes = true,
  chartHeight = 250,
  onSeriesChange,
}: Props) {
  const [series, setSeries] = useState<MinimizationPoint[]>([]);
  const [source, setSource] = useState<"realtime" | "memory" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setLoading(true);

    const fetchData = async () => {
      try {
        const query = dataset ? `?dataset=${encodeURIComponent(dataset)}` : "";
        const response = await axios.get<MinimizationResponse>(`${FLASK_BASE}/api/minimization${query}`, {
          timeout: 3000,
        });
        const normalized = normalizeMinimizationResponse(response.data);

        if (normalized) {
          setSeries(normalized.series);
          setSource(normalized.source);
          setError(null);
          return;
        }

        setSeries([]);
        setSource(null);
        setError("Aucune serie de minimisation exploitable n'a ete retournee.");
      } catch {
        setSeries([]);
        setSource(null);
        setError("Le flux de minimisation est temporairement indisponible.");
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
    intervalRef.current = setInterval(() => {
      void fetchData();
    }, 30_000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [dataset]);

  useEffect(() => {
    if (onSeriesChange) onSeriesChange(series, source);
  }, [onSeriesChange, series, source]);

  const latest = series[series.length - 1];
  const peakAlarms = Math.max(...series.map((point) => point.alarmes), 0);
  const lowestRisk = series.length > 0 ? Math.min(...series.map((point) => point.risque)) : 0;
  const trend = getTrend(series);
  const sourceVisual = source ? formatSourceLabel(source) : null;

  return (
    <div
      className="chart-card"
      style={{
        padding: embedded ? 24 : 20,
        borderRadius: embedded ? 22 : undefined,
        background:
          "radial-gradient(circle at top right, rgba(52,211,153,0.08), transparent 32%), linear-gradient(180deg, rgba(15,23,42,0.92), rgba(15,23,42,0.74))",
      }}
    >
      {!embedded && (
        <div className="chart-header" style={{ alignItems: "flex-start", marginBottom: 18 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <span className="chart-title" style={{ fontSize: 20, color: panelText }}>Evolution du risque</span>
            <span style={{ fontSize: 17, color: panelText, lineHeight: 1.5 }}>
              Chaque point represente un passage enregistre, avec ses alertes et son risque restant.
            </span>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {trend && (
              <span
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: `1px solid ${trend.color}33`,
                  background: `${trend.color}14`,
                  color: trend.color,
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                }}
              >
                {trend.label.toUpperCase()}
              </span>
            )}
            {sourceVisual && (
              <span
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid rgba(148,163,184,0.18)",
                  background: sourceVisual.bg,
                  color: sourceVisual.color,
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                }}
              >
                {sourceVisual.label}
              </span>
            )}
          </div>
        </div>
      )}

      {embedded && (trend || sourceVisual) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {trend && (
            <span
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: `1px solid ${trend.color}33`,
                background: `${trend.color}14`,
                color: trend.color,
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.08em",
              }}
            >
              {trend.label.toUpperCase()}
            </span>
          )}
          {sourceVisual && (
            <span
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid rgba(148,163,184,0.18)",
                background: sourceVisual.bg,
                color: sourceVisual.color,
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.08em",
              }}
            >
              {sourceVisual.label}
            </span>
          )}
        </div>
      )}

      {showMetricTiles && series.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 10,
            marginBottom: 18,
          }}
        >
          {[
            { label: "Pic d'alertes", value: peakAlarms, tone: "#fda4af" },
            { label: "Alertes actuelles", value: latest?.alarmes ?? 0, tone: "#e2e8f0" },
            { label: "Risque restant", value: `${latest?.risque ?? 0}%`, tone: "#6ee7b7" },
            { label: "Risque le plus bas", value: `${lowestRisk}%`, tone: "#7dd3fc" },
          ].map((item) => (
            <div key={item.label} style={metricTileStyle}>
              <div style={{ fontSize: 16, color: panelText, marginBottom: 8 }}>{item.label}</div>
              <div style={{ fontSize: 27, fontWeight: 700, color: item.tone }}>{item.value}</div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="chart-empty" style={{ color: panelText, fontSize: 15 }}>Chargement de l'historique...</div>
      ) : series.length === 0 ? (
        <div
          className="chart-empty"
          style={{
            minHeight: chartHeight,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: 20,
            color: panelText,
            fontSize: 15,
          }}
        >
          {error ?? "Aucune donnee live disponible pour la minimisation du risque."}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={chartHeight}>
          <AreaChart data={series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="alarmAreaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#fb7185" stopOpacity={0.18} />
                <stop offset="95%" stopColor="#fb7185" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="riskAreaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#34d399" stopOpacity={0.18} />
                <stop offset="95%" stopColor="#34d399" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" />
            <XAxis
              dataKey="timestamp"
              tick={{ fill: panelText, fontSize: 16 }}
              axisLine={{ stroke: "rgba(148,163,184,0.12)" }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: panelText, fontSize: 16 }}
              axisLine={{ stroke: "rgba(148,163,184,0.12)" }}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              verticalAlign="top"
              align="right"
              wrapperStyle={{ fontSize: 16, paddingBottom: 8 }}
              formatter={(value) => (
                <span style={{ color: panelText }}>
                  {value === "alarmes" ? "Alertes finales" : "Risque restant"}
                </span>
              )}
            />
            <ReferenceLine
              y={10}
              stroke="#fbbf24"
              strokeDasharray="4 4"
              label={{ value: "Seuil critique", fill: panelText, fontSize: 15, position: "right" }}
            />
            <Area
              type="monotone"
              dataKey="alarmes"
              name="alarmes"
              stroke="#fb7185"
              strokeWidth={2}
              fill="url(#alarmAreaGradient)"
              dot={{ r: 2.5, fill: "#fb7185" }}
              activeDot={{ r: 4, fill: "#fecdd3" }}
            />
            <Area
              type="monotone"
              dataKey="risque"
              name="risque"
              stroke="#34d399"
              strokeWidth={2}
              fill="url(#riskAreaGradient)"
              dot={{ r: 2.5, fill: "#34d399" }}
              activeDot={{ r: 4, fill: "#a7f3d0" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}

      {((showFooterNotes && series.length > 0) || error) && (
        <div
          className="chart-footer"
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: "1px solid rgba(148,163,184,0.08)",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          {showFooterNotes && <span className="stat-mini" style={{ fontSize: 15, color: panelText }}>Courbe corail = alertes finales par passage</span>}
          {showFooterNotes && <span className="stat-mini" style={{ fontSize: 15, color: panelText }}>Courbe verte = risque restant apres traitement</span>}
          {error && <span className="stat-mini" style={{ fontSize: 15, color: panelText }}>{error}</span>}
        </div>
      )}
    </div>
  );
}
