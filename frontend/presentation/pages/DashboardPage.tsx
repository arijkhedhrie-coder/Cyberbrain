// presentation/pages/DashboardPage.tsx
// ═══════════════════════════════════════════════════════════════════
// SOURCE UNIQUE DE VÉRITÉ : useIdpsDashboard
// Zéro mock · Zéro useAnalyticsViewModel · Zéro useCorrelationViewModel
// Tous les charts reçoivent des données réelles du backend Flask/WS
// ═══════════════════════════════════════════════════════════════════

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";

// ── Infrastructure ────────────────────────────────────────────────
import { useAuth } from "../../infrastructure/auth/useAuth";
import { restartPipeline } from "../../infrastructure/websocket/idpsDashboardApi";

// ── Application — SOURCE UNIQUE ───────────────────────────────────
import { useIdpsDashboard } from "../../application/services/useIdpsDashboard";

// ── Presentation hooks ────────────────────────────────────────────
import { useDarkMode } from "../hooks/useDarkMode";

// ── Composants existants (INCHANGÉS) ─────────────────────────────
import { Sidebar } from "../components/dashboard/Sidebar";
import { TopBar } from "../components/dashboard/TopBar";
import { DashboardPanel } from "../components/dashboard/DashboardPanel";
import { CorrectiveAgentPanel } from "../components/dashboard/CorrectiveAgentPanel";
import { ThreatAnalyticsView } from "../components/dashboard/ThreatAnalyticsView";
import { ServerSelector } from "../components/dashboard/ServerSelector";

// ── Nouveaux composants analytiques ──────────────────────────────
import { PipelineObservabilityTab } from "../components/dashboard/PipelineObservabilityTab";
import { FusionPanel } from "../components/fusion/FusionPanel";

// ── Styles ────────────────────────────────────────────────────────
import "../../shared/style/Global.css";
import "../../shared/style/theme.css";
import "../../shared/style/Sidebar.css";
import { ChatBot } from "../components/Chat/ChatBot";
import { ForecastPanel } from "../components/forecast/ForecastPanel";

