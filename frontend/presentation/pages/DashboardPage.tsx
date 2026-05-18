// presentation/pages/DashboardPage.tsx
// ═══════════════════════════════════════════════════════════════════
// SOURCE UNIQUE DE VÉRITÉ : useIdpsDashboard
// Zéro mock · Zéro useAnalyticsViewModel · Zéro useCorrelationViewModel
// Tous les charts reçoivent des données réelles du backend Flask/WS
// ═══════════════════════════════════════════════════════════════════

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { FC } from "react";
import { useNavigate } from "react-router-dom";

// ── Infrastructure ────────────────────────────────────────────────
import { useAuth }         from "../../infrastructure/auth/useAuth";
import { restartPipeline } from "../../infrastructure/websocket/idpsDashboardApi";

// ── Application — SOURCE UNIQUE ───────────────────────────────────
import { useIdpsDashboard } from "../../application/services/useIdpsDashboard";

// ── Presentation hooks ────────────────────────────────────────────
import { useDarkMode } from "../hooks/useDarkMode";

// ── Composants existants (INCHANGÉS) ─────────────────────────────
import MinimizationChart        from "../components/dashboard/MinimizationChart";
import { Sidebar }              from "../components/dashboard/Sidebar";
import { TopBar }               from "../components/dashboard/TopBar";
import { DashboardPanel }       from "../components/dashboard/DashboardPanel";
import { CorrectiveAgentPanel } from "../components/dashboard/CorrectiveAgentPanel";
import { TrackServersPanel }    from "../components/dashboard/TrackServersPanel";

// ── Nouveaux composants analytiques ──────────────────────────────
import { EntropyChart }          from "../components/charts/EntropyChart";
import { AttackHeatmap }         from "../components/charts/AttackHeatmap";
import { RadarEngineChart }      from "../components/charts/RadarEngineChart";
import { StreamingPipeline }     from "../components/charts/StreamingPipeline";
import { BacktestAccuracyChart } from "../components/charts/BacktestAccuracyChart";
import { AttackTimelinePanel } from "../components/panels/AttackTimelinePanel";
import { ExplainabilityPanel } from "../components/panels/ExplainibilityPanel";
import { AdaptiveThresholdPanel } from "../components/panels/AdaptiveThresholdPanel";

// ── Types ─────────────────────────────────────────────────────────
import type { EntropyPoint } from "../../shared/types/analytics";
import type { TrustData } from "../../shared/types/idps";

// ── Styles ────────────────────────────────────────────────────────
import "../../shared/style/global.css";
import "../../shared/style/theme.css";
import "../../shared/style/Sidebar.css";
import { ChatBot } from "../components/Chat/ChatBot";
import { ForecastPanel } from "../components/forecast/ForecastPanel";

type Section = "dashboard" | "track" | "corrective" | "forecast";

type PredictionSummary = {
  available: boolean;
  prediction_score: number;
  flags: string[];
  predicted_events: string[];
  message?: string;
  risk_evolution: Array<{ time: string; risk: number; failures: number }>;
  behavioral_analysis: {
    ssh_failures_trend: number;
    unique_ips_trend: number;
    username_diversity: number;
    ftp_activity: number;
    kernel_errors: number;
  };
  prevention_suggestions: string[];
  risk_level: string;
};

const FALLBACK_TRUST: TrustData = {
  available: false,
  model_agreement: null,
  false_positive_rate: null,
  drift_score: null,
  drift_label: "UNKNOWN",
  drift_flagged: false,
  stability: "UNKNOWN",
  confidence_in_metrics: null,
  confidence_label: "Unavailable",
  signals_summary: "",
};

