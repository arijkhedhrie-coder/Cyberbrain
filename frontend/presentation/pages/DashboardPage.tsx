// presentation/pages/DashboardPage.tsx
// ═══════════════════════════════════════════════════════════════════
// SOURCE UNIQUE DE VÉRITÉ : useIdpsDashboard
// Zéro mock · Zéro useAnalyticsViewModel · Zéro useCorrelationViewModel
// Tous les charts reçoivent des données réelles du backend Flask/WS
// ═══════════════════════════════════════════════════════════════════

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
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
// Chaque composant reçoit ses props directement depuis useIdpsDashboard
import { EntropyChart }          from "../components/charts/EntropyChart";
import { AttackHeatmap }         from "../components/charts/AttackHeatmap";
import { RadarEngineChart }      from "../components/charts/RadarEngineChart";
import { StreamingPipeline }     from "../components/charts/StreamingPipeline";
import { ConfusionMatrix }       from "../components/charts/ConfusionMatrics";
import { AttackTimelinePanel } from "../components/panels/AttackTimelinePanel";
import { ExplainabilityPanel } from "../components/panels/ExplainibilityPanel";
import { AdaptiveThresholdPanel } from "../components/panels/AdaptiveThresholdPanel";

// ── Types ─────────────────────────────────────────────────────────
import type { EntropyPoint } from "../../shared/types/analytics";

// ── Styles ────────────────────────────────────────────────────────
import "../../shared/style/global.css";
import "../../shared/style/theme.css";
import "../../shared/style/Sidebar.css";

