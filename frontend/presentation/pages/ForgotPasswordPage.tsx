// src/pages/ForgotPasswordPage.tsx
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "../../shared/style/ForgotPasswordPage.css";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

export const ForgotPasswordPage = () => {
  const navigate = useNavigate();
  const [email, setEmail]     = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /* ── Cyber grid animation (identique LoginPage) ─────────── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const setSize = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    setSize();
    window.addEventListener("resize", setSize);

    let time = 0;
    const particles: Array<{ x:number; y:number; vx:number; vy:number; size:number; alpha:number }> = [];
    for (let i = 0; i < 100; i++) {
      particles.push({
        x:     Math.random() * canvas.width,
        y:     Math.random() * canvas.height,
        vx:    (Math.random() - 0.5) * 0.5,
        vy:    (Math.random() - 0.5) * 0.3,
        size:  Math.random() * 2 + 1,
        alpha: Math.random() * 0.5 + 0.2,
      });
    }

    const animate = () => {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, "#0a0e1a");
      gradient.addColorStop(0.5, "#0f121f");
      gradient.addColorStop(1, "#0a0e1a");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Grid
      const gridSize = 40;
      ctx.strokeStyle = "rgba(0, 212, 255, 0.06)";
      ctx.lineWidth = 1;
      for (let x = 0; x < canvas.width; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
      }

      // Hexagons
      const hexSize = 30;
      const hexWidth = hexSize * Math.sqrt(3);
      const hexHeight = hexSize * 2;
      const cols = Math.ceil(canvas.width  / hexWidth)  + 2;
      const rows = Math.ceil(canvas.height / hexHeight) + 2;
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = i * hexWidth;
          const y = j * hexHeight + (i % 2) * hexSize;
          const pulse = Math.sin(time * 0.001 + i * 0.2 + j * 0.3) * 0.3 + 0.1;
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const angle = (k * 60 - 30) * Math.PI / 180;
            const px = x + hexSize * Math.cos(angle);
            const py = y + hexSize * Math.sin(angle);
            if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.strokeStyle = `rgba(0, 212, 255, ${0.02 + pulse * 0.04})`;
          ctx.stroke();
        }
      }

      // Particles
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 212, 255, ${p.alpha + Math.sin(time * 0.002) * 0.1})`;
        ctx.fill();
      });

      // Lines
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 100) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(0, 212, 255, ${0.04 * (1 - dist / 100)})`;
            ctx.stroke();
          }
        }
      }
      ctx.globalCompositeOperation = "source-over";
      time++;
      requestAnimationFrame(animate);
    };

    animate();
    return () => window.removeEventListener("resize", setSize);
  }, []);

  /* ── Submit ──────────────────────────────────────────────── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setLoading(true);
    try {
      await axios.post(`${API_BASE}/auth/forgot-password`, { email });
      setMessage({ type: "success", text: "Un lien de réinitialisation a été envoyé à votre adresse email." });
    } catch {
      setMessage({ type: "error", text: "Adresse introuvable ou erreur serveur. Vérifiez votre email." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="forgot-container">
      <canvas ref={canvasRef} className="cyber-canvas" />

      <div className="forgot-overlay">
        <div className="forgot-card">
          <div className="card-glow" />

          {/* ── Header ── */}
          <div className="forgot-header">
            <div className="logo-wrapper">
              <div className="logo-ring">
                {/* Icône clé / reset */}
                <svg className="logo-icon" viewBox="0 0 24 24" fill="none">
                  <path d="M21 2L19 4M15 2C13.7 2 12.5 2.5 11.7 3.3L3 12V21H12L20.7 12.3C21.5 11.5 22 10.3 22 9C22 6.2 19.8 4 17 4"
                    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="17" cy="9" r="1.5" stroke="currentColor" strokeWidth="1.5"/>
                </svg>
              </div>
            </div>

            <div className="badge">
              <span className="badge-dot" />
              Récupération de compte
            </div>

            <h2 className="forgot-title">
              Mot de<span>passe oublié</span>
            </h2>

            <p className="forgot-subtitle">
              Saisissez votre adresse email admin. Vous recevrez un lien sécurisé pour réinitialiser votre accès.
            </p>
          </div>

          {/* ── Form ── */}
          <form onSubmit={handleSubmit} className="forgot-form">
            <div className="input-field">
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder=" "
              />
              <label htmlFor="email">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M4 4H20C21.1 4 22 4.9 22 6V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V6C2 4.9 2.9 4 4 4Z"
                    stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M22 6L12 13L2 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                Adresse email admin
              </label>
              <div className="input-border" />
            </div>

            {message?.type === "success" && (
              <div className="success-message">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M22 11.08V12C21.99 17.55 17.54 22 12 22C6.48 22 2 17.52 2 12C2 6.48 6.48 2 12 2C13.85 2 15.57 2.53 17 3.46"
                    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M22 4L12 14.01L9 11.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                {message.text}
              </div>
            )}

            {message?.type === "error" && (
              <div className="error-message">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M12 8V12M12 16H12.01M3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12Z"
                    stroke="currentColor" strokeWidth="1.5"/>
                </svg>
                {message.text}
              </div>
            )}

            <button type="submit" className="forgot-button" disabled={loading}>
              <span className="button-text">
                {loading ? (
                  <>
                    <svg className="spinner" viewBox="0 0 50 50">
                      <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
                    </svg>
                    Envoi en cours…
                  </>
                ) : (
                  "Envoyer le lien de réinitialisation"
                )}
              </span>
              {!loading && (
                <svg className="button-icon" viewBox="0 0 24 24" fill="none">
                  <path d="M22 2L11 13M22 2L15 22L11 13M11 13L2 9L22 2"
                    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>

            <div className="back-link-wrapper">
              <button type="button" className="back-link" onClick={() => navigate("/login")}>
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M19 12H5M5 12L12 19M5 12L12 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                Retour à la connexion
              </button>
            </div>
          </form>

          {/* ── Footer ── */}
          <div className="forgot-footer">
            <div className="security-badges">
              <span>🔐 JWT Encrypted</span>
              <span>🛡️ XSS Protected</span>
              <span>⚡ TLS 1.3</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};