// ════════════════════════════════════════════════════════════════
// StarField — animation décorative (inchangée)
// ════════════════════════════════════════════════════════════════
const StarField = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let W = window.innerWidth;
    let H = window.innerHeight;
    canvas.width = W;
    canvas.height = H;

    const stars = Array.from({ length: 160 }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 1.2 + 0.2,
      vx: (Math.random() - 0.5) * 0.12, vy: (Math.random() - 0.5) * 0.12,
      alpha: Math.random() * 0.5 + 0.15,
      twinkle: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.012 + Math.random() * 0.02,
      hue: Math.random() < 0.15
        ? (Math.random() < 0.5 ? "108,92,231" : "0,245,255")
        : "255,255,255",
    }));

    const shooters: {
      x: number; y: number; len: number;
      vx: number; vy: number; life: number; maxLife: number;
    }[] = [];
    let shooterTimer = 0;

    const addShooter = () => {
      const angle = (Math.random() * 30 - 60) * (Math.PI / 180);
      const speed = 6 + Math.random() * 8;
      shooters.push({
        x: Math.random() * W, y: Math.random() * H * 0.5,
        len: 80 + Math.random() * 80,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 0, maxLife: 45 + Math.random() * 20,
      });
    };

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      for (const s of stars) {
        s.twinkle += s.twinkleSpeed;
        const alpha = s.alpha * (0.7 + 0.3 * Math.sin(s.twinkle));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${s.hue},${alpha})`;
        ctx.fill();
        s.x += s.vx; s.y += s.vy;
        if (s.x < 0) s.x = W; if (s.x > W) s.x = 0;
        if (s.y < 0) s.y = H; if (s.y > H) s.y = 0;
      }
      shooterTimer++;
      if (shooterTimer > 220 + Math.random() * 300) { addShooter(); shooterTimer = 0; }
      for (let i = shooters.length - 1; i >= 0; i--) {
        const sh = shooters[i];
        const progress = sh.life / sh.maxLife;
        const alpha = progress < 0.2 ? progress / 0.2 : 1 - (progress - 0.2) / 0.8;
        const grad = ctx.createLinearGradient(
          sh.x - sh.vx * (sh.len / 10), sh.y - sh.vy * (sh.len / 10), sh.x, sh.y,
        );
        grad.addColorStop(0, "rgba(255,255,255,0)");
        grad.addColorStop(0.6, `rgba(180,160,255,${alpha * 0.5})`);
        grad.addColorStop(1, `rgba(255,255,255,${alpha})`);
        ctx.beginPath();
        ctx.moveTo(sh.x - sh.vx * (sh.len / 10), sh.y - sh.vy * (sh.len / 10));
        ctx.lineTo(sh.x, sh.y);
        ctx.strokeStyle = grad; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.beginPath();
        ctx.arc(sh.x, sh.y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${alpha})`; ctx.fill();
        sh.x += sh.vx; sh.y += sh.vy; sh.life++;
        if (sh.life > sh.maxLife) shooters.splice(i, 1);
      }
      animId = requestAnimationFrame(draw);
    };

    draw();
    const onResize = () => {
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = W; canvas.height = H;
    };
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", onResize); };
  }, []);

  return <canvas ref={canvasRef} className="starfield" aria-hidden="true" />;
};

