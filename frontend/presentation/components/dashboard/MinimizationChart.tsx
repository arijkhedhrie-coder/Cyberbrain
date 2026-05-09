// src/components/MinimizationChart.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Courbe de minimisation du risque
// Endpoint : GET http://localhost:5000/api/minimization
// Données  : { series: [{ timestamp, alarmes, risque }], source, count }
//
// Si le backend est absent → fallback sur une série simulée avec variation réelle.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useRef } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  AreaChart,
} from "recharts";
import axios from "axios";

// ── Types ────────────────────────────────────────────────────────────────────

interface MinPoint {
  timestamp: string;
  alarmes: number;
  risque: number;
}

interface MinimizationResponse {
  series: MinPoint[];
  source: "realtime" | "memory";
  count: number;
}

// ── Mock : variation réelle simulée ─────────────────────────────────────────
// Simule l'effet de notre solution : pic d'alarmes au début → tendance ↓

const getMockMinimizationSeries = (): MinPoint[] => {
  const base = [12, 18, 24, 31, 27, 22, 19, 14, 11, 9, 7, 8, 6, 4, 5, 3, 4, 2, 2, 1];
  const now = new Date();

  return base.map((val, i) => {
    const t = new Date(now.getTime() - (19 - i) * 5 * 60 * 1000);
    const noise = Math.floor(Math.random() * 3) - 1; // ±1
    const alarmes = Math.max(0, val + noise);
    return {
      timestamp: t.toTimeString().slice(0, 5),
      alarmes,
      risque: Math.max(0, Math.round(alarmes * 3.8 + Math.random() * 4)), // % risque corrélé
    };
  });
};

// ── Tooltip personnalisé ─────────────────────────────────────────────────────

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const alarmes = payload.find((p: any) => p.dataKey === "alarmes")?.value;
  const risque  = payload.find((p: any) => p.dataKey === "risque")?.value;

  return (
    <div style={{
      background: "#0f1117",
      border: "1px solid #22c55e44",
      borderRadius: 8,
      padding: "10px 14px",
      fontSize: 13,
      color: "#e2e8f0",
      boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
    }}>
      <div style={{ color: "#94a3b8", marginBottom: 4, fontFamily: "monospace" }}>
        ⏱ {label}
      </div>
      {alarmes !== undefined && (
        <div style={{ color: "#f87171" }}>
          🔔 Alarmes : <strong>{alarmes}</strong>
        </div>
      )}
      {risque !== undefined && (
        <div style={{ color: "#22c55e" }}>
          🛡 Risque résiduel : <strong>{risque}%</strong>
        </div>
      )}
    </div>
  );
};

// ── Composant principal ──────────────────────────────────────────────────────

const FLASK_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

