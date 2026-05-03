// src/pages/DashboardPage.tsx
// ─────────────────────────────────────────────────────────────────────────────
// FICHIER CORRIGÉ — connecte TrackServersPanel aux données réelles
//                 + intègre CorrectiveAgentPanel sans erreur TypeScript
//
// CORRECTIONS :
//    [C1] Type section étendu : "dashboard" | "track" | "corrective"
//    [C2] Sidebar et TopBar reçoivent le bon type (défini en local)
//    [C3] CorrectiveAgentPanel rendu dans la section "corrective"
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth }           from "../hooks/useAuth";
import { useIdpsDashboard }  from "../hooks/useIdpsDashboard";
import { useDarkMode }       from "../hooks/useDarkMode";

import { Sidebar }              from "../components/dashboard/Sidebar";
import { TopBar }               from "../components/dashboard/TopBar";
import { DashboardPanel }       from "../components/dashboard/DashboardPanel";
import CorrectiveAgentPanel     from "../components/dashboard/CorrectiveAgentPanel";
import { TrackServersPanel }    from "../components/dashboard/TrackServersPanel";

import "../style/global.css";
import "../style/theme.css";
import "../style/Sidebar.css";

// ✅ [C1] Type section centralisé ici — identique à Sidebar.tsx et TopBar.tsx
type Section = "dashboard" | "track" | "corrective";

// ── StarField ─────────────────────────────────────────────────────────────────
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
          sh.x - sh.vx * (sh.len / 10), sh.y - sh.vy * (sh.len / 10),
          sh.x, sh.y,
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

  return <canvas ref={canvasRef} className="starfield" aria-hidden="true"/>;
};

// ── DashboardPage ─────────────────────────────────────────────────────────────
export const DashboardPage = () => {
  const { logout }  = useAuth();
  const navigate    = useNavigate();

  const [theme, toggleTheme] = useDarkMode();

  // ✅ [C1] useState typé avec Section — inclut "corrective"
  const [section, setSection] = useState<Section>("dashboard");
  const [selectedServers, setSelectedServers] = useState<string[]>(["auth", "web"]);

  // ✅ Callback stable
  const handleServersChange = useCallback((servers: string[]) => {
    setSelectedServers(servers);
  }, []);

  // ✅ useIdpsDashboard reçoit selectedServers → filtre REST + WS automatiquement
  const {
    apiReady, loading, lastUpdate,
    kpis, alarms, engines, decisions,
    sessions, logLines, trust,
    sessionCount, logsAnalysed, threatLevel,
    wsConnected, isLive,
  } = useIdpsDashboard(selectedServers);

  return (
    <>
      {theme === "dark" && <StarField/>}

      <div className="page-shell">

        {/* ✅ [C2] Sidebar reçoit section de type Section — pas d'erreur ts(2322) */}
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

          {/* ✅ [C2] TopBar reçoit section de type Section — pas d'erreur ts(2322) */}
          <TopBar
            section={section}
            apiReady={apiReady}
            lastUpdate={lastUpdate}
            wsConnected={wsConnected}
            isLive={isLive}
            theme={theme}
            onToggleTheme={toggleTheme}
          />

          <div className="main-content__scroll">

            {section === "dashboard" && (
              <DashboardPanel
                kpis={kpis}
                alarms={alarms}
                engines={engines}
                decisions={decisions}
                sessions={sessions}
                logLines={logLines}
                trust={trust}
                loading={loading}
                wsConnected={wsConnected}
                isLive={isLive}
              />
            )}

            {/* ✅ [C3] Agent correcteur rendu sans conflit de type */}
            {section === "corrective" && <CorrectiveAgentPanel />}

            {section === "track" && (
              <TrackServersPanel
                kpis={kpis}
                alarms={alarms}
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