// ════════════════════════════════════════════════════════════════
// DASHBOARD PAGE — export unique · source unique useIdpsDashboard
// ════════════════════════════════════════════════════════════════
export const DashboardPage = () => {
  const { logout } = useAuth();
  const navigate   = useNavigate();

  const [theme, toggleTheme]                  = useDarkMode();
  const [section, setSection]                 = useState<Section>("dashboard");
  const [selectedServers, setSelectedServers] = useState<string[]>([]);
  const [relancerLoading, setRelancerLoading] = useState(false);
  const [prediction, setPrediction]           = useState<PredictionSummary | null>(null);
  const [dashboardTab, setDashboardTab]       = useState<"liveops" | "analytics" | "pipeline">("liveops");

  const handleSectionChange = useCallback((next: Section) => {
    setSection(next);
    if (next === "dashboard") setDashboardTab("liveops");
  }, []);

  const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

  useEffect(() => {
    let mounted = true;
    const fetchPrediction = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/prediction`);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        if (!mounted) return;
        setPrediction(data);
      } catch (err) {
        console.warn("[DashboardPage] prediction fetch failed", err);
      }
    };

    fetchPrediction();
    const id = setInterval(fetchPrediction, 10000);
    return () => { mounted = false; clearInterval(id); };
  }, [API_BASE]);

  // ╔══════════════════════════════════════════════════════════╗
  // ║   SOURCE UNIQUE — useIdpsDashboard                      ║
  // ║   Tous les composants derivent de ces données           ║
  // ║   WebSocket + Flask REST → ici → charts                 ║
  // ╚══════════════════════════════════════════════════════════╝
  const {
    apiReady,
    loading,
    lastUpdate,
    kpis,
    alarms,
    engines,
    decisions,
    sessions,
    logLines,
    trust,
    activities,
    sessionCount,
    logsAnalysed,
    threatLevel,
    wsConnected,
    isLive,
    suggestions,
  } = useIdpsDashboard(selectedServers);

  // ── Sécurité : tableaux toujours définis ─────────────────────
  const safeAlarms    = useMemo(() => Array.isArray(alarms)    ? alarms    : [], [alarms]);
  const safeEngines   = useMemo(() => Array.isArray(engines)   ? engines   : [], [engines]);
  const safeSessions  = useMemo(() => Array.isArray(sessions)  ? sessions  : [], [sessions]);
  const safeDecisions = useMemo(() => Array.isArray(decisions) ? decisions : [], [decisions]);
  const safeLogLines  = useMemo(() => Array.isArray(logLines)  ? logLines  : [], [logLines]);
  const safeActivities = useMemo(() => Array.isArray(activities) ? activities : [], [activities]);
  const explainabilityTrust = useMemo(() => trust ?? FALLBACK_TRUST, [trust]);

  // ── Alarme critique la plus récente (pour ExplainabilityPanel) ─
  const topAlarm = useMemo(
    () => safeAlarms.find(a => a.severity === "CRITICAL")
       ?? safeAlarms.find(a => a.severity === "HIGH")
       ?? safeAlarms[0]
       ?? null,
    [safeAlarms],
  );

  // ── Accumulation entropy (série temporelle en mémoire) ───────
  const entropyRef     = useRef<EntropyPoint[]>([]);
  const prevEntropyRef = useRef<number | null>(null);
  const [entropyHistory, setEntropyHistory] = useState<EntropyPoint[]>([]);

  useEffect(() => {
    const val = kpis?.ip_entropy ?? null;
    if (val === null || val === prevEntropyRef.current) return;
    prevEntropyRef.current = val;
    const point: EntropyPoint = {
      time:      new Date().toLocaleTimeString("fr-FR"),
      entropy:   val,
      threshold: 3.8,
      ipCount:   kpis?.unique_attacking_ips ?? 0,
    };
    entropyRef.current = [...entropyRef.current.slice(-29), point];
    setEntropyHistory([...entropyRef.current]);
  }, [kpis?.ip_entropy, kpis?.unique_attacking_ips]);

  // ── Handlers ─────────────────────────────────────────────────
  const handleRelancer = useCallback(async () => {
    if (relancerLoading) return;
    setRelancerLoading(true);
    try {
      await restartPipeline();
      setTimeout(() => window.location.reload(), 3000);
    } catch (err) {
      console.error("[RELANCER] Erreur:", err);
    } finally {
      setRelancerLoading(false);
    }
  }, [relancerLoading]);

  const handleServersChange = useCallback((servers: string[]) => {
    setSelectedServers(servers);
  }, []);

  // ─────────────────────────────────────────────────────────────
  return (
    <>
      <ChatBot />
      {theme === "dark" && <StarField />}

      <div className="page-shell">

        <Sidebar
          activeSection={section}
          onSectionChange={handleSectionChange}
          prediction={prediction ?? undefined}
          username={localStorage.getItem("username") || "admin"}
          onLogout={() => { logout(); navigate("/login"); }}
          sessionStats={{
            session:      sessionCount,
            logsAnalysed,
            lastUpdate:   lastUpdate?.toLocaleTimeString("fr-FR") ?? "—",
            threat:       threatLevel,
          }}
        />

        <div className="main-content">

          <TopBar
            section={section}
            apiReady={apiReady}
            lastUpdate={lastUpdate}
            wsConnected={wsConnected}
            isLive={isLive}
            theme={theme}
            onToggleTheme={toggleTheme}
            onRelancer={handleRelancer}
            relancerLoading={relancerLoading}
          />

          <div className="main-content__scroll">

            {/* ══════════════════════════════════════════════════
                SECTION — DASHBOARD (with tabs)
            ══════════════════════════════════════════════════ */}
            {section === "dashboard" && (
              <>
                {/* ── Tab bar ── */}
                <div style={{
                  display: "flex", gap: 4, marginBottom: 16,
                  background: "rgba(15,23,42,0.5)", borderRadius: 8,
                  padding: 4, backdropFilter: "blur(8px)",
                }}>
                  {(["liveops", "analytics", "pipeline"] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setDashboardTab(tab)}
                      style={{
                        flex: 1, padding: "10px 16px", borderRadius: 6,
                        border: "none",
                        background: dashboardTab === tab ? "#1e293b" : "transparent",
                        color: dashboardTab === tab ? "#e2e8f0" : "#64748b",
                        fontWeight: 600, fontSize: 12, cursor: "pointer",
                        fontFamily: "'JetBrains Mono', monospace",
                        transition: "all 0.15s",
                      }}
                    >
                      {tab === "liveops" && "🚀 Live Ops"}
                      {tab === "analytics" && "📊 Threat Analytics"}
                      {tab === "pipeline" && "⚙️ Pipeline & ML Health"}
                    </button>
                  ))}
                </div>

                {/* ── TAB: Live Ops ── */}
                {dashboardTab === "liveops" && (
                  <DashboardPanel
                    kpis={kpis}
                    alarms={safeAlarms}
                    engines={safeEngines}
                    decisions={safeDecisions}
                    logLines={safeLogLines}
                    trust={trust}
                    activities={safeActivities}
                    loading={loading}
                    wsConnected={wsConnected}
                    isLive={isLive}
                  />
                )}

                {/* ── TAB: Threat Analytics ── */}
                {dashboardTab === "analytics" && (
                  <>
                    <MinimizationChart />
                    <div className="analytics-divider" style={{ marginTop: 16, marginBottom: 8 }}>
                      <span className="analytics-divider__label">◈ Deep Analytics</span>
                    </div>
                    <div className="grid-2" style={{ gap: 16 }}>
                      <RadarEngineChart engines={safeEngines} />
                      <AttackHeatmap alarms={safeAlarms} />
                    </div>
                    {safeAlarms.length > 0 && (
                      <section className="analytics-section" style={{ marginTop: 16 }}>
                        <div className="section-title">Attack Reconstruction Timeline</div>
                        <AttackTimelinePanel alarms={safeAlarms} sessions={safeSessions} />
                      </section>
                    )}
                  </>
                )}

                {/* ── TAB: Pipeline & ML Health ── */}
                {dashboardTab === "pipeline" && (
                  <>
                    {/* Feature Analytics */}
                    <div className="grid-2" style={{ gap: 16, marginBottom: 16 }}>
                      <EntropyChart data={entropyHistory} />
                      <AdaptiveThresholdPanel sessions={safeSessions} engines={safeEngines} />
                    </div>

                    {/* Streaming Pipeline */}
                    <section className="analytics-section" style={{ marginBottom: 16 }}>
                      <div className="section-title">Live Streaming Pipeline</div>
                      <StreamingPipeline logs={safeLogLines} sessions={safeSessions} />
                    </section>

                    {/* Trust & Backtest row */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 16,
                        marginBottom: 16,
                      }}
                    >
                      {trust?.available && (
                        <div className="chart-card" style={{ padding: 14 }}>
                          <div className="chart-header">
                            <span className="chart-title">Trust Gate — Score de confiance</span>
                          </div>
                          <TrustPanel trust={trust} />
                        </div>
                      )}
                      <BacktestAccuracyChart />
                    </div>

                    {/* Explainable AI (full width, interactive) */}
                    <section className="analytics-section">
                      <ExplainabilityPanel
                        decisions={safeDecisions}
                        suggestions={suggestions}
                        trust={explainabilityTrust}
                        topAlarm={topAlarm}
                        kpis={kpis ?? null}
                        engines={safeEngines}
                      />
                    </section>
                  </>
                )}
              </>
            )}

            {/* ══════════════════════════════════════════════════
                SECTION — AGENT CORRECTEUR (INCHANGÉ)
            ══════════════════════════════════════════════════ */}
            {section === "corrective" && (
              <CorrectiveAgentPanel
                suggestions={suggestions}
                wsConnected={wsConnected}
              />
            )}

            {/* ══════════════════════════════════════════════════
                SECTION — TRACK SERVERS (INCHANGÉ)
            ══════════════════════════════════════════════════ */}
            {section === "track" && (
              <TrackServersPanel
                kpis={kpis}
                alarms={safeAlarms}
                loading={loading}
                wsConnected={wsConnected}
                onServersChange={handleServersChange}
              />
            )}

            {section === "forecast" && <ForecastPanel />}

          </div>
        </div>
      </div>
    </>
  );
};

// ── TrustPanel extracted to be reused ──
// (You can keep this inside DashboardPanel or move it to a separate file;
//  for simplicity, I duplicate it here – in production, extract it to its own file.)
const TrustPanel: FC<{ trust: TrustData | null }> = ({ trust }) => {
  if (!trust?.available) return <div>No trust data</div>;
  const score = trust.confidence_in_metrics ?? 0;
  const scoreColor = score >= 0.8 ? "#0F6E56" : score >= 0.6 ? "#854F0B" : "#A32D2D";
  const pct = Math.round(score * 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ position: "relative", width: 56, height: 56 }}>
          <svg viewBox="0 0 56 56" width={56} height={56}>
            <circle cx={28} cy={28} r={24} fill="none" stroke="var(--color-background-secondary,#f3f4f6)" strokeWidth={5}/>
            <circle cx={28} cy={28} r={24} fill="none" stroke={scoreColor} strokeWidth={5}
              strokeDasharray={`${(pct/100)*150.8} 150.8`} strokeLinecap="round" transform="rotate(-90 28 28)"/>
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: scoreColor }}>{pct}%</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{trust.confidence_label}</div>
          <div style={{ fontSize: 10, color: "#64748b" }}>Score de confiance</div>
        </div>
      </div>
      {([
        ["Accord modèles", `${((trust.model_agreement??0)*100).toFixed(0)}%`, (trust.model_agreement??0)>=0.8],
        ["Taux FP", `${((trust.false_positive_rate??0)*100).toFixed(1)}%`, (trust.false_positive_rate??0)<=0.1],
        ["Drift", `${trust.drift_score?.toFixed(3)??"—"} (${trust.drift_label})`, !trust.drift_flagged],
        ["Stabilité", trust.stability, trust.stability==="HIGH"],
      ] as [string,string,boolean][]).map(([k,v,ok]) => (
        <div key={k} style={{ display:"flex", justifyContent:"space-between", fontSize:11 }}>
          <span style={{ color:"var(--muted,#6b7280)" }}>{k}</span>
          <span style={{ color: ok ? "#0F6E56" : "#A32D2D", fontFamily:"monospace", fontWeight:500 }}>{v}</span>
        </div>
      ))}
    </div>
  );
};

export default DashboardPage;
