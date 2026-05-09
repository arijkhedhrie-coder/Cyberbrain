// presentation/components/charts/EntropyChart.tsx
// ────────────────────────────────────────────────────────────────
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from "recharts";
import type { EntropyChartProps } from "../../../shared/types/analyticsProps";

export function EntropyChart({ data }: EntropyChartProps) {
  const last = data[data.length - 1];
  const isAbove = last && last.entropy > last.threshold;

  return (
    <div className="chart-card">
      <div className="chart-header">
        <span className="chart-title">IP Entropy — Détection DDoS/Scan</span>
        <span className={isAbove ? "badge-crit" : "badge-ok"}>
          H = {last?.entropy.toFixed(2) ?? "—"}
        </span>
      </div>

      {data.length === 0 ? (
        <div className="chart-empty">En attente de données pipeline…</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="entropyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#00d4ff" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#00d4ff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="time" tick={{ fill: "#4a6278", fontSize: 10 }} interval={4} />
            <YAxis tick={{ fill: "#4a6278", fontSize: 10 }} domain={[0, 6]} />
            <Tooltip
              contentStyle={{ background: "#111820", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
              labelStyle={{ color: "#8ba5c0" }}
              itemStyle={{ color: "#00d4ff" }}
            />
            <ReferenceLine
              y={3.8}
              stroke="#ffb800"
              strokeDasharray="4 2"
              label={{ value: "Seuil DDoS", fill: "#ffb800", fontSize: 10, position: "right" }}
            />
            <Area
              type="monotone"
              dataKey="entropy"
              stroke="#00d4ff"
              fill="url(#entropyGrad)"
              strokeWidth={2}
              dot={false}
              name="Entropy H(X)"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}

      <div className="chart-footer">
        <span className="stat-mini">{last?.ipCount ?? 0} IPs attackantes</span>
        <span className="stat-mini">{data.length} points collectés</span>
      </div>
    </div>
  );
}