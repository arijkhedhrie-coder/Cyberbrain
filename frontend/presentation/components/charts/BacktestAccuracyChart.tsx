import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

interface BacktestEntry {
  timestamp: string;
  sessions_tested: number;
  overall_accuracy: number;
  overall_label: string;
  summary: string;
}

interface Props {
  dataset?: string;
}

const formatTime = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString([], { month: "short", day: "2-digit" });
};

export const BacktestAccuracyChart = ({ dataset = "" }: Props) => {
  const [data, setData] = useState<BacktestEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const query = dataset ? `?dataset=${encodeURIComponent(dataset)}` : "";
        const res = await fetch(`${API_BASE}/api/backtest-history${query}`);
        const json = await res.json();
        const sorted = (Array.isArray(json) ? json : []).reverse();
        setData(sorted);
      } catch {
        setData([]);
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
    const id = setInterval(fetchData, 30000);
    return () => clearInterval(id);
  }, [dataset]);

  if (loading) {
    return (
      <div className="chart-card" style={{ padding: 18 }}>
        <div className="chart-header">
          <span className="chart-title">Historique de validation</span>
        </div>
        <div style={{ padding: "18px 0", color: "#64748b", fontSize: 12 }}>
          Chargement de l'historique de validation...
        </div>
      </div>
    );
  }

  if (data.length === 0) return null;

  const latest = data[data.length - 1];
  const chartData = data.map((entry, index) => ({
    session: index + 1,
    accuracy: Math.round(entry.overall_accuracy * 100),
    label: entry.overall_label,
    time: formatTime(entry.timestamp),
  }));

  const badgeStyle =
    latest.overall_accuracy >= 0.8
      ? { bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.24)", color: "#34d399" }
      : latest.overall_accuracy >= 0.65
        ? { bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.24)", color: "#fbbf24" }
        : { bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.24)", color: "#f87171" };

  return (
    <div className="chart-card" style={{ padding: 18 }}>
      <div className="chart-header">
        <span className="chart-title">Historique de validation</span>
        <span
          style={{
            fontSize: 10,
            padding: "4px 8px",
            borderRadius: 999,
            background: badgeStyle.bg,
            color: badgeStyle.color,
            border: `1px solid ${badgeStyle.border}`,
            fontWeight: 700,
          }}
        >
          {Math.round(latest.overall_accuracy * 100)}% · {latest.overall_label}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 10,
          marginBottom: 14,
        }}
      >
        {[
          { label: "Dernier niveau", value: `${Math.round(latest.overall_accuracy * 100)}%`, color: badgeStyle.color },
          { label: "Essais", value: String(data.length), color: "#7dd3fc" },
          { label: "Sessions testees", value: String(latest.sessions_tested ?? 0), color: "#cbd5e1" },
        ].map((item) => (
          <div
            key={item.label}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              background: "rgba(15,23,42,0.42)",
              border: "1px solid rgba(148,163,184,0.14)",
            }}
          >
            <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>{item.label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: item.color }}>{item.value}</div>
          </div>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" />
          <XAxis dataKey="session" tick={{ fill: "#64748b", fontSize: 10 }} />
          <YAxis domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 10 }} />
          <Tooltip
            contentStyle={{
              background: "#0f172a",
              border: "1px solid rgba(148,163,184,0.16)",
              borderRadius: 10,
            }}
            labelFormatter={(value) => `Essai ${value}`}
            formatter={(value) => [`${value}%`, "Precision"]}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line
            type="monotone"
            dataKey="accuracy"
            stroke="#22c55e"
            strokeWidth={2.5}
            dot={{ r: 4, fill: "#22c55e" }}
            activeDot={{ r: 5, fill: "#86efac" }}
            name="Precision %"
          />
        </LineChart>
      </ResponsiveContainer>

      <div style={{ marginTop: 10, fontSize: 11, color: "#94a3b8", lineHeight: 1.6 }}>
        {latest.summary}
      </div>
    </div>
  );
};
