// presentation/components/charts/AttackHeatmap.tsx
import type { AttackHeatmapProps } from "../../../shared/types/analyticsProps";

const ENGINE_TYPES = ["SSH", "WEB", "FTP", "SESSION", "KERNEL"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function intensityColor(v: number): string {
  if (v === 0) return "rgba(255,255,255,0.03)";
  if (v < 20)  return "rgba(59,130,246,0.35)";
  if (v < 45)  return "rgba(255,184,0,0.45)";
  if (v < 70)  return "rgba(255,100,0,0.55)";
  return `rgba(255,59,92,${0.5 + (v / 100) * 0.5})`;
}

export function AttackHeatmap({ alarms }: AttackHeatmapProps) {
  const cellMap = new Map<string, number>();
  alarms.forEach(a => {
    let hour: number;
    // Try to parse the timestamp as an ISO date string
    const date = new Date(a.timestamp);
    if (!isNaN(date.getTime())) {
      hour = date.getHours();
    } else {
      // Fallback to old logic (e.g., "HH:MM:SS" format)
      hour = parseInt(a.timestamp.split(":")[0], 10);
    }
    if (isNaN(hour) || hour < 0 || hour > 23) return;
    const key = `${a.engine}:${hour}`;
    cellMap.set(key, (cellMap.get(key) ?? 0) + (a.score / 10));
  });

  return (
    <div className="chart-card">
      <div className="chart-header">
        <span className="chart-title">Attack Heatmap — 24h par moteur</span>
        <div className="legend-row">
          <span className="leg-item" style={{ color: "#3b82f6" }}>● Faible</span>
          <span className="leg-item" style={{ color: "#ffb800" }}>● Moyen</span>
          <span className="leg-item" style={{ color: "#ff3b5c" }}>● Critique</span>
        </div>
      </div>

      {alarms.length === 0 ? (
        <div className="chart-empty">Aucune alarme — pipeline en attente</div>
      ) : (
        <div className="heatmap-grid">
          <div className="heatmap-ylabels">
            {ENGINE_TYPES.map(t => (
              <div key={t} className="heatmap-ylabel">{t}</div>
            ))}
          </div>
          <div style={{ flex: 1 }}>
            <div className="heatmap-xaxis">
              {HOURS.filter((_, i) => i % 3 === 0).map(h => (
                <span key={h} className="heatmap-xlabel">
                  {String(h).padStart(2, "0")}h
                </span>
              ))}
            </div>
            {ENGINE_TYPES.map(engine => (
              <div key={engine} className="heatmap-row">
                {HOURS.map(hour => {
                  const intensity = Math.min(100, Math.round(cellMap.get(`${engine}:${hour}`) ?? 0));
                  return (
                    <div
                      key={hour}
                      className="heatmap-cell"
                      style={{ background: intensityColor(intensity) }}
                      title={`${engine} @ ${hour}h — score cumulé: ${intensity}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="chart-footer">
        <span className="stat-mini">{alarms.length} alarmes analysées</span>
      </div>
    </div>
  );
}