type Section = "dashboard" | "corrective" | "forecast" | "fusion";

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
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.2 + 0.2,
      vx: (Math.random() - 0.5) * 0.12,
      vy: (Math.random() - 0.5) * 0.12,
      alpha: Math.random() * 0.5 + 0.15,
      twinkle: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.012 + Math.random() * 0.02,
      hue:
        Math.random() < 0.15
          ? Math.random() < 0.5
            ? "108,92,231"
            : "0,245,255"
          : "255,255,255",
    }));

    const shooters: {
      x: number;
      y: number;
      len: number;
      vx: number;
      vy: number;
      life: number;
      maxLife: number;
    }[] = [];
    let shooterTimer = 0;

    const addShooter = () => {
      const angle = (Math.random() * 30 - 60) * (Math.PI / 180);
      const speed = 6 + Math.random() * 8;
      shooters.push({
        x: Math.random() * W,
        y: Math.random() * H * 0.5,
        len: 80 + Math.random() * 80,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 45 + Math.random() * 20,
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
        s.x += s.vx;
        s.y += s.vy;
        if (s.x < 0) s.x = W;
        if (s.x > W) s.x = 0;
        if (s.y < 0) s.y = H;
        if (s.y > H) s.y = 0;
      }
      shooterTimer++;
      if (shooterTimer > 220 + Math.random() * 300) {
        addShooter();
        shooterTimer = 0;
      }
      for (let i = shooters.length - 1; i >= 0; i--) {
        const sh = shooters[i];
        const progress = sh.life / sh.maxLife;
        const alpha =
          progress < 0.2 ? progress / 0.2 : 1 - (progress - 0.2) / 0.8;
        const grad = ctx.createLinearGradient(
          sh.x - sh.vx * (sh.len / 10),
          sh.y - sh.vy * (sh.len / 10),
          sh.x,
          sh.y
        );
        grad.addColorStop(0, "rgba(255,255,255,0)");
        grad.addColorStop(0.6, `rgba(180,160,255,${alpha * 0.5})`);
        grad.addColorStop(1, `rgba(255,255,255,${alpha})`);
        ctx.beginPath();
        ctx.moveTo(
          sh.x - sh.vx * (sh.len / 10),
          sh.y - sh.vy * (sh.len / 10)
        );
        ctx.lineTo(sh.x, sh.y);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(sh.x, sh.y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.fill();
        sh.x += sh.vx;
        sh.y += sh.vy;
        sh.life++;
        if (sh.life > sh.maxLife) shooters.splice(i, 1);
      }
      animId = requestAnimationFrame(draw);
    };

    draw();
    const onResize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W;
      canvas.height = H;
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="starfield" aria-hidden="true" />;
};

// ════════════════════════════════════════════════════════════════
// DASHBOARD PAGE — export unique · source unique useIdpsDashboard
// ════════════════════════════════════════════════════════════════
export const DashboardPage = () => {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [theme, toggleTheme] = useDarkMode();
  const [section, setSection] = useState<Section>("dashboard");
  const [selectedDataset, setSelectedDataset] = useState<string>(
    () => localStorage.getItem("selected_dataset") || ""
  );
  const [relancerLoading, setRelancerLoading] = useState(false);
  const [prediction, setPrediction] = useState<PredictionSummary | null>(null);
  const [dashboardTab, setDashboardTab] = useState<
    "liveops" | "analytics" | "pipeline"
  >("liveops");
  const isFusionView = ["fusion", "__fusion__", "merged", "__merged__"].includes(
    selectedDataset.toLowerCase()
  );

  const handleSectionChange = useCallback((next: Section) => {
    setSection(next);
    if (next === "dashboard") setDashboardTab("liveops");
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [section]);

  const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

  useEffect(() => {
    let mounted = true;
    const fetchPrediction = async () => {
      try {
        const query = selectedDataset
          ? `?dataset=${encodeURIComponent(selectedDataset)}`
          : "";
        const res = await fetch(`${API_BASE}/api/prediction${query}`);
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
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [API_BASE, selectedDataset]);

  // ╔══════════════════════════════════════════════════════════╗
  // ║   SOURCE UNIQUE — useIdpsDashboard                      ║
  // ║   Tous les composants derivent de ces données           ║
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
    thresholdHistory,
    explainability,
    pipeline,
    logLines,
    trust,
    activities,
    sessionCount,
    logsAnalysed,
    threatLevel,
    wsConnected,
    isLive,
    suggestions,
  } = useIdpsDashboard(selectedDataset);

  // ── Sécurité : tableaux toujours définis ─────────────────────
  const safeAlarms = useMemo(
    () => (Array.isArray(alarms) ? alarms : []),
    [alarms]
  );
  const safeEngines = useMemo(
    () => (Array.isArray(engines) ? engines : []),
    [engines]
  );
  const safeSessions = useMemo(
    () => (Array.isArray(sessions) ? sessions : []),
    [sessions]
  );
  const safeDecisions = useMemo(
    () => (Array.isArray(decisions) ? decisions : []),
    [decisions]
  );
  const safeThresholdHistory = useMemo(
    () => (Array.isArray(thresholdHistory) ? thresholdHistory : []),
    [thresholdHistory]
  );
  const safePipeline = useMemo(
    () => (pipeline && typeof pipeline === "object" ? pipeline : null),
    [pipeline]
  );
  const safeLogLines = useMemo(
    () => (Array.isArray(logLines) ? logLines : []),
    [logLines]
  );
  const safeActivities = useMemo(
    () => (Array.isArray(activities) ? activities : []),
    [activities]
  );

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

  const handleServersChange = useCallback((dataset: string) => {
    setSelectedDataset(dataset);
    localStorage.setItem("selected_dataset", dataset);
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
          onLogout={() => {
            logout();
            navigate("/login");
          }}
          sessionStats={{
            session: sessionCount,
            logsAnalysed,
            lastUpdate: lastUpdate?.toLocaleTimeString("fr-FR") ?? "—",
            threat: threatLevel,
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

          <div className="main-content__scroll" ref={scrollRef}>
            {/* ── Sélecteur de dataset (caché uniquement sur la page fusion) ── */}
            {section !== "fusion" && (
              <div style={{ marginBottom: 16 }}>
                <ServerSelector
                  selected={selectedDataset}
                  onChange={handleServersChange}
                />
              </div>
            )}

            {/* ══════════════════════════════════════════════════
                SECTION — DASHBOARD (with tabs)
            ══════════════════════════════════════════════════ */}
            {section === "dashboard" && (
              <>
                {/* ── Tab bar ── */}
                <div
                  style={{
                    display: "flex",
                    gap: 4,
                    marginBottom: 16,
                    background: "rgba(15,23,42,0.5)",
                    borderRadius: 8,
                    padding: 4,
                    backdropFilter: "blur(8px)",
                  }}
                >
                  {(["liveops", "analytics", "pipeline"] as const).map(
                    (tab) => (
                      <button
                        key={tab}
                        onClick={() => setDashboardTab(tab)}
                        style={{
                          flex: 1,
                          padding: "10px 16px",
                          borderRadius: 6,
                          border: "none",
                          background:
                            dashboardTab === tab ? "#1e293b" : "transparent",
                          color: dashboardTab === tab ? "#e2e8f0" : "#64748b",
                          fontWeight: 600,
                          fontSize: 12,
                          cursor: "pointer",
                          fontFamily: "'JetBrains Mono', monospace",
                          transition: "all 0.15s",
                        }}
                      >
                        {tab === "liveops" && "Operations en direct"}
                        {tab === "analytics" && "Analyse des menaces"}
                        {tab === "pipeline" && "Sante du pipeline"}
                      </button>
                    )
                  )}
                  <div
                    style={{
                      width: 1,
                      height: 28,
                      background: "#1e293b",
                      margin: "0 4px",
                    }}
                  />

                  {/* Badges d’état (seulement dans le dashboard) */}
                  <span
                    style={{
                      fontSize: 10,
                      padding: "4px 10px",
                      borderRadius: 999,
                      border: `1px solid ${
                        isFusionView
                          ? "rgba(56,189,248,0.4)"
                          : "rgba(29,158,117,0.24)"
                      }`,
                      background: isFusionView
                        ? "rgba(8,47,73,0.55)"
                        : "rgba(15,118,110,0.16)",
                      color: isFusionView ? "#7dd3fc" : "#6ee7b7",
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {isFusionView ? "VUE CONSOLIDEE" : "DATASET LOCAL"}
                  </span>
                  {isFusionView && (
                    <span
                      style={{
                        fontSize: 10,
                        padding: "4px 10px",
                        borderRadius: 999,
                        border: "1px solid rgba(251,191,36,0.4)",
                        background: "rgba(120,53,15,0.34)",
                        color: "#fcd34d",
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      LECTURE SEULE
                    </span>
                  )}
                </div>

                {isFusionView && (
                  <div
                    style={{
                      marginBottom: 16,
                      padding: "14px 16px",
                      borderRadius: 12,
                      border: "1px solid rgba(56,189,248,0.28)",
                      background:
                        "linear-gradient(135deg, rgba(8,47,73,0.58), rgba(15,23,42,0.74))",
                      color: "#dbeafe",
                      fontSize: 12,
                      lineHeight: 1.5,
                    }}
                  >
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 8,
                        padding: "4px 10px",
                        borderRadius: 999,
                        background: "rgba(125,211,252,0.14)",
                        border: "1px solid rgba(125,211,252,0.22)",
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      VUE CONSOLIDEE · LECTURE SEULE
                    </div>
                    <div>
                      Cette vue regroupe les signaux de tous les serveurs pour
                      donner une conclusion commune. Les blocages, seuils,
                      corrections et mises a jour restent locaux a chaque
                      serveur.
                    </div>
                  </div>
                )}

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
                    isFusionView={isFusionView}
                  />
                )}

                {/* ── TAB: Threat Analytics ── */}
                {dashboardTab === "analytics" && (
                  <ThreatAnalyticsView
                    dataset={selectedDataset}
                    kpis={kpis ?? null}
                    alarms={safeAlarms}
                    engines={safeEngines}
                    sessions={safeSessions}
                  />
                )}

                {/* ── TAB: Pipeline & ML Health ── */}
                {dashboardTab === "pipeline" && (
                  <PipelineObservabilityTab
                    alarms={safeAlarms}
                    explainability={explainability}
                    kpis={kpis}
                    pipeline={safePipeline}
                    thresholdHistory={safeThresholdHistory}
                    trust={trust}
                  />
                )}
              </>
            )}

            {/* ══════════════════════════════════════════════════
                SECTION — AGENT CORRECTEUR
            ══════════════════════════════════════════════════ */}
            {section === "corrective" &&
              (isFusionView ? (
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    background: "#0a0e1a",
                    color: "#c9d1e0",
                    padding: "20px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.07)",
                  }}
                >
                  La vue consolidee est en lecture seule. Pour valider ou
                  corriger des suggestions, revenez a un serveur precis.
                </div>
              ) : (
                <CorrectiveAgentPanel
                  suggestions={suggestions}
                  activities={safeActivities}
                  alarms={safeAlarms}
                  wsConnected={wsConnected}
                  selectedDataset={selectedDataset}
                />
              ))}

            {/* ══════════════════════════════════════════════════
                SECTION — FUSION (consolidée)
            ══════════════════════════════════════════════════ */}
            {section === "fusion" && (
              <>
                {/* Bandeau d’information (optionnel) */}
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    marginBottom: 16,
                    alignItems: "center",
                    flexWrap: "wrap",
                    background: "rgba(15,23,42,0.5)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    backdropFilter: "blur(8px)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: "#7dd3fc",
                      fontWeight: 800,
                      letterSpacing: "0.14em",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    VUE CONSOLIDEE - PERIMETRE SERVEURS
                  </div>
                  <span
                    style={{
                      fontSize: 10,
                      padding: "4px 10px",
                      borderRadius: 999,
                      border: `1px solid ${
                        isFusionView
                          ? "rgba(56,189,248,0.4)"
                          : "rgba(148,163,184,0.24)"
                      }`,
                      background: isFusionView
                        ? "rgba(8,47,73,0.55)"
                        : "rgba(51,65,85,0.34)",
                      color: isFusionView ? "#7dd3fc" : "#cbd5e1",
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {isFusionView ? "VUE COMMUNE" : "RETOUR LOCAL"}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      padding: "4px 10px",
                      borderRadius: 999,
                      border: "1px solid rgba(251,191,36,0.3)",
                      background: "rgba(120,53,15,0.24)",
                      color: "#fcd34d",
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    LECTURE SEULE
                  </span>
                </div>

                {/* On force le dataset à vide pour obtenir la fusion de tous les datasets */}
                <FusionPanel
                  dataset={section === "fusion" ? "" : selectedDataset}
                  isFusionView={isFusionView}
                />
              </>
            )}

            {/* ══════════════════════════════════════════════════
                SECTION — FORECAST
            ══════════════════════════════════════════════════ */}
            {section === "forecast" && (
  <ForecastPanel 
    dataset={selectedDataset} 
    trust={trust}
    topAlarm={explainability?.top_alarm ?? null}
  />
)}
          </div>
        </div>
      </div>
    </>
  );
};

export default DashboardPage;