type Section = "dashboard" | "track" | "corrective";

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

  // ╔══════════════════════════════════════════════════════════╗
  // ║   SOURCE UNIQUE — useIdpsDashboard                      ║
  // ║   Tous les composants derivent de ces données           ║
  // ║   WebSocket + Flask REST → ici → charts                 ║
  // ╚══════════════════════════════════════════════════════════╝
  const {
    apiReady,
    loading,
    lastUpdate,
    kpis,        // /api/kpis        → health_score, ip_entropy, ssh_failures...
    alarms,      // /api/alarms + WS → liste des alarmes temps réel
    engines,     // /api/engine-scores → SSH/WEB/FTP/KERNEL pass1/pass2/alarms
    decisions,   // /api/decisions   → actions agents CrewAI
    sessions,    // /api/sessions    → historique sessions pipeline
    logLines,    // WebSocket "log"  → logs pipeline temps réel
    trust,       // /api/trust       → model_agreement, drift, fpr
    sessionCount,
    logsAnalysed,
    threatLevel,
    wsConnected,
    isLive,
    suggestions, // WebSocket "suggestion" → agent correcteur
  } = useIdpsDashboard(selectedServers);

  // ── Sécurité : tableaux toujours définis ─────────────────────
  const safeAlarms    = useMemo(() => Array.isArray(alarms)    ? alarms    : [], [alarms]);
  const safeEngines   = useMemo(() => Array.isArray(engines)   ? engines   : [], [engines]);
  const safeSessions  = useMemo(() => Array.isArray(sessions)  ? sessions  : [], [sessions]);
  const safeDecisions = useMemo(() => Array.isArray(decisions) ? decisions : [], [decisions]);
  const safeLogLines  = useMemo(() => Array.isArray(logLines)  ? logLines  : [], [logLines]);

  // ── Alarme critique la plus récente (pour ExplainabilityPanel) ─
  const topAlarm = useMemo(
    () => safeAlarms.find(a => a.severity === "CRITICAL")
       ?? safeAlarms.find(a => a.severity === "HIGH")
       ?? safeAlarms[0]
       ?? null,
    [safeAlarms],
  );

  // ── Accumulation entropy (série temporelle en mémoire) ───────
  // kpis.ip_entropy = scalaire. On accumule ici → courbe EntropyChart.
  // Aucun endpoint backend supplémentaire nécessaire.
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
      {theme === "dark" && <StarField />}

      <div className="page-shell">

        <Sidebar
          activeSection={section}
          onSectionChange={setSection}
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
                SECTION — DASHBOARD
            ══════════════════════════════════════════════════ */}
            {section === "dashboard" && (
              <>
                {/* ── Panneau principal existant (INCHANGÉ) ── */}
                <DashboardPanel
                  kpis={kpis}
                  alarms={safeAlarms}
                  engines={safeEngines}
                  decisions={safeDecisions}
                  sessions={safeSessions}
                  logLines={safeLogLines}
                  trust={trust}
                  loading={loading}
                  wsConnected={wsConnected}
                  isLive={isLive}
                  suggestions={suggestions}
                />

                {/* ── Courbe minimisation existante (INCHANGÉE) ── */}
                <MinimizationChart />

                {/* ══════════════════════════════════════════════
                    DEEP ANALYTICS SECTION
                    Séparateur visuel entre existant et nouveaux charts
                ══════════════════════════════════════════════ */}
                <div className="analytics-divider">
                  <span className="analytics-divider__label">
                    ◈ Deep Analytics — Visualisation Temps Réel
                  </span>
                </div>

                {/* ────────────────────────────────────────────
                    1. LIVE STREAMING PIPELINE
                    Source : logLines (WS) + sessions (REST)
                    Affiche les étapes du pipeline en temps réel
                ──────────────────────────────────────────── */}
                <section className="analytics-section">
                  <div className="section-title">Live Streaming Pipeline</div>
                  <StreamingPipeline
                    logs={safeLogLines}
                    sessions={safeSessions}
                  />
                </section>

                {/* ────────────────────────────────────────────
                    2. FEATURE ANALYTICS
                    EntropyChart     : kpis.ip_entropy accumulé
                    AdaptiveThreshold: sessions + engines (pass1/pass2)
                ──────────────────────────────────────────── */}
                <section className="analytics-section">
                  <div className="section-title">Feature Analytics</div>
                  <div className="grid-2">
                    <EntropyChart data={entropyHistory} />
                    <AdaptiveThresholdPanel
                      sessions={safeSessions}
                      engines={safeEngines}
                    />
                  </div>
                </section>

                {/* ────────────────────────────────────────────
                    3. MULTI-ENGINE DETECTION
                    RadarEngineChart : engines[] (pass1/pass2/alarms/status)
                    AttackHeatmap    : alarms[] (timestamp/engine/score)
                ──────────────────────────────────────────── */}
                <section className="analytics-section">
                  <div className="section-title">Multi-Engine Detection</div>
                  <div className="grid-2">
                    <RadarEngineChart engines={safeEngines} />
                    <AttackHeatmap alarms={safeAlarms} />
                  </div>
                </section>

                {/* ────────────────────────────────────────────
                    4. EXPLAINABLE AI
                    Source : decisions + suggestions + trust + kpis
                    Affiché seulement si trust disponible (backend actif)
                ──────────────────────────────────────────── */}
                {trust?.available && (
                  <section className="analytics-section">
                    <div className="section-title">
                      Explainable AI — Pourquoi cette alarme ?
                    </div>
                    <ExplainabilityPanel
                      decisions={safeDecisions}
                      suggestions={suggestions}
                      trust={trust}
                      topAlarm={topAlarm}
                      kpis={kpis ?? null}
                      engines={safeEngines}
                    />
                  </section>
                )}

                {/* ────────────────────────────────────────────
                    5. ATTACK RECONSTRUCTION TIMELINE
                    Source : alarms[] + sessions[]
                    Affiché seulement si des alarmes existent
                ──────────────────────────────────────────── */}
                {safeAlarms.length > 0 && (
                  <section className="analytics-section">
                    <div className="section-title">
                      Attack Reconstruction Timeline
                    </div>
                    <AttackTimelinePanel
                      alarms={safeAlarms}
                      sessions={safeSessions}
                    />
                  </section>
                )}

                {/* ────────────────────────────────────────────
                    6. DETECTION PERFORMANCE
                    Source : decisions[] + alarms[]
                    Affiché seulement si des décisions existent
                ──────────────────────────────────────────── */}
                {safeDecisions.length > 0 && (
                  <section className="analytics-section">
                    <div className="section-title">Detection Performance</div>
                    <ConfusionMatrix
                      decisions={safeDecisions}
                      alarms={safeAlarms}
                    />
                  </section>
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

          </div>
        </div>
      </div>
    </>
  );
};

export default DashboardPage;