const MinimizationChart = () => {
  const [series, setSeries]     = useState<MinPoint[]>([]);
  const [source, setSource]     = useState<"realtime" | "memory" | "mock">("mock");
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const intervalRef             = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = async () => {
    try {
      const res = await axios.get<MinimizationResponse>(
        `${FLASK_BASE}/api/minimization`,
        { timeout: 3000 }
      );

      if (res.data.series && res.data.series.length > 0) {
        setSeries(res.data.series);
        setSource(res.data.source);
        setError(null);
      } else {
        // Endpoint OK mais aucune session encore
        setSeries(getMockMinimizationSeries());
        setSource("mock");
      }
    } catch {
      // Backend absent → mock
      setSeries(getMockMinimizationSeries());
      setSource("mock");
      setError("Backend indisponible — données simulées");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Rafraîchissement toutes les 30s
    intervalRef.current = setInterval(fetchData, 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // ── Calcul de la tendance globale ──────────────────────────────────────────
  const trend = (() => {
    if (series.length < 2) return null;
    const first = series[0].alarmes;
    const last  = series[series.length - 1].alarmes;
    const delta = last - first;
    if (delta < -2) return { label: "↓ Risque en baisse", color: "#22c55e" };
    if (delta > 2)  return { label: "↑ Risque en hausse", color: "#f87171" };
    return { label: "→ Risque stable", color: "#f59e0b" };
  })();

  const maxAlarmes = Math.max(...series.map(s => s.alarmes), 1);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{
      background: "linear-gradient(135deg, #0a0d14 0%, #0f1520 100%)",
      border: "1px solid #1e293b",
      borderRadius: 16,
      padding: "24px 28px",
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h3 style={{
            margin: 0,
            fontSize: 16,
            color: "#e2e8f0",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}>
            🛡 Courbe de Minimisation du Risque
          </h3>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "#475569" }}>
            Évolution temporelle des alarmes · Détection → Prévision → Action corrective
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          {trend && (
            <span style={{
              fontSize: 12,
              color: trend.color,
              background: trend.color + "22",
              border: `1px solid ${trend.color}44`,
              borderRadius: 6,
              padding: "3px 10px",
              fontWeight: 600,
            }}>
              {trend.label}
            </span>
          )}
          <span style={{
            fontSize: 11,
            color: source === "realtime" ? "#22c55e" : source === "memory" ? "#60a5fa" : "#94a3b8",
            background: "#1e293b",
            borderRadius: 4,
            padding: "2px 8px",
          }}>
            {source === "realtime" ? "● LIVE" : source === "memory" ? "◎ HISTORIQUE" : "○ SIMULATION"}
          </span>
        </div>
      </div>

      {/* ── Métriques résumées ── */}
      {series.length > 0 && (
        <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
          {[
            {
              label: "Pic d'alarmes",
              value: maxAlarmes,
              color: "#f87171",
              unit: "",
            },
            {
              label: "Niveau actuel",
              value: series[series.length - 1]?.alarmes ?? 0,
              color: "#22c55e",
              unit: " alarmes",
            },
            {
              label: "Risque résiduel",
              value: series[series.length - 1]?.risque ?? 0,
              color: "#22c55e",
              unit: "%",
            },
            {
              label: "Sessions analysées",
              value: series.length,
              color: "#60a5fa",
              unit: "",
            },
          ].map(({ label, value, color, unit }) => (
            <div key={label} style={{
              flex: 1,
              background: "#0f1117",
              border: "1px solid #1e293b",
              borderRadius: 10,
              padding: "12px 14px",
              textAlign: "center",
            }}>
              <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}{unit}</div>
              <div style={{ fontSize: 10, color: "#475569", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Graphique principal : alarmes ── */}
      {loading ? (
        <div style={{ textAlign: "center", color: "#475569", padding: 40 }}>
          Chargement des données…
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 6, fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Nombre d'alarmes par session
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={series} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="alarmGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#f87171" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f87171" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="risqueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="timestamp"
                tick={{ fill: "#475569", fontSize: 11 }}
                axisLine={{ stroke: "#1e293b" }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: "#475569", fontSize: 11 }}
                axisLine={{ stroke: "#1e293b" }}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                formatter={(value) => (
                  <span style={{ color: "#94a3b8", fontSize: 12 }}>
                    {value === "alarmes" ? "Alarmes déclenchées" : "% Risque résiduel"}
                  </span>
                )}
              />
              {/* Seuil d'alerte */}
              <ReferenceLine
                y={10}
                stroke="#f59e0b"
                strokeDasharray="4 4"
                label={{ value: "Seuil critique", fill: "#f59e0b", fontSize: 11, position: "right" }}
              />
              <Area
                type="monotone"
                dataKey="alarmes"
                stroke="#f87171"
                strokeWidth={2}
                fill="url(#alarmGrad)"
                dot={{ fill: "#f87171", r: 3 }}
                activeDot={{ r: 5, fill: "#fca5a5" }}
              />
              <Area
                type="monotone"
                dataKey="risque"
                stroke="#22c55e"
                strokeWidth={2}
                fill="url(#risqueGrad)"
                dot={{ fill: "#22c55e", r: 3 }}
                activeDot={{ r: 5, fill: "#86efac" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </>
      )}

      {/* ── Message d'erreur discret ── */}
      {error && (
        <p style={{ fontSize: 11, color: "#475569", margin: "10px 0 0", textAlign: "right" }}>
          ⚠ {error}
        </p>
      )}

      {/* ── Légende explicative ── */}
      <div style={{
        marginTop: 18,
        padding: "12px 16px",
        background: "#0a0d14",
        borderRadius: 8,
        border: "1px solid #1e293b",
        fontSize: 11,
        color: "#475569",
        lineHeight: 1.7,
      }}>
        <strong style={{ color: "#64748b" }}>Comment lire ce graphique :</strong>
        {" "}La courbe <span style={{ color: "#f87171" }}>rouge</span> montre le nombre d'alarmes déclenchées par session.
        La courbe <span style={{ color: "#22c55e" }}>verte</span> montre le risque résiduel estimé (%).
        Une tendance descendante indique que notre pipeline de détection + actions correctives réduit efficacement la surface d'attaque.
      </div>
    </div>
  );
};

export default MinimizationChart;