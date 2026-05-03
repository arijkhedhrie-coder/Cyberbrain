// src/components/dashboard/KpiCard.tsx
import type { FC } from "react";
import '../../style/KpiCard.css';

interface Props {
  label: string;
  value: string | number;
  sub?: string;
  color?: "green" | "red" | "amber" | "default";
}

const colors = { green: "#0F6E56", red: "#A32D2D", amber: "#854F0B", default: "var(--text)" };

export const KpiCard: FC<Props> = ({ label, value, sub, color = "default" }) => (
  <div style={{ background: "var(--card, #fff)", border: "0.5px solid var(--border, #e5e7eb)", borderRadius: 8, padding: "10px 12px" }}>
    <div style={{ fontSize: 10, color: "var(--muted, #6b7280)", marginBottom: 4, textTransform: "uppercase", letterSpacing: ".06em" }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 500, color: colors[color], lineHeight: 1 }}>{value}</div>
    {sub && <div style={{ fontSize: 10, color: "var(--muted, #6b7280)", marginTop: 4 }}>{sub}</div>}
  </div>
);