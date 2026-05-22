import { useEffect, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend
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

export const BacktestAccuracyChart = ({ dataset = "" }: Props) => {
  const [data, setData] = useState<BacktestEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const query = dataset ? `?dataset=${encodeURIComponent(dataset)}` : "";
        const res = await fetch(`${API_BASE}/api/backtest-history${query}`);
        const json = await res.json();
        // Reverse so oldest first for chart
        const sorted = (Array.isArray(json) ? json : []).reverse();
        setData(sorted);
      } catch (e) {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    fetchData();
    const id = setInterval(fetchData, 30000);
    return () => clearInterval(id);
  }, [dataset]);

  if (loading) return <div style={{ padding: 20, color: "#64748b" }}>Chargement…</div>;
  if (data.length === 0)
    return (
      <div style={{ padding: 20, color: "#64748b", textAlign: "center" }}>
        Pas encore de données de validation – exécutez le pipeline avec --backtest.
      </div>
    );

  const latest = data[data.length - 1];
  const chartData = data.map((entry, i) => ({
    session: i + 1,
    accuracy: Math.round(entry.overall_accuracy * 100),
    label: entry.overall_label,
  }));

  return (
    <div className="chart-card" style={{ padding: 16 }}>
      <div className="chart-header">
        <span className="chart-title">Auto‑Validation Accuracy (Backtest)</span>
        <span className={latest.overall_accuracy >= 0.75 ? "badge-ok" : "badge-warn"}>
          {Math.round(latest.overall_accuracy * 100)}% · {latest.overall_label}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="session" tick={{ fill: "#4a6278", fontSize: 10 }} />
          <YAxis domain={[0, 100]} tick={{ fill: "#4a6278", fontSize: 10 }} />
          <Tooltip
            contentStyle={{ background: "#111820", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
            labelStyle={{ color: "#8ba5c0" }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="accuracy" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} name="Accuracy %" />
        </LineChart>
      </ResponsiveContainer>
      <div className="chart-footer" style={{ marginTop: 8, fontSize: 10, color: "#64748b" }}>
        {latest.summary}
      </div>
    </div>
  );
};
