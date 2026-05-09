// presentation/components/charts/RiskMinimizationChart.tsx
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { RiskMinimizationPoint } from "../../../shared/types/analytics";

interface Props { data: RiskMinimizationPoint[] }

export function RiskMinimizationChart({ data }: Props) {
  const last = data[data.length - 1];
  const reduction = last ? Math.round(((last.riskBefore - last.riskAfter) / last.riskBefore) * 100) : 0;

  return (
    <div className="chart-card">
      <div className="chart-header">
        <span className="chart-title">Risk Minimization Curve</span>
        <span className="badge-ok">↓ {reduction}% reduction</span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="riskGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#ff3b5c" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#ff3b5c" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="time" tick={{ fill: "#4a6278", fontSize: 10 }} />
          <YAxis tick={{ fill: "#4a6278", fontSize: 10 }} domain={[0, 100]} />
          <Tooltip contentStyle={{ background: "#111820", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} />
          <Legend wrapperStyle={{ fontSize: 11, color: "#8ba5c0" }} />
          <Area type="monotone" dataKey="riskBefore" name="Risk Before" stroke="#ff3b5c"
            fill="url(#riskGrad)" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="riskAfter" name="Risk After" stroke="#00ff88"
            strokeWidth={2} dot={false} strokeDasharray="5 2" />
          <Line type="monotone" dataKey="healthScore" name="Health" stroke="#00d4ff"
            strokeWidth={1.5} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}