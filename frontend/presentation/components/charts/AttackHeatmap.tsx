import type { AttackHeatmapProps } from "../../../shared/types/analyticsProps";

type DayBucket = {
  key: string;
  label: string;
};

const HOUR_LABELS = Array.from({ length: 24 }, (_, hour) => hour);

function normalizeAlarmDate(value: string): Date | null {
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const timeOnly = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!timeOnly) return null;

  const fallback = new Date();
  fallback.setHours(Number(timeOnly[1]), Number(timeOnly[2]), Number(timeOnly[3] ?? "0"), 0);
  return fallback;
}

function buildDayBuckets(days: number, reference: Date): DayBucket[] {
  return Array.from({ length: days }, (_, index) => {
    const current = new Date(reference);
    current.setHours(0, 0, 0, 0);
    current.setDate(current.getDate() - (days - 1 - index));

    return {
      key: current.toISOString().slice(0, 10),
      label: current.toLocaleDateString([], { weekday: "short", day: "2-digit" }).toUpperCase(),
    };
  });
}

function intensityColor(value: number): string {
  if (value <= 0) return "rgba(255,255,255,0.03)";
  if (value < 20) return "rgba(53,212,255,0.22)";
  if (value < 40) return "rgba(125,211,252,0.38)";
  if (value < 60) return "rgba(251,191,36,0.5)";
  if (value < 80) return "rgba(249,115,22,0.64)";
  return "rgba(255,91,127,0.82)";
}

export function AttackHeatmap({ alarms, embedded = false, days = 7 }: AttackHeatmapProps) {
  const normalizedAlarms = alarms
    .map((alarm) => {
      const parsed = normalizeAlarmDate(alarm.timestamp);
      if (!parsed) return null;

      return {
        hour: parsed.getHours(),
        dayKey: parsed.toISOString().slice(0, 10),
        score: alarm.score ?? 0,
      };
    })
    .filter((alarm): alarm is NonNullable<typeof alarm> => alarm !== null);

  const referenceDate = normalizedAlarms.length > 0
    ? new Date(Math.max(...normalizedAlarms.map((alarm) => new Date(`${alarm.dayKey}T00:00:00`).getTime())))
    : new Date();
  const dayBuckets = buildDayBuckets(days, referenceDate);
  const dayKeys = new Set(dayBuckets.map((bucket) => bucket.key));

  const cellMap = new Map<string, number>();
  normalizedAlarms.forEach((alarm) => {
    if (!dayKeys.has(alarm.dayKey)) return;
    const key = `${alarm.dayKey}:${alarm.hour}`;
    cellMap.set(key, (cellMap.get(key) ?? 0) + Math.max(1, alarm.score / 10));
  });

  const maxIntensity = Math.max(...Array.from(cellMap.values()), 1);
  const densestEntry = Array.from(cellMap.entries()).sort((a, b) => b[1] - a[1])[0] ?? null;
  const activeDayCount = dayBuckets.filter((bucket) =>
    HOUR_LABELS.some((hour) => cellMap.has(`${bucket.key}:${hour}`)),
  ).length;

  const densestWindowLabel = densestEntry
    ? (() => {
        const [dayKey, hourString] = densestEntry[0].split(":");
        const dayLabel = dayBuckets.find((bucket) => bucket.key === dayKey)?.label ?? dayKey;
        return `${dayLabel} · ${hourString.padStart(2, "0")}h`;
      })()
    : "Aucune";

  return (
    <div
      className={embedded ? undefined : "chart-card"}
      style={
        embedded
          ? {
              padding: 22,
              borderRadius: 22,
              border: "1px solid rgba(148,163,184,0.12)",
              background:
                "radial-gradient(circle at top right, rgba(53,212,255,0.08), transparent 30%), linear-gradient(180deg, rgba(8,15,28,0.98), rgba(15,23,42,0.9))",
            }
          : undefined
      }
    >
      {!embedded && (
        <div className="chart-header">
          <span className="chart-title">Attack Heatmap</span>
          <div className="legend-row">
            <span className="leg-item" style={{ color: "#35d4ff" }}>● faible</span>
            <span className="leg-item" style={{ color: "#fbbf24" }}>● soutenu</span>
            <span className="leg-item" style={{ color: "#ff5b7f" }}>● critique</span>
          </div>
        </div>
      )}

      {embedded && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid rgba(53,212,255,0.22)",
                background: "rgba(53,212,255,0.1)",
                color: "#7dd3fc",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.08em",
              }}
            >
              FENETRES ACTIVES {activeDayCount}/{days}
            </span>
            <span
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid rgba(251,191,36,0.22)",
                background: "rgba(251,191,36,0.1)",
                color: "#fbbf24",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.08em",
              }}
            >
              PIC {densestWindowLabel}
            </span>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: "#8ba5c0" }}>
            <span>● faible</span>
            <span style={{ color: "#fbbf24" }}>● soutenu</span>
            <span style={{ color: "#ff5b7f" }}>● critique</span>
          </div>
        </div>
      )}

      {alarms.length === 0 ? (
        <div className="chart-empty" style={{ minHeight: embedded ? 300 : undefined }}>
          Aucune alarme live disponible pour la heatmap.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <div
            style={{
              minWidth: 820,
              display: "grid",
              gridTemplateColumns: "84px repeat(24, minmax(24px, 1fr))",
              gap: 6,
              alignItems: "center",
            }}
          >
            <div />
            {HOUR_LABELS.map((hour) => (
              <div
                key={hour}
                style={{
                  fontSize: 10,
                  textAlign: "center",
                  color: "#64748b",
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.04em",
                }}
              >
                {String(hour).padStart(2, "0")}
              </div>
            ))}

            {dayBuckets.map((bucket) => (
              <div key={bucket.key} style={{ display: "contents" }}>
                <div
                  style={{
                    fontSize: 10,
                    color: "#94a3b8",
                    fontFamily: "var(--font-mono)",
                    letterSpacing: "0.08em",
                    paddingRight: 10,
                  }}
                >
                  {bucket.label}
                </div>
                {HOUR_LABELS.map((hour) => {
                  const rawValue = cellMap.get(`${bucket.key}:${hour}`) ?? 0;
                  const scaledValue = Math.round((rawValue / maxIntensity) * 100);

                  return (
                    <div
                      key={`${bucket.key}-${hour}`}
                      title={`${bucket.label} ${String(hour).padStart(2, "0")}h · intensite ${scaledValue}%`}
                      style={{
                        height: embedded ? 28 : 22,
                        borderRadius: 8,
                        background: intensityColor(scaledValue),
                        border: scaledValue > 0
                          ? "1px solid rgba(255,255,255,0.04)"
                          : "1px solid rgba(148,163,184,0.06)",
                        boxShadow: scaledValue > 60 ? "0 0 22px rgba(255,91,127,0.12)" : "none",
                        transition: "transform .2s ease, box-shadow .2s ease",
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        className="chart-footer"
        style={{
          marginTop: 16,
          paddingTop: 12,
          borderTop: "1px solid rgba(148,163,184,0.08)",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span className="stat-mini">{alarms.length} alarmes analysees</span>
        <span className="stat-mini">{activeDayCount} jours avec activite visible</span>
        <span className="stat-mini">Cellules basees uniquement sur les alarmes live/backend</span>
      </div>
    </div>
